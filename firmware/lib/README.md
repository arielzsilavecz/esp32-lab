# lib/

Librerías privadas del proyecto (convención PlatformIO: cada subcarpeta es una
librería aislada, sus headers son visibles desde cualquier otro módulo sin rutas
relativas). Organizadas por capa, no por caso de uso:

- **`config/`** — constantes centralizadas (pines, baudrate, timings).
- **`logger/`** — logging por niveles sobre `Serial` (capa Utilidades).
- **`hardware/`** — wrappers de GPIO/periféricos (capa Hardware).
- **`rf_receiver/`** — captura de flancos por interrupción (capa Drivers, ADR-0003).
- **`rf_transmitter/`** — generación de ondas PWM (capa Drivers, ADR-0005).
- **`backend_client/`** — cliente HTTPS de `backend/`, hace polling de comandos
  pendientes (capa Drivers, ADR-0006). No gestiona la conexión WiFi — eso lo hace
  `main.cpp` antes de usarlo, igual que no gestiona el pin de otros módulos.

Las constantes de un dispositivo concreto (el control Garen, por ejemplo) **no** van
acá: son conocimiento de aplicación y viven en `src/`.

`Secrets.h` (gitignored, plantilla en `Secrets.example.h`) tiene las credenciales de
WiFi y el token del dispositivo — nunca se commitea.
