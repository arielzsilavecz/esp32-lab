#!/bin/bash
# Lee temperatura, carga, RAM y bateria de NEO, los guarda en CSV local y los
# empuja a POST /api/device/estado del backend. El CSV es el respaldo si
# Railway o Internet fallan; el push es best-effort.
set -u
. /etc/neo-monitor.env   # NEO_TOKEN, NEO_URL

# hwmonN cambia de numero entre arranques: se busca por nombre, nunca por indice.
hw() { local d; for d in /sys/class/hwmon/hwmon*; do [ "$(cat "$d/name")" = "$1" ] && { echo "$d"; return; }; done; }

# Un pico de segundos (arranque, inferencia) no se ve con una lectura por
# minuto: se muestrea cada 5 s y se reporta el maximo. freq_min_mhz bajo = throttling.
cpu_dir=$(hw k10temp); gpu_dir=$(hw amdgpu)
cpu_max=0; gpu_max=0; freq_min=999999
nucleos_freq=(/sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_cur_freq)
suma_nucleo=()
for _ in $(seq 12); do
  c=$(cat "$cpu_dir/temp1_input"); g=$(cat "$gpu_dir/temp1_input")
  f=$(awk '{s+=$1} END {printf "%d", s/NR/1000}' "${nucleos_freq[@]}")
  [ "$c" -gt "$cpu_max" ] && cpu_max=$c
  [ "$g" -gt "$gpu_max" ] && gpu_max=$g
  [ "$f" -lt "$freq_min" ] && freq_min=$f
  # Velocidad por nucleo: promedio del minuto (un instante suelto es ruido de schedutil).
  for i in "${!nucleos_freq[@]}"; do
    suma_nucleo[$i]=$(( ${suma_nucleo[$i]:-0} + $(cat "${nucleos_freq[$i]}") ))
  done
  sleep 5
done
cpu=$(awk -v v="$cpu_max" 'BEGIN {printf "%.1f", v/1000}')
gpu=$(awk -v v="$gpu_max" 'BEGIN {printf "%.1f", v/1000}')
freq=$freq_min
nucleos=$(for s in "${suma_nucleo[@]}"; do echo $(( s / 12 / 1000 )); done | paste -sd,)
ssd=$(df --output=pcent / | tail -1 | tr -dc 0-9)
# El HDD puede no estar montado (nofail): se reporta null en vez de medir el SSD.
hdd=null; mountpoint -q /mnt/backups && hdd=$(df --output=pcent /mnt/backups | tail -1 | tr -dc 0-9)
load=$(cut -d' ' -f1 /proc/loadavg)
ram=$(free | awk '/Mem:/ {printf "%d", ($2-$7)*100/$2}')
bat=$(cat /sys/class/power_supply/BAT*/capacity)
enchufado=false; [ "$(cat /sys/class/power_supply/AC*/online)" = 1 ] && enchufado=true

mkdir -p /var/lib/neo-monitor
csv=/var/lib/neo-monitor/temp.csv
[ -f "$csv" ] || echo "ts,cpu_c,gpu_c,freq_min_mhz,load1,ram_pct,bateria_pct,enchufado,nucleos_mhz,ssd_pct,hdd_pct" > "$csv"
echo "$(date -Is),$cpu,$gpu,$freq,$load,$ram,$bat,$enchufado,${nucleos//,/ },$ssd,$hdd" >> "$csv"

curl -fsS -m 15 -X POST "$NEO_URL/api/device/estado" \
  -H "Authorization: Bearer $NEO_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"estado\":{\"cpu_c\":$cpu,\"gpu_c\":$gpu,\"freq_min_mhz\":$freq,\"nucleos_mhz\":[$nucleos],\"load1\":$load,\"ram_pct\":$ram,\"bateria_pct\":$bat,\"enchufado\":$enchufado,\"disco_ssd_pct\":$ssd,\"disco_hdd_pct\":$hdd}}" \
  >/dev/null || echo "push fallo (CSV guardado)" >&2
