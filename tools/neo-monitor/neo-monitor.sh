#!/bin/bash
# Lee temperatura, carga, RAM y bateria de NEO, los guarda en CSV local y los
# empuja a POST /api/device/estado del backend. El CSV es el respaldo si
# Railway o Internet fallan; el push es best-effort.
set -u
. /etc/neo-monitor.env   # NEO_TOKEN, NEO_URL

# hwmonN cambia de numero entre arranques: se busca por nombre, nunca por indice.
hw() { local d; for d in /sys/class/hwmon/hwmon*; do [ "$(cat "$d/name")" = "$1" ] && { echo "$d"; return; }; done; }
mc() { awk '{printf "%.1f", $1/1000}' "$1"; }

cpu=$(mc "$(hw k10temp)/temp1_input")
gpu=$(mc "$(hw amdgpu)/temp1_input")
freq=$(awk '{s+=$1} END {printf "%d", s/NR/1000}' /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq)
load=$(cut -d' ' -f1 /proc/loadavg)
ram=$(free | awk '/Mem:/ {printf "%d", ($2-$7)*100/$2}')
bat=$(cat /sys/class/power_supply/BAT*/capacity)
cargando=false; [ "$(cat /sys/class/power_supply/AC*/online)" = 1 ] && cargando=true

mkdir -p /var/lib/neo-monitor
csv=/var/lib/neo-monitor/temp.csv
[ -f "$csv" ] || echo "ts,cpu_c,gpu_c,freq_mhz,load1,ram_pct,bateria_pct,cargando" > "$csv"
echo "$(date -Is),$cpu,$gpu,$freq,$load,$ram,$bat,$cargando" >> "$csv"

curl -fsS -m 15 -X POST "$NEO_URL/api/device/estado" \
  -H "Authorization: Bearer $NEO_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"estado\":{\"cpu_c\":$cpu,\"gpu_c\":$gpu,\"freq_mhz\":$freq,\"load1\":$load,\"ram_pct\":$ram,\"bateria_pct\":$bat,\"cargando\":$cargando}}" \
  >/dev/null || echo "push fallo (CSV guardado)" >&2
