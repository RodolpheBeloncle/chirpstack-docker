# Suivi de la batterie (Li-Po 1S LP805080 3.7V 4000 mAh)

Objectif : alimenter l'Arduino Uno + shield LA66 via une batterie **Li-Po LP805080 (3.7V 4000 mAh)**, avec charge USB-C, et remonter la tension batterie par LoRaWAN toutes les 60 minutes.

---

## 1. Architecture matérielle

```
                    ┌── USB-C (charge)
                    │
   Li-Po (+) ── JST ─┤ DFRobot Lipo Charger Type-C │─ JST ── Batterie
                    │  (MCP73831, sortie = Vbat)   │
                    │                              │
                    ├── (Vbat ≈ 3.3-4.2V)
                    │
                    ├─── R1 (100 kΩ) ── A0 Uno
                    │                    │
                    │                   R2 (100 kΩ)
                    │                    │
                    │                   GND
                    │
                    └─── XL6009E1 IN+ ── OUT+ ── Uno "5V"
   Li-Po (−) ────────── XL6009E1 IN− ── OUT− ── Uno GND
```

### Composants

| Composant | Rôle |
|-----------|------|
| **Batterie Li-Po LP805080** 3.7V / 4000 mAh | Alimentation |
| **PCM XBL-3944** (intégré à la batterie) | Protection over-discharge (~2.75V), over-charge (~4.25V), court-circuit |
| **DFRobot Lipo Charger Type-C** | Charge USB-C via MCP73831 |
| **XL6009E1** boost step-up | Boost Vbat (3.3-4.2V) → 5V pour l'Uno |
| **2× résistances 100 kΩ** (1%) | Pont diviseur pour lire Vbat sur A0 |

### Réglage XL6009 (impératif avant tout branchement Uno)

1. Brancher **batterie sur IN+/IN−** du XL6009.
2. Multimètre en sortie OUT+/OUT−.
3. Tourner le **potentiomètre bleu** jusqu'à lire **5.00 V ± 0.05 V**.
4. Puis seulement, connecter Uno.

⚠️ Le XL6009 sort ~1.25V par défaut : Uno ne démarrera pas. Réglage obligatoire.

---

## 2. Consommation & autonomie

| État | Courant |
|------|---------|
| Uno + LA66 deep sleep (`LowPower.powerDown()`) | ~1 mA |
| Uno + LA66 émission LoRa (1s toutes les 60 min) | ~100 mA pendant 1s |
| **XL6009 quiescent** ⚠️ | ~10-15 mA (limitation majeure) |
| **Moyenne globale** | ~12 mA |

**Autonomie estimée** : `4000 mAh × 0.85 / 12 mA ≈ 280 h ≈ ~12 jours`

Optimisations possibles si insuffisant :
- Remplacer XL6009 par **MT3608** (~5 mA Iq) → ~25 jours
- Remplacer par **TPS61023** ou **TPS63020** (µA Iq) → ~6 mois
- Passer à un **Pro Mini 3.3V** alimenté direct sur Li-Po (pas de boost) → ~1 an

---

## 3. Format du payload LoRaWAN

Payload **3 octets** sur fPort 3 :

| Offset | Taille | Champ | Encodage |
|--------|--------|-------|----------|
| 0-1 | 2 o | Vbat en **millivolts** | uint16 big-endian |
| 2   | 1 o | Pourcentage estimé (0-100) | uint8 |

Exemple : Vbat = 3820 mV → 68 % → bytes `0EEC 44` → `AT+SENDB=0,3,3,0EEC44`

---

## 4. Firmware Arduino

Emplacement : `~/Documents/PlatformIO/Projects/LORAWAN/src/main.cpp`

### 4.1 `platformio.ini`

```ini
[env:uno]
platform = atmelavr
board = uno
framework = arduino
monitor_speed = 9600
upload_port = /dev/cu.usbmodem11401
lib_deps =
    rocketscream/Low-Power@^1.81
```

### 4.2 Points clés du firmware

- **Mesure Vbat sur A0** avec référence interne 1.1V (précision indépendante de VCC).
- **Pont diviseur ratio 2** (`VBAT_DIVIDER_X10 = 20`) → plage lisible 0-2.2V (Vbat/2 ∈ 1.5-2.1V).
- **Moyennage sur 8 échantillons** pour réduire le bruit ADC.
- **Coupure logicielle** : si `Vbat < 3200 mV`, on skip l'uplink (double sécurité avec le PCM XBL-3944).
- **Uplink toutes les 60 minutes** : `SLEEP_CYCLES = 450` (450 × 8s WDT = 3600s).
- **Courbe Li-Po 1S** (13 points de 4200 → 3200 mV) pour l'estimation du %.

### 4.3 Flash

