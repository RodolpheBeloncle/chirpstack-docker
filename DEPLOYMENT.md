# Déploiement ChirpStack LoRaWAN — Guide complet

Ce guide documente l'installation complète d'un réseau LoRaWAN local avec :
- une gateway **Dragino XX1302** sur Raspberry Pi
- un serveur **ChirpStack v4** sur MacBook Pro via Docker
- un device **Dragino LA66** sur Arduino Uno

---

## Architecture du système

```
[Capteur Arduino + LA66]
        |  (radio LoRa EU868)
        v
[Gateway Dragino XX1302]  ←— Raspberry Pi @ 192.168.1.23
        |  (UDP port 1700, réseau local Wi-Fi/Ethernet)
        v
[MacBook Pro @ 192.168.1.14]
        |
        ├── chirpstack-gateway-bridge  (reçoit UDP 1700)
        ├── chirpstack                 (serveur LNS, UI port 8080)
        ├── chirpstack-rest-api        (API REST port 8090)
        ├── mosquitto                  (broker MQTT port 1883)
        ├── postgresql                 (base de données)
        └── redis                      (cache)
```

Tous les services Mac tournent dans Docker Compose.

---

## Prérequis

- **MacBook** avec Docker Desktop installé et démarré
- **Raspberry Pi** avec la gateway Dragino branchée et connectée au réseau local
- Mac et Pi sur le **même réseau local** (même routeur)
- L'IP du Mac doit être **fixe** (ou réservée dans le routeur)

Pour trouver l'IP du Mac :
```bash
ipconfig getifaddr en0
```

---

## Partie 1 — Installer ChirpStack sur le Mac

### 1.1 Cloner le repo officiel

```bash
cd ~/Desktop
git clone https://github.com/chirpstack/chirpstack-docker.git
cd chirpstack-docker
```

Le repo contient déjà tout le nécessaire :
- `docker-compose.yml` — définit tous les services
- `configuration/chirpstack/region_eu868.toml` — plan de fréquences EU868
- `configuration/chirpstack/chirpstack.toml` — config principale

### 1.2 Démarrer ChirpStack

```bash
cd ~/Desktop/chirpstack-docker
docker compose up -d
```

Vérifier que tous les services sont `Up` :
```bash
docker compose ps
```

Tu dois voir 7 services avec le statut `Up` :
- `chirpstack` — le serveur LoRaWAN
- `chirpstack-gateway-bridge` — reçoit les paquets UDP de la gateway
- `chirpstack-gateway-bridge-basicstation` — pour les gateways BasicStation
- `chirpstack-rest-api` — l'API REST
- `postgres` — la base de données
- `redis` — le cache
- `mosquitto` — le broker MQTT

L'interface web est accessible sur **http://localhost:8080**
Login par défaut : `admin` / `admin`

### 1.3 Commandes utiles

```bash
# Voir les logs en temps réel (paquets reçus de la gateway)
docker compose logs -f chirpstack-gateway-bridge

# Voir les logs du serveur ChirpStack
docker compose logs -f chirpstack

# Arrêter tous les services
docker compose down

# Redémarrer
docker compose restart
```

---

## Partie 2 — Configurer la gateway Dragino sur le Raspberry Pi

### 2.1 Vérifier la connexion SSH

```bash
# Depuis le Mac
ssh pi@192.168.1.23
# Mot de passe par défaut Raspberry Pi : raspberry
# Mot de passe par défaut Dragino : dragino ou dragino1234
```

> **Si le Pi a changé d'IP après un reboot**, scanner le réseau :
> ```bash
> arp -a | grep "192.168.1"
> # Chercher la MAC commençant par b8:27:eb (Raspberry Pi)
> ```

### 2.2 Vérifier la config du packet forwarder

Le packet forwarder (dragino_fwd) est le programme qui envoie les paquets radio LoRa vers le serveur.

Sa config est dans `/etc/lora/local_conf.json` :

```bash
cat /etc/lora/local_conf.json
```

Le champ `server_address` doit pointer vers l'IP du Mac :

