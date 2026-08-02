# Journal des experiences — Stack LoRaWAN Dragino + ChirpStack local

Recapitulatif chronologique des essais realises pour mettre en service la chaine :

```
Arduino Uno + shield Dragino LA66  --LoRa EU868-->  Gateway Dragino XX1302 (RPi)
                                                    --UDP 1700-->  ChirpStack (Docker/Mac)
                                                    --MQTT-->      (a venir : n8n distant)
```

---

## 1. Contexte materiel

| Composant | Details |
|---|---|
| Gateway | Dragino XX1302 (concentrateur SX1302) sur Raspberry Pi, IP `192.168.1.23`, EUI `a84041fdfea3a5c3` |
| Node | Arduino Uno + shield Dragino LA66 (firmware `DR-LWS-007 v1.3`), DevEui `a840416e01896414` |
| Alim node | Shield support de piles 4× AA NiMH (VARTA 2100 mAh) |
| Serveur | ChirpStack v4 en Docker sur MacBook (`192.168.1.14:1700`), region EU868 |

---

## 2. Session 1 (2026-08-02, matin) — Bringup

### 2.1 Ce qui a ete fait

- Deploiement ChirpStack via `chirpstack/chirpstack-docker` (stack complete : chirpstack, gateway-bridge, mosquitto, postgres, redis, rest-api).
- Configuration region EU868 (`configuration/chirpstack/chirpstack.toml`).
- Configuration du packet forwarder Dragino sur le Pi (`/etc/lora/local_conf.json`) pour pointer vers `192.168.1.14:1700`.
- Enrolement du LA66 en OTAA dans ChirpStack (device profile `Dragino-LA66`, application `LA66-Arduino`).
- Flash firmware batterie sur l'Uno (mesure Vcc via bandgap interne, envoi fPort 3).

### 2.2 Blocage — gateway injoignable

En fin de matinee, `JoinRequest` emis par le LA66 mais aucun `JoinAccept` recu.

Diagnostic :
- `docker logs chirpstack-docker-chirpstack-gateway-bridge-1` : **0 paquet UDP** recu de la gateway.
- `ping 192.168.1.23` : echec, ARP incomplete, absent du scan `nmap -sn 192.168.1.0/24`.

**Cause** : le Pi n'etait plus sur le reseau (cable Ethernet debranche ou WiFi non associe).

---

## 3. Session 2 (2026-08-02, apres-midi) — Reprise et diagnostic reseau

### 3.1 Verification connectivite Pi

```bash
ping -c 3 192.168.1.23        # -> OK
ssh root@192.168.1.23         # -> No route to host (SSH desactive)
```

Le ping repond mais SSH echoue. Verification via navigateur :

- `http://192.168.1.23` → **interface web Dragino repond**, login `root` / `dragino`.
- Section LoRaWAN : `server_address = 192.168.1.14`, `port_up/down = 1700` → **OK**.

Conclusion : gateway vivante et bien configuree, seul SSH etait desactive. Diagnostic possible depuis l'UI web.

### 3.2 Verification pipeline serveur

```bash
docker logs chirpstack-docker-chirpstack-gateway-bridge-1
```

Stats gateway remontees toutes les 30s, uplinks captes et publies MQTT.

```bash
docker logs chirpstack-docker-chirpstack-1 | grep -iE "join|Uplink received"
```

- `f_type=JoinRequest` → `join_accept` → `tx_ack` : **join OTAA reussi** cote serveur.
- `f_type=UnconfirmedDataUp` : uplink data publie sur `application/<uuid>/device/a840416e01896414/event/up`.

Le pipeline fonctionne. L'utilisateur ne voyait rien dans l'UI ChirpStack car il fallait activer **Live** dans l'onglet *LoRaWAN frames* et rafraichir la page.

---

## 4. Experience 1 — Uplink sur alim USB

**Objectif** : premier uplink batterie via bandgap ATmega, alim USB.

**Firmware** (`src/main.cpp`) : boucle `millis()`, TX toutes les 10 min, formule lineaire `4400→5400 mV = 0→100%`.

**Resultat** (`single-log (1).json`, `2026-08-02T10:04:07Z`) :

```json
{
  "fPort": 3,
  "data": "FBJJ",
  "object": { "battery_mv": 5138, "battery_v": 5.138, "battery_percent": 73 },
  "rxInfo": [ { "rssi": -69, "snr": 7.5, "channel": 5 } ]
}
```

**Interpretation** :
- `battery_mv: 5138` = rail 5V regule USB (dans la specification 4.75–5.25 V).
- `battery_percent: 73` = artefact du calcul lineaire, non pertinent puisque pas de vraie batterie.

