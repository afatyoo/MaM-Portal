#!/bin/sh
# remove keeps config, certificates and data; purge deletes them.
set -e
systemctl daemon-reload >/dev/null 2>&1 || true
if [ "$1" = "purge" ]; then
    rm -rf /etc/mam-portal /var/lib/mam-portal
fi
exit 0
