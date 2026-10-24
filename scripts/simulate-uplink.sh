#!/bin/sh
# Simule des uplinks ChirpStack d'une sonde SE01-LS (demo sans capteur).
# Usage : ./scripts/simulate-uplink.sh [intervalle_s]   (Ctrl+C pour arrêter)
cd "$(dirname "$0")/.." || exit 1
export LC_ALL=C  # point décimal dans le JSON
PASS=$(grep ^MOSQUITTO_HA_PASSWORD= .env | cut -d= -f2-)
while :; do
  hum=$(awk -v r=$RANDOM 'BEGIN{printf "%.1f", 20 + r%400/10}')
  tmp=$(awk -v r=$RANDOM 'BEGIN{printf "%.1f", 12 + r%80/10}')
  ec=$((300 + RANDOM % 200))
  snr=$(awk -v r=$RANDOM 'BEGIN{printf "%.1f", -12 + r%100/10}')
  msg="{\"deviceInfo\":{\"deviceName\":\"sonde-jardin\",\"devEui\":\"a840410000000001\"},\"object\":{\"water_SOIL\":$hum,\"temp_SOIL\":$tmp,\"conduct_SOIL\":$ec,\"BatV\":3.9},\"rxInfo\":[{\"rssi\":-112,\"snr\":$snr}]}"
  docker compose exec -T mosquitto mosquitto_pub -u homeassistant -P "$PASS" \
    -t application/demo/device/a840410000000001/event/up -m "$msg" && echo "sent hum=$hum% tmp=$tmp°C ec=$ec snr=$snr"
  sleep "${1:-30}"
done
