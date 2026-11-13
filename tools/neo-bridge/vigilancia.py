"""Vigilancia de una camara en NEO (ADR-0015). Solo corre con alguien en
"Estoy afuera" (cabecera X-Vigilancia de la espera de ordenes).

- Un ffmpeg sobre la calidad secundaria saca 2 cuadros/s de 64x36 en gris (para
  detectar movimiento) y 2 fotos/s en color, de las que se guardan en memoria
  los ultimos ~12 s.
- Movimiento = parte de la imagen distinta de un fondo que se adapta lento
  (nubes, sombras) sostenida unos segundos. Un cambio casi total de golpe es la
  camara pasando a modo noche: rearma el fondo, no dispara.
- Con movimiento, el modelo local mira la foto de ese instante; si hay persona
  o vehiculo se sube la foto y Railway avisa.
- X-Reforzar "<zona>@<ms>" (Z1/Z2 activada): sube la foto de unos segundos
  antes de la activacion (va en el aviso de zona), la analiza sin esperar
  movimiento y por 10 min baja los umbrales.

Solo biblioteca estandar. Los umbrales se ajustan en la config de la camara
("vigilancia": {...}) sin tocar codigo: dependen del lugar.
"""
import base64
import collections
import json
import os
import subprocess
import threading
import time
import urllib.request

ANCHO, ALTO = 64, 36
CUADROS_POR_S = 2
SEGUNDOS_GUARDADOS = 12

AJUSTES = {
    "umbral_pixel": 25,         # diferencia de gris (0-255) para que un pixel cuente como cambiado
    "adaptacion": 0.05,         # cuanto se acerca el fondo al cuadro nuevo en cada paso
    "normal": {"area": 0.08, "segundos": 4, "ventana_s": 6},
    "reforzado": {"area": 0.03, "segundos": 1, "ventana_s": 2},
    "cambio_global": 0.6,       # mas que esto de golpe: cambio de luz, no movimiento
    "reforzado_s": 600,
    "pausa_analisis_s": {"normal": 180, "reforzado": 60},  # desde que termina el anterior
    "pausa_aviso_s": 300,
    "temperatura_max_c": 80,
    # Foto del aviso de zona: cuantos segundos antes de la activacion, por zona.
    "antes_s": {"1": 2, "2": 3},
    # Cuanto llega atrasada una imagen a NEO respecto de la realidad (stream de
    # la camara menos lo que tarda el aviso de zona en llegar). Se calibra.
    "retraso_camara_s": 1.0,
}


def log(*partes):
    print("vigilancia:", *partes, flush=True)


def extraer_jpegs(buffer):
    """Separa los JPEG completos de un flujo MJPEG (de FF D8 a FF D9).
    Devuelve (cuadros, resto). FF D9 no aparece dentro de los datos de un JPEG
    de ffmpeg: los FF del contenido se codifican como FF 00."""
    cuadros = []
    while True:
        inicio = buffer.find(b"\xff\xd8")
        fin = buffer.find(b"\xff\xd9", inicio + 2) if inicio >= 0 else -1
        if inicio < 0 or fin < 0:
            return cuadros, buffer[inicio:] if inicio >= 0 else b""
        cuadros.append(buffer[inicio:fin + 2])
        buffer = buffer[fin + 2:]


class Detector:
    """Fraccion de la imagen que difiere del fondo. Sin numpy: 2304 pixeles a
    2 cuadros/s son nada para Python."""

    def __init__(self, umbral, adaptacion):
        self.umbral, self.adaptacion = umbral, adaptacion
        self.fondo = None

    def fraccion(self, cuadro):
        if self.fondo is None:
            self.fondo = [float(p) for p in cuadro]
            return 0.0
        cambiados = sum(1 for p, f in zip(cuadro, self.fondo) if abs(p - f) > self.umbral)
        a = self.adaptacion
        self.fondo = [f + (p - f) * a for p, f in zip(cuadro, self.fondo)]
        return cambiados / len(cuadro)

    def reiniciar(self):
        self.fondo = None


class Sostenido:
    """True cuando en los ultimos `ventana_s` hubo al menos `segundos` de cuadros
    sobre el area minima: un movimiento grande y que dura, no un pajaro."""

    def __init__(self):
        self.ultimos = collections.deque()

    def agregar(self, fraccion, modo):
        ventana = modo["ventana_s"] * CUADROS_POR_S
        self.ultimos.append(fraccion >= modo["area"])
        while len(self.ultimos) > ventana:
            self.ultimos.popleft()
        return sum(self.ultimos) >= modo["segundos"] * CUADROS_POR_S

    def vaciar(self):
        self.ultimos.clear()


