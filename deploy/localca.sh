#!/usr/bin/env bash
# Build a small local PKI for MaM: a CA plus a server certificate signed by it.
#
#   sudo ./deploy/localca.sh mam.afatyo.com
#
# A self-signed server certificate doubles as its own CA, which some clients
# (Thunderbird/NSS among them) refuse to use as a trust anchor. A real chain —
# CA with CA:TRUE, server certificate with serverAuth EKU — is what they expect.
# Import the printed CA file into the mail client, not the server certificate.
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/mam-portal}"
CA_DAYS="${CA_DAYS:-3650}"
CERT_DAYS="${CERT_DAYS:-825}"
NAME="${1:-}"
if [ -z "${NAME}" ]; then
    printf 'usage: %s <hostname> [extra-hostname...]\n' "$0" >&2
    exit 2
fi
shift

CERT_DIR="${APP_DIR}/certs"
SAN="DNS:${NAME}"
for ip in $(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' | sort -u); do
    SAN="${SAN},IP:${ip}"
done
for extra in "$@"; do
    SAN="${SAN},DNS:${extra}"
done

mkdir -p "${CERT_DIR}"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

# 1. CA (only created once; trust in clients survives server certificate renewals)
if [ ! -f "${CERT_DIR}/mam-ca.crt" ]; then
    openssl req -x509 -newkey rsa:2048 -nodes -days "${CA_DAYS}" \
        -keyout "${CERT_DIR}/mam-ca.key" -out "${CERT_DIR}/mam-ca.crt" \
        -subj "/O=MaM Lab/CN=MaM Lab CA" \
        -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
        -addext "keyUsage=critical,keyCertSign,cRLSign" \
        -addext "subjectKeyIdentifier=hash" >/dev/null 2>&1
    chmod 600 "${CERT_DIR}/mam-ca.key"
fi

# 2. Server key + CSR
openssl req -newkey rsa:2048 -nodes -keyout "${tmp}/mail.key" -out "${tmp}/mail.csr" \
    -subj "/CN=${NAME}" >/dev/null 2>&1

# 3. Sign it with the CA
cat >"${tmp}/exts.cnf" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=${SAN}
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
EOF
openssl x509 -req -in "${tmp}/mail.csr" -CA "${CERT_DIR}/mam-ca.crt" -CAkey "${CERT_DIR}/mam-ca.key" \
    -CAcreateserial -days "${CERT_DAYS}" -extfile "${tmp}/exts.cnf" -out "${tmp}/mail.crt" >/dev/null 2>&1

install -m 640 "${tmp}/mail.crt" "${CERT_DIR}/mail.crt"
install -m 600 "${tmp}/mail.key" "${CERT_DIR}/mail.key"
if id -u mam >/dev/null 2>&1; then
    chown mam:mam "${CERT_DIR}/mail.crt" "${CERT_DIR}/mail.key" "${CERT_DIR}/mam-ca.crt" 2>/dev/null || true
fi

printf '\033[1;34m[mam]\033[0m CA:     %s/mam-ca.crt  <- import this one into the mail client\n' "${CERT_DIR}"
printf '\033[1;34m[mam]\033[0m server: %s/mail.crt\n' "${CERT_DIR}"
openssl verify -CAfile "${CERT_DIR}/mam-ca.crt" "${CERT_DIR}/mail.crt"
openssl x509 -in "${CERT_DIR}/mail.crt" -noout -subject -issuer -dates -ext subjectAltName

if systemctl is-active --quiet mam-portal 2>/dev/null; then
    systemctl restart mam-portal
    printf '\033[1;34m[mam]\033[0m mam-portal restarted\n'
fi
