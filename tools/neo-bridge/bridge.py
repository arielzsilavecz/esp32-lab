#!/usr/bin/env python3
"""Puente NEO: Home Assistant <-> backend de Railway (ver ADR-0011).

Por cada dispositivo configurado (luz o disyuntor), un hilo:
  - pide al backend la orden pendiente cada ~1 s (eso tambien es su latido),
  - la ejecuta en Home Assistant si esta en la lista cerrada,
  - reporta el estado al backend: al cambiar, y cada cierto tiempo.

Las camaras (kind "camara", ADR-0012) no pasan por Home Assistant: con la orden
"ver" se lanza ffmpeg sobre su RTSP y se suben cuadros JPEG al backend durante
2 min (o hasta "detener"). Sin pedido no hay ffmpeg ni trafico.

Solo biblioteca estandar. Config en /etc/neo-bridge.json y el token de Home
Assistant en /etc/neo-bridge-ha.token (ambos root, 600, fuera del repo).
"""
import http.client
import json
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

CONFIG_PATH = "/etc/neo-bridge.json"

# Lista cerrada: el backend tambien la valida, aca es la segunda barrera.
SERVICIOS = {
    "luz": {"encender": "light/turn_on", "apagar": "light/turn_off", "alternar": "light/toggle",
            "ajustar": "light/turn_on"},
    "disyuntor": {"encender": "switch/turn_on", "apagar": "switch/turn_off"},
}
# Cada cuanto reportar aunque nada cambie: el disyuntor alimenta las metricas en vivo.
REPORTE_CADA_S = {"luz": 30, "disyuntor": 5}

# Factores a la unidad que espera el backend (W, V, A, kWh).
UNIDADES = {"W": 1, "kW": 1000, "V": 1, "mV": 0.001, "A": 1, "mA": 0.001, "kWh": 1, "Wh": 0.001}


def log(*partes):
    print(*partes, flush=True)


# Rangos de los focos CozyLife segun Home Assistant (min/max_color_temp_kelvin).
TEMPERATURA_K = (2000, 6535)


def ajuste_a_ha(parametros):
    """Traduce los parametros de "ajustar" al servicio light.turn_on, o None si
    son invalidos. Repite la validacion del backend (src/lightParams.js)."""
    if not isinstance(parametros, dict) or not parametros:
        return None
    if set(parametros) - {"brillo", "temperatura_k", "color"}:
        return None
    if "temperatura_k" in parametros and "color" in parametros:
        return None

    def entero(v, minimo, maximo):
        return isinstance(v, int) and not isinstance(v, bool) and minimo <= v <= maximo

    datos = {}
    if "brillo" in parametros:
        if not entero(parametros["brillo"], 1, 100):
            return None
        datos["brightness_pct"] = parametros["brillo"]
    if "temperatura_k" in parametros:
        if not entero(parametros["temperatura_k"], *TEMPERATURA_K):
            return None
        datos["color_temp_kelvin"] = parametros["temperatura_k"]
    if "color" in parametros:
        color = parametros["color"]
        if not (isinstance(color, str) and len(color) == 7 and color[0] == "#"):
            return None
        try:
            datos["rgb_color"] = [int(color[i:i + 2], 16) for i in (1, 3, 5)]
        except ValueError:
            return None
    return datos


def a_numero(estado_ha):
    """Valor numerico de un sensor de HA convertido a la unidad base, o None."""
    if not estado_ha:
        return None
    try:
        valor = float(estado_ha["state"])
    except (KeyError, TypeError, ValueError):
        return None  # 'unavailable', 'unknown'
    factor = UNIDADES.get(estado_ha.get("attributes", {}).get("unit_of_measurement"), 1)
    return round(valor * factor, 3)


class HomeAssistant:
    def __init__(self, url, token):
        self.url = url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def _pedir(self, metodo, ruta, cuerpo=None):
        datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
        req = urllib.request.Request(self.url + ruta, data=datos, method=metodo, headers=self.headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read() or b"null")

    def estado(self, entity_id):
        try:
            return self._pedir("GET", f"/api/states/{entity_id}")
        except Exception as error:  # noqa: BLE001 - un sensor caido no detiene el puente
            log("HA estado fallo", entity_id, error)
            return None

    def servicio(self, servicio, entity_id, datos=None):
        self._pedir("POST", f"/api/services/{servicio}", {"entity_id": entity_id, **(datos or {})})


