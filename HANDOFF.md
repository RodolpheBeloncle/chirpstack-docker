# HANDOFF — système jardin connecté (pour la prochaine session IA)

Lire ce fichier en premier. Mis à jour : 2026-10-24.

## Objectif utilisateur

Arrosage connecté d'un jardin à ~5 km de la maison : sonde de sol + électrovanne
LoRaWAN Dragino → gateway Raspberry Pi (shield LoRa) à la maison → ChirpStack →
Home Assistant → app Android simple.

Contraintes exprimées :
- Pragmatique, minimum de services à gérer. **Pas de n8n** (refus explicite).
- Dépendances tierces OK si centralisées dans Home Assistant et modifiables.
- Éviter Firebase / services Google imposés.

## État actuel (local, Mac)

| Brique | État | Accès |
|---|---|---|
| ChirpStack v4 | tourne (docker compose) | http://localhost:8080 |
| Mosquitto | user `homeassistant` ajouté (mdp `MOSQUITTO_HA_PASSWORD` dans `.env`) | interne `mosquitto:1883`, externe 8883 TLS |
| Home Assistant | conteneur `homeassistant`, intégration MQTT configurée | http://localhost:8123 (user `rodolphe_beloncle`) |
| Capteurs démo | `configuration/homeassistant/configuration.yaml` (section `mqtt:`) | topics `application/demo/device/a840410000000001/...` |
| Simulateur | `scripts/simulate-uplink.sh [intervalle_s]` publie de faux uplinks ChirpStack | — |
| App Android | `mobile/` (React Native CLI 0.85.2), vidéo HLS via WebSocket HA `camera/stream` + `react-native-video` (repli snapshot `entity_picture`) | voir `mobile/README.md` |
| Dashboard HA "Jardin" | `configuration/homeassistant/dashboards/jardin.yaml` (YAML) | http://localhost:8123/dashboard-jardin |
| Caméra Teruhal TC55 (Eseecloud) | `192.168.1.16`, RTSP `live/ch00_0` (HEVC 1080p) **sans auth** → service `go2rtc` → HA `camera.jardin` | go2rtc UI http://127.0.0.1:1984 |
| Frigate (NVR, détection CPU, MQTT user `frigate`) | `configuration/frigate/config.yml`, lit les flux via go2rtc, enreg. motion 3 j / alertes 14 j | https://127.0.0.1:8971 (user `admin`, mdp généré au 1er lancement, à changer) |

### Déploiement serveur (Coolify, 31.70.69.194)

- Repo rsync dans `/opt/jardin` (sans .git/mobile), lancé par
  `docker compose -f docker-compose.yml -f docker-compose.coolify.yml up -d`. Aucun port publié.
- HA public : https://jardin.triggerstudio.dev (labels Traefik dans `docker-compose.coolify.yml`).
- WireGuard : serveur `10.77.0.1` (`/etc/wireguard/wg0.conf`, route 192.168.1.16 via le pair maison) ;
  maison `10.77.0.2` = conteneur `wireguard` (`docker-compose.home.yml`, projet `jardin-home`, conf gitignorée).
  Plus tard : le Pi remplace le Mac comme pair maison. Stack locale du Mac arrêtée.

Ajouter un appareil : suivre `HA_DEVICE_INTEGRATION.md`.
Sécuriser la caméra (pas de cloud) : `CAMERA_SECURITY.md`. Agent DVR désinstallé (remplacé par Frigate).

Matériel : **aucun capteur reçu**. Sonde choisie : Dragino **SE01-LS** (solaire).
Vanne : contrôleur d'électrovanne Dragino (modèle exact à confirmer).

## Pièges déjà rencontrés

