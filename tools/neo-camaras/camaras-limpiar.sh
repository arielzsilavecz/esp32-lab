#!/bin/bash
# Mantiene cada camara bajo su limite de espacio (CAM_LIMITE_GB de su .env):
# borra sus grabaciones mas viejas. Nunca toca el segmento que se esta
# escribiendo (el mas nuevo) ni archivos fuera de la carpeta de esa camara.
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
  done < <(ls -1tr "$dir"/*.mkv 2>/dev/null | head -n -1)
  [ "$borrados" -gt 0 ] && echo "$nombre: $borrados grabaciones viejas borradas (limite ${limite_gb} GB)"
done
exit 0