class Backend:
    """Conexion HTTPS persistente: rehacer TLS cada segundo es caro (ver ADR-0009)."""

    def __init__(self, url, token):
        partes = urllib.parse.urlparse(url)
        self.host = partes.hostname
        self.headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        self.conn = None

    def _pedir(self, metodo, ruta, cuerpo=None, tipo=None):
        # bytes (un JPEG) van crudos con su tipo; el resto como JSON.
        datos = cuerpo if isinstance(cuerpo, bytes) else (json.dumps(cuerpo) if cuerpo is not None else None)
        headers = {**self.headers, "Content-Type": tipo} if tipo else self.headers
        for intento in (1, 2):
            try:
                if self.conn is None:
                    self.conn = http.client.HTTPSConnection(self.host, timeout=10)
                self.conn.request(metodo, ruta, body=datos, headers=headers)
                resp = self.conn.getresponse()
                texto = resp.read()
                return resp.status, (json.loads(texto) if texto and resp.status == 200 else None)
            except (OSError, http.client.HTTPException, json.JSONDecodeError):
                self.conn = None  # socket cerrado por Railway: se reabre una vez
                if intento == 2:
                    raise

    def comando_pendiente(self):
        return self._pedir("GET", "/api/device/comando-pendiente")

    def consumido(self, comando_id):
        return self._pedir("POST", f"/api/device/comando/{comando_id}/consumido")

    def reportar(self, estado):
        return self._pedir("POST", "/api/device/estado", {"estado": estado})

    def subir_imagen(self, jpeg):
        return self._pedir("POST", "/api/device/imagen", jpeg, tipo="image/jpeg")


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


VER_SEGUNDOS = 120  # corte automatico: la pagina renueva con "Seguir mirando"