- **chirp2mqtt** = add-on HA OS (repo `modrisb/chirpha`), inutilisable avec HA en Docker. Ne pas le reproposer.
- **HACS** : flux d'auth GitHub plante (aiohttp "Got more than 8190 bytes"). Désinstallé, inutile ici.
- Noms d'entités HA dérivés du `name` (`Sol humidité` → `sensor.sol_humidite`).
- Champs du codec Dragino (`water_SOIL`, `temp_SOIL`, `conduct_SOIL`, `BatV`) = **supposés**, à vérifier sur une vraie trame.
- Switch vanne en `optimistic: true` avec payload factice (`AQ==`/`AA==`) : remplacer par la vraie commande Dragino + `state_topic`.
- Vanne LoRaWAN Class A : downlink livré seulement après un uplink (latence = intervalle d'envoi).
- Caméra : le go2rtc intégré à HA wrappe les flux en `ffmpeg:` → échec (exit 183) sur la TC55. Solution : service
  `go2rtc` dédié (`configuration/go2rtc/go2rtc.yaml`, source RTSP native) + `go2rtc: url:` dans HA ;
  caméra HA "Generic" = `rtsp://go2rtc:8554/camera_jardin` + snapshot `http://go2rtc:1984/api/frame.jpeg?src=camera_jardin`.
- Caméra : RTSP ouvert sans mot de passe + cloud Eseecloud par défaut → bloquer son accès Internet (Livebox),
  fixer son IP en DHCP statique (sinon `go2rtc.yaml` casse). Lecture live HEVC dans le navigateur : OK Safari, variable sur Chrome.
- Frigate : `detect: enabled: true` obligatoire (sinon detect/state OFF). Intégration Frigate dans HA = composant custom (HACS cassé → install manuelle si besoin).
- **HA 2026 : section YAML `http:` ignorée** (`yaml_migration_done` dans `.storage/http`). Reverse proxy = éditer
  `.storage/http` (HA arrêté) : `use_x_forwarded_for: true`, `trusted_proxies: ["10.0.1.0/24"]` (réseau `coolify`).
- Serveur : certs Mosquitto copiés depuis le Mac (uid 501) → `chown -R 1883:1883 configuration/mosquitto/certs`.
- Tunnel WireGuard sur **UDP 4500** (autorisé par défaut par la Livebox, IPSEC-NAT-T) + règle entrante UDP 4500 dans le pare-feu de l'hébergeur. Clamp MSS (TCPMSS) obligatoire des deux côtés, sinon RTSP en timeout.
- VPN téléphone : pair `10.77.0.3` (conf `/etc/wireguard/phone.conf` sur le serveur, QR via qrencode). UIs sur l'IP VPN seulement : ChirpStack http://10.77.0.1:8081 (8080 = coolify-proxy), go2rtc :1984, Frigate https://10.77.0.1:8971. wg0 doit être up avant docker au boot.
- Tunnel durci : PresharedKey (serveur `/etc/wireguard/home.psk`) ; côté maison seul `wg0 → 192.168.1.16:554` est forwardé (reste DROP) ;
  côté serveur rien n'entre depuis wg0 (INPUT/DOCKER-USER DROP hors réponses). Gateway LoRa plus tard = ouvrir explicitement son flux (UDP 1700 ou MQTT).
- Let's Encrypt : 5 échecs/h max par domaine (DNS absent = échec) → ne lancer Traefik qu'après propagation DNS.
- Mosquitto sans ACL : tous les users voient tous les topics. À corriger avant exposition.

## Prochaines étapes (ordre)

1. **Tester l'app** sur le téléphone avec la démo (simulateur lancé, token HA dans `mobile/src/config.ts`).
2. **Quand la SE01-LS arrive** : l'enregistrer dans ChirpStack (EU868, OTAA, codec Dragino
   `dragino/dragino-end-node-decoder`), lire une trame réelle, remplacer `demo` + DevEUI + noms de champs
   dans `configuration.yaml`. Test de portée 5 km (SNR > −15 dB à SF12 sinon antenne extérieure).
3. **Vanne** : vraie commande downlink + retour d'état.
4. **Déploiement sécurisé via Coolify** (demandé par l'utilisateur) : ACL Mosquitto, HA derrière HTTPS
   (ou accès VPN WireGuard/Tailscale), passer l'URL de l'app en HTTPS, keystore release.
5. Notifications sans Firebase : app HA "minimal" (F-Droid) ou ntfy, configurées dans HA.