---

## 5. Experience 2 — Bascule shield batterie NiMH 4S (formule lineaire)

**Objectif** : verifier que le shield support de piles donne bien la tension pack.

**Setup** : USB debranche, shield 4× AA NiMH branche. Reset du Uno.

**Resultat** (`single-log (2).json`, `2026-08-02T19:29:52Z`) :

```json
{
  "object": { "battery_mv": 5001, "battery_v": 5.001, "battery_percent": 60 },
  "rxInfo": [ { "rssi": -62, "snr": 8.2, "channel": 5 } ]
}
```

**Interpretation** :
- Vcc = 5001 mV = **tension reelle du pack NiMH** (le shield fournit Vbat directement sur le rail 5V, le regulateur du Uno decroche a Vbat < ~7 V).
- Baisse de 137 mV vs USB → coherent.
- `battery_percent: 60` = **incoherent**. Un pack NiMH 4S a 5.0 V est proche du plein (plateau ~1.2 V/cellule), pas a 60 %. La formule lineaire ne convient pas aux NiMH.

**Decision** : remplacer la formule lineaire par une courbe de decharge realiste.

---

## 6. Experience 3 — Courbe NiMH 4S realiste

**Modif firmware** :

Suppression de `VBAT_FULL_MV`/`VBAT_EMPTY_MV`. Ajout d'une table PROGMEM avec interpolation lineaire par segments :

```cpp
const BatPoint NIMH_CURVE[] PROGMEM = {
  { 5600, 100 }, { 5200, 95 }, { 5000, 85 }, { 4900, 75 },
  { 4800,  60 }, { 4700, 40 }, { 4600, 25 }, { 4500, 15 },
  { 4400,   8 }, { 4200,  2 }, { 4000,  0 },
};
```

Reflete le plateau NiMH ~4.8 V et la chute brutale sous 4.6 V.

**Resultat** (`single-log (3).json`, `2026-08-02T19:37:39Z`) :

```json
{
  "object": { "battery_mv": 5115, "battery_v": 5.115, "battery_percent": 90 },
  "rxInfo": [ { "rssi": -71, "snr": 8.5, "channel": 5 } ]
}
```

**Verification** : interpolation entre `5200→95%` et `5000→85%`. A 5115 mV : `85 + (115/200)*10 = 90.75 → 90`. ✅

**Interpretation** :
- La tension a legerement remonte (5001 → 5115) : normal, les NiMH recuperent en tension au repos entre les TX.
- 90 % correspond bien a un pack proche de la pleine charge.

---

## 7. Experience 4 — Deep sleep 10 min

**Objectif** : diviser la consommation moyenne de l'Uno en dormant entre les uplinks (au lieu de tourner en `loop()` permanent).

**Setup** :
- Librairie `rocketscream/Low-Power@^1.81` ajoutee au `platformio.ini`.
- `main.cpp` refactore en state-machine : `setup()` attend le join (max 60 s) puis `loop()` = TX → drain serie 8 s → sommeil profond par blocs de 8 s (WDT).
- `SLEEP_CYCLES = 75` → 600 s = 10 min de sommeil pur.

**Conso attendue** (indicatif, a mesurer avec un multimetre ou uCurrent) :
- Uno seul en `powerDown(SLEEP_8S, ADC_OFF, BOD_OFF)` : ~30–100 µA.
- Uno actif + LA66 TX : ~50–120 mA pendant qq secondes.
- Duty cycle actif estime : ~10 s / 610 s = **~1.6 %**.
- Conso moyenne attendue : ordre de grandeur ~1–2 mA (vs ~40–50 mA sans sleep).

**Autonomie theorique** avec 4× 2100 mAh NiMH :
- Sans sleep : ~2100 mAh / 45 mA ≈ **46 h** (~2 jours).
- Avec sleep : ~2100 mAh / 1.5 mA ≈ **1400 h** (~58 jours).

Reste a valider par mesure reelle sur plusieurs jours (voir §8).

---

## 8. Prochaines etapes