```json
{
  "gateway_conf": {
    "server_address": "192.168.1.14",
    "serv_port_up": 1700,
    "serv_port_down": 1700
  }
}
```

Si l'adresse est incorrecte, la modifier :
```bash
sudo nano /etc/lora/local_conf.json
```

### 2.3 Redémarrer le packet forwarder

```bash
sudo systemctl restart dragino_fwd
sudo systemctl status dragino_fwd   # doit afficher "active (running)"
```

### 2.4 Vérifier que les paquets arrivent sur le Mac

```bash
# Sur le Mac, dans chirpstack-docker/
docker compose logs -f chirpstack-gateway-bridge
```

Signal de succès :
```
msg="integration/mqtt: publishing event" event=stats gatewayID=a84041fdfea3a5c3
```

La gateway envoie des `stats` toutes les 30 secondes même sans device connecté.

---

## Partie 3 — Enregistrer la gateway dans ChirpStack

### 3.1 Trouver l'EUI de la gateway

L'EUI apparaît dans les logs du gateway-bridge :
```bash
docker compose logs chirpstack-gateway-bridge | grep "gatewayID"
```

Dans notre cas : `a84041fdfea3a5c3`

> **Note** : l'EUI imprimé sur le boîtier de la gateway peut différer de celui utilisé par le packet forwarder. Toujours se fier aux logs.

### 3.2 Enregistrer via l'UI

1. Ouvrir http://localhost:8080
2. **Gateways** → **Add gateway**
3. Remplir :
   - **Gateway EUI** : `a84041fdfea3a5c3`
   - **Name** : `Dragino-XX1302`
4. Sauvegarder

La gateway apparaît avec le statut **Online** après quelques secondes.

### 3.3 Enregistrer via l'API (automatisable)

Créer d'abord un token API admin :
```bash
cd ~/Desktop/chirpstack-docker
docker compose exec chirpstack \
  /usr/bin/chirpstack -c /etc/chirpstack create-api-key --name "admin-key"
```

Récupérer le tenant ID :
```bash
TOKEN="<token>"
curl -s "http://localhost:8090/api/tenants?limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Partie 4 — Enregistrer un device LoRa (Dragino LA66)

### 4.1 Récupérer les credentials du device

Les credentials OTAA sont imprimés sur l'étiquette du module LA66 :
- **DevEUI** : identifiant unique du device (ex: `A840416E01896414`)
- **AppEUI** : identifiant de l'application (ex: `A840410000000101`)
- **AppKey** : clé de chiffrement (ex: `5903185D110E327009B706BE486ED7C9`)

> **Important** : conserver précieusement ce papier, ces credentials sont uniques.

### 4.2 Créer manuellement via l'interface web (recommandé pour débuter)

Ouvrir **http://localhost:8080** — login `admin` / `admin`.

#### Étape A — Créer un Device Profile

Le device profile définit les caractéristiques techniques du module LoRa.

1. Menu gauche → **Device profiles** → bouton **Add device profile**
2. Onglet **General** :
   - **Name** : `Dragino-LA66`
   - **Region** : `EU868`
   - **MAC version** : `LoRaWAN 1.0.3`
   - **Regional parameters revision** : `A`
   - **ADR algorithm** : `Default ADR algorithm`
3. Onglet **Join (OTAA / ABP)** :
   - Cocher **Device supports OTAA**
4. Cliquer **Submit**

> Le device profile est réutilisable pour tous tes modules LA66.

#### Étape B — Créer une Application

L'application est un conteneur logique qui regroupe plusieurs devices.

1. Menu gauche → **Applications** → **Add application**
2. Remplir :
   - **Name** : `LA66-Arduino`
   - **Description** : (optionnel)
3. Cliquer **Submit**

#### Étape C — Ajouter le Device dans l'Application

1. Cliquer sur l'application `LA66-Arduino` créée
2. Onglet **Devices** → **Add device**
3. Remplir :
   - **Name** : `LA66-LA781268`
   - **DevEUI** : `A840416E01896414` ← copier depuis l'étiquette
   - **Device profile** : sélectionner `Dragino-LA66`
4. Cliquer **Submit**

#### Étape D — Entrer les clés OTAA

Après la création du device, ChirpStack redirige automatiquement vers l'onglet des clés.

1. Onglet **OTAA keys**
2. Remplir :
   - **Application key** : `5903185D110E327009B706BE486ED7C9`
3. Laisser **NwkKey** vide (LoRaWAN 1.0.x, une seule clé)
4. Cliquer **Submit**

> Le device est maintenant prêt à rejoindre le réseau. Il passera en statut **Active** dès le premier JOIN réussi.

---

### 4.3 Créer via l'API

```bash
TOKEN="<token>"
TENANT_ID="<tenant_id>"

