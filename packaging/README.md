# MaM Portal Debian package

Build (needs node, npm, nfpm): `./packaging/build-deb.sh` → `dist/mam-portal_<version>_all.deb`.

## Install

```bash
sudo apt install ./mam-portal_<version>_all.deb
sudo vi /etc/mam-portal/config.ini
sudo systemctl enable --now mam-portal
sudo cat /etc/mam-portal/mam-portal.env   # first admin password
```

Needs `nodejs` 18.17 or newer. The service is not started by the package.

| Path | Content |
|---|---|
| `/etc/mam-portal/config.ini` | configuration (also written by the admin UI) |
| `/etc/mam-portal/certs/` | TLS certificates; `certs/...` in the config points here |
| `/var/lib/mam-portal/` | login log, admin users, sessions, route cache |

For a test certificate:

```bash
sudo APP_DIR=/etc/mam-portal /usr/share/mam-portal/selfsigned.sh mail.example.com
sudo chown -R mam:mam /etc/mam-portal/certs
```

`apt remove` keeps config and data; `apt purge` deletes them.

Backend settings (trusted IP, XCLIENT, mailboxd ports) are the same as for the
other install methods, see `deploy/README.md` in the repository.

## Migrate from `deploy/install.sh`

Copy config, certificates and data **before** installing the package, so it does
not generate a new config or an unused admin password. `/opt/mam-portal` is left
untouched for rollback.

```bash
sudo systemctl disable --now mam-portal
sudo mv /etc/systemd/system/mam-portal.service /root/mam-portal.service.old
sudo install -d /etc/mam-portal/certs /var/lib/mam-portal
sudo cp -a /opt/mam-portal/config.ini /etc/mam-portal/
sudo cp -a /opt/mam-portal/certs/. /etc/mam-portal/certs/
sudo cp -a /opt/mam-portal/data/. /var/lib/mam-portal/
sudo apt install ./mam-portal_<version>_all.deb
sudo chown -R mam:mam /etc/mam-portal/config.ini /etc/mam-portal/certs /var/lib/mam-portal
sudo systemctl enable --now mam-portal
```

The unit runs `/usr/bin/node` (the `nodejs` package), not a node installed from a
tarball under `/usr/local`.

Rollback: `sudo apt remove mam-portal`, move the old unit back to
`/etc/systemd/system/`, then `sudo systemctl daemon-reload && sudo systemctl enable --now mam-portal`.
