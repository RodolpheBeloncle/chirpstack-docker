# GardenMobile

App Android minimale : lit les capteurs du jardin et pilote la vanne via
l'API REST de Home Assistant (pas de MQTT dans l'app, tout passe par HA).
Méthode de build reprise de `musik_downloader_mobile` : React Native CLI pur,
APK debug autonome (sans Metro), sideload par `adb`.

## Config

```bash
cp src/config.example.ts src/config.ts   # gitignoré
```
- `HA_URL` : IP LAN du Mac (`ipconfig getifaddr en0`), port 8123. Le téléphone doit être sur le même Wi-Fi.
- `HA_TOKEN` : HA → Profil → Sécurité → Jetons d'accès longue durée.
- `SENSORS` / `VALVE` / `CAMERA` : entity_id HA (vidéo HLS demandée à HA en WebSocket, repli snapshot 1×/s).

Le token est embarqué dans l'APK : acceptable en sideload perso, pas pour distribuer.

## Build & install

```bash
export ANDROID_SDK_ROOT="$HOME/Library/Android/sdk"
export JAVA_HOME=$(/usr/libexec/java_home -v 19)
npm run build:apk      # android/app/build/outputs/apk/debug/app-debug.apk
npm run install:apk    # téléphone branché en USB, débogage USB activé
```

`debuggableVariants = []` dans `android/app/build.gradle` force le bundle JS
même en debug (APK autonome). HTTP en clair autorisé en debug uniquement :
passer HA en HTTPS avant tout build release.

## Démo sans capteur

Depuis la racine du repo : `./scripts/simulate-uplink.sh 10`