def foto_mas_cercana(fotos, momento, tolerancia_s=1.5):
    """De [(llegada, jpeg)], la que llego mas cerca de `momento`, o None."""
    if not fotos:
        return None
    llegada, jpeg = min(fotos, key=lambda f: abs(f[0] - momento))
    return jpeg if abs(llegada - momento) <= tolerancia_s else None


def momento_foto_zona(ajustes, zona, activada_en):
    """Hora de llegada a NEO de la foto que muestra la escena `antes_s` segundos
    antes de la activacion de la zona."""
    antes = ajustes["antes_s"].get(str(zona), 2)
    return activada_en - antes + ajustes["retraso_camara_s"]


def leer_reforzar(valor):
    """'1@1731300000123' -> (1, 1731300000.123); None si falta o es invalido.
    '1' (backend anterior, sin zona ni hora): como Z1 activada ahora."""
    if valor == "1":
        return 1, time.time()
    try:
        zona, ms = valor.split("@")
        return int(zona), int(ms) / 1000
    except (AttributeError, ValueError):
        return None


def temperatura_c():
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return int(f.read()) / 1000
    except (OSError, ValueError):
        return 0.0


# Primero decide, despues describe. Enumerarle la escena fija para que no la
# describa no sirve: el modelo de 2B la copia. Se le pide describir solo a las
# personas y vehiculos. "vehiculo" es uno detenido frente a la entrada: los que
# pasan por la calle no interesan (y como una foto no muestra si se mueve, se
# confirma con una segunda foto; ver _analizar_siempre).
ESQUEMA = {"type": "object", "additionalProperties": False,
           "required": ["persona", "vehiculo", "descripcion"],
           "properties": {"persona": {"type": "boolean"}, "vehiculo": {"type": "boolean"},
                          "descripcion": {"type": "string", "maxLength": 300}}}

PREGUNTA = (
    "Imagen de la cámara de seguridad de la entrada de una casa. Indicá si hay alguna persona y si "
    "hay algún vehículo detenido o estacionado justo frente a la entrada (un vehículo que circula "
    "por la calle no cuenta). En descripcion describí solo a esas personas o vehículos en pocas "
    "palabras: cuántos, cómo son y qué hacen. No menciones el lugar ni el fondo. Si no hay "
    "ninguno, descripcion vacía.")


