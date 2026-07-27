# esp32-lab

Plataforma de experimentación para ESP32 orientada a ingeniería inversa y automatización
de dispositivos de radiofrecuencia de baja potencia (433 MHz como primer foco).

No es un proyecto para "abrir un portón". Es una base de código reutilizable para
analizar, comprender, reproducir y controlar distintos dispositivos RF, empezando por un
control remoto Garen de portón y extendiéndose luego a alarmas, sensores inalámbricos,
NFC y domótica.

## Filosofía

Medir → analizar → comprender → recién después automatizar. Ver `CLAUDE.md` para la
filosofía completa y la forma de trabajo esperada en este repo.

## Estructura

```
esp32-lab/
├── docs/
│   ├── decisions/   ADRs — por qué se eligió cada cosa
│   ├── hardware/    pinout, datasheets, notas de cableado
│   └── captures/    capturas RF exportadas
└── firmware/        proyecto PlatformIO (se crea en la Etapa 1)
```

## Hardware

- ESP32 WROOM-32 (USB-C)
- Receptor 433 MHz MX-05V, transmisor 433 MHz FS1000A, antenas helicoidales

## Roadmap

1. Configuración base (PlatformIO, blink, serial monitor)
2. Fundaciones (GPIO, logging, config)
3. Captura RF (interrupciones, timestamps, duración de pulsos)
4. Análisis de protocolos (sin asumir protocolo de antemano)
5. Comparación de capturas
6. Transmisión RF
7. Servidor HTTP / API REST

Detalle completo en `CLAUDE.md`.
