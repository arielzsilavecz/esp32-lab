#!/bin/bash
# Mantiene cada camara bajo su limite de espacio (CAM_LIMITE_GB de su .env):
# borra sus grabaciones mas viejas. Nunca toca el segmento que se esta
# escribiendo (el mas nuevo) ni archivos fuera de la carpeta de esa camara.
# Ademas reinicia el grabador si esta grabando sin audio (ver abajo).
set -u
CONFIG_DIR=${CONFIG_DIR:-/etc/neo-camaras}
GRABACIONES_DIR=${GRABACIONES_DIR:-/mnt/backups/camaras}

for env in "$CONFIG_DIR"/*.env; do
  [ -e "$env" ] || continue
  nombre=$(basename "$env" .env)
  dir="$GRABACIONES_DIR/$nombre"
  [ -d "$dir" ] || continue
  limite_gb=$(. "$env"; echo "${CAM_LIMITE_GB:-50}")
  maximo=$(( limite_gb * 1024 * 1024 * 1024 ))
  total=$(du -sb "$dir" | cut -f1)
  borrados=0
  # Mas viejos primero; "head -n -1" deja afuera el mas nuevo (en escritura).
  while IFS= read -r archivo; do
    [ "$total" -le "$maximo" ] && break
    tamano=$(stat -c %s "$archivo")
    rm -f -- "$archivo"
    total=$(( total - tamano ))
    borrados=$(( borrados + 1 ))
  done < <(ls -1tr "$dir"/*.mkv 2>/dev/null | head -n -1 2>/dev/null)
  [ "$borrados" -gt 0 ] && echo "$nombre: $borrados grabaciones viejas borradas (limite ${limite_gb} GB)"

  # Control de audio. A veces, al reconectarse, la camara manda audio unos
  # segundos (o nada) y no lo retoma en esa conexion: el video sigue y el audio
  # queda vacio hasta el proximo reinicio (medido: 11/11 y 13/11, horas sin
  # audio). Si el segmento en curso declara audio pero no tiene ni un paquete,
  # se reinicia el grabador (se pierden ~2 s de video). Solo con mas de 3 min
  # andando: asi nunca se juzga un archivo de antes del ultimo reinicio.
  servicio="camara@$nombre"
  inicio=$(systemctl show "$servicio" -p ActiveEnterTimestampMonotonic --value)
  ahora=$(cut -d' ' -f1 /proc/uptime | cut -d. -f1)
  [ -n "$inicio" ] && [ "$inicio" -gt 0 ] && [ $(( ahora - inicio / 1000000 )) -gt 180 ] || continue
  actual=$(ls -1t "$dir"/*.mkv 2>/dev/null | head -n 1)
  # Un segmento recien empezado puede no tener el audio escrito todavia: se
  # juzga recien con ~40 s de video (~1 Mbps).
  [ -n "$actual" ] && [ "$(stat -c %s "$actual")" -gt 5000000 ] || continue
  ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$actual" 2>/dev/null | grep -q . || continue
  paquetes=$(ffprobe -v error -select_streams a -show_entries packet=stream_index -of csv=p=0 "$actual" 2>/dev/null | wc -l)
  if [ "$paquetes" -eq 0 ]; then
    echo "$nombre: grabando sin audio, reinicio el grabador"
    systemctl restart "$servicio"
  fi
done
exit 0
