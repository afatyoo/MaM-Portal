#!/usr/bin/env bash
# Install MaM Portal on a Debian/Ubuntu host as a systemd service.
#
#   sudo ./deploy/install.sh                 # install, enable, start
#   sudo ./deploy/install.sh --gen-cert mail.example.com
#   sudo ./deploy/install.sh --no-start
#
# The portal and the mail proxy run as the same process on purpose: one config,
# one log, one thing to restart. Mail ports stay closed until [MAIL] enabled = true.
set -Eeuo pipefail

APP_DIR="/opt/mam-portal"
APP_USER="mam"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_SRC="${SRC_DIR}/deploy/mam-portal.service"
SERVICE_DST="/etc/systemd/system/mam-portal.service"
GEN_CERT=""
DO_START=1

log()  { printf '\033[1;34m[mam]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[mam]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[mam]\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --gen-cert) GEN_CERT="${2:-}"; shift 2 ;;
        --no-start) DO_START=0; shift ;;
        -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
        *) die "unknown argument: $1" ;;
    esac
done

[ "$(id -u)" = "0" ] || die "run as root (sudo)"

if ! command -v node >/dev/null 2>&1; then
    log "installing nodejs from apt"
    apt-get update -qq
    apt-get install -y -qq nodejs npm
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "${NODE_MAJOR}" -ge 18 ] || die "node $(node -v) is too old, need 18 or newer"

command -v openssl >/dev/null 2>&1 || apt-get install -y -qq openssl

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
    log "creating system user ${APP_USER}"
    useradd --system --home-dir "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
fi

log "copying application to ${APP_DIR}"
mkdir -p "${APP_DIR}"
for item in server.js package.json package-lock.json config.sample.ini mail tools docs public start.sh; do
    [ -e "${SRC_DIR}/${item}" ] || continue
    cp -a "${SRC_DIR}/${item}" "${APP_DIR}/"
done
mkdir -p "${APP_DIR}/data" "${APP_DIR}/certs"

log "installing production dependencies"
( cd "${APP_DIR}" && npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 ) \
    || warn "npm ci failed; the service will not start until dependencies are installed"

if [ ! -f "${APP_DIR}/config.ini" ]; then
    cp "${APP_DIR}/config.sample.ini" "${APP_DIR}/config.ini"
    warn "created ${APP_DIR}/config.ini from the sample; edit it before relying on the portal"
fi

if [ -n "${GEN_CERT}" ]; then
    [ -f "${APP_DIR}/certs/mail.crt" ] && warn "certs/mail.crt already exists, leaving it alone" || {
        log "generating a self-signed certificate for ${GEN_CERT}"
        openssl req -x509 -newkey rsa:2048 -nodes -days 397 \
            -keyout "${APP_DIR}/certs/mail.key" -out "${APP_DIR}/certs/mail.crt" \
            -subj "/CN=${GEN_CERT}" -addext "subjectAltName=DNS:${GEN_CERT}" >/dev/null 2>&1
    }
fi

# The proxy reads its certificate at start; a missing file would only fail at runtime.
if grep -qx 'enabled *= *true' "${APP_DIR}/config.ini" 2>/dev/null; then
    for f in certs/mail.crt certs/mail.key; do
        [ -f "${APP_DIR}/${f}" ] || warn "[MAIL] enabled but ${APP_DIR}/${f} is missing"
    done
fi

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
chmod 750 "${APP_DIR}"
chmod 700 "${APP_DIR}/data"
chmod 750 "${APP_DIR}/certs"
[ -f "${APP_DIR}/config.ini" ] && chmod 640 "${APP_DIR}/config.ini"
[ -d "${APP_DIR}/certs" ] && chmod 640 "${APP_DIR}"/certs/* 2>/dev/null || true

log "installing systemd unit"
install -m 0644 "${SERVICE_SRC}" "${SERVICE_DST}"
# Use the node that is actually installed (nvm, /usr/local/bin, ...), not a guess.
NODE_BIN="$(command -v node)"
sed -i "s|^ExecStart=.*|ExecStart=${NODE_BIN} server.js|" "${SERVICE_DST}"
systemctl daemon-reload

if [ "${DO_START}" = "1" ]; then
    systemctl enable --now mam-portal >/dev/null
    sleep 2
    systemctl --no-pager --lines=0 status mam-portal || true
    log "check the mail listeners with: journalctl -u mam-portal -n 30 --no-pager"
else
    systemctl enable mam-portal >/dev/null
    log "enabled but not started (--no-start)"
fi

cat <<EOF

Next steps:
  1. edit ${APP_DIR}/config.ini   ([MAIL] section, MaMKey_* domains and mail_host)
  2. systemctl restart mam-portal
  3. on every backend, add this server's IP to zimbraMailTrustedIP
     so IMAP/POP logins carry the real client IP
  4. admin UI: http://<this-host>:8080/admin  (mail proxy page: /admin/mail)
EOF
