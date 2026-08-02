# Runbook — Migration ChirpStack stack Mac → VPS Linux

Cible : passage du stack `chirpstack-docker` du MBP maison vers un VPS Debian/Ubuntu pour obtenir un vrai setup prod (IP fixe, uptime, fail2ban, certbot cron).

Durée estimée : **2-4 h** dont ~30 min de downtime réel.

---

## 0. Pré-requis

- VPS provisionné (Hetzner CX22 / Scaleway DEV1-S / OVH VLE, 2 vCPU / 2 Go RAM min, Debian 12 ou Ubuntu 24.04)
- Accès SSH root ou sudo user
- IPv4 publique fixe du VPS (ex : `X.X.X.X`)
- Nom de domaine `mqtt.rodolphebeloncle.com` géré chez Ionos (accès admin)
- Access au repo git `chirpstack-docker` local

---

## 1. Hardening VPS (30 min)

```bash
# Sur le VPS, en tant que root
apt update && apt upgrade -y
apt install -y ufw fail2ban docker.io docker-compose-v2 certbot git vim

# Créer user non-root
adduser deploy
usermod -aG sudo,docker deploy

# SSH hardening : /etc/ssh/sshd_config
#   PermitRootLogin no
#   PasswordAuthentication no
#   Port 22022         # optionnel, port non-standard
# Copier clé publique locale :
#   ssh-copy-id -p 22022 deploy@X.X.X.X
systemctl restart ssh

# UFW
ufw default deny incoming
ufw default allow outgoing
ufw allow 22022/tcp        # SSH (ou 22 si port standard)
ufw allow 80/tcp           # certbot renewal HTTP-01
ufw allow 443/tcp          # futur (dashboard, API)
ufw allow 8883/tcp         # MQTT TLS
ufw allow 3001/tcp         # BasicStation (optionnel, seulement si gateway direct)
ufw enable
```

---

## 2. DNS : TTL bas AVANT cutover (2 h à l'avance)

Chez Ionos :
1. Descendre le TTL du record A `mqtt.rodolphebeloncle.com` à **60 s** (au lieu de 3600)
2. Attendre 1 h que la propagation atteigne les caches DNS mondiaux
3. **Ne pas encore changer l'IP** — juste le TTL

---

## 3. Copier le stack sur le VPS

Depuis le Mac :
```bash
# Créer un tarball propre (sans .env, sans certs)
cd /Users/rodolphebeloncle/Desktop/chirpstack-docker
tar --exclude='.env' \
    --exclude='configuration/mosquitto/certs' \
    --exclude='.git' \
    -czf /tmp/chirpstack-stack.tgz .

scp -P 22022 /tmp/chirpstack-stack.tgz deploy@X.X.X.X:~/
```

Sur le VPS :
```bash
mkdir chirpstack-docker && cd chirpstack-docker
tar xzf ~/chirpstack-stack.tgz
mkdir -p configuration/mosquitto/certs
```

## 4. Régénérer les secrets sur le VPS

```bash
cd ~/chirpstack-docker
cat > .env <<EOF
MOSQUITTO_CHIRPSTACK_PASSWORD=$(openssl rand -base64 18)
MOSQUITTO_N8N_PASSWORD=$(openssl rand -base64 18)
EOF
chmod 600 .env
cat .env    # noter le password n8n pour MAJ credential n8n après cutover
```

**Ne PAS réutiliser les passwords du Mac** — clean slate.

---

## 5. Obtenir cert Let's Encrypt sur le VPS

**Avant de changer le DNS**, on ne peut pas encore générer le cert (LE valide contre le domaine, qui pointe encore vers la maison). Deux options :

### Option A — DNS-01 challenge (préféré)
Utiliser le plugin certbot Ionos (nécessite API token Ionos) : cert sans avoir à basculer l'IP.

### Option B — Basculer DNS puis générer (plus simple, 5 min downtime)
1. Ionos : changer A record → IP VPS
2. Attendre propagation (TTL 60s = ~2 min)
3. Sur VPS :
   ```bash
   certbot certonly --standalone -d mqtt.rodolphebeloncle.com \
     --agree-tos -m rodolphe.beloncle@rokodo.io --non-interactive
   ```
