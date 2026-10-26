# Intégrer un appareil LoRaWAN dans Home Assistant (et l'app Jardin)

Chaîne : appareil → gateway → ChirpStack (décode via codec) → MQTT (Mosquitto) → Home Assistant → app mobile.
Pas d'intégration HA dédiée ChirpStack ici (chirp2mqtt = add-on HA OS uniquement, HACS cassé) :
on déclare les entités en YAML, c'est court et versionné.

## 1. ChirpStack

1. **Device profile** : région EU868, LoRaWAN 1.0.3, OTAA, Class A (C si appareil alimenté).
   Onglet *Codec* → JavaScript → coller le décodeur du fabricant
   (Dragino : github.com/dragino/dragino-end-node-decoder).
2. **Application → Add device** : DevEUI + AppKey (étiquette/fiche de l'appareil).
3. Allumer l'appareil, vérifier le *Join* puis un uplink dans l'onglet *Events*.
   Le champ `object` de l'uplink = valeurs décodées → noter les noms des champs.

L'`APP_ID` (UUID de l'application) est dans l'URL ChirpStack : `/applications/<APP_ID>`.

## 2. Home Assistant — capteurs (uplink) : automatique

Rien à écrire. L'automatisation `iotrigger_lorawan_discovery` (`automations_iotrigger.yaml`) écoute
`application/+/device/+/event/up` et crée par MQTT discovery un capteur par champ de `object` + le SNR,
regroupés dans un appareil HA nommé comme dans ChirpStack (identifiant = DevEUI).
Unités/classes : table `known` de l'automatisation (ajouter une ligne pour un nouveau champ, sinon capteur brut).
Ensuite : HA → Appareils → lui donner une pièce, ou directement le ＋ de l'app.

## 3. Home Assistant — actionneur (downlink)

Topic : `application/<APP_ID>/device/<DEV_EUI>/command/down`, payload JSON :

```json
{"devEui":"<DEV_EUI>","confirmed":true,"fPort":<port>,"data":"<commande en base64>"}
```

Commande hex du manuel fabricant → base64 : `echo 0101 | xxd -r -p | base64`.
Déclarer un `mqtt: switch:` (voir `Vanne jardin`). Avec un vrai retour d'état, remplacer
`optimistic: true` par `state_topic` (event/up) + `value_template` + `state_on`/`state_off`.

Class A : la commande n'est livrée qu'après le prochain uplink de l'appareil.

## 4. Appliquer

```bash
docker compose exec homeassistant python -m homeassistant --script check_config -c /config
docker compose restart homeassistant
```

Tester sans matériel : publier un faux uplink (cf `scripts/simulate-uplink.sh`).

## 5. Dashboard et app

- Dashboard **Jardin** : `configuration/homeassistant/dashboards/jardin.yaml` (mode YAML, versionné).
  Ajouter une carte `tile` / `gauge` / `history-graph` avec le nouvel `entity_id`. Rafraîchir la page suffit (pas de restart).
- App mobile : ajouter l'`entity_id` dans `SENSORS` de `mobile/src/config.ts` (et `config.example.ts`), rebuild.
