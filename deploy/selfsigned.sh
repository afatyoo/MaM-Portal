#!/usr/bin/env bash
# Generate a self-signed certificate for MaM (lab / internal use).
#
#   sudo ./deploy/selfsigned.sh mail.example.com
#   sudo ./deploy/selfsigned.sh mail.example.com extra.example.com
#
# The hostname goes in CN and in the SAN together with every local IPv4 address, so
# clients that connect by name *or* by IP both validate. Clients still show a warning
# until the certificate is imported as trusted (see deploy/README.md).
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/mam-portal}"
DAYS="${DAYS:-825}"
NAME="${1:-}"
if [ -z "${NAME}" ]; then
    printf 'usage: %s <hostname> [extra-hostname...]\n' "$0" >&2
    exit 2
fi
shift

SAN="DNS:${NAME}"
for ip in $(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' | sort -u); do
    SAN="${SAN},IP:${ip}"
done
for extra in "$@"; do
    SAN="${SAN},DNS:${extra}"
done

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days "${DAYS}" \
    -keyout "${tmp}/mail.key" -out "${tmp}/mail.crt" \
    -subj "/CN=${NAME}" -addext "subjectAltName=${SAN}" >/dev/null 2>&1

mkdir -p "${APP_DIR}/certs"
install -m 640 "${tmp}/mail.crt" "${APP_DIR}/certs/mail.crt"
install -m 600 "${tmp}/mail.key" "${APP_DIR}/certs/mail.key"
if id -u mam >/dev/null 2>&1; then
    chown mam:mam "${APP_DIR}/certs/mail.crt" "${APP_DIR}/certs/mail.key"
fi

printf '\033[1;34m[mam]\033[0m self-signed certificate written to %s/certs\n' "${APP_DIR}"
openssl x509 -in "${APP_DIR}/certs/mail.crt" -noout -subject -dates -ext subjectAltName

if systemctl is-active --quiet mam-portal 2>/dev/null; then
    systemctl restart mam-portal
    printf '\033[1;34m[mam]\033[0m mam-portal restarted\n'
fi
