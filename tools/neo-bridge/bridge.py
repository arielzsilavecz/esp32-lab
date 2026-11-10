#!/usr/bin/env python3
"""Puente NEO: Home Assistant <-> backend de Railway (ver ADR-0011).

Por cada dispositivo configurado (luz o disyuntor), un hilo:
  - pide al backend la orden pendiente cada ~1 s (eso tambien es su latido),
  - la ejecuta en Home Assistant si esta en la lista cerrada,
  - reporta el estado al backend: al cambiar, y cada cierto tiempo.

Solo biblioteca estandar. Config en /etc/neo-bridge.json y el token de Home
Assistant en /etc/neo-bridge-ha.token (ambos root, 600, fuera del repo).
"""
import http.client
import json
import sys
import threading
import time
import urllib.parse
import urllib.request

CONFIG_PATH = "/etc/neo-bridge.json"

# Lista cerrada: el backend tambien la valida, aca es la segunda barrera.
SERVICIOS = {
    "luz": {"encender": "light/turn_on", "apagar": "light/turn_off", "alternar": "light/toggle"},
    "disyuntor": {"encender": "switch/turn_on", "apagar": "switch/turn_off"},
}
# Cada cuanto reportar aunque nada cambie: el disyuntor alimenta las metricas en vivo.
REPORTE_CADA_S = {"luz": 30, "disyuntor": 5}

# Factores a la unidad que espera el backend (W, V, A, kWh).
UNIDADES = {"W": 1, "kW": 1000, "V": 1, "mV": 0.001, "A": 1, "mA": 0.001, "kWh": 1, "Wh": 0.001}


def log(*partes):
    print(*partes, flush=True)


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

    def servicio(self, servicio, entity_id):
        self._pedir("POST", f"/api/services/{servicio}", {"entity_id": entity_id})


class Backend:
    """Conexion HTTPS persistente: rehacer TLS cada segundo es caro (ver ADR-0009)."""

    def __init__(self, url, token):
        partes = urllib.parse.urlparse(url)
        self.host = partes.hostname
        self.headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        self.conn = None

    def _pedir(self, metodo, ruta, cuerpo=None):
        datos = json.dumps(cuerpo) if cuerpo is not None else None
        for intento in (1, 2):
            try:
                if self.conn is None:
                    self.conn = http.client.HTTPSConnection(self.host, timeout=10)
                self.conn.request(metodo, ruta, body=datos, headers=self.headers)
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


def leer_estado(ha, dispositivo):
    principal = ha.estado(dispositivo["entity"])
    if principal is None or principal.get("state") not in ("on", "off"):
        return None  # sin dato confiable: mejor no reportar que reportar basura
    estado = {"encendido": principal["state"] == "on"}
    if dispositivo["kind"] == "luz":
        brillo = principal.get("attributes", {}).get("brightness")
        if isinstance(brillo, (int, float)):
            estado["brillo"] = round(brillo * 100 / 255)
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
                # ttl_ms: la orden vence a los 5 s; si ya vencio, no se ejecuta.
                if servicio and comando.get("ttl_ms", 0) > 0:
                    ha.servicio(servicio, dispositivo["entity"])
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
        print("selftest OK")
    else:
        main()
