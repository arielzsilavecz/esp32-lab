# alarm-sniffer/

Proyecto PlatformIO separado (ESP32 físico distinto al del portón) para el bus DATO del
teclado de un panel de alarma Xanaes 610. Ver `docs/decisions/0007-alarm-sniffer.md` y
`docs/hardware/xanaes-dato-wiring.md` antes de cablear nada.

**La captura (RX) solo registra flancos con timestamp** — no decodifica nada a bordo,
igual que la Etapa 3 del portón. El análisis (offline, en la PC) es lo que decodificó
el protocolo: las 12 teclas del teclado y el estado de zonas 1-6 ya están mapeados. Ver
`docs/hardware/xanaes-dato-protocol.md` para la tabla completa.

**La escritura (TX) sí vive a bordo**: el firmware puede simular apretar una tecla del
teclado real, escribiendo directo sobre el bus DATO en vivo — ver ADR-0008 para el
circuito (transistor BC547C, colector/drenador abierto) y
`alarm-sniffer/lib/dato_transmitter/` + `alarm-sniffer/lib/xanaes_protocol/` para el
driver y la tabla de códigos. En la práctica no logró hacer reaccionar al panel real; se
dejó el circuito y el código tal cual, sin usar (ver ADR-0009 — más seguro así).

**El estado de zonas se reporta solo, en segundo plano**: con WiFi conectado, el
firmware encadena ventanas de captura de 200ms, busca la trama de estado del panel y,
si la encuentra, decodifica las 6 zonas y las manda al backend (mismo backend que el
portón, ver ADR-0009). Se ve en la misma página que controla el portón. No decodifica
ni expone nunca las teclas apretadas — ver ADR-0009 por qué importa. La captura y HTTPS
corren en tareas separadas: mientras la red envía o reintenta un estado, el bus sigue
siendo escuchado y una cola conserva siempre el estado más reciente.

## Uso — captura (RX)

1. Cablear DATO a GPIO34 a través del divisor (ver doc de hardware arriba).
2. `pio run --target upload`
3. Abrir el monitor serie (115200 baud).
4. Enviar `c` → arranca la captura.
5. Ir hasta el teclado real y apretar la tecla que se quiere capturar.
6. Enviar `s` → para la captura y vuelca el CSV por serial.
7. Guardar el CSV en `docs/captures/` y analizarlo con
   `tools/analyze_capture.py <archivo>`.

## Uso — escritura (TX)

Con el circuito de `docs/hardware/xanaes-dato-wiring.md` cableado (GPIO27 + BC547C):
enviar por el monitor serie cualquiera de `0-9`, `*` o `#` simula esa tecla en el
teclado real. **El transistor está conectado directo al bus real del panel** — no es
un ensayo de banco, cada tecla enviada es una pulsación real sobre un sistema de
seguridad en uso. El botón "casita" no está expuesto (ver ADR-0008, función real sin
confirmar).

## Uso — estado en vivo

Requiere, del lado de `backend/` (una sola vez, contra la base de producción):

```
npm run migrate 002_estado_dispositivo.sql
npm run seed dispositivo "Alarma" alarma
```

El segundo comando imprime un token — completar `kAlarmDeviceToken` en
`firmware/lib/config/Secrets.h` (gitignored, compartido con el portón) con ese valor.
El WiFi y la URL del backend son las mismas constantes que ya usa el portón, no hace
falta duplicarlas. Con eso cargado, no hay nada más que hacer: el reporte corre solo.

## Por qué es un proyecto aparte

No un segundo *environment* dentro de `firmware/`: son aplicaciones no relacionadas en
ESP32 físicamente distintos. Reusa `DigitalPin`, `Logger` y `RfReceiver` de
`firmware/lib/` vía `lib_extra_dirs` en `platformio.ini` — sin duplicar código ni tocar
una sola línea del firmware del portón, que ya está validado en producción.
