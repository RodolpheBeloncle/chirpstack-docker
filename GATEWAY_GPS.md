# Gateway Dragino — GPS et enregistrement sur cartes publiques LoRa

Scope : **enregistrer la gateway** (Dragino SX1302 HAT sur Raspberry Pi) sur les cartes publiques de couverture LoRaWAN. Ne concerne PAS les devices (LA66, Arduino, etc.).

---

## 1. Branchement de l'antenne GPS

Le HAT Dragino SX1302 v1.5 a **deux connecteurs SMA** :

| Connecteur | Antenne | Position |
|---|---|---|
| SMA du haut (déjà utilisé) | **LoRa 868 MHz** — la tige verte flexible actuellement branchée | Ne pas toucher |
| SMA du bas (labellisé `GPS-ANT` / `GPS_ANT`) | **GPS 1575.42 MHz** — le patch blanc plat | À visser ici |

**Réponse directe** : visse le GPS sur le **connecteur fixe du HAT (celui du bas, labellisé GPS-ANT)**, PAS sur la tige flexible balante (qui est la LoRa).

Le patch GPS blanc porte l'inscription `GPS ANTENNA 1575.42MHz 3.0-5.0V` — c'est bien lui.

**Placement** : le patch GPS doit avoir **vue sur le ciel** (fenêtre ouverte, appui de fenêtre, extérieur). Face en céramique blanche vers le haut. Un fix satellite prend 1 à 5 minutes à froid.

---

## 2. Activation GPS côté Dragino

Via l'UI web du Dragino (LoRaWAN → LoRaWAN → Radio) :

- **GPS Enable** : coché
- **gps_tty_path** : `/dev/serial0`

Sauvegarder + redémarrer le packet forwarder.

Alternative en SSH : éditer `/etc/lora/global_conf.json` et ajouter/modifier :
```json
"gateway_conf": {
  "gps_tty_path": "/dev/serial0",
  ...
}
```

---

## 3. Vérifier le fix GPS

En SSH sur le Dragino :

```bash
sudo cat /dev/serial0
# Doit afficher des trames NMEA type $GPGGA,$GPRMC avec lat/lon non nulles
```

```bash
logread | grep -i gps
# Cherche "GPS sync OK" ou équivalent
```

Une fois le fix acquis, **ChirpStack renseigne automatiquement la localisation** de la gateway (Gateways → [ta gateway] → carte).

---

## 4. Enregistrement sur cartes publiques

### Option A — TTN Mapper (recommandé, natif ChirpStack v4.2+)

Dans ChirpStack UI :
1. **Applications** → sélectionner l'application → **Integrations**
2. Ajouter **TTN Mapper**
3. Renseigner l'email de contact + activer

Les uplinks incluant lat/lon (venant de devices GPS OU métadonnées gateway) alimentent la carte publique **ttnmapper.org**.

### Option B — Enregistrement manuel

Cartes publiques qui acceptent l'enregistrement manuel d'une gateway (nom, EUI, coordonnées, altitude) :
- **mappy.lora-alliance.org** — carte officielle LoRa Alliance
- **signalsflow.com** — carte communautaire

Créer un compte, déclarer la gateway avec :
- Gateway EUI (visible dans ChirpStack → Gateways)
- Lat / Lon (celles remontées par ton GPS)
- Frequency plan : EU868
- Modèle : Dragino SX1302 LPS8v2 (ou équivalent selon ton HAT)

---

## 5. Post-migration VPS

Si la stack ChirpStack migre vers le VPS (voir `VPS_MIGRATION.md`), rien à refaire côté GPS : la config GPS vit **sur le Dragino**, pas sur ChirpStack. Seul le `Server Address` du packet forwarder change (voir §9 du runbook migration).
