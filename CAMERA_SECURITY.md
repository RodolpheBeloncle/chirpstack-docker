# Sécuriser la caméra TC55 (Eseecloud) — zéro donnée vers des tiers

Constat : RTSP ouvert **sans mot de passe** (port 554), port 80 ouvert, firmware chinois qui
contacte le cloud Eseecloud/P2P par défaut. Objectif : la caméra ne parle qu'au LAN (go2rtc/Frigate).

Caméra : IP `192.168.1.16`, MAC `cc:b8:5e:17:6b:e9`.

## 1. Couper Internet à la caméra (le plus important)

Livebox (http://192.168.1.1) :
1. **Réseau → DHCP** : bail statique `cc:b8:5e:17:6b:e9` → `192.168.1.16` (sinon `go2rtc.yaml` casse).
2. **Contrôle parental** (ou Pare-feu) : ajouter l'appareil `cc:b8:5e:17:6b:e9` → accès Internet
   **bloqué en permanence**. Le LAN continue de fonctionner.
3. **Réseau → NAT/PAT** : aucune redirection vers la caméra. **UPnP désactivé** (sinon le P2P s'ouvre des ports seul).

Box qui ne bloque pas par MAC : à défaut, mettre une passerelle/DNS bidon en IP fixe dans la caméra
(gateway `192.168.1.254` inexistante) — elle reste joignable en LAN, plus vers Internet.

## 2. Configurer la caméra (une fois, avant de couper Internet si l'app l'exige)

App Eseecloud / ISEEHOME ou http://192.168.1.16 :
- Changer le mot de passe `admin` (ou en définir un).
- Désactiver cloud / P2P / push / mises à jour automatiques si les options existent.
- Puis **supprimer la caméra de l'app** et désinstaller l'app du téléphone.

Si un mot de passe RTSP est activé, mettre à jour `configuration/go2rtc/go2rtc.yaml` :
`rtsp://admin:MOTDEPASSE@192.168.1.16:554/live/ch00_0` (idem `ch00_1`), puis `docker compose restart go2rtc`.
Ne pas commiter ce mot de passe : passer par une variable `${CAMERA_PASSWORD}` dans `.env`
(go2rtc lit les variables d'env avec la syntaxe `${VAR}`).

## 3. Vérifier qu'elle ne sort plus

Depuis le Mac (même LAN, outil ponctuel) :
```bash
# requêtes DNS de la caméra si la box le permet, sinon :
sudo tcpdump -i en0 host 192.168.1.16 and not net 192.168.1.0/24
```
Rien ne doit apparaître (sauf ARP/broadcast). Le Wi-Fi commuté du Mac ne voit pas tout : le blocage box fait foi.

## 4. Mieux (optionnel)

- Réseau dédié IoT/invité isolé, avec seulement go2rtc autorisé vers la caméra
  (la Livebox grand public le fait mal ; un routeur OpenWrt le fait bien).
- Ne jamais exposer go2rtc (1984) ni Frigate (8971) sur Internet : déjà bindés sur `127.0.0.1`.
  Accès distant = VPN (WireGuard/Tailscale), cf. déploiement Coolify.
- Heure de la caméra : sans Internet elle perd le NTP ; les horodatages Frigate viennent du serveur, sans impact.
