#!/usr/bin/env bash
set -Eeuo pipefail

# =========================================================
# MaM Portal bootstrap/start script
#
# Features:
# - Auto-detect OS
# - Install Node.js + npm if missing
# - Run npm install
# - Run npm run build
# - Run npm run create-admin with default admin/admin
# - Start app in foreground or background
# - Manage app with start / stop / restart / status / bootstrap / help
# - Skip bootstrap on next start if app is already prepared
#
# Default behavior:
#   ./start.sh
#   => start app
#   => auto-bootstrap only if needed
# =========================================================

ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin}"
PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"
APP_MATCH="${APP_MATCH:-node server.js}"

LOG_DIR="${PROJECT_DIR}/logs"
APP_LOG="${LOG_DIR}/app.log"
BOOTSTRAP_LOG="${LOG_DIR}/bootstrap.log"
PID_FILE="${PROJECT_DIR}/app.pid"
BOOTSTRAP_STAMP="${PROJECT_DIR}/.bootstrap.done"

RUN_MODE="background"
ACTION="start"
FORCE_BOOTSTRAP="0"
SUDO=""

log() {
  echo "[INFO] $*"
}

warn() {
  echo "[WARN] $*" >&2
}

err() {
  echo "[ERROR] $*" >&2
}

print_help() {
  cat <<EOF
MaM Portal Start Script

Usage:
  ./start.sh
  ./start.sh start
  ./start.sh start --background
  ./start.sh start --foreground
  ./start.sh start --force-bootstrap
  ./start.sh bootstrap
  ./start.sh stop
  ./start.sh restart
  ./start.sh status
  ./start.sh help
  ./start.sh --help
  ./start.sh -h

Description:
  start       Start the application
              If the app is not prepared yet, bootstrap will run automatically.
              If already prepared, it will only start the app.

  bootstrap   Force bootstrap manually:
              - install Node.js/npm if needed
              - npm install
              - npm run build
              - npm run create-admin

  stop        Stop the running application

  restart     Stop and start the application again
              By default this does NOT re-run bootstrap

  status      Show current application status

  help        Show this help message

Run modes:
  --background       Start app in background mode (default)
  --foreground       Start app in foreground mode
  --force-bootstrap  Force bootstrap before start/restart

Environment variables:
  ADMIN_USER     Default admin username
                 Default: admin

  ADMIN_PASS     Default admin password
                 Default: admin

  PROJECT_DIR    Project directory
                 Default: current working directory

  APP_MATCH      Process match string used to detect/stop the real app
                 Default: node server.js

Files:
  PID file         ${PID_FILE}
  App log          ${APP_LOG}
  Bootstrap log    ${BOOTSTRAP_LOG}
  Bootstrap stamp  ${BOOTSTRAP_STAMP}

Examples:
  ./start.sh
  ./start.sh start
  ./start.sh stop
  ./start.sh restart
  ./start.sh bootstrap
  ./start.sh start --force-bootstrap
  ./start.sh status

Custom admin:
  ADMIN_USER=myadmin ADMIN_PASS=secret ./start.sh bootstrap

Custom project directory:
  PROJECT_DIR=/opt/mam-portal ./start.sh start

Custom process matcher:
  APP_MATCH="node server.js" ./start.sh
  APP_MATCH="node dist/server.js" ./start.sh

Useful commands:
  tail -f logs/app.log
  tail -f logs/bootstrap.log
  cat app.pid
  rm -f .bootstrap.done         # reset bootstrap state
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --background)
        RUN_MODE="background"
        shift
        ;;
      --foreground)
        RUN_MODE="foreground"
        shift
        ;;
      --force-bootstrap)
        FORCE_BOOTSTRAP="1"
        shift
        ;;
      start|stop|restart|status|bootstrap|help)
        ACTION="$1"
        shift
        ;;
      -h|--help)
        ACTION="help"
        shift
        ;;
      *)
        err "Unknown argument: $1"
        echo
        print_help
        exit 1
        ;;
    esac
  done
}

