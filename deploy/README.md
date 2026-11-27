# Deploying MaM Portal

The portal and the mail proxy are one process. It belongs on its own host in front
of the mail servers, not on a Carbonio/Zimbra node: it terminates client TLS for
993/995/465, so the backends keep their own certificates untouched.

```
mail client ──TLS──▶ MaM (993/995/465) ──TLS──▶ Carbonio / Zimbra (993/995/465)
                     one hostname, routing by login
```

## Path A — systemd (recommended for one host)

```bash
git clone https://github.com/afatyoo/MaM-Portal.git
cd MaM-Portal

sudo ./deploy/install.sh --gen-cert mail.example.com
sudo vi /opt/mam-portal/config.ini     # [MAIL] + MaMKey_*
sudo systemctl restart mam-portal

systemctl status mam-portal
journalctl -u mam-portal -n 30 --no-pager
```

What the installer does: creates the `mam` user, copies the app to `/opt/mam-portal`,
runs `npm ci --omit=dev`, generates `config.ini` from the sample if missing, installs
`mam-portal.service`, then enables and starts it. Ports 993/995/465 are granted with
`AmbientCapabilities=CAP_NET_BIND_SERVICE`, so the service never runs as root.

Re-running it upgrades in place and keeps `config.ini`, `certs/`, and `data/`.

## Path B — container

```bash
mkdir -p /srv/mam/{etc,certs}
cp config.sample.ini /srv/mam/etc/config.ini
cp deploy/docker-compose.yml /srv/mam/
cd /srv/mam && docker compose up -d
```

`network_mode: host` is required: the proxy owns the mail ports, and the backends
must see the host's address. `NET_BIND_SERVICE` lets the non-root `node` user bind
them.

## Minimum `config.ini`

```ini
[WEB]
http_port = 8080

[DEFAULT]
default_domain = example.com

[MAIL]
enabled = true
hostname = mail.example.com
bind_host = 0.0.0.0
imaps_port = 993
pop3s_port = 995
smtps_port = 465
tls_cert_file = certs/mail.crt
tls_key_file = certs/mail.key
send_originating_ip = true
route_cache_enabled = true

[MaMKey_1]
name = Carbonio CE
server = https://mail1.example.com
domains = example.com
preauthkey = <preauth key>
mail_host = 10.0.0.11
ca_file = certs/internal-ca.pem
```

`hostname` is the single name clients see. `mail_host` is where the backend actually
answers; `ca_file` pins the internal CA, and `insecure_tls = true` is for lab only —
the proxy logs a warning at start if a server uses it.

## On every backend (required for the real client IP)

Run these on the Carbonio/Zimbra node, with `<MAM_IP>` replaced by this server:

```bash
# 1. trust the proxy for IMAP ID / POP3 XOIP, then restart mailboxd (read at startup)
su - zextras -c "zmprov ms \$(zmhostname) +zimbraMailTrustedIP <MAM_IP>"
systemctl restart carbonio-appserver        # or: zmmailboxdctl restart

# 2. SMTP XCLIENT (Postfix). Zimbra has no LDAP attribute for this one.
su - zextras -c 'postconf -e "smtpd_authorized_xclient_hosts = <MAM_IP>"'
systemctl restart carbonio-postfix          # or: systemctl restart zimbra-mta
```

**Point `imap_port` / `pop3_port` at mailboxd, not at 993/995.** On both Carbonio and Zimbra,
993 and 995 belong to the bundled nginx proxy. nginx terminates TLS and forwards on its own, so
the `ID X-ORIGINATING-IP` / `XOIP` we send stops there and the backend keeps logging the proxy's
address. Use the mailboxd ports instead:

```ini
[MaMKey_1]
mail_host = 10.0.0.11
mail_servername = mail1.example.com
imap_port = 7993      # mailboxd IMAPS
pop3_port = 7995      # mailboxd POP3S
ca_file = certs/internal-ca.pem
```

SMTP 465 is served by Postfix directly, so `smtps_port = 465` is fine.

Zimbra blocks 7993/7995 by default (firewalld only opens the standard ports, and the
connection fails with `EHOSTUNREACH` even though mailboxd listens on `0.0.0.0`). Open
them for the proxy only:

```bash
firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="<MAM_IP>" port port="7993" protocol="tcp" accept'
firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="<MAM_IP>" port port="7995" protocol="tcp" accept'
firewall-cmd --reload
```

**`server =` must be the backend FQDN, not an IP.** Webmail login posts SOAP to `server + soap_path`,
and `fetch` verifies the hostname against the backend certificate: `https://10.0.0.11` fails with
`soap_error: fetch failed`. `mail_host` may stay an IP because the mail path uses `mail_servername`.
If the proxy host has no DNS for those names, add them to `/etc/hosts`.

**`preauthkey` is required for webmail login**, not for the mail proxy. Read the domain key with
`zmprov gd <domain> zimbraPreAuthKey`, or create one with `zmprov gdpak <domain>`.

Without these, login still works; the backend just records the proxy's address instead of the
user's. `postconf -e` writes Postfix's `main.cf` directly, so a config regeneration can drop it —
re-check after Carbonio upgrades.

Verified on Carbonio CE 4.5.14 (2026-11-26): with 993/995 the log showed
`ip=10.0.0.x;oip=<proxy>`; with 7993/7995 plus the trusted IP and a mailboxd restart it showed
`ip=<proxy>;oip=<client>`.

## Firewall

Only these need to be reachable from the internet: `993`, `995`, `465` (and `80`/`443`
or `8080` if the portal login page sits on the same host). The admin UI should stay
on the internal network.

## Check it works

```bash
# listeners and status
journalctl -u mam-portal -n 20 --no-pager
curl -s localhost:8080/api/health

# login through the proxy, then look for the log line with the routed backend
cat /opt/mam-portal/data/login_attempts.jsonl | tail -3

# cache state
curl -s -b cookies.txt localhost:8080/api/admin/mail/status | jq .cache
```

A successful login on a domain that exists on two backends first shows
`"cache":"miss"` with two entries in `attempted`, then `"cache":"hit"` with one on
the next login.

The first start with no admin creates `admin` with `DEFAULT_ADMIN_PASS`, or with a
random password in `/opt/mam-portal/data/initial-admin-password`. Installs made with
older versions may still use `admin`/`admin`: the server warns at start; change it.

The sample config serves the web on `127.0.0.1` only. Put a TLS reverse proxy in front
(and set `trust_proxy`), or enable `https_enabled` and clear `bind_host`.