- [x] **Consommateur MQTT n8n** : workflow deploye, uplinks decodes et branches sur seuil batterie. Voir §11.
- [ ] **Stockage timeseries** : ajouter apres `Normalize LoRaWAN Uplink` un noeud Postgres/InfluxDB/Data Table pour historiser `batteryMv`, `rssi`, `snr`, `fCnt`.
- [ ] **Notifications** : brancher Telegram/Slack/email apres `Prepare Low Battery Alert` (l'utilisateur gere ce cablage lui-meme).
- [ ] **Durcissement MQTT** : le broker Mosquitto est actuellement `allow_anonymous true` et expose via ngrok. A remplacer par auth user/pass + TLS, ou basculer sur solution §10 (VPS + BasicStation).
- [ ] **Test d'autonomie reel** : laisser tourner en batterie seule, tracer `batteryMv` dans le temps, noter le passage sous 4400 mV.
- [ ] **Deploiement VPS** : possibilite de deplacer ChirpStack sur un serveur distant, la gateway Dragino continue de pousser en UDP vers l'IP publique. Voir §10.
- [ ] **Nouveaux capteurs** : DHT22 / BME280 sur pins libres du Uno, extension du payload avec nouveaux fPorts.
- [ ] **Codec ChirpStack** : deja en place pour fPort 3 (battery). A etendre pour futurs capteurs.

---

## 9. Note — Consommateur MQTT distant (n8n)

Le broker Mosquitto tourne en local Docker (`localhost:1883`, sans TLS, sans auth par defaut).

Pour qu'un n8n distant en HTTPS consomme les uplinks, options :

1. **Exposer Mosquitto derriere un reverse proxy TLS** (Traefik/Caddy avec MQTT sur port 8883, WebSocket-over-TLS sur 443).
2. **Bridge MQTT sortant** : configurer Mosquitto pour republier `application/+/device/+/event/up` vers un broker public (HiveMQ Cloud, EMQX Cloud) accessible en TLS. n8n consomme le broker public.
3. **Webhook HTTP** : configurer ChirpStack UI → Application → Integrations → HTTP integration, POST direct vers `https://<n8n>/webhook/...`. Le plus simple si le node est accessible en HTTPS.

**Recommandation** : commencer par l'option 3 (webhook HTTP direct). Pas de gestion de broker, tout est natif dans ChirpStack.

---

## 10. Deploiement ChirpStack sur VPS — solution professionnelle (sans VPN)

Cible : ChirpStack tourne sur un VPS public, la gateway Dragino XX1302 pousse ses uplinks depuis le reseau domestique vers ce VPS, **sans tunnel VPN paye**, avec un niveau de securite equivalent aux deploiements industriels.

### 10.1 Choix du protocole — BasicStation LNS avec TLS mutuel

**Ne pas utiliser Semtech UDP (port 1700) sur Internet public**. Ce protocole :
- N'a aucune authentification (n'importe qui spoofe des uplinks).
- N'a aucun chiffrement (les payloads sont en clair, seule la charge LoRaWAN est encryptee par les cles NwkSKey/AppSKey).
- Est concu pour un LAN de confiance.

**Utiliser BasicStation** (specification Semtech, standard LoRa Alliance) :
- WebSocket **TLS** (port `3001` par defaut ChirpStack, ou `443` derriere un reverse proxy).
- Authentification par **certificat client X.509** (mutual TLS) → seule ta gateway peut se connecter.
- Supporte nativement par ChirpStack (`chirpstack-gateway-bridge-basicstation` container, deja present dans ton `docker-compose.yml`).
- Supporte par les gateways Dragino recentes (LPS8v2, LG308v2, DLOS8, XX1302 avec firmware ≥ 2022) — a verifier sur ta version.

### 10.2 Architecture cible

```
[Gateway Dragino XX1302]                    [VPS public]
   packet forwarder                          ┌──────────────────────┐
   → BasicStation client   ──── WSS/TLS ───► │ Traefik/Caddy :443   │
   (cert client)                             │  ↓ TLS termination    │
                                             │ chirpstack-gw-bridge │
                                             │  -basicstation :3001 │
                                             │  ↓ MQTT              │
                                             │ mosquitto :1883      │
                                             │  ↓                   │
                                             │ chirpstack app       │
                                             │ postgres, redis      │
                                             └──────────────────────┘
                                                      ▲
                                                      │ MQTT+TLS
                                                      │
                                             [n8n distant HTTPS]
```

### 10.3 Etapes de deploiement

**1. VPS de base**
- Distribution Debian/Ubuntu LTS, 2 vCPU / 4 GB RAM suffisent largement pour <100 devices.
- Docker + docker-compose installes.
- Nom de domaine dedie (ex. `lora.mondomaine.tld`) pointant vers l'IP du VPS.

**2. Reverse proxy TLS avec Let's Encrypt**
Traefik ou Caddy termine le TLS pour :
- `https://lora.mondomaine.tld/` → UI ChirpStack (port 8080).
- `wss://lora.mondomaine.tld/router-info` et `/router-*` → gateway-bridge-basicstation (port 3001).