require_sudo() {
  if [[ "${EUID}" -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
      SUDO="sudo"
    else
      err "This script requires root/sudo privileges to install packages."
      exit 1
    fi
  else
    SUDO=""
  fi
}

detect_os() {
  OS_FAMILY="unknown"
  PKG_MGR=""

  if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    DIST_ID="${ID:-}"
    DIST_LIKE="${ID_LIKE:-}"

    case "${DIST_ID}" in
      ubuntu|debian)
        OS_FAMILY="debian"
        PKG_MGR="apt"
        ;;
      rocky|rhel|centos|almalinux)
        OS_FAMILY="rhel"
        if command -v dnf >/dev/null 2>&1; then
          PKG_MGR="dnf"
        else
          PKG_MGR="yum"
        fi
        ;;
      fedora)
        OS_FAMILY="fedora"
        PKG_MGR="dnf"
        ;;
      opensuse*|sles)
        OS_FAMILY="suse"
        PKG_MGR="zypper"
        ;;
      *)
        if [[ "${DIST_LIKE}" == *debian* ]]; then
          OS_FAMILY="debian"
          PKG_MGR="apt"
        elif [[ "${DIST_LIKE}" == *rhel* ]] || [[ "${DIST_LIKE}" == *fedora* ]]; then
          OS_FAMILY="rhel"
          if command -v dnf >/dev/null 2>&1; then
            PKG_MGR="dnf"
          else
            PKG_MGR="yum"
          fi
        elif [[ "${DIST_LIKE}" == *suse* ]]; then
          OS_FAMILY="suse"
          PKG_MGR="zypper"
        fi
        ;;
    esac
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    OS_FAMILY="macos"
    PKG_MGR="brew"
  fi

  if [[ "${OS_FAMILY}" == "unknown" ]]; then
    err "Unsupported OS. Please install Node.js and npm manually first."
    exit 1
  fi

  log "Detected OS: ${OS_FAMILY} (${PKG_MGR})"
}

install_node_npm_linux_apt() {
  require_sudo
  ${SUDO} apt-get update -y
  ${SUDO} apt-get install -y curl ca-certificates gnupg

  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    log "Installing Node.js LTS from NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | ${SUDO} bash -
    ${SUDO} apt-get install -y nodejs
  fi
}

install_node_npm_linux_rhel() {
  require_sudo
  if [[ "${PKG_MGR}" == "dnf" ]]; then
    ${SUDO} dnf install -y curl ca-certificates
  else
    ${SUDO} yum install -y curl ca-certificates
  fi

  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    log "Installing Node.js LTS from NodeSource..."
    curl -fsSL https://rpm.nodesource.com/setup_lts.x | ${SUDO} bash -
    if [[ "${PKG_MGR}" == "dnf" ]]; then
      ${SUDO} dnf install -y nodejs
    else
      ${SUDO} yum install -y nodejs
    fi
  fi
}

install_node_npm_linux_suse() {
  require_sudo
  ${SUDO} zypper refresh
  ${SUDO} zypper install -y curl ca-certificates

  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    warn "Automatic Node.js installation is not configured for SUSE."
    warn "Please install Node.js LTS and npm manually, then re-run this script."
    exit 1
  fi
}

install_node_npm_macos() {
  if ! command -v brew >/dev/null 2>&1; then
    err "Homebrew is not installed. Please install Homebrew first."
    exit 1
  fi

  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    log "Installing Node.js via Homebrew..."
    brew install node
  fi
}

ensure_node_npm() {
  detect_os

  case "${OS_FAMILY}" in
    debian)
      install_node_npm_linux_apt
      ;;
    rhel|fedora)
      install_node_npm_linux_rhel
      ;;
    suse)
      install_node_npm_linux_suse
      ;;
    macos)
      install_node_npm_macos
      ;;
    *)
      err "Unsupported OS family: ${OS_FAMILY}"
      exit 1
      ;;
  esac

  if ! command -v node >/dev/null 2>&1; then
    err "node command is still not available after installation."
    exit 1
  fi

  if ! command -v npm >/dev/null 2>&1; then
    err "npm command is still not available after installation."
    exit 1
  fi

  log "Node version: $(node -v)"
  log "npm version : $(npm -v)"
}