# 1. Créer le device profile
curl -s -X POST "http://localhost:8090/api/device-profiles" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"deviceProfile\": {
      \"tenantId\": \"$TENANT_ID\",
      \"name\": \"Dragino-LA66\",
      \"region\": \"EU868\",
      \"macVersion\": \"LORAWAN_1_0_3\",
      \"regParamsRevision\": \"A\",
      \"supportsOtaa\": true,
      \"supportsClassB\": false,
      \"supportsClassC\": false
    }
  }"

# 2. Créer l'application
curl -s -X POST "http://localhost:8090/api/applications" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"application\": {\"tenantId\": \"$TENANT_ID\", \"name\": \"LA66-Arduino\"}}"

# 3. Créer le device (remplacer les IDs par ceux obtenus ci-dessus)
curl -s -X POST "http://localhost:8090/api/devices" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device": {
      "applicationId": "<app_id>",
      "deviceProfileId": "<profile_id>",
      "devEui": "a840416e01896414",
      "name": "LA66-LA781268",
      "skipFcntCheck": true
    }
  }'

# 4. Ajouter les clés OTAA
curl -s -X POST "http://localhost:8090/api/devices/a840416e01896414/keys" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceKeys": {
      "devEui": "a840416e01896414",
      "nwkKey": "5903185d110e327009b706be486ed7c9",
      "appKey": "5903185d110e327009b706be486ed7c9"
    }
  }'
```

### 4.3 Valeurs utilisées dans ce projet

| Champ | Valeur |
|-------|--------|
| DevEUI | `a840416e01896414` |
| AppEUI | `a840410000000101` |
| AppKey | `5903185d110e327009b706be486ed7c9` |
| SN | `LA781268` |

---

## Partie 5 — Flasher le sketch Arduino

Le sketch fait le pont entre le port USB du Mac et le module LA66 via SoftwareSerial (pins D10/D11).

Il fait deux choses :
1. Transmet les commandes AT tapées dans le moniteur série vers le LA66
2. Envoie `"Hello World"` en hex toutes les 60 secondes après le JOIN LoRaWAN

### 5.1 Sketch complet (PlatformIO / Arduino)

Fichier : `src/main.cpp` dans le projet PlatformIO.

```cpp
#include <Arduino.h>
#include <SoftwareSerial.h>

String inputString = "";
bool stringComplete = false;
long old_time = millis();
long new_time;
long uplink_interval = 60000;  // 1 minute

bool time_to_at_recvb = false;
bool get_LA66_data_status = false;
bool network_joined_status = false;

SoftwareSerial ss(10, 11);  // RX=D10, TX=D11

char rxbuff[128];
uint8_t rxbuff_index = 0;

void setup() {
  Serial.begin(9600);
  ss.begin(9600);
  ss.listen();
  inputString.reserve(200);
  ss.println("ATZ");  // reset du module LA66
}

