#!/bin/sh
# Stop on removal only; on upgrade postinst restarts the running service.
set -e
case "$1" in
    remove|deconfigure)
        systemctl disable --now mam-portal.service >/dev/null 2>&1 || true
        ;;
esac
exit 0