ensure_project_files() {
  cd "${PROJECT_DIR}"

  if [[ ! -f package.json ]]; then
    err "package.json not found in: ${PROJECT_DIR}"
    exit 1
  fi

  mkdir -p "${LOG_DIR}"

  if [[ ! -f config.ini && -f config.sample.ini ]]; then
    log "config.ini not found. Copying from config.sample.ini..."
    cp -f config.sample.ini config.ini
  fi
}

run_npm_install() {
  log "Running npm install..."
  npm install 2>&1 | tee -a "${BOOTSTRAP_LOG}"
}

run_build() {
  if npm run | grep -q " build"; then
    log "Running npm run build..."
    npm run build 2>&1 | tee -a "${BOOTSTRAP_LOG}"
  else
    warn "npm script 'build' not found. Skipping build step."
  fi
}

create_admin_user() {
  if npm run | grep -q "create-admin"; then
    log "Creating default admin user..."
    log "Username: ${ADMIN_USER}"
    log "Password: ${ADMIN_PASS}"

    set +e
    printf "%s\n%s\n%s\n%s\n" \
      "${ADMIN_USER}" \
      "${ADMIN_PASS}" \
      "${ADMIN_PASS}" \
      "y" | npm run create-admin 2>&1 | tee -a "${BOOTSTRAP_LOG}"
    CREATE_EXIT=${PIPESTATUS[1]}
    set -e

    if [[ ${CREATE_EXIT} -ne 0 ]]; then
      warn "create-admin returned a non-zero exit code."
      warn "This may happen if the admin user already exists or the prompt flow is different."
    fi

    echo
    echo "=========================================="
    echo "Default admin credentials:"
    echo "Username: ${ADMIN_USER}"
    echo "Password: ${ADMIN_PASS}"
    echo "=========================================="
    echo
  else
    warn "npm script 'create-admin' was not found in package.json. Skipping admin creation."
  fi
}

mark_bootstrap_done() {
  cat > "${BOOTSTRAP_STAMP}" <<EOF
BOOTSTRAP_DONE=1
DATE=$(date '+%Y-%m-%d %H:%M:%S')
ADMIN_USER=${ADMIN_USER}
EOF
}

needs_bootstrap() {
  if [[ "${FORCE_BOOTSTRAP}" == "1" ]]; then
    return 0
  fi

  if ! command -v node >/dev/null 2>&1; then
    return 0
  fi

  if ! command -v npm >/dev/null 2>&1; then
    return 0
  fi

  if [[ ! -d "${PROJECT_DIR}/node_modules" ]]; then
    return 0
  fi

  if [[ ! -f "${BOOTSTRAP_STAMP}" ]]; then
    return 0
  fi

  return 1
}

get_detected_app_pid() {
  pgrep -f "${APP_MATCH}" | tail -n1 || true
}

