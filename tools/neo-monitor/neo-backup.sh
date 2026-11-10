#!/bin/bash
# Backup diario de NEO al HDD (/mnt/backups). Conserva las ultimas 14 copias.
# Contiene /etc/neo-monitor.env (token): el archivo queda 600 y nunca va al repo.
set -euo pipefail
DEST=/mnt/backups
KEEP=14

mountpoint -q "$DEST" || { echo "ERROR: $DEST no esta montado" >&2; exit 1; }

out="$DEST/neo-$(date +%Y%m%d-%H%M%S).tar.gz"
umask 077
# La base del recorder de Home Assistant se excluye: es historial regenerable y
# copiarla en caliente puede dejarla inconsistente. Config, usuarios y
# automatizaciones (.storage, YAML) si entran.
tar -czf "$out" \
  --exclude='home-assistant_v2.db*' --exclude='*.log*' \
  /home/ariel/neo \
  /etc/neo-monitor.env \
  /etc/systemd/system/neo-monitor.service /etc/systemd/system/neo-monitor.timer \
  /etc/systemd/system/battery-limit.service /etc/systemd/system/cpu-limit.service \
  /usr/local/bin/neo-monitor.sh /usr/local/bin/neo-backup.sh \
  /etc/netplan/60-ethernet.yaml /etc/docker/daemon.json \
  /etc/ssh/sshd_config.d/00-solo-claves.conf 2>/dev/null
tar -tzf "$out" >/dev/null   # verifica que el archivo se pueda leer

ls -1t "$DEST"/neo-*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm --
echo "OK $out ($(du -h "$out" | cut -f1))"
