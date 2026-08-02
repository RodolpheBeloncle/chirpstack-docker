# Ajout de capteurs (Température + Humidité du sol) sur LA66 + Arduino Uno

Ce document explique **de zéro** comment brancher un capteur de température et/ou un capteur d'humidité du sol sur l'Arduino Uno déjà monté avec le shield Dragino LA66, puis remonter les valeurs dans ChirpStack via LoRaWAN.

---

## 1. Matériel de référence (photo du projet)

| Élément | Rôle |
|--------|------|
| **Elegoo Uno R3** (Arduino Uno compatible, ATmega328P) | MCU qui lit les capteurs et parle au LA66 |
| **Dragino LA66 Shield** (SN: LA781268, DevEUI: `A840416E01896414`) | Modem LoRaWAN EU868, communique en AT sur SoftwareSerial D10/D11 |
| **Dragino PG1302 Concentrator HAT** (sur Raspberry Pi, IP `192.168.1.23`) | Gateway LoRaWAN EU868, forwarde vers ChirpStack sur le Mac |
| **Batterie Li-Po Cellevia 3.7V 4000mAh** | Alim autonome du couple Uno+LA66 (à brancher sur JST) |
| **Pack 3× VARTA AA 2100mAh** (4.5V nominal) | Alim alternative pour le Uno via jack ou VIN |

