#!/usr/bin/env bash
# Build dist/mam-portal_<version>_all.deb. Needs node, npm and nfpm.
#   ./packaging/build-deb.sh            # version from package.json
#   VERSION=1.2.0 ./packaging/build-deb.sh
set -Eeuo pipefail
cd "$(dirname "$0")/.."

VERSION="${VERSION:-$(node -p 'require("./package.json").version')}"
STAGE="dist/deb-stage"

npm ci --no-audit --no-fund >/dev/null
npm run build >/dev/null          # admin UI -> public/admin

rm -rf "${STAGE}"
mkdir -p "${STAGE}"
cp -R server.js mail tools public "${STAGE}/"
rm -f "${STAGE}"/mail/*.test.js

# package.json also lists the admin UI libraries; ship only what server.js imports,
# at the versions the lockfile resolved.
STAGE="${STAGE}" node <<'JS'
const fs = require("fs");
const pkg = require("./package.json");
const lock = require("./package-lock.json");
const runtime = ["bcryptjs", "cookie-parser", "express", "express-session", "helmet", "ini", "session-file-store", "undici"];
const dependencies = Object.fromEntries(runtime.map((n) => [n, lock.packages[`node_modules/${n}`].version]));
fs.writeFileSync(`${process.env.STAGE}/package.json`,
  JSON.stringify({ name: "mam-portal", version: pkg.version, private: true, type: "module", dependencies }, null, 2) + "\n");
JS
( cd "${STAGE}" && npm install --omit=dev --ignore-scripts --no-audit --no-fund --no-package-lock >/dev/null )

# Pure JavaScript is what makes one "all" package valid on every architecture.
if find "${STAGE}/node_modules" -name '*.node' | grep -q .; then
    echo "native module found; the package can no longer be arch: all" >&2
    exit 1
fi
chmod -R u=rwX,go=rX "${STAGE}"

VERSION="${VERSION}" nfpm package --config packaging/nfpm.yaml --packager deb --target dist/
