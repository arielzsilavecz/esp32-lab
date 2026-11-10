"""Vigilancia de una camara en NEO (ADR-0015). Solo corre con alguien en
"Estoy afuera" (cabecera X-Vigilancia de la espera de ordenes).

- Un ffmpeg sobre la calidad secundaria saca 2 cuadros/s de 64x36 en gris (para
  detectar movimiento) y deja la ultima foto en color en /dev/shm (1/s).
- Movimiento = parte de la imagen distinta de un fondo que se adapta lento
  (nubes, sombras) sostenida unos segundos. Un cambio casi total de golpe es la
  camara pasando a modo noche: rearma el fondo, no dispara.
- Con movimiento, el modelo local mira la foto de ese instante; si hay persona
  o vehiculo se sube la foto y Railway avisa.
- X-Reforzar (Z1/Z2 activada): sube ya la foto del instante (va en el aviso de
  zona), analiza sin esperar movimiento y por 10 min baja los umbrales.

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

AJUSTES = {
    "umbral_pixel": 25,         # diferencia de gris (0-255) para que un pixel cuente como cambiado
    "adaptacion": 0.05,         # cuanto se acerca el fondo al cuadro nuevo en cada paso
    "normal": {"area": 0.08, "segundos": 4, "ventana_s": 6},
    "reforzado": {"area": 0.03, "segundos": 1, "ventana_s": 2},
    "cambio_global": 0.6,       # mas que esto de golpe: cambio de luz, no movimiento
    "reforzado_s": 600,
    "pausa_analisis_s": {"normal": 180, "reforzado": 60},
    "pausa_aviso_s": 300,
    "temperatura_max_c": 80,
}


def log(*partes):
    print("vigilancia:", *partes, flush=True)


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


def es_jpeg(datos):
    return len(datos) > 4 and datos[:2] == b"\xff\xd8" and datos[-2:] == b"\xff\xd9"


def temperatura_c():
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return int(f.read()) / 1000
    except (OSError, ValueError):
        return 0.0


ESQUEMA = {"type": "object", "additionalProperties": False,
           "required": ["descripcion", "persona", "vehiculo"],
           "properties": {"descripcion": {"type": "string", "maxLength": 140},
                          "persona": {"type": "boolean"}, "vehiculo": {"type": "boolean"}}}

PREGUNTA = ("Imagen de la cámara de la entrada de una casa. Describí en una frase corta en español "
            "lo que se ve (descripcion) y decí si hay alguna persona o algún vehículo.")


def analizar(url_llm, jpeg):
    """{descripcion, persona, vehiculo} segun el modelo local (~2 min en NEO)."""
    imagen = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
    cuerpo = {"messages": [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": imagen}}, {"type": "text", "text": PREGUNTA}]}],
        "temperature": 0, "max_tokens": 120,
        "response_format": {"type": "json_schema", "json_schema": {"schema": ESQUEMA}}}
    req = urllib.request.Request(url_llm + "/v1/chat/completions", json.dumps(cuerpo).encode(),
                                 {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=400) as resp:
        return json.loads(json.load(resp)["choices"][0]["message"]["content"])


class Vigilancia:
    def __init__(self, dispositivo, url_llm, subir):
        """subir(jpeg, motivo, descripcion=None): POST /api/device/captura."""
        self.dispositivo, self.url_llm, self.subir = dispositivo, url_llm, subir
        self.ajustes = {**AJUSTES, **dispositivo.get("vigilancia", {})}
        self.nombre = dispositivo["nombre"]
        self.foto = f"/dev/shm/neo-vigilancia-{abs(hash(dispositivo['rtsp'])) % 10**6}.jpg"
        self.activa = False
        self.reforzado_hasta = 0.0
        self.mirando = None
        self.disparo = threading.Event()
        self.foto_disparo = None
        threading.Thread(target=self._analizar_siempre, daemon=True).start()

    # --- Entrada: cabeceras de cada respuesta de ordenes ---------------------
    def actualizar(self, activa, reforzar):
        if activa != self.activa:
            log(self.nombre, "activada" if activa else "desactivada")
        self.activa = activa
        if activa and (self.mirando is None or not self.mirando.is_alive()):
            self.mirando = threading.Thread(target=self._mirar, daemon=True)
            self.mirando.start()
        if activa and reforzar:
            self.reforzado_hasta = time.monotonic() + self.ajustes["reforzado_s"]
            threading.Thread(target=self._zona, daemon=True).start()

    def reforzado(self):
        return time.monotonic() < self.reforzado_hasta

    def _leer_foto(self, max_edad_s=3.0):
        """Ultima foto en color si es reciente. ffmpeg la reescribe en el lugar:
        una lectura a medio escribir no cierra en FF D9 y se reintenta."""
        for _ in range(10):
            try:
                if time.time() - os.path.getmtime(self.foto) <= max_edad_s:
                    with open(self.foto, "rb") as f:
                        datos = f.read()
                    if es_jpeg(datos):
                        return datos
            except OSError:
                pass
            time.sleep(0.2)
        return None

    def _zona(self):
        foto = self._leer_foto()
        if foto is None:
            log(self.nombre, "Z1/Z2 sin foto reciente")
            return
        self.subir(foto, "zona")
        log(self.nombre, "foto de Z1/Z2 subida")
        self._disparar(foto)  # en reforzado se analiza sin esperar movimiento

    def _disparar(self, foto):
        self.foto_disparo = foto
        self.disparo.set()

    # --- Deteccion de movimiento ---------------------------------------------
    def _mirar(self):
        a = self.ajustes
        detector, sostenido = Detector(a["umbral_pixel"], a["adaptacion"]), Sostenido()
        tamano = ANCHO * ALTO
        while self.activa:
            proceso = subprocess.Popen(
                ["ffmpeg", "-nostdin", "-loglevel", "error", "-rtsp_transport", "tcp",
                 "-timeout", "10000000", "-i", self.dispositivo["rtsp"], "-an",
                 "-filter_complex", f"[0:v]fps={CUADROS_POR_S},split[a][b];[a]scale={ANCHO}:{ALTO},format=gray[g];[b]fps=1[c]",
                 "-map", "[g]", "-f", "rawvideo", "pipe:1",
                 "-map", "[c]", "-q:v", "5", "-update", "1", "-y", self.foto],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
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
                        foto = self._leer_foto(max_edad_s=1.5)
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
        try:
            os.remove(self.foto)
        except OSError:
            pass
        log(self.nombre, "dejo de mirar")

    # --- Analisis con el modelo ----------------------------------------------
    def _analizar_siempre(self):
        ultimo_analisis, ultimo_aviso = 0.0, 0.0
        while True:
            self.disparo.wait()
            self.disparo.clear()
            foto, ahora = self.foto_disparo, time.monotonic()
            pausa = self.ajustes["pausa_analisis_s"]["reforzado" if self.reforzado() else "normal"]
            if not self.activa or foto is None or ahora - ultimo_analisis < pausa:
                continue  # un disparo durante la pausa se descarta, no se encola
            if temperatura_c() > self.ajustes["temperatura_max_c"]:
                log(self.nombre, "analisis salteado por temperatura")
                continue
            ultimo_analisis = ahora
            try:
                inicio = time.monotonic()
                resultado = analizar(self.url_llm, foto)
                log(self.nombre, f"analisis en {time.monotonic() - inicio:.0f} s:", resultado)
            except Exception as error:  # noqa: BLE001 - el hilo nunca debe morir
                log(self.nombre, "analisis fallo:", error)
                continue
            texto = aviso(resultado)
            if texto and self.activa and time.monotonic() - ultimo_aviso >= self.ajustes["pausa_aviso_s"]:
                ultimo_aviso = time.monotonic()
                self.subir(foto, "deteccion", texto)


def aviso(resultado):
    """Texto de la notificacion, o None si no hay persona ni vehiculo."""
    quien = [q for q, clave in (("Persona", "persona"), ("Vehículo", "vehiculo")) if resultado.get(clave) is True]
    if not quien:
        return None
    descripcion = str(resultado.get("descripcion", "")).strip()
    return f"{' y '.join(quien)} en la entrada" + (f": {descripcion}" if descripcion else "")


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
    assert aviso({"descripcion": "auto", "persona": True, "vehiculo": True}).startswith("Persona y Vehículo")
    assert aviso({"descripcion": "un perro", "persona": False, "vehiculo": False}) is None
    assert es_jpeg(b"\xff\xd8xx\xff\xd9") and not es_jpeg(b"\xff\xd8xx")
    print("selftest vigilancia OK")


if __name__ == "__main__":
    selftest()