Cert Let's Encrypt automatique (ACME HTTP-01 ou DNS-01).

**3. Generation des certificats client gateway**
ChirpStack fournit un outil pour generer une CA privee et des certs client :

```bash
# Sur le VPS, dans chirpstack-docker/configuration/gateway-bridge-basicstation/
# Generer CA + cert serveur + cert client par gateway
# (procedure detaillee : https://www.chirpstack.io/docs/chirpstack-gateway-bridge/backends/basic-station.html)
```

Le cert client + sa cle privee sont ensuite copies dans la gateway Dragino.

**4. Config gateway Dragino en mode BasicStation**
Depuis l'UI web Dragino :
- **LoRaWAN → LoRaWAN Semtech UDP → Disable**.
- **LoRaWAN → LoRaWAN Basic Station → Enable**.
- LNS URI : `wss://lora.mondomaine.tld:443` (ou `:3001` si pas de proxy).
- Upload `tc.trust` (CA du VPS), `tc.crt` (cert client), `tc.key` (cle privee client).

**5. Defense en profondeur (facultatif mais recommande)**
- **Firewall VPS** (`ufw` ou `nftables`) : n'exposer que 443 (et eventuellement 22 restreint a ton IP admin). Bloquer explicitement 1700/udp.
- **fail2ban** sur les logs Traefik/Caddy pour bannir les IPs qui tentent de scanner.
- **CrowdSec** en alternative (base communautaire, meilleure detection).
- **IP allowlist** (facultatif) : si ta box a une IP fixe, restreindre `wss://` a cette IP. Si IP dynamique, utiliser un DDNS + script de MAJ regulier de l'allowlist.
- **Renouvellement cert client** : Let's Encrypt pour le serveur (auto), mais le cert client de la gateway est generalement long-terme (5-10 ans) → planifier la rotation.

### 10.4 Ce qui reste identique par rapport au setup local

- Le `docker-compose.yml` ChirpStack est le meme (les containers gateway-bridge-basicstation et Mosquitto sont deja presents).
- Les devices (LA66) ne voient aucune difference : c'est la gateway qui change de LNS backend, les cles LoRaWAN restent inchangees.
- Le codec JS et le decoder ChirpStack sont importes tels quels.

### 10.5 Cout et complexite

| Poste | Cout mensuel | Difficulte initiale |
|---|---|---|
| VPS Hetzner CX22 / OVH VLE | 4–6 € | faible |
| Domaine | 1 € (.tld) | faible |
| Let's Encrypt cert TLS | 0 € (auto) | faible |
| Certs client BasicStation | 0 € (openssl) | moyenne (une fois) |
| **Total** | **~5–7 €/mois** | ~2h setup |

### 10.6 Alternative degradee (si la gateway ne supporte pas BasicStation)

