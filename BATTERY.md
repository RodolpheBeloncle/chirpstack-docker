# Suivi de la batterie (4× AA NiMH 2100 mAh) — version minimaliste, zéro composant

Objectif : brancher juste le **shield support de piles** (4× VARTA AA NiMH 2100 mAh) sous l'Arduino Uno + shield LA66, et **remonter la tension batterie** par LoRaWAN, sans souder quoi que ce soit.

---

## 1. Le principe : lire VCC via la référence interne 1.1 V

L'ATmega328P intègre une **référence de tension interne à 1.1 V** très stable. En mesurant cette référence *à travers* l'ADC configuré sur VCC, on peut en déduire VCC :

```
VCC = 1.1 V × 1023 / ADC(bandgap 1.1 V)
```

Aucun câblage externe : pas de pont diviseur, pas de fil sur A0/A1, rien à souder. Le shield batterie s'enfile directement.

### Pourquoi ça donne bien Vbat sur ce montage ?

Le shield batterie alimente l'Arduino via **VIN** → le régulateur linéaire on-board du Uno abaisse à 5 V.  
Tant que Vbat > ~6.5 V, on lit **5 V** (tension régulée, constante) → inutile.

Le pack NiMH fournit **4.4 V à 5.6 V**, ce qui est **sous le seuil du régulateur**. Deux cas selon le shield :

- **Shield qui bypasse le régulateur** (câble direct sur le pin 5V ou sur la rail 5V) → VCC = Vbat directement. C'est le cas de la plupart des shields piles Dragino / Elegoo. ✅
- **Shield qui passe par VIN** → à 4.8 V le régulateur *décroche* (dropout ~1.5 V) et laisse passer la tension quasi telle quelle. VCC ≈ Vbat − 0.1 V. ✅ aussi utilisable.

> ⚠️ Prise de responsabilité : ce mode d'alimentation **contourne la protection** du régulateur linéaire. En cas de surtension (pack Li-ion mal identifié, chargeur défectueux), l'Arduino grille. Pack NiMH 4×AA = pas de risque, la tension max reste sous 6 V. Tu as validé ce choix.

---

## 2. Câblage

```
   Pack 4×AA NiMH ── shield support piles ── Arduino Uno + shield LA66
       (Vbat ≈ 4.8 V)
```

C'est tout. Le shield support de piles s'enfile sur les headers du Uno. Aucun fil supplémentaire.

**Vérification au multimètre AVANT de brancher** :
- Mesurer la tension aux bornes du pack chargé → doit être entre **4.8 V et 5.6 V**.
- Si > 6 V : **ne pas brancher** (chargeur défaillant ou piles non-NiMH).

---

## 3. Format du payload LoRaWAN

Payload **3 octets** sur fPort 3 :

| Offset | Taille | Champ | Encodage |
|--------|--------|-------|----------|
| 0-1 | 2 o | VCC en **millivolts** | uint16 big-endian |
| 2   | 1 o | Pourcentage estimé (0-100) | uint8 |

Exemple : VCC = 4820 mV → 42 % → bytes `12D4 2A` → `AT+SENDB=0,3,3,12D42A`

---

## 4. Code Arduino

### 4.1 `platformio.ini`

Aucune lib externe :

```ini
[env:uno]
platform = atmelavr
board = uno
framework = arduino
monitor_speed = 9600
upload_port = /dev/cu.usbmodem11401
```

### 4.2 `src/main.cpp` — firmware « battery-only »

```cpp
#include <Arduino.h>
#include <SoftwareSerial.h>

// --- Plage NiMH 4S pour l'estimation du % ---
#define VBAT_FULL_MV  5400   // 4× 1.35 V (juste après charge)
#define VBAT_EMPTY_MV 4400   // 4× 1.10 V (fin d'utilisation utile)

// --- Calibration bandgap (voir §5) ---
// Valeur théorique = 1100 mV. En pratique 1050-1150 mV selon les puces.
#define BANDGAP_MV    1100

// --- LA66 ---
SoftwareSerial ss(10, 11);   // RX=D10, TX=D11
char rxbuff[128];
uint8_t rxbuff_index = 0;
bool network_joined_status = false;

// --- Timing ---
long old_time = 0;
const long uplink_interval = 600000;   // 10 minutes

// Lit VCC en mV via la référence interne 1.1 V (bandgap)
// Aucun câblage externe requis.
uint16_t readVccMv() {
  // Sélectionne la bandgap comme entrée de l'ADC, ref = AVcc (VCC)
  ADMUX = _BV(REFS0) | _BV(MUX3) | _BV(MUX2) | _BV(MUX1);
  delay(3);                          // laisser stabiliser Vref
  ADCSRA |= _BV(ADSC);               // start conversion
  while (bit_is_set(ADCSRA, ADSC));  // attendre fin

  uint16_t adc = ADC;                // 0..1023 = bandgap mesuré vs VCC
  // VCC = bandgap × 1023 / adc
  uint32_t vcc = ((uint32_t) BANDGAP_MV * 1023UL) / adc;
  return (uint16_t) vcc;
}

uint8_t vccPercent(uint16_t mv) {
  if (mv >= VBAT_FULL_MV)  return 100;
  if (mv <= VBAT_EMPTY_MV) return 0;
  return (uint8_t) (((uint32_t) (mv - VBAT_EMPTY_MV) * 100) /
                    (VBAT_FULL_MV - VBAT_EMPTY_MV));
}

void sendBattery() {
  uint16_t mv = readVccMv();
  uint8_t  pct = vccPercent(mv);

  char hex[16];
  snprintf(hex, sizeof(hex), "%04X%02X", mv, pct);

  String cmd = "AT+SENDB=0,3,3,";
  cmd += hex;

  Serial.print("VCC="); Serial.print(mv);
  Serial.print(" mV ("); Serial.print(pct); Serial.println("%)");
  Serial.print("Uplink: "); Serial.println(cmd);
  ss.println(cmd);
}

void setup() {
  Serial.begin(9600);
  ss.begin(9600);
  ss.listen();
  ss.println("ATZ");           // reset LA66 → JOIN
  old_time = millis() - uplink_interval + 15000;  // premier envoi ~15 s après JOIN
}

void loop() {
  long now = millis();
  if ((now - old_time >= uplink_interval) && network_joined_status) {
    old_time = now;
    sendBattery();
  }

  while (ss.available()) {
    char c = (char) ss.read();
    rxbuff[rxbuff_index++] = c;
    if (rxbuff_index >= sizeof(rxbuff) - 1) rxbuff_index = 0;
    if (c == '\n' || c == '\r') {
      rxbuff[rxbuff_index] = '\0';
      if (strncmp(rxbuff, "JOINED", 6) == 0)               network_joined_status = true;
      if (strncmp(rxbuff, "Dragino LA66 Device", 19) == 0) network_joined_status = false;
      if (rxbuff_index > 1) Serial.print(rxbuff);
      rxbuff_index = 0;
    }
  }
}
```