is_running() {
  local pid=""

  if [[ -f "${PID_FILE}" ]]; then
    pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      return 0
    fi
  fi

  pid="$(get_detected_app_pid)"
  if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

start_app_background() {
  if is_running; then
    local existing_pid=""
    existing_pid="$(get_detected_app_pid)"
    if [[ -n "${existing_pid}" ]]; then
      echo "${existing_pid}" > "${PID_FILE}"
      log "Application is already running with PID ${existing_pid}"
    else
      log "Application is already running."
    fi
    return 0
  fi

  log "Starting application in background..."
  nohup npm start >> "${APP_LOG}" 2>&1 < /dev/null &
  local npm_pid=$!

  sleep 5

  local app_pid=""
  app_pid="$(get_detected_app_pid)"

  if [[ -n "${app_pid}" ]] && kill -0 "${app_pid}" >/dev/null 2>&1; then
    echo "${app_pid}" > "${PID_FILE}"
    log "Application started successfully in background."
    log "npm PID         : ${npm_pid}"
    log "Application PID : ${app_pid}"
    log "PID file        : ${PID_FILE}"
    log "App log         : ${APP_LOG}"
  else
    err "Application failed to start. Check log: ${APP_LOG}"
    rm -f "${PID_FILE}"
    exit 1
  fi
}

start_app_foreground() {
  log "Starting application in foreground..."
  exec npm start
}

stop_app() {
  local pid=""
  local stopped_any="false"

  if [[ -f "${PID_FILE}" ]]; then
    pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  fi

  if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
    log "Stopping application PID ${pid}..."
    kill -TERM "${pid}" || true
    stopped_any="true"

    for _ in {1..15}; do
      if kill -0 "${pid}" >/dev/null 2>&1; then
        sleep 1
      else
        break
      fi
    done

    if kill -0 "${pid}" >/dev/null 2>&1; then
      warn "Process did not stop gracefully. Sending SIGKILL..."
      kill -KILL "${pid}" || true
    fi
  else
    warn "PID file not valid or process already stopped."
  fi

  if pgrep -f "${APP_MATCH}" >/dev/null 2>&1; then
    warn "Found orphan application process matching: ${APP_MATCH}"
    pkill -TERM -f "${APP_MATCH}" || true
    stopped_any="true"
    sleep 2

    if pgrep -f "${APP_MATCH}" >/dev/null 2>&1; then
      warn "Application process still alive. Sending SIGKILL..."
      pkill -KILL -f "${APP_MATCH}" || true
    fi
  fi

  rm -f "${PID_FILE}"

  if [[ "${stopped_any}" == "true" ]]; then
    log "Application stopped."
  else
    log "Application was not running."
  fi
}

status_app() {
  local pid=""
  local found_pid=""

  if [[ -f "${PID_FILE}" ]]; then
    pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  fi

  if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
    log "Application is running with PID ${pid}"
  else
    found_pid="$(get_detected_app_pid)"
    if [[ -n "${found_pid}" ]] && kill -0 "${found_pid}" >/dev/null 2>&1; then
      echo "${found_pid}" > "${PID_FILE}"
      log "Application is running with detected PID ${found_pid}"
    else
      log "Application is not running."
    fi
  fi

  if [[ -f "${BOOTSTRAP_STAMP}" ]]; then
    log "Bootstrap state: ready"
  else
    log "Bootstrap state: not ready"
  fi

  log "App log: ${APP_LOG}"
}

bootstrap() {
  ensure_project_files
  : > "${BOOTSTRAP_LOG}"
  ensure_node_npm
  run_npm_install
  run_build
  create_admin_user
  mark_bootstrap_done
  log "Bootstrap completed successfully."
}

start_flow() {
  ensure_project_files

  if needs_bootstrap; then
    log "Bootstrap is required. Running bootstrap first..."
    bootstrap
  else
    log "Bootstrap already completed. Skipping install/build/admin creation."
  fi

  if [[ "${RUN_MODE}" == "foreground" ]]; then
    start_app_foreground
  else
    start_app_background
  fi
}

restart_flow() {
  ensure_project_files
  stop_app || true

  if [[ "${FORCE_BOOTSTRAP}" == "1" ]]; then
    log "Force bootstrap requested. Running bootstrap before restart..."
    bootstrap
  else
    log "Restarting without bootstrap."
  fi

  if [[ "${RUN_MODE}" == "foreground" ]]; then
    start_app_foreground
  else
    start_app_background
  fi
}

main() {
  parse_args "$@"
  cd "${PROJECT_DIR}"

  case "${ACTION}" in
    start)
      start_flow
      ;;
    bootstrap)
      bootstrap
      ;;
    stop)
      ensure_project_files
      stop_app
      ;;
    restart)
      restart_flow
      ;;
    status)
      ensure_project_files
      status_app
      ;;
    help)
      print_help
      ;;
    *)
      err "Unknown action: ${ACTION}"
      exit 1
      ;;
  esac
}

main "$@"