void loop() {
  new_time = millis();
  if ((new_time - old_time >= uplink_interval) && (network_joined_status == 1)) {
    old_time = new_time;
    get_LA66_data_status = false;
    String payload = "48656C6C6F20576F726C64";  // "Hello World" en hex
    String command = "AT+SENDB=0,2," + String(payload.length() / 2) + "," + payload;
    ss.println(command);
  }

  if (time_to_at_recvb == true) {
    time_to_at_recvb = false;
    get_LA66_data_status = true;
    delay(1000);
    ss.println("AT+CFG");
  }

  while (ss.available()) {
    char inChar = (char) ss.read();
    inputString += inChar;
    rxbuff[rxbuff_index++] = inChar;
    if (rxbuff_index > 128) break;
    if (inChar == '\n' || inChar == '\r') {
      stringComplete = true;
      rxbuff[rxbuff_index] = '\0';
      if (strncmp(rxbuff, "JOINED", 6) == 0)            network_joined_status = 1;
      if (strncmp(rxbuff, "Dragino LA66 Device", 19) == 0) network_joined_status = 0;
      if (strncmp(rxbuff, "Run AT+RECVB=? to see detail", 28) == 0) {
        time_to_at_recvb = true;
        stringComplete = false;
        inputString = "";
      }
      if (strncmp(rxbuff, "AT+RECVB=", 9) == 0) {
        stringComplete = false;
        inputString = "";
        Serial.print("\r\nDownlink recu: ");
        Serial.println(&rxbuff[9]);
      }
      rxbuff_index = 0;
      if (get_LA66_data_status == true) {
        stringComplete = false;
        inputString = "";
      }
    }
  }

  while (Serial.available()) {
    char inChar = (char) Serial.read();
    inputString += inChar;
    if (inChar == '\n' || inChar == '\r') {
      ss.print(inputString);
      inputString = "";
    }
  }

  if (stringComplete) {
    Serial.print(inputString);
    inputString = "";
    stringComplete = false;
  }
}
```

### 5.2 `platformio.ini`

```ini
[env:uno]
platform = atmelavr
board = uno
framework = arduino
monitor_speed = 9600
upload_port = /dev/cu.usbmodem11401
```

> **⚠️ Point de vigilance — ne PAS ajouter `EspSoftwareSerial`**
> Cette lib est réservée aux ESP8266/ESP32. L'Arduino Uno utilise le `SoftwareSerial` intégré du framework Arduino AVR. Ajouter `EspSoftwareSerial` provoque des erreurs de compilation (`functional: No such file or directory`, `Delegate has not been declared`).

### 5.3 Flasher et surveiller

Dans VSCode avec PlatformIO :
- **Upload** (flèche →) pour flasher
- **Serial Monitor** (icône prise) pour voir les logs à 9600 baud

**Méthode alternative en ligne de commande** (utile si l'upload PlatformIO bloque) :

```bash
# 1. Compiler seulement (rapide, une fois)
~/.platformio/penv/bin/pio run -e uno

# 2. Appuyer sur le bouton RESET de l'Arduino
# 3. Immédiatement (dans la seconde) lancer :
~/.platformio/packages/tool-avrdude/bin/avrdude \
  -C ~/.platformio/packages/tool-avrdude/avrdude.conf \
  -p atmega328p -c arduino \
  -P /dev/cu.usbmodem11401 -b 115200 \
  -D -U flash:w:.pio/build/uno/firmware.hex:i
