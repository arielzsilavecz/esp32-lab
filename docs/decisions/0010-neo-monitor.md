# ADR-0010: NEO (servidor domestico) como dispositivo del backend

## Estado

Aceptado

## Fecha

2026-11-09

## Contexto

NEO es una notebook Asus VivoBook X441BA con Ubuntu Server, Docker y Home Assistant,
funcionando 24/7 dentro de una caja. Hace falta vigilar su temperatura (CPU A6-9225,
`high` 70 °C y `crit` 100 °C segun `k10temp`) y avisar si el equipo falla. Un monitoreo
que corre solo en NEO no detecta que NEO se apago.

## Decision

NEO es un dispositivo mas del backend (ADR-0006): fila en `dispositivos` con
`tipo = 'servidor'` y token propio, que empuja su estado a `POST /api/device/estado`.

- `tools/neo-monitor/neo-monitor.sh` + `neo-monitor.timer` (systemd, cada 60 s) leen
  temperatura CPU/GPU, frecuencia, carga, RAM y bateria. Instalado en
  `/usr/local/bin/` y `/etc/systemd/system/`; credenciales en `/etc/neo-monitor.env`
  (root, 600, fuera del repo).
- Cada lectura se agrega tambien a `/var/lib/neo-monitor/temp.csv`: respaldo si
  Railway o Internet fallan.
- Los sensores se buscan por `name` en `/sys/class/hwmon`, no por indice: `hwmonN`
  cambia entre arranques.
- El estado es JSONB libre (ADR-0006), asi que no hay migracion. Las push solo se
  disparan para `tipo = 'alarma'`, por lo que NEO no genera avisos.
- El frontend tiene una rama `servidor` de solo lectura; antes cualquier tipo que no
  fuera `alarma` se dibujaba como el porton.

## Alternativas consideradas

- **Mover todo el backend a NEO**: descartada por ahora. Exige HTTPS publico (PWA,
  WebAuthn, push) sin acceso al router, expone un backend que abre una puerta fisica, y
  concentra portón, alarma y avisos en un solo equipo. NEO no puede avisar de su propia
  caida. Se podria revisar por etapas con un ADR que reemplace al 0006.
- **Solo System Monitor de Home Assistant**: queda como complemento, pero tambien
  depende de que NEO este vivo.

## Consecuencias

- La presencia de NEO (`last_seen_at`) permite detectar que dejo de reportar: umbral de
  90 s para tipos distintos de `porton`, y NEO reporta cada 60 s (margen corto).
- 1 fila por minuto en `estados`: ~86.000 filas a 60 dias de retencion (ADR-0009).
- Pendiente: alerta push por temperatura alta; hoy el push esta atado a zonas de alarma.
