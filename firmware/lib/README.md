# lib/

Librerías privadas del proyecto (convención PlatformIO: cada subcarpeta es una
librería aislada, sus headers son visibles desde cualquier otro módulo sin rutas
relativas). Organizadas por capa, no por caso de uso:

- **`config/`** — constantes centralizadas (pines, baudrate, timings).
- **`logger/`** — logging por niveles sobre `Serial` (capa Utilidades).
- **`hardware/`** — wrappers de GPIO/periféricos (capa Hardware).

Drivers RF y módulos de protocolo se agregan acá mismo a partir de la Etapa 3.
