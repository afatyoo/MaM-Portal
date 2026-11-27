#!/bin/sh
# Install or upgrade. Nothing is enabled or started on a fresh install: the admin
# edits the config first. Existing config, certificates and data are never overwritten.
set -e

ETC=/etc/mam-portal
VAR=/var/lib/mam-portal

if ! getent passwd mam >/dev/null; then
    adduser --system --group --home "$VAR" --no-create-home --quiet mam
fi

# These directories are writable by the service user, and this script runs as root:
# never follow a link the service could have planted there.
for d in "$ETC" "$ETC/certs" "$VAR"; do
    if [ -L "$d" ]; then
        echo "mam-portal: $d is a symlink, refusing to continue" >&2
        exit 1
    fi
done
[ -d "$ETC" ] || install -d -o mam -g mam -m 0750 "$ETC"
[ -d "$ETC/certs" ] || install -d -o mam -g mam -m 0750 "$ETC/certs"
[ -d "$VAR" ] || install -d -o mam -g mam -m 0700 "$VAR"

# set -C creates with O_EXCL, so an existing file or link is never written through.
if [ ! -e "$ETC/config.ini" ] && [ ! -L "$ETC/config.ini" ]; then
    SECRET=$(openssl rand -hex 32)
    ( set -C; umask 027; sed "s/CHANGE_ME_SESSION_SECRET/$SECRET/" /usr/share/mam-portal/config.sample.ini > "$ETC/config.ini" )
    chown -h mam:mam "$ETC/config.ini"
fi

# Without this the first start would have no known password.
if [ ! -e "$ETC/mam-portal.env" ] && [ ! -L "$ETC/mam-portal.env" ] && [ ! -e "$VAR/admin_users.json" ]; then
    ( set -C; umask 077; printf 'DEFAULT_ADMIN_PASS=%s\n' "$(openssl rand -hex 12)" > "$ETC/mam-portal.env" )
fi

systemctl daemon-reload >/dev/null 2>&1 || true

if [ -f /etc/systemd/system/mam-portal.service ]; then
    echo "WARNING: /etc/systemd/system/mam-portal.service (from deploy/install.sh) overrides the packaged unit."
    echo "         See /usr/share/doc/mam-portal/INSTALL.md to migrate."
fi

if [ "$1" = "configure" ] && [ -n "$2" ]; then
    if systemctl is-active --quiet mam-portal; then
        systemctl restart mam-portal || true
    fi
elif [ "$1" = "configure" ]; then
    cat <<'MSG'

MaM Portal is installed but not started.
  1. edit /etc/mam-portal/config.ini
  2. systemctl enable --now mam-portal
  The web portal listens on 127.0.0.1:8080 until you change [WEB] in the config.
  The first admin password is in /etc/mam-portal/mam-portal.env (root only).
Details: /usr/share/doc/mam-portal/INSTALL.md

MSG
fi
exit 0