4. Copier :
   ```bash
   cp /etc/letsencrypt/live/mqtt.rodolphebeloncle.com/fullchain.pem \
      ~/chirpstack-docker/configuration/mosquitto/certs/server.crt
   cp /etc/letsencrypt/live/mqtt.rodolphebeloncle.com/privkey.pem \
      ~/chirpstack-docker/configuration/mosquitto/certs/server.key
   chmod 644 ~/chirpstack-docker/configuration/mosquitto/certs/server.crt
   chmod 600 ~/chirpstack-docker/configuration/mosquitto/certs/server.key
   ```

---

## 6. Cert renewal automatique (cron systemd)

Certbot installe déjà un timer systemd (`certbot.timer`). Ajouter un hook post-renewal pour recopier + reload Mosquitto :

```bash
sudo tee /etc/letsencrypt/renewal-hooks/deploy/chirpstack-mosquitto.sh <<'EOF'
#!/bin/bash
DOMAIN=mqtt.rodolphebeloncle.com
STACK=/home/deploy/chirpstack-docker
cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem $STACK/configuration/mosquitto/certs/server.crt
cp /etc/letsencrypt/live/$DOMAIN/privkey.pem   $STACK/configuration/mosquitto/certs/server.key
chmod 644 $STACK/configuration/mosquitto/certs/server.crt
chmod 600 $STACK/configuration/mosquitto/certs/server.key
cd $STACK && docker compose restart mosquitto
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/chirpstack-mosquitto.sh
sudo systemctl enable --now certbot.timer
```

Test à sec : `sudo certbot renew --dry-run`.

---

## 7. fail2ban pour Mosquitto (bloque brute-force sur 8883)

Mosquitto loggue les auths échouées vers stdout (donc dans les logs Docker). Pipe-les vers un fichier lisible par fail2ban :

```bash
# Docker compose déjà en log JSON. Alternative : ajouter driver syslog
# Plus simple : envoyer les logs mosquitto vers un fichier via docker logging driver
```

Dans `docker-compose.yml`, ajouter à mosquitto :
```yaml
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "5"
```

Créer un jail fail2ban :
```bash
sudo tee /etc/fail2ban/filter.d/mosquitto.conf <<'EOF'
[Definition]
failregex = ^.*\[<HOST>:\d+\] disconnected: not authorised.*$
ignoreregex =
EOF

sudo tee /etc/fail2ban/jail.d/mosquitto.local <<'EOF'
[mosquitto]
enabled = true
filter = mosquitto
logpath = /var/lib/docker/containers/*/*-json.log
maxretry = 5
findtime = 300
bantime = 3600
action = iptables-allports[name=mosquitto]
EOF

sudo systemctl restart fail2ban
sudo fail2ban-client status mosquitto
```

**Note :** Docker NAT masque les IP source pour trafic inter-conteneur — mais pour trafic EXTERNE via port `8883` publié, Mosquitto voit la vraie IP publique du client → fail2ban peut bannir.

---

## 8. Lancer le stack et vérifier

```bash
cd ~/chirpstack-docker
docker compose up -d
sleep 10
docker compose ps
docker compose logs mosquitto | tail -20     # aucun "not authorised"
docker compose logs chirpstack | tail -20    # "Setting up API interface"
```

Test TLS depuis externe :
```bash
mosquitto_sub -h mqtt.rodolphebeloncle.com -p 8883 -u n8n -P '<pw>' \
  --capath /etc/ssl/certs -t '$SYS/broker/version' -C 1
```

---

## 9. Reconfigurer la gateway Dragino (LPS8N ou équivalent)

La gateway continue de causer avec l'ancienne infra (semtech-udp ou BasicStation vers l'ancien host). Pour la basculer vers le VPS :

### Cas 1 — Gateway parle UDP Packet Forwarder (semtech-udp, port 1700) — **CAS ACTUEL**

Interface web Dragino (`http://<IP-LAN-gateway>/`, login `root`) → **LoRaWAN → LoRaWAN → Semtech UDP GWMP**.

| Champ | Avant (Mac LAN) | Après (VPS) |
|---|---|---|
| Protocol | Semtech UDP GWMP | Semtech UDP GWMP (inchangé) |
| Server Address | `192.168.1.14` | `mqtt.rodolphebeloncle.com` (ou IP VPS) |
| Server Port Up | `1700` | `1700` |
| Server Port Down | `1700` | `1700` |