class Transmision:
    """ffmpeg -> cuadros JPEG -> backend, solo mientras haya un pedido vigente."""

    def __init__(self, dispositivo, url):
        self.dispositivo = dispositivo
        self.url = url
        self.hasta = 0.0
        self.hilo = None

    def activa(self):
        return time.monotonic() < self.hasta

    def ver(self):
        self.hasta = time.monotonic() + VER_SEGUNDOS
        if self.hilo is None or not self.hilo.is_alive():
            self.hilo = threading.Thread(target=self._correr, daemon=True)
            self.hilo.start()

    def detener(self):
        self.hasta = 0.0

    def _correr(self):
        # Conexion propia: http.client no se comparte entre hilos.
        backend = Backend(self.url, self.dispositivo["token"])
        nombre = self.dispositivo["nombre"]
        while self.activa():
            # 2 cuadros/s de la calidad secundaria (640x360): decodificar 1080p
            # todo el tiempo no entra en el CPU de NEO.
            proceso = subprocess.Popen(
                ["ffmpeg", "-nostdin", "-loglevel", "error", "-rtsp_transport", "tcp",
                 "-timeout", "10000000", "-i", self.dispositivo["rtsp"],
                 "-an", "-vf", "fps=2", "-q:v", "7", "-f", "image2pipe", "-c:v", "mjpeg", "-"],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            log(nombre, "transmitiendo")
            pendiente = b""
            try:
                while self.activa():
                    trozo = proceso.stdout.read1(65536)
                    if not trozo:
                        break  # ffmpeg termino (camara caida): se relanza si sigue el pedido
                    cuadros, pendiente = extraer_jpegs(pendiente + trozo)
                    for cuadro in cuadros:
                        backend.subir_imagen(cuadro)
            except Exception as error:  # noqa: BLE001
                log(nombre, "error transmitiendo:", error)
            finally:
                proceso.terminate()
                try:
                    proceso.wait(5)
                except subprocess.TimeoutExpired:
                    proceso.kill()
            if self.activa():
                time.sleep(3)
        log(nombre, "transmision detenida")


# Giro PTZ: pulso de ContinuousMove y Stop. Medido en la camara de la entrada:
# 1 s a velocidad 0,6 corre ~1/3 del cuadro; 0,4 s a 0,5 es un paso controlable.
GIROS = {"arriba": (0, 0.5), "abajo": (0, -0.5), "izquierda": (-0.5, 0), "derecha": (0.5, 0)}
GIRO_SEGUNDOS = 0.4


def onvif_ptz(url_ptz, cuerpo):
    sobre = ('<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" '
             'xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">'
             f'<s:Body>{cuerpo}</s:Body></s:Envelope>')
    req = urllib.request.Request(url_ptz, data=sobre.encode(), headers={"Content-Type": "application/soap+xml"})
    with urllib.request.urlopen(req, timeout=8) as resp:
        return resp.read()


def girar(dispositivo, direccion):
    x, y = GIROS[direccion]  # direccion ya validada: KeyError si no
    perfil = dispositivo.get("perfil", "Profile_1")
    onvif_ptz(dispositivo["onvif_ptz"], f'<tptz:ContinuousMove><tptz:ProfileToken>{perfil}</tptz:ProfileToken>'
                                        f'<tptz:Velocity><tt:PanTilt x="{x}" y="{y}"/></tptz:Velocity></tptz:ContinuousMove>')
    try:
        time.sleep(GIRO_SEGUNDOS)
    finally:
        # Frenar siempre: una camara que queda girando es peor que un pulso perdido.
        onvif_ptz(dispositivo["onvif_ptz"], f'<tptz:Stop><tptz:ProfileToken>{perfil}</tptz:ProfileToken>'
                                            '<tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>')


def atender_camara(dispositivo, url):
    nombre = dispositivo["nombre"]
    backend = Backend(url, dispositivo["token"])
    transmision = Transmision(dispositivo, url)
    ultimo_estado, ultimo_reporte = None, 0.0
    while True:
        inicio = time.monotonic()
        try:
            status, comando = backend.comando_pendiente()
            if status == 200 and comando:
                tipo = comando.get("tipo_comando")
                vigente = comando.get("ttl_ms", 0) > 0
                direccion = (comando.get("parametros") or {}).get("direccion")
                if vigente and tipo == "ver":
                    transmision.ver()
                elif tipo == "detener":
                    transmision.detener()
                elif vigente and tipo == "mover" and direccion in GIROS and dispositivo.get("onvif_ptz"):
                    girar(dispositivo, direccion)
                else:
                    log(nombre, "orden rechazada o vencida", tipo)
                backend.consumido(comando["id"])
            estado = {"transmitiendo": transmision.activa()}
            ahora = time.monotonic()
            if estado != ultimo_estado or ahora - ultimo_reporte >= 60:
                backend.reportar(estado)
                ultimo_estado, ultimo_reporte = estado, ahora
        except Exception as error:  # noqa: BLE001 - el hilo nunca debe morir
            log(nombre, "error:", error)
            time.sleep(5)
        # En reposo cada 2 s alcanza ("ver" tarda a lo sumo eso en arrancar);
        # mirando, cada 0,5 s para que las flechas de giro respondan enseguida.
        intervalo = 0.5 if transmision.activa() else 2.0
        time.sleep(max(0.0, intervalo - (time.monotonic() - inicio)))


def leer_estado(ha, dispositivo):
    principal = ha.estado(dispositivo["entity"])
    if principal is None or principal.get("state") not in ("on", "off"):
        return None  # sin dato confiable: mejor no reportar que reportar basura
    estado = {"encendido": principal["state"] == "on"}
    if dispositivo["kind"] == "luz":
        atributos = principal.get("attributes", {})
        brillo = atributos.get("brightness")
        if isinstance(brillo, (int, float)):
            estado["brillo"] = round(brillo * 100 / 255)
        # Blanco (temperatura) y color son modos excluyentes del foco.
        if atributos.get("color_mode") == "color_temp":
            estado["modo"] = "blanco"
            if isinstance(atributos.get("color_temp_kelvin"), int):
                estado["temperatura_k"] = atributos["color_temp_kelvin"]
        elif atributos.get("color_mode") in ("hs", "rgb", "xy"):
            estado["modo"] = "color"
            rgb = atributos.get("rgb_color")
            if isinstance(rgb, list) and len(rgb) == 3:
                estado["color"] = "#" + "".join(f"{int(c):02x}" for c in rgb)
    for clave, entity_id in dispositivo.get("sensors", {}).items():
        estado[clave] = a_numero(ha.estado(entity_id))
    return estado


def atender(dispositivo, ha, url):
    nombre, kind = dispositivo["nombre"], dispositivo["kind"]
    backend = Backend(url, dispositivo["token"])
    ultimo_estado, ultimo_reporte = None, 0.0

    while True:
        inicio = time.monotonic()
        try:
            status, comando = backend.comando_pendiente()
            if status == 200 and comando:
                tipo = comando.get("tipo_comando")
                servicio = SERVICIOS[kind].get(tipo)
                datos = ajuste_a_ha(comando.get("parametros")) if tipo == "ajustar" else None
                if tipo == "ajustar" and datos is None:
                    servicio = None  # parametros invalidos: se rechaza
                # ttl_ms: la orden vence a los 5 s; si ya vencio, no se ejecuta.
                if servicio and comando.get("ttl_ms", 0) > 0:
                    ha.servicio(servicio, dispositivo["entity"], datos)
                    log(nombre, "ejecutado", tipo)
                    time.sleep(0.8)  # que HA refleje el cambio antes de reportar
                    ultimo_reporte = 0.0
                else:
                    log(nombre, "orden rechazada o vencida", tipo)
                backend.consumido(comando["id"])

            estado = leer_estado(ha, dispositivo)
            ahora = time.monotonic()
            # En el disyuntor la potencia varia en cada lectura: solo encender/
            # apagar cuenta como cambio inmediato; las metricas van por intervalo.
            cambio = estado is not None and (
                ultimo_estado is None
                or (estado["encendido"] != ultimo_estado["encendido"] if kind == "disyuntor" else estado != ultimo_estado)
            )
            if estado is not None and (cambio or ahora - ultimo_reporte >= REPORTE_CADA_S[kind]):
                backend.reportar(estado)
                ultimo_estado, ultimo_reporte = estado, ahora
        except Exception as error:  # noqa: BLE001 - el hilo nunca debe morir
            log(nombre, "error:", error)
            time.sleep(5)
        time.sleep(max(0.0, 1.0 - (time.monotonic() - inicio)))


def main():
    with open(CONFIG_PATH) as f:
        config = json.load(f)
    with open(config["ha_token_file"]) as f:
        ha = HomeAssistant(config.get("ha_url", "http://localhost:8123"), f.read().strip())

    for dispositivo in config["devices"]:
        if dispositivo["kind"] == "camara":
            threading.Thread(target=atender_camara, args=(dispositivo, config["url"]), daemon=True).start()
            log("atendiendo", dispositivo["nombre"], "camara")
            continue
        if dispositivo["kind"] not in SERVICIOS:
            sys.exit(f"tipo no soportado: {dispositivo['kind']}")
        threading.Thread(target=atender, args=(dispositivo, ha, config["url"]), daemon=True).start()
        log("atendiendo", dispositivo["nombre"], dispositivo["entity"])

    while True:
        time.sleep(3600)


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        assert a_numero({"state": "1500", "attributes": {"unit_of_measurement": "mA"}}) == 1.5
        assert a_numero({"state": "2.5", "attributes": {"unit_of_measurement": "kW"}}) == 2500
        assert a_numero({"state": "unavailable", "attributes": {}}) is None
        assert a_numero(None) is None
        assert SERVICIOS["disyuntor"].get("alternar") is None  # el disyuntor no se alterna a ciegas
        assert SERVICIOS["disyuntor"].get("ajustar") is None
        assert ajuste_a_ha({"brillo": 60}) == {"brightness_pct": 60}
        assert ajuste_a_ha({"temperatura_k": 3000, "brillo": 5}) == {"color_temp_kelvin": 3000, "brightness_pct": 5}
        assert ajuste_a_ha({"color": "#ff6a00"}) == {"rgb_color": [255, 106, 0]}
        for malo in (None, {}, {"brillo": 0}, {"brillo": True}, {"brillo": 50.5}, {"temperatura_k": 9000},
                     {"color": "#zzzzzz"}, {"color": "red"}, {"color": "#fff", "brillo": 3},
                     {"temperatura_k": 3000, "color": "#ffffff"}, {"efecto": 1}):
            assert ajuste_a_ha(malo) is None, malo
        a, b = b"\xff\xd8AAA\xff\x00\xff\xd9", b"\xff\xd8BB\xff\xd9"
        assert extraer_jpegs(b"basura" + a + b + b"\xff\xd8CC") == ([a, b], b"\xff\xd8CC")
        assert extraer_jpegs(b"\xff\xd8sin fin") == ([], b"\xff\xd8sin fin")
        assert extraer_jpegs(b"sin inicio") == ([], b"")
        assert set(GIROS) == {"arriba", "abajo", "izquierda", "derecha"}  # igual a DIRECCIONES del backend
        print("selftest OK")
    else:
        main()