Si le firmware Dragino de la gateway ne propose pas BasicStation (verifier dans l'UI → LoRaWAN) :

1. Garder Semtech UDP mais :
   - Ouvrir UDP 1700 uniquement depuis l'IP publique de la box (allowlist stricte).
   - Utiliser un DDNS pour suivre les changements d'IP.
   - Accepter le risque de spoofing (mitigation : monitoring des flux, alerte sur volume anormal).
2. Ou upgrade firmware gateway (Dragino publie des builds recents avec BasicStation).
3. Ou remplacer la gateway par un modele recent (LPS8v2, DLOS8).

**Verdict** : BasicStation TLS + mTLS reste la seule solution « propre » sans VPN. Si impossible sur ta gateway actuelle, prioriser l'upgrade firmware.

---

## 11. Experience 5 — Consommateur MQTT n8n distant via ngrok

### 11.1 Objectif

Consommer les uplinks ChirpStack depuis un n8n hebergé sur `n8n-dev.rokodo.app` (HTTPS distant) sans exposer directement la box residentielle et sans payer de VPN.

### 11.2 Architecture retenue (dev/test)

```
LA66 --LoRa--> Gateway --UDP--> ChirpStack (Docker/Mac)
                                   |
                                   v
                              Mosquitto :1883 (allow_anonymous)
                                   |
                                   v
                              ngrok TCP tunnel  --->  4.tcp.eu.ngrok.io:XXXXX
                                                              |
                                                              v
                                                     n8n distant (MQTT Trigger)
```

Choix ngrok justifie par : deja installe sur la machine, tunnel TCP natif, DNS public resolvable, mise en place en 2 commandes. Ephemere (URL change a chaque relance), acceptable pour la phase test.

### 11.3 Mise en oeuvre

```bash
# Verifier que Mosquitto est bien expose sur l'hote
docker ps --format '{{.Names}} {{.Ports}}' | grep mosquitto
# chirpstack-docker-mosquitto-1  0.0.0.0:1883->1883/tcp

# Lancer le tunnel TCP
ngrok tcp 1883

# Recuperer l'URL publique
curl -s http://127.0.0.1:4040/api/tunnels | jq -r '.tunnels[].public_url'
# tcp://4.tcp.eu.ngrok.io:16803

# Test de bout en bout
mosquitto_sub -h 4.tcp.eu.ngrok.io -p 16803 -t '$SYS/broker/version' -C 1
# mosquitto version 2.1.2
```

### 11.4 Workflow n8n

Cree via le MCP n8n : `LoRaWAN Uplinks - LA66 Battery Monitor` (ID `N59pzq3FIi2WRu1D`).

Pipeline :

```
[MQTT Trigger]  --->  [Set: Normalize]  --->  [If: batteryPercent < 20]  --+--> [Set: Prepare Low Battery Alert]
                                                                          +--> [Set: Mark OK]
```

- **MQTT Trigger** : topic `application/+/device/+/event/up`, `jsonParseBody: true`, `onlyMessage: true`.
- **Normalize** : aplatit `deviceInfo.*`, `object.*`, `rxInfo[0].*` en champs plats (`deviceName`, `devEui`, `batteryMv`, `batteryV`, `batteryPercent`, `rssi`, `snr`, `gatewayId`, `fPort`, `fCnt`, `time`, `applicationName`).
- **Low Battery?** : condition `batteryPercent < 20`.
- Branches terminales : stubs (`alertLevel = warning|ok`) — a completer avec noeuds notification / stockage.

### 11.5 Credential n8n

Type : **MQTT**. Valeurs :

| Champ | Valeur |
|---|---|
| Protocol | `mqtt://` |
| Host | `4.tcp.eu.ngrok.io` (**sans espace, sans prefixe**) |
| Port | `16803` (change a chaque relance ngrok) |
| Username / Password | vides (broker `allow_anonymous true`) |
| SSL | off |
| Client ID | `n8n-lorawan` |

**Piege rencontre** : un espace accidentel dans le champ Host provoque `getaddrinfo ENOTFOUND`. Verifier le champ, tester avec `nslookup` cote serveur n8n si probleme persistant.

### 11.6 Resultat

Uplink reel capture cote n8n (pinData execution) :

```json
{
  "time": "2026-08-02T20:07:47.628047+00:00",
  "deviceName": "LA66-LA781268",
  "batteryMv": 5115, "batteryV": 5.115, "batteryPercent": 90,
  "rssi": -65, "snr": 8.8, "fCnt": 2, "fPort": 3
}
```

Route vers `Mark OK` (90% > 20%). Chaine complete LA66 → Gateway → ChirpStack → Mosquitto → ngrok → n8n distant : **validee**.

### 11.7 Limitations connues

- Broker anonyme expose publiquement le temps du tunnel : quiconque devine l'URL peut sniffer les uplinks. Acceptable pour dev, **inacceptable en prod**.
- URL ngrok ephemere : chaque relance impose de mettre a jour Host + Port dans la credential n8n.
- Debit ngrok free limite : suffisant pour ~1 uplink / 10 min, pas pour flotte.

Migration prod : durcir Mosquitto (auth + TLS) OU basculer sur §10 (VPS BasicStation).

---

## Annexes — Fichiers modifies

- `chirpstack-docker/docker-compose.yml`
- `chirpstack-docker/configuration/chirpstack/chirpstack.toml`
- `chirpstack-docker/DEPLOYMENT.md`, `SENSORS.md`, `BATTERY.md`
- `PlatformIO/Projects/LORAWAN/platformio.ini`
- `PlatformIO/Projects/LORAWAN/src/main.cpp`
- Pi (via web UI Dragino) : `/etc/lora/local_conf.json`

## Annexes — Logs de reference

- `~/Downloads/single-log (1).json` — Uplink USB, formule lineaire, 5138 mV → 73 %
- `~/Downloads/single-log (2).json` — Uplink batterie, formule lineaire, 5001 mV → 60 %
- `~/Downloads/single-log (3).json` — Uplink batterie, courbe NiMH, 5115 mV → 90 %
- n8n workflow `LoRaWAN Uplinks - LA66 Battery Monitor` (id `N59pzq3FIi2WRu1D`) sur `n8n-dev.rokodo.app`