def analizar(url_llm, jpeg):
    """{descripcion, persona, vehiculo} segun el modelo local (~2 min en NEO)."""
    imagen = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
    cuerpo = {"messages": [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": imagen}}, {"type": "text", "text": PREGUNTA}]}],
        "temperature": 0, "max_tokens": 160,
        "response_format": {"type": "json_schema", "json_schema": {"schema": ESQUEMA}}}
    req = urllib.request.Request(url_llm + "/v1/chat/completions", json.dumps(cuerpo).encode(),
                                 {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=400) as resp:
        return json.loads(json.load(resp)["choices"][0]["message"]["content"])


class Vigilancia:
    def __init__(self, dispositivo, url_llm, subir, evento):
        """subir(jpeg, motivo, descripcion=None): POST /api/device/captura (queda
        en el registro con su foto). evento(texto): linea del registro sin foto."""
        self.dispositivo, self.url_llm, self.subir, self.evento = dispositivo, url_llm, subir, evento
        self.ajustes = {**AJUSTES, **dispositivo.get("vigilancia", {})}
        self.nombre = dispositivo["nombre"]
        self.fotos = collections.deque(maxlen=SEGUNDOS_GUARDADOS * CUADROS_POR_S)  # (llegada, jpeg)
        self.activa = False
        self.reforzado_hasta = 0.0
        self.mirando = None
        self.disparo = threading.Event()
        self.foto_disparo = None
        threading.Thread(target=self._analizar_siempre, daemon=True).start()

    # --- Entrada: cabeceras de cada respuesta de ordenes ---------------------
    def actualizar(self, activa, reforzar=None):
        """reforzar: (zona, hora de activacion en s epoch) o None."""
        if activa != self.activa:
            log(self.nombre, "activada" if activa else "desactivada")
            self.evento("Vigilancia activada" if activa else "Vigilancia desactivada")
        self.activa = activa
        if activa and (self.mirando is None or not self.mirando.is_alive()):
            self.mirando = threading.Thread(target=self._mirar, daemon=True)
            self.mirando.start()
        if activa and reforzar:
            self.reforzado_hasta = time.monotonic() + self.ajustes["reforzado_s"]
            threading.Thread(target=self._zona, args=reforzar, daemon=True).start()

    def reforzado(self):
        return time.monotonic() < self.reforzado_hasta

    def _zona(self, zona, activada_en):
        momento = momento_foto_zona(self.ajustes, zona, activada_en)
        espera = momento + 0.6 - time.time()  # si cae en el futuro, esperar a que llegue
        if espera > 0:
            time.sleep(min(espera, 5))
        foto = foto_mas_cercana(list(self.fotos), momento)
        if foto is None:
            log(self.nombre, f"Z{zona} sin foto de ese momento")
            self.evento(f"Z{zona} activada, sin foto de ese momento")
            return
        antes = self.ajustes["antes_s"].get(str(zona), 2)
        self.subir(foto, "zona", f"Foto de Z{zona}, {antes} s antes")
        log(self.nombre, f"foto de Z{zona} subida ({time.time() - momento:.1f} s atras)")
        self._disparar(foto)  # en reforzado se analiza sin esperar movimiento

    def _disparar(self, foto):
        self.foto_disparo = foto
        self.disparo.set()

    # --- Deteccion de movimiento ---------------------------------------------
    def _guardar_fotos(self, lectura):
        pendiente = b""
        with os.fdopen(lectura, "rb") as flujo:
            while True:
                trozo = flujo.read1(65536)
                if not trozo:
                    return
                cuadros, pendiente = extraer_jpegs(pendiente + trozo)
                for cuadro in cuadros:
                    self.fotos.append((time.time(), cuadro))

    def _mirar(self):
        a = self.ajustes
        detector, sostenido = Detector(a["umbral_pixel"], a["adaptacion"]), Sostenido()
        tamano = ANCHO * ALTO
        while self.activa:
            # Dos salidas: gris chico por stdout y fotos en color por un pipe aparte.
            lectura, escritura = os.pipe()
            proceso = subprocess.Popen(
                ["ffmpeg", "-nostdin", "-loglevel", "error", "-rtsp_transport", "tcp",
                 "-timeout", "10000000", "-i", self.dispositivo["rtsp"], "-an",
                 "-filter_complex", f"[0:v]fps={CUADROS_POR_S},split[a][c];[a]scale={ANCHO}:{ALTO},format=gray[g]",
                 "-map", "[g]", "-f", "rawvideo", "pipe:1",
                 "-map", "[c]", "-c:v", "mjpeg", "-q:v", "5", "-f", "image2pipe", f"pipe:{escritura}"],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, pass_fds=(escritura,))
            os.close(escritura)
            threading.Thread(target=self._guardar_fotos, args=(lectura,), daemon=True).start()
            log(self.nombre, "mirando")
            try:
                while self.activa:
                    cuadro = proceso.stdout.read(tamano)
                    if len(cuadro) < tamano:
                        break  # camara caida: se relanza
                    fraccion = detector.fraccion(cuadro)
                    if fraccion >= a["cambio_global"]:
                        detector.reiniciar()
                        sostenido.vaciar()
                        continue
                    modo = a["reforzado"] if self.reforzado() else a["normal"]
                    if sostenido.agregar(fraccion, modo):
                        sostenido.vaciar()
                        foto = foto_mas_cercana(list(self.fotos), time.time())
                        if foto:
                            self._disparar(foto)
            finally:
                proceso.terminate()
                try:
                    proceso.wait(5)
                except subprocess.TimeoutExpired:
                    proceso.kill()
            if self.activa:
                time.sleep(5)
        self.fotos.clear()
        log(self.nombre, "dejo de mirar")

    # --- Analisis con el modelo ----------------------------------------------
    def _analizar_siempre(self):
        fin_analisis, ultimo_aviso = 0.0, 0.0
        while True:
            self.disparo.wait()
            self.disparo.clear()
            foto = self.foto_disparo
            pausa = self.ajustes["pausa_analisis_s"]["reforzado" if self.reforzado() else "normal"]
            if not self.activa or foto is None or time.monotonic() - fin_analisis < pausa:
                continue  # un disparo durante la pausa se descarta, no se encola
            if temperatura_c() > self.ajustes["temperatura_max_c"]:
                log(self.nombre, "analisis salteado por temperatura")
                continue
            try:
                inicio = time.monotonic()
                resultado = analizar(self.url_llm, foto)
                log(self.nombre, f"analisis en {time.monotonic() - inicio:.0f} s:", resultado)
                # Solo vehiculo: una foto no dice si estaba pasando. La de ahora
                # (~2 min despues) tiene que seguir mostrandolo.
                if resultado.get("vehiculo") is True and resultado.get("persona") is not True:
                    ahora = foto_mas_cercana(list(self.fotos), time.time())
                    segundo = analizar(self.url_llm, ahora) if ahora else {}
                    log(self.nombre, "confirmacion de vehiculo:", segundo)
                    if segundo.get("vehiculo") is not True:
                        resultado = {**resultado, "vehiculo": False, "paso": True}
            except Exception as error:  # noqa: BLE001 - el hilo nunca debe morir
                log(self.nombre, "analisis fallo:", error)
                self.evento("Análisis falló")
                continue
            finally:
                fin_analisis = time.monotonic()
            texto = aviso(resultado)
            if not texto:
                self.evento("Análisis: un vehículo pasó, no se detuvo" if resultado.get("paso")
                            else "Análisis: sin personas ni vehículos detenidos")
            elif not self.activa:
                self.evento(f"Análisis: {texto} (sin aviso, la vigilancia ya terminó)")
            elif time.monotonic() - ultimo_aviso < self.ajustes["pausa_aviso_s"]:
                self.evento(f"Análisis: {texto} (sin aviso, hubo uno hace menos de 5 min)")
            else:
                ultimo_aviso = time.monotonic()
                self.subir(foto, "deteccion", texto)


def aviso(resultado):
    """Texto de la notificacion, o None si no hay persona ni vehiculo."""
    persona, vehiculo = resultado.get("persona") is True, resultado.get("vehiculo") is True
    if not (persona or vehiculo):
        return None
    quien = ("Persona y vehículo detenido" if persona and vehiculo
             else "Persona" if persona else "Vehículo detenido")
    descripcion = str(resultado.get("descripcion", "")).strip()
    return f"{quien} en la entrada" + (f": {descripcion}" if descripcion else "")


def selftest():
    d = Detector(umbral=25, adaptacion=0.05)
    quieto = bytes([100]) * (ANCHO * ALTO)
    assert d.fraccion(quieto) == 0.0 and d.fraccion(quieto) == 0.0
    mitad = bytes([200]) * (ANCHO * ALTO // 2) + bytes([100]) * (ANCHO * ALTO // 2)
    assert abs(d.fraccion(mitad) - 0.5) < 1e-9
    s, normal = Sostenido(), AJUSTES["normal"]
    # 4 s de 6 sobre el area: 7 cuadros no alcanzan, el 8.o dispara
    assert not any(s.agregar(0.2, normal) for _ in range(7))
    assert s.agregar(0.2, normal)
    s.vaciar()
    assert not any(s.agregar(0.05, normal) for _ in range(20))  # chico: nunca en modo normal
    assert any(s.agregar(0.05, AJUSTES["reforzado"]) for _ in range(2))  # en reforzado si
    assert aviso({"descripcion": "un hombre en la vereda", "persona": True, "vehiculo": False}) == \
        "Persona en la entrada: un hombre en la vereda"
    assert aviso({"descripcion": "auto", "persona": True, "vehiculo": True}).startswith("Persona y vehículo detenido")
    assert aviso({"descripcion": "auto gris", "persona": False, "vehiculo": True}) == \
        "Vehículo detenido en la entrada: auto gris"
    assert aviso({"descripcion": "auto", "persona": False, "vehiculo": False, "paso": True}) is None
    assert aviso({"descripcion": "", "persona": True, "vehiculo": False}) == "Persona en la entrada"
    assert aviso({"descripcion": "un perro", "persona": False, "vehiculo": False}) is None
    # Foto de zona: Z1 2 s antes, Z2 3 s antes, mas el retraso de la camara.
    assert momento_foto_zona(AJUSTES, 1, 1000.0) == 999.0
    assert momento_foto_zona(AJUSTES, 2, 1000.0) == 998.0
    fotos = [(990.0 + i / 2, bytes([i])) for i in range(24)]  # 990,0 .. 1001,5
    assert foto_mas_cercana(fotos, 998.0) == bytes([16])
    assert foto_mas_cercana(fotos, 999.2) == bytes([18])
    assert foto_mas_cercana(fotos, 980.0) is None and foto_mas_cercana([], 1.0) is None
    assert leer_reforzar("2@1731300000123") == (2, 1731300000.123)
    assert leer_reforzar(None) is None and leer_reforzar("x@y") is None and leer_reforzar("2") is None
    assert leer_reforzar("1")[0] == 1
    a, b = b"\xff\xd8AAA\xff\x00\xff\xd9", b"\xff\xd8BB\xff\xd9"
    assert extraer_jpegs(b"basura" + a + b + b"\xff\xd8CC") == ([a, b], b"\xff\xd8CC")
    assert extraer_jpegs(b"\xff\xd8sin fin") == ([], b"\xff\xd8sin fin")
    assert extraer_jpegs(b"sin inicio") == ([], b"")
    print("selftest vigilancia OK")


if __name__ == "__main__":
    selftest()