### 4.3 Flash

```bash
cd ~/Documents/PlatformIO/Projects/LORAWAN
~/.platformio/penv/bin/pio run -e uno -t upload
~/.platformio/penv/bin/pio device monitor -b 9600 -p /dev/cu.usbmodem11401
```

---

## 5. Calibration du bandgap (5 minutes, une seule fois)

Chaque ATmega328P a un bandgap réel entre **1050 et 1150 mV**. La valeur par défaut `1100` peut donner un écart de ±5 %. Pour corriger :

1. Alimenter le Uno via **USB** (tension 5V stable).
2. Mesurer la tension exacte du pin `5V` au multimètre → ex. `4980 mV`.
3. Ouvrir le moniteur série → lire la valeur `VCC=` remontée par le firmware → ex. `5120 mV`.
4. Nouveau `BANDGAP_MV` = `1100 × (mesure_multimètre / valeur_lue)` = `1100 × 4980 / 5120` = **1070**.
5. Reporter dans le code et reflasher.

Après cette étape, la lecture `readVccMv()` sera précise à ±1 % sur toute la plage.

---

## 6. Codec JS ChirpStack (fPort 3)

UI ChirpStack → `Device profiles` → `Dragino-LA66` → onglet **Codec** → remplacer par :

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

  // fPort 2 = payload texte (test « Hello World »)
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
  "battery_mv": 4820,
  "battery_v": 4.82,
  "battery_percent": 42,
  "fPort": 3
}
```

---

## 7. Estimer l'autonomie

### 7.1 Consommation attendue

Uno + shield LA66 **sans deep sleep** :
- Idle : 30-50 mA
- Pic émission LoRa : 100-120 mA pendant ~1 s

Conso moyenne ≈ **40 mA**.

### 7.2 Calcul théorique

```
Capacité utile pack   = 2100 mAh × 90 % (rendement NiMH)  ≈ 1890 mAh
Autonomie théorique   = 1890 / 40                          ≈ 47 h ≈ 2 jours
```

### 7.3 Mesure réelle avec ce firmware

Un uplink toutes les 10 min pendant 2-3 jours → courbe de décharge visible dans ChirpStack (Events → export ou integration MQTT/InfluxDB).

Fin d'autonomie utile = **quand `battery_mv` passe sous ~4400 mV**. Le temps écoulé = autonomie réelle du montage.

### 7.4 Optimisations si autonomie insuffisante

| Piste | Gain typique |
|-------|--------------|
| **Deep sleep** entre uplinks (`LowPower.powerDown()`) | ×10 à ×50 |
| Remplacer le Uno par un **Pro Mini 3.3 V** (pas de régulateur, pas de LED) | ×3 |
| Uplink toutes les 30 min au lieu de 10 min | ×3 |
| Couper la LED d'alim du Uno | +5 mA gagnés |

---

## 8. Points de vigilance

| Sujet | Piège | Solution |
|-------|-------|----------|
| Bandgap non calibré | Écart jusqu'à ±5 % sur la mesure | Faire §5 une fois |
| Shield → régulateur qui décroche | Uno reset spontanés à Vbat < ~6.5 V si le shield passe par VIN | Vérifier que le shield alimente le rail 5V directement (bypass régulateur) |
| NiMH auto-décharge | 10-15 %/mois | Recharger juste avant l'installation |
| Interprétation du % | Formule linéaire mV↔% pas fidèle en fin de décharge (chute brutale NiMH) | Utiliser plutôt `battery_mv` comme indicateur principal |
| fPort | Confusion fPort 2 (test) vs fPort 3 (batterie) | Toujours vérifier `input.fPort` dans le codec |
| SoftwareSerial + bandgap | La lecture ADC ne perturbe pas la comm série (mesure < 5 ms) | Rien à faire, testé |

---

## 9. Étapes suivantes

Une fois l'autonomie mesurée sur ce firmware simple :
1. Ajouter les capteurs (`SENSORS.md`) sur fPort 2.
2. Garder l'uplink batterie moins fréquent (1×/heure) sur fPort 3.
3. Ajouter `LowPower.h` si l'autonomie est insuffisante.
