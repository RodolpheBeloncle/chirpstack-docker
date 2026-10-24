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
| App Android | `mobile/` (React Native CLI 0.85.2) | voir `mobile/README.md` |

Matériel : **aucun capteur reçu**. Sonde choisie : Dragino **SE01-LS** (solaire).
Vanne : contrôleur d'électrovanne Dragino (modèle exact à confirmer).

## Pièges déjà rencontrés

- **chirp2mqtt** = add-on HA OS (repo `modrisb/chirpha`), inutilisable avec HA en Docker. Ne pas le reproposer.
- **HACS** : flux d'auth GitHub plante (aiohttp "Got more than 8190 bytes"). Désinstallé, inutile ici.
- Noms d'entités HA dérivés du `name` (`Sol humidité` → `sensor.sol_humidite`).
- Champs du codec Dragino (`water_SOIL`, `temp_SOIL`, `conduct_SOIL`, `BatV`) = **supposés**, à vérifier sur une vraie trame.
- Switch vanne en `optimistic: true` avec payload factice (`AQ==`/`AA==`) : remplacer par la vraie commande Dragino + `state_topic`.
- Vanne LoRaWAN Class A : downlink livré seulement après un uplink (latence = intervalle d'envoi).
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
