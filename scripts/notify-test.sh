#!/bin/sh
# Envoie une notification de test à tous les téléphones connectés : scripts/notify-test.sh "Titre" "Message"
TOK=$(grep HA_TOKEN "$(dirname "$0")/../mobile/src/config.ts" | sed -E "s/.*'([^']+)'.*/\1/")
curl -s -X POST -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d "{\"title\":\"${1:-Test}\",\"message\":\"${2:-Notification de test}\"}" \
  https://homeassistant.triggerstudio.dev/api/events/iotrigger_notify
