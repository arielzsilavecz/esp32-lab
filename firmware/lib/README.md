# lib/

Librerías privadas del proyecto (convención PlatformIO: cada subcarpeta con su propio
`src/`+`include/` es una librería aislada, compilada por separado). Acá van drivers
(RF TX/RX) y módulos de protocolo a medida que se implementen — no dependencias
externas, esas van en `platformio.ini` (`lib_deps`).