```bash
cd ~/Documents/PlatformIO/Projects/LORAWAN
~/.platformio/penv/bin/pio run -e uno -t upload
~/.platformio/penv/bin/pio device monitor -b 9600 -p /dev/cu.usbmodem11401
```

---

## 4.4 Vérifier que ça tourne (à faire après flash)

```bash
~/.platformio/penv/bin/pio device monitor -b 9600 -p /dev/cu.usbmodem11401
```

Séquence attendue sur le moniteur série :

1. `Waiting for JOIN...` puis `Joined.` (dans les 60s après reset)
2. `Vbat=XXXX mV (YY%)` — à comparer avec la mesure multimètre aux bornes du JST batterie
3. `Uplink: AT+SENDB=0,3,3,XXXXYY`
4. Silence (deep sleep 60 min) — puis nouvelle trame

Si `Vbat` lu diffère de la mesure multimètre de plus de ±100 mV → calibrer `VBAT_DIVIDER_X10` (§5).

Côté ChirpStack : onglet **Events → up** du device, on doit voir le payload décodé (`battery_mv`, `battery_v`, `battery_percent`) toutes les heures.

---

## 5. Calibration du pont diviseur (optionnel)

Avec R1 = R2 = 100 kΩ, ratio théorique = 2.0. Si les résistances ne sont pas exactement à 100 kΩ (tolérance 1% ou 5%), corriger :

1. Alimenter le montage batterie chargée.
2. Mesurer Vbat au multimètre (aux bornes du JST batterie) → ex. `3820 mV`.
3. Lire la valeur `Vbat=` du moniteur série → ex. `3700 mV`.
4. Nouveau `VBAT_DIVIDER_X10` = `20 × (3820 / 3700)` ≈ **21**.
5. Modifier dans `main.cpp` puis reflasher.

Après cette étape, la lecture est précise à ±1 % sur toute la plage 3200-4200 mV.

---

## 6. Codec JS ChirpStack (fPort 3)

UI ChirpStack → `Device profiles` → `Dragino-LA66` → onglet **Codec** :

```javascript
function decodeUplink(input) {
  var b = input.bytes;

  // fPort 3 = télémétrie batterie (3 octets)
  if (input.fPort === 3 && b.length >= 3) {
    var mv  = (b[0] << 8) | b[1];
    var pct = b[2];
    return {
      data: {
        battery_mv: mv,
        battery_v:  mv / 1000.0,
        battery_percent: pct,
        fPort: input.fPort
      }
    };
  }

  // fPort 2 = payload texte (test)
  if (input.fPort === 2) {
    var text = '';
    for (var i = 0; i < b.length; i++) text += String.fromCharCode(b[i]);
    return { data: { text: text, fPort: input.fPort } };
  }

  return { data: { raw: b, fPort: input.fPort } };
}

function encodeDownlink(input) {
  return { bytes: [] };
}
```

Résultat attendu dans **Events** → `up` :
```json
{
  "battery_mv": 3820,
  "battery_v": 3.82,
  "battery_percent": 68,
  "fPort": 3
}
```

---

## 7. Points de vigilance

| Sujet | Piège | Solution |
|-------|-------|----------|
| XL6009 non réglé | Sort ~1.25V par défaut, Uno ne démarre pas | Régler à 5.00V au multimètre avant de brancher l'Uno |
| XL6009 quiescent élevé | ~10-15 mA à vide → mange l'autonomie | Remplacer par MT3608 / TPS61023 pour production |
| Batterie sans PCM | Décharge profonde = cellule détruite / gonflement | Vérifier présence d'une petite PCB (ex. XBL-3944) sur la batterie |
| Pont diviseur mal calibré | Écart jusqu'à ±5 % sur la mesure | Faire §5 une fois, ajuster `VBAT_DIVIDER_X10` |
| fPort | Confusion fPort 2 (test) vs fPort 3 (batterie) | Toujours vérifier `input.fPort` dans le codec |
| Coupure logicielle | Le seuil 3200 mV est prudent (PCM coupe à ~2.75V) | Ne pas descendre sous 3000 mV dans le code sans raison |
| Charge en fonctionnement | Le module DFRobot charge et alimente simultanément → Vbat monte à ~4.15V | OK, mais l'estimation % sera "sur-optimiste" pendant la charge |

---

## 8. Étapes suivantes

Une fois l'autonomie mesurée sur ce firmware simple :
1. Ajouter les capteurs (`SENSORS.md`) sur fPort 2.
2. Garder l'uplink batterie sur fPort 3 (déjà à 1×/heure).
3. Si autonomie insuffisante, remplacer le boost XL6009 par MT3608 ou passer à un Pro Mini 3.3V direct sur Li-Po.