```

Le bootloader ATmega328P n'écoute que **~1-2 secondes** après un reset avant de passer à l'application. Si l'upload bloque à `Looking for upload port...`, c'est que cette fenêtre a été manquée.

> **⚠️ Point de vigilance — processus zombies sur le port série**
>
> Si des scripts Python `pyserial` ou `avrdude` s'exécutent puis timeoutent, ils peuvent rester bloqués en état **"U" (uninterruptible sleep)** sur macOS. Même `kill -9` ne peut pas les tuer. Ils continuent à squatter le port série et **empêchent tout nouvel upload** ou toute nouvelle communication.
>
> **Symptôme** : `avrdude` bloque sur `Looking for upload port...` même après plusieurs resets.
>
> **Solution unique** : **débrancher physiquement le câble USB** de l'Arduino, attendre 3 secondes, rebrancher. Cela libère le port au niveau kernel et débloque tous les processus fantômes.
>
> Vérifier les zombies :
> ```bash
> ps aux | grep -E "(avrdude|serial\.Serial)" | grep -v grep
> ```

Séquence de démarrage normale dans le moniteur série :
```
Dragino LA66 Device, LA66-V1.x
Join...
JOINED
```

Une fois `JOINED` affiché, le device envoie `Hello World` toutes les 60 secondes.

---

## Partie 6 — Vérifier que tout fonctionne

### 6.1 Logs gateway bridge (paquets radio reçus)

```bash
cd ~/Desktop/chirpstack-docker
docker compose logs -f chirpstack-gateway-bridge
```

Signal de succès :
```
event=up uplink_id=XXXX   ← une trame LoRa reçue
event=stats               ← keepalive de la gateway (toutes les 30s)
```

### 6.2 Interface web ChirpStack

- http://localhost:8080 → **Applications** → **LA66-Arduino** → **LA66-LA781268**
- Onglet **LoRaWAN frames** : voir les JOIN Request / JOIN Accept et les uplinks
- Onglet **Events** : voir les données décodées

### 6.3 Décoder le payload

Le champ `data` d'un uplink dans ChirpStack est **encodé en base64**, pas en hex ni en ASCII.

Exemple d'uplink :
```json
{
  "fCnt": 1,
  "fPort": 2,
  "data": "SGVsbG8gV29ybGQ=",
  "rxInfo": [{ "rssi": -67, "snr": 6.8 }]
}
```

Décoder `SGVsbG8gV29ybGQ=` :
```bash
echo "SGVsbG8gV29ybGQ=" | base64 -d
# → Hello World
```

> **⚠️ Point de vigilance** : ne pas confondre les représentations du payload
> - Dans le sketch Arduino : `48656C6C6F20576F726C64` (hex ASCII de "Hello World")
> - Sur la radio LoRa : bytes bruts `0x48 0x65 0x6C 0x6C 0x6F 0x20 0x57 0x6F 0x72 0x6C 0x64`
> - Dans l'API/JSON ChirpStack : `SGVsbG8gV29ybGQ=` (base64 des bytes bruts)
> - Dans un codec JavaScript ChirpStack : `Uint8Array [72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]`

Pour afficher directement le texte décodé dans l'UI ChirpStack, un **codec JS est déjà installé** sur le device profile `Dragino-LA66` (Device profile → Codec → JavaScript, runtime = `JS`) :

```javascript
function decodeUplink(input) {
  var text = '';
  for (var i = 0; i < input.bytes.length; i++) {
    text += String.fromCharCode(input.bytes[i]);
  }
  var hex = '';
  for (var j = 0; j < input.bytes.length; j++) {
    hex += ('0' + input.bytes[j].toString(16)).slice(-2);
  }
  return {
    data: {
      text: text,
      hex: hex.toUpperCase(),
      bytes: input.bytes.length,
      fPort: input.fPort
    }
  };
}