> ⚠️ **Alimentation** : ne PAS brancher la Li-Po (3.7V) sur le pin `5V` de l'Uno — trop bas pour le régulateur. Utiliser soit :
> - le **JST du shield LA66** (si présent, c'est prévu pour Li-Po),
> - soit un **step-up 5V** entre la Li-Po et le pin VIN,
> - soit le **pack 3×AA (4.5V)** sur VIN (ça passe pour un régulateur linéaire mais rendement médiocre).

---

## 2. Capteurs supportés dans ce guide

Deux capteurs simples et courants, câblés en parallèle :

### 2.1 DHT22 (ou DHT11) — Température + Humidité de l'air

| DHT22 | Arduino Uno |
|-------|-------------|
| VCC   | 5V |
| DATA  | D2 (avec résistance pull-up 10 kΩ vers 5V) |
| GND   | GND |

Le DHT11 se câble pareil (moins précis, plage plus étroite).

### 2.2 Capteur d'humidité du sol capacitif (v1.2 ou équivalent)

| Sol capacitif | Arduino Uno |
|---------------|-------------|
| VCC   | 5V (ou 3.3V selon le modèle — vérifier l'étiquette) |
| AOUT  | A0 |
| GND   | GND |

> ⚠️ **Éviter le capteur résistif** (deux pointes métalliques nues) : il se corrode en quelques semaines. Préférer le **capacitif** (PCB unique, souvent noir).

### 2.3 Broches à éviter

- **D10 et D11** : utilisées par le shield LA66 (SoftwareSerial). Ne rien y brancher.
- **D0 et D1** : Serial USB. Ne rien y brancher.
- **SW1 sur le shield** : doit être sur la position qui laisse D10/D11 vers le module LA66 (voir sérigraphie).

---

## 3. Câblage récapitulatif

```
                Arduino Uno + shield LA66
   ┌────────────────────────────────────────┐
   │  5V ─────┬─── DHT22 VCC                │
   │          └─── Sol capacitif VCC        │
   │  GND ────┬─── DHT22 GND                │
   │          └─── Sol capacitif GND        │
   │  D2  ─────── DHT22 DATA (+ 10kΩ→5V)    │
   │  A0  ─────── Sol capacitif AOUT        │
   │  D10 ─────── (réservé LA66 RX)         │
   │  D11 ─────── (réservé LA66 TX)         │
   └────────────────────────────────────────┘
```

---

## 4. Format du payload LoRaWAN

Payload compact **6 octets** sur fPort 2, format big-endian :

| Offset | Taille | Champ | Encodage | Plage |
|--------|--------|-------|----------|-------|
| 0-1 | 2 o | Température (°C × 100) | int16 signé | -327.68 à +327.67 |
| 2-3 | 2 o | Humidité air (% × 100) | uint16 | 0 à 100.00 |
| 4-5 | 2 o | Humidité sol (% × 100) | uint16 | 0 à 100.00 |

Exemple : 23.45 °C, 62.30 %HR air, 41.20 %HR sol
→ bytes = `09 29 18 56 10 18` (hex) → `AT+SENDB=0,2,6,0929185610 18`

> Pourquoi × 100 et pas des floats ? LoRaWAN pénalise le nombre d'octets (temps d'air, duty cycle 1% EU868). 6 octets = décisions rapides, plusieurs uplinks/jour possibles sans saturer le canal.

---

## 5. Code Arduino (PlatformIO)

Créer / remplacer `src/main.cpp` du projet PlatformIO `LORAWAN`.

### 5.1 `platformio.ini`

```ini
[env:uno]
platform = atmelavr
board = uno
framework = arduino
monitor_speed = 9600
upload_port = /dev/cu.usbmodem11401
lib_deps =
  adafruit/DHT sensor library@^1.4.6
  adafruit/Adafruit Unified Sensor@^1.1.14
```

### 5.2 `src/main.cpp`

```cpp
#include <Arduino.h>
#include <SoftwareSerial.h>
#include <DHT.h>

// --- Capteurs ---
#define DHT_PIN     2
#define DHT_TYPE    DHT22        // ou DHT11 si tu as un DHT11
#define SOIL_PIN    A0
#define SOIL_DRY    620          // valeur ADC dans l'air (à calibrer)
#define SOIL_WET    280          // valeur ADC pot d'eau (à calibrer)

DHT dht(DHT_PIN, DHT_TYPE);

// --- LA66 ---
SoftwareSerial ss(10, 11);       // RX=D10, TX=D11
char rxbuff[128];
uint8_t rxbuff_index = 0;
bool network_joined_status = false;

// --- Timing ---
long old_time = 0;
const long uplink_interval = 60000;  // 60 s

// Convertit une valeur ADC brute en % d'humidité du sol (0=sec, 100=trempé)
uint16_t soilPercent(int raw) {
  long pct = map(raw, SOIL_DRY, SOIL_WET, 0, 10000);   // × 100 direct
  if (pct < 0)     pct = 0;
  if (pct > 10000) pct = 10000;
  return (uint16_t) pct;
}

void sendSensors() {
  float tC = dht.readTemperature();
  float hAir = dht.readHumidity();
  int soilRaw = analogRead(SOIL_PIN);

  if (isnan(tC))    tC = 0;
  if (isnan(hAir))  hAir = 0;

  int16_t  tEnc    = (int16_t)  (tC   * 100);
  uint16_t hEnc    = (uint16_t) (hAir * 100);
  uint16_t soilEnc = soilPercent(soilRaw);

  char hex[16];
  snprintf(hex, sizeof(hex), "%04X%04X%04X",
           (uint16_t) tEnc, hEnc, soilEnc);

  String cmd = "AT+SENDB=0,2,6,";
  cmd += hex;

  Serial.print("Uplink: "); Serial.println(cmd);
  ss.println(cmd);
}

void setup() {
  Serial.begin(9600);
  ss.begin(9600);
  ss.listen();
  dht.begin();
  ss.println("ATZ");             // reset LA66 → relance JOIN
}

void loop() {
  long now = millis();
  if ((now - old_time >= uplink_interval) && network_joined_status) {
    old_time = now;
    sendSensors();
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

### 5.3 Compilation et flash

```bash
cd ~/Documents/PlatformIO/Projects/LORAWAN
~/.platformio/penv/bin/pio run -e uno            # compile
~/.platformio/penv/bin/pio run -e uno -t upload  # flash
~/.platformio/penv/bin/pio device monitor -b 9600 -p /dev/cu.usbmodem11401
```

> Si l'upload bloque à `Looking for upload port...`, voir `DEPLOYMENT.md` §Dépannage.

---

## 6. Calibration du capteur de sol (obligatoire)

Sans calibration, `SOIL_DRY` et `SOIL_WET` donnent des pourcentages faux. Procédure :

1. Flasher un sketch simple qui log `analogRead(A0)` toutes les 2 s :
   ```cpp
   void setup(){ Serial.begin(9600); }
   void loop(){ Serial.println(analogRead(A0)); delay(2000); }
   ```
2. **Sonde en l'air (sec)** → noter la valeur (souvent 550-650). C'est `SOIL_DRY`.
3. **Sonde dans un verre d'eau jusqu'à la ligne max** → noter la valeur (souvent 250-320). C'est `SOIL_WET`.
4. Reporter ces deux valeurs dans `main.cpp` puis reflasher le sketch principal.

> Ne jamais immerger le PCB au-dessus de la ligne marquée sur la sonde (limite étanche).

---

## 7. Configuration côté ChirpStack

Le device profile `Dragino-LA66` existe déjà (voir `DEPLOYMENT.md`). Il suffit de **remplacer le codec JS** pour décoder le nouveau payload de 6 octets.

### 7.1 Nouveau codec JS

UI ChirpStack → `Device profiles` → `Dragino-LA66` → onglet **Codec** → coller :

```javascript
function decodeUplink(input) {
  var b = input.bytes;
  if (b.length < 6) {
    return { errors: ["payload trop court, attendu 6 octets"] };
  }

  // int16 signé pour la température
  var tRaw = (b[0] << 8) | b[1];
  if (tRaw & 0x8000) tRaw -= 0x10000;

  var hAir  = ((b[2] << 8) | b[3]) / 100.0;
  var hSoil = ((b[4] << 8) | b[5]) / 100.0;

  return {
    data: {
      temperature_c:  tRaw / 100.0,
      humidity_air:   hAir,
      humidity_soil:  hSoil,
      fPort:          input.fPort
    }
  };
}

function encodeDownlink(input) {
  return { bytes: [] };
}
```

### 7.2 Vérification

Après le prochain uplink (≤ 60 s) :

- UI → `Applications` → `LA66-Arduino` → `LA66-LA781268` → onglet **Events** → `up`
- Champ `object` attendu :
  ```json
  {
    "temperature_c": 23.45,
    "humidity_air": 62.30,
    "humidity_soil": 41.20,
    "fPort": 2
  }
  ```

---

## 8. Points de vigilance

| Sujet | Piège | Solution |
|-------|-------|----------|
| Alim Li-Po | 3.7V trop bas sur `5V` du Uno | JST du shield, step-up, ou 3×AA sur VIN |
| DHT22 pull-up | Sans 10kΩ → lectures NaN | Souder / brancher le pull-up entre DATA et VCC |
| Capteur sol résistif | Corrosion rapide | Utiliser la version **capacitive** |
| Calibration sol | Valeurs 0% ou 100% figées | Refaire §6 |
| Broches D10/D11 | Coupent la comm LA66 | Interdites pour capteurs |
| Duty cycle EU868 | 1% max → ~36 s/heure d'émission | `uplink_interval` ≥ 60 s pour SF12 |
| Codec runtime | Runtime doit être `JS`, pas `NONE` | Bien sauver depuis l'UI (bouton en bas) |
| Payload endianness | Décodeur qui inverse les octets | Big-endian dans le sketch et dans le codec |

---

## 9. Étapes suivantes possibles

- Ajouter la **tension batterie** : lire A1 via un pont diviseur, ajouter 2 octets au payload.
- Passer en **classe A avec deep sleep** (`LowPower.h`) pour tenir plusieurs mois sur la Li-Po 4000mAh.
- Ajouter une **règle d'alerte** (webhook / MQTT integration ChirpStack) si `humidity_soil < 20 %`.
- Historiser les données via **InfluxDB + Grafana** (integration native ChirpStack).
