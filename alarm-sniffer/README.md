# alarm-sniffer/

Proyecto PlatformIO separado (ESP32 físico distinto al del portón) para el bus DATO del
teclado de un panel de alarma Xanaes 610. Ver `docs/decisions/0007-alarm-sniffer.md` y
`docs/hardware/xanaes-dato-wiring.md` antes de cablear nada.

**El firmware solo captura flancos con timestamp** — no decodifica nada a bordo, igual
que la Etapa 3 del portón. El análisis (offline, en la PC) es lo que decodificó el
protocolo: las 12 teclas del teclado y el estado de zonas 1-6 ya están mapeados. Ver
`docs/hardware/xanaes-dato-protocol.md` para la tabla completa, y ADR-0008 para el
diseño (todavía no implementado) de un transmisor.

## Uso

1. Cablear DATO a GPIO34 a través del divisor (ver doc de hardware arriba).
2. `pio run --target upload`
3. Abrir el monitor serie (115200 baud).
4. Enviar `c` → arranca la captura.
5. Ir hasta el teclado real y apretar la tecla que se quiere capturar.
6. Enviar `s` → para la captura y vuelca el CSV por serial.
7. Guardar el CSV en `docs/captures/` y analizarlo con
   `tools/analyze_capture.py <archivo>`.

## Por qué es un proyecto aparte

No un segundo *environment* dentro de `firmware/`: son aplicaciones no relacionadas en
ESP32 físicamente distintos. Reusa `DigitalPin`, `Logger` y `RfReceiver` de
`firmware/lib/` vía `lib_extra_dirs` en `platformio.ini` — sin duplicar código ni tocar
una sola línea del firmware del portón, que ya está validado en producción.