function encodeDownlink(input) {
  var bytes = [];
  if (input.data && input.data.text) {
    for (var i = 0; i < input.data.text.length; i++) {
      bytes.push(input.data.text.charCodeAt(i));
    }
  }
  return { bytes: bytes };
}
```

Vérification : UI ChirpStack → `Applications` → `LA66-Arduino` → `LA66-LA781268` → onglet **Events** → événement `up`. Le champ `object` du prochain uplink contiendra :
```json
{ "text": "Hello World", "hex": "48656C6C6F20576F726C64", "bytes": 11, "fPort": 2 }
```

### 6.4 Commandes AT utiles (via Serial Monitor)

| Commande | Description |
|----------|-------------|
| `AT+DEUI=?` | Lire le DevEUI |
| `AT+APPEUI=?` | Lire l'AppEUI |
| `AT+APPKEY=?` | Lire l'AppKey |
| `AT+NJS=?` | Statut du JOIN (0=non joiné, 1=joiné) |
| `ATZ` | Reset du module |

---

## Dépannage

### La gateway n'apparaît pas dans ChirpStack

1. Vérifier que le Pi est joignable : `ping 192.168.1.23`
2. Vérifier le service sur le Pi : `sudo systemctl status dragino_fwd`
3. Vérifier que `server_address` dans `/etc/lora/local_conf.json` est l'IP du Mac
4. Vérifier les logs bridge : `docker compose logs -f chirpstack-gateway-bridge`

### Le device ne rejoint pas (pas de JOINED)

1. Vérifier que la gateway est **Online** dans l'UI ChirpStack
2. Vérifier que le DevEUI, AppEUI et AppKey dans ChirpStack correspondent à l'étiquette
3. Vérifier que le device profile est bien en **OTAA** et **EU868**
4. Vérifier que le LA66 est bien câblé sur les pins D10 (RX) et D11 (TX)

### SSH impossible sur le Pi

- Le port 22 est ouvert : `nc -zv 192.168.1.23 22`
- Si clé SSH invalide après reboot : `ssh-keygen -R 192.168.1.23`
- Mots de passe à essayer : `raspberry`, `dragino`, `dragino1234`

### Docker ne démarre pas

```bash
# Vérifier que Docker Desktop est lancé
docker info

# Relancer tous les services
cd ~/Desktop/chirpstack-docker
docker compose down && docker compose up -d
```

### Upload Arduino qui bloque à `Looking for upload port...`

Cause : la fenêtre bootloader (1-2 s après reset) a été manquée, souvent parce que la compilation prend trop de temps entre le reset et l'upload effectif.

Solutions :
1. **Compiler séparément** puis flasher (voir §5.3 méthode alternative)
2. Si le port est squatté par des zombies : débrancher/rebrancher le câble USB
3. Utiliser le bouton **Upload** de PlatformIO dans VSCode qui synchronise le reset automatiquement

### Uplink reçu mais payload illisible dans l'UI

Le payload est en **base64** dans le JSON de ChirpStack. Voir §6.3 pour le décoder ou écrire un codec.

### SSH sur le Pi refuse le mot de passe

- Vérifier qu'on utilise le bon user : `pi`, `root` ou `admin` selon la distro
- Mots de passe par défaut Dragino : `dragino` ou `dragino1234`
- Après un reboot, si `passwd` n'a pas été correctement appliqué, les credentials par défaut peuvent revenir. Toujours vérifier avec le mot de passe usine avant de conclure au problème réseau.

### Le device rejoint mais pas d'uplinks visibles

- Vérifier que `network_joined_status` passe à `1` dans le sketch (message `JOINED` reçu)
- L'intervalle est de 60 s par défaut — patienter
- Vérifier `docker compose logs -f chirpstack | grep uplink`

---

## Récapitulatif des points de vigilance

| Sujet | Piège | Solution |
|-------|-------|----------|
| Port série macOS | `/dev/tty.*` attend le carrier detect et bloque | Utiliser `/dev/cu.*` |
| Zombies sur port série | Process en état "U" indestructibles | Débrancher/rebrancher le câble USB |
| Bootloader Arduino | Fenêtre de 1-2 s après reset | Compiler séparément, reset juste avant avrdude |
| SoftwareSerial | Ne pas installer `EspSoftwareSerial` sur AVR | Utiliser le SoftwareSerial intégré au framework |
| Payload ChirpStack | Base64, pas hex | `base64 -d` ou codec JS |
| IP du Mac | Doit rester stable | Réservation DHCP dans le routeur |
| SSH known_hosts | Clé invalide après reflash du Pi | `ssh-keygen -R <ip>` |
| Credentials LA66 | Étiquette collée facilement perdue | Photo + backup numérique |

---

## Références

- [ChirpStack Documentation](https://www.chirpstack.io/docs/)
- [Dragino LA66 User Manual](https://www.dragino.com/downloads/index.php?dir=LA66/)
- [Dragino XX1302 Gateway](https://www.dragino.com/products/lora/item/228-lg02.html)
- [ChirpStack Docker GitHub](https://github.com/chirpstack/chirpstack-docker)