Sauver → Reboot gateway (ou SSH : `/etc/init.d/lora_pkt_fwd restart`).

**Pièges Dragino :**
- Cache DNS local → prévoir 5-10 min après changement, ou reboot pour forcer
- Vérifier que la box maison autorise UDP sortant vers le VPS (normalement OK par défaut)
- Le keepalive PULL_DATA toutes les 10s maintient le NAT ouvert pour les downlinks (natif, rien à faire)

**Vérif après cutover :**
1. SSH gateway : `logread | grep -i pkt_fwd` → uplinks envoyés vers le VPS
2. VPS : `docker compose logs chirpstack-gateway-bridge | tail -20` → uplinks reçus
3. ChirpStack UI (`http://<IP-VPS>:8080`) → Gateways → **Last seen** se rafraîchit

⚠️ **Sur le VPS**, ouvrir UDP 1700 dans UFW :
```bash
ufw allow 1700/udp
```
Le service `chirpstack-gateway-bridge` (dans compose, port `1700:1700/udp`) recevra les paquets.

### Cas 2 — Gateway parle BasicStation (WebSocket sur port 3001)
Fichier de config sur la gateway : `station.conf` ou via UI.
- **URI** : `wss://mqtt.rodolphebeloncle.com:3001` (WSS = TLS)
- Actuellement le `chirpstack-gateway-bridge-basicstation` écoute en **plain** sur 3001. Pour prod, activer TLS dans `chirpstack-gateway-bridge-basicstation-eu868.toml` :
  ```
  [backend.basic_station]
  bind=":3001"
  tls_cert="/mosquitto/certs/server.crt"
  tls_key="/mosquitto/certs/server.key"
  ```
  (Monter le volume certs dans le service basicstation aussi.)
- Uploader `trust.crt` (chaîne LE) sur la gateway pour valider le cert serveur.

### Cas 3 — Migration MQTT direct (avancé, non-recommandé sans mTLS)
La gateway parle MQTT directement à Mosquitto → nécessite creds MQTT stockés sur la gateway. À réserver pour setup avec mTLS.

**Vérifier après cutover** : dans ChirpStack UI (`http://<VPS-IP>:8080`), section Gateways → last seen doit se mettre à jour.

---

## 10. Cutover DNS + validation

Si tu as pris l'option B au step 5, le cutover est déjà fait. Sinon :
1. Ionos : A record → IP VPS
2. Attendre 2 min (TTL 60s)
3. Vérifier : `dig +short mqtt.rodolphebeloncle.com` → IP VPS partout
4. Sur le Mac : `docker compose down` (arrêt stack ancien)
5. n8n : MAJ credential MQTT avec le nouveau password (celui du `.env` VPS)

Remonter le TTL à 3600 chez Ionos une fois stable.

---

## 11. Post-migration

- Livebox : supprimer les port forwards 80/443/1883/5432/8883/9001 (plus utile, VPS est le point d'entrée)
- Mac : `docker compose down` définitif, garder le repo local en dev
- VPS : configurer backup postgres cron :
  ```bash
  0 3 * * * docker exec chirpstack-docker-postgres-1 pg_dumpall -U chirpstack | gzip > /home/deploy/backups/pg-$(date +\%F).sql.gz
  ```
- Monitoring : installer Netdata (`bash <(curl -Ss https://my-netdata.io/kickstart.sh)`) pour dashboards CPU/RAM/disk/network

---

## Checklist go/no-go avant cutover

- [ ] VPS SSH accessible via clé, root désactivé
- [ ] UFW actif, ports minimum ouverts
- [ ] `.env` créé sur VPS avec nouveaux secrets, perms 600
- [ ] Stack démarre `docker compose ps` = tout up
- [ ] Cert LE valide sur VPS (`openssl x509 -in server.crt -noout -dates`)
- [ ] Test `mosquitto_sub` externe fonctionne
- [ ] Renewal hook installé et testé (`certbot renew --dry-run`)
- [ ] fail2ban actif sur jail mosquitto
- [ ] DNS TTL descendu à 60s depuis ≥1 h
- [ ] Backup postgres du Mac exporté au cas où
- [ ] Nouveau password n8n noté pour MAJ credential
