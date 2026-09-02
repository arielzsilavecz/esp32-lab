# ADR-0006: Backend de control remoto (Railway + Postgres, adentro del repo)

## Estado

Aceptado

## Fecha

2026-08-18

## Contexto

La Etapa 7 original preveía que la ESP32 sirviera su propia página HTTP. Eso choca con
un límite duro: HTTPS (obligatorio para service worker/PWA instalable) no puede convivir
con la ESP32 sirviendo HTTP plano en la LAN sin certificados y sin exponer un puerto a
internet — que además el usuario descartó explícitamente por seguridad.

Durante el diseño surgieron dos cosas que cambiaron el problema:

1. El usuario ya tiene stacks probados en otros proyectos propios (`gastos-app`,
   `nono-lalo`: Vercel + Supabase; `bot-backend`: Railway + Postgres + Express) y
   prefiere reutilizarlos a aprender infraestructura nueva (VPN, MQTT).
2. El objetivo declarado no es "abrir un portón" sino el arranque de una plataforma de
   domótica: luces, sensores, y un proyecto de alarma por ESP32 aparte, todos hablando
   con el mismo backend.

## Decisión

**Backend propio en `backend/` (Node/Express + Postgres), deployado en Railway, dentro
de este mismo repo** — no en un repo separado, y no Supabase.

- **Railway+Postgres en vez de Supabase**: la cuenta de Supabase del usuario ya está en
  el tope de proyectos gratis. Además, con Postgres crudo la API se escribe a mano (sin
  RLS/PostgREST autogenerado) — encaja mejor con la filosofía del proyecto de no
  depender de capas que ocultan la lógica.
- **Un solo proceso Express sirve API + frontend estático**, sin Vercel: el contenedor
  de Railway ya está prendido 24/7 para la API, servir el build estático no cuesta nada
  extra y evita mantener dos plataformas de deploy para una app de este tamaño.
- **Frontend en HTML/CSS/JS plano**, no React/Vite: para una pantalla de login + una
  lista de botones de dispositivo, un toolchain de frontend completo es más de lo que el
  problema pide. Mismo patrón que ya usa `bot-backend` para sus páginas de admin. Se
  reevalúa si en el futuro hace falta reactividad real (estado de sensores en vivo).
- **Modelo de datos genérico** (`dispositivos`, `comandos`), no `comandos_porton`: el
  portón es el primer dispositivo, no un caso especial. Agregar una luz o un sensor es
  una fila nueva, no una tabla ni un endpoint nuevo.
- **Auth por dos vías separadas**: personas con cuenta real (bcrypt + sesión, mismo
  patrón que `bot-backend`) para poder auditar quién activó qué; dispositivos con un
  token propio por fila de `dispositivos` (`Authorization: Bearer`), no atado a una
  sesión de usuario, así se puede revocar un dispositivo sin tocar cuentas de personas.
- **La ESP32 hace polling saliente** (`GET` a la API cada 1s) en vez de correr un
  servidor: no necesita IP pública, no hay puerto que abrir, funciona igual desde la red
  local o desde afuera. El costo de infraestructura lo domina el proceso estando
  prendido 24/7, no la cantidad de requests — a esta escala (un puñado de dispositivos)
  1s de intervalo no mueve la aguja del costo frente a 5s.
- **Vive dentro de `esp32-lab`**, pese a no ser específico de RF ni de este dispositivo:
  decisión explícita del usuario, no recomendación del agente (ver Alternativas).

## Alternativas consideradas

- **Supabase** (Vercel + Supabase, como `gastos-app`/`nono-lalo`) — descartada: tope de
  proyectos gratis alcanzado. Además hubiera resuelto auth/API gratis vía RLS/PostgREST,
  pero como capa más opaca que escribir la API a mano.
- **Repo separado para el backend** (recomendación inicial del agente, con el argumento
  de que `CLAUDE.md` scopea este repo a ingeniería inversa de RF y un backend de
  domótica compartido por varios proyectos futuros no es RF-específico) — el usuario la
  rechazó explícitamente ("no quiero otra carpeta"), dos veces. Se documenta la
  discrepancia por transparencia, no se fuerza la alternativa. Consecuencia: el alcance
  de este repo, tal como queda escrito en `CLAUDE.md` §1, ya no es puramente RF.
- **VPN (Tailscale) o broker MQTT** para el acceso remoto, evaluadas antes de conocer
  que el usuario ya tenía stacks propios corriendo — descartadas por ser infraestructura
  nueva a aprender, cuando reusar lo que ya opera (Railway) resuelve lo mismo.
- **React/Vite para el frontend** (como en `gastos-app`/`nono-lalo`) — descartado por
  ahora: agrega un toolchain completo de build para una pantalla de login y una lista de
  botones. Revisar si aparece necesidad real de estado reactivo complejo.
- **Frecuencia de polling variable por horario** (2s de día, 5s de madrugada) —
  planteada por el usuario, descartada tras aclarar que el costo de Railway lo domina el
  tiempo de proceso corriendo, no la cantidad de requests: la variación no ahorra nada
  real a esta escala, así que no se agrega la complejidad.

## Consecuencias

- `CLAUDE.md` §1 ya no describe este repo como exclusivamente RF — incluye el backend de
  domótica. Cualquier sesión futura que lea el CLAUDE.md desactualizado (de antes del
  2026-08-18) va a tener una imagen incompleta del alcance real.
- El repo pasa a tener tres lenguajes/runtimes: C++ (`firmware/`), Python (`tools/`),
  Node/JS (`backend/`). Cada uno con su propio `README.md` de convenciones — no hay un
  único "Estilo de código" que aplique a los tres.
- La ESP32 pasa a depender de WiFi + un servicio externo para el control remoto. El
  botón físico BOOT (ver `main.cpp`) y el control Garen original siguen funcionando
  igual, sin depender de la red — son el fallback si Railway o el WiFi de casa están
  caídos.
- El token por dispositivo vive en `Secrets.h` (gitignored) del lado del firmware, igual
  que las credenciales de WiFi — ver `firmware/lib/config/Secrets.example.h`.
