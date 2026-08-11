#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# m3u8-downloader — Linux / macOS / Git Bash launcher
#
# - Checks Docker CLI + daemon (with auto-start self-healing)
# - Detects container existence / running / healthy
# - Fingerprints app sources to detect OLD vs NEW code
# - Auto rebuilds + recreates container when code changed
# - Progressive retry & self-healing stack recovery logic
# - Opens the app URL in the browser
# - Keeps terminal open with interactive exit prompt
# -----------------------------------------------------------------------------
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR" || exit 1

APP_NAME="m3u8-downloader"
CONTAINER_NAME="m3u8-downloader"
APP_PORT="${APP_PORT:-38478}"
APP_URL="${APP_URL:-http://127.0.0.1:${APP_PORT}}"
HEALTH_URL="${HEALTH_URL:-${APP_URL}/api/downloads}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
FP_FILE="${FP_FILE:-.docker-build-fingerprint}"
# FORCE_BUILD=1 always rebuilds even if fingerprint matches
FORCE_BUILD="${FORCE_BUILD:-0}"

DOCKER_READY_RETRIES="${DOCKER_READY_RETRIES:-35}"
DOCKER_READY_SLEEP="${DOCKER_READY_SLEEP:-2}"
START_RETRIES="${START_RETRIES:-4}"
HEALTH_RETRIES="${HEALTH_RETRIES:-60}"
HEALTH_SLEEP="${HEALTH_SLEEP:-2}"

NEED_BUILD=0
NEED_RECREATE=0
CODE_CHANGED=0
CURRENT_FP=""
STORED_FP=""

if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_CYAN=$'\033[36m'
else
  C_RESET=""; C_BOLD=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_CYAN=""
fi

log()  { printf '%s[%s]%s %s\n' "$C_CYAN" "$APP_NAME" "$C_RESET" "$*"; }
ok()   { printf '%s[%s]%s %s\n' "$C_GREEN" "ok" "$C_RESET" "$*"; }
warn() { printf '%s[%s]%s %s\n' "$C_YELLOW" "warn" "$C_RESET" "$*"; }
err()  { printf '%s[%s]%s %s\n' "$C_RED" "error" "$C_RESET" "$*" >&2; }
die()  { err "$*"; exit 1; }

finish() {
  local code=$?
  trap - EXIT INT TERM
  echo ""
  if [[ $code -eq 0 ]]; then
    printf "%s========================================%s\n" "$C_GREEN" "$C_RESET"
    printf "%s [ok] m3u8-downloader completed successfully.%s\n" "$C_GREEN" "$C_RESET"
    printf "%s========================================%s\n" "$C_GREEN" "$C_RESET"
  else
    printf "%s========================================%s\n" "$C_RED" "$C_RESET"
    printf "%s [error] Launcher exited with code %d.%s\n" "$C_RED" "$code" "$C_RESET"
    printf "%s         Review error messages above for details.%s\n" "$C_RED" "$C_RESET"
    printf "%s========================================%s\n" "$C_RED" "$C_RESET"
  fi
  echo ""
  printf "%sPress [Enter] to close terminal window...%s\n" "$C_CYAN" "$C_RESET"
  if [[ -t 0 ]] || [[ -t 1 ]]; then
    read -r _unused < /dev/tty 2>/dev/null || read -r _unused || true
  fi
  exit "$code"
}
trap finish EXIT INT TERM

resolve_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
  else
    return 1
  fi
}

compose() { "${COMPOSE[@]}" -f "$COMPOSE_FILE" "$@"; }

http_ok() {
  local url="$1"
  local code=""
  if command -v curl >/dev/null 2>&1; then
    code="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
    [[ "$code" =~ ^2[0-9][0-9]$ ]] && return 0
    return 1
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -q --timeout=5 -O /dev/null "$url" 2>/dev/null && return 0
    return 1
  fi
  if command -v timeout >/dev/null 2>&1; then
    timeout 5 bash -c "exec 3<>/dev/tcp/127.0.0.1/${APP_PORT} && printf 'GET /api/downloads HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n' >&3 && head -n1 <&3 | grep -q ' 200'" 2>/dev/null && return 0
  fi
  return 1
}

try_start_docker_daemon() {
  warn "[self-heal] Attempting to auto-start Docker daemon..."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    if [[ -d "/Applications/Docker.app" ]]; then
      open -a Docker >/dev/null 2>&1 && ok "Launched Docker.app for macOS. Waiting for daemon startup..." && return 0
    fi
  elif command -v systemctl >/dev/null 2>&1; then
    sudo systemctl start docker >/dev/null 2>&1 && ok "Triggered systemctl start docker..." && return 0
  elif command -v service >/dev/null 2>&1; then
    sudo service docker start >/dev/null 2>&1 && ok "Triggered service docker start..." && return 0
  fi
  return 1
}

wait_for_docker() {
  log "Checking Docker CLI..."
  command -v docker >/dev/null 2>&1 || die "Docker is not installed or not on PATH. Install Docker Desktop / Engine first."

  log "Waiting for Docker daemon (up to $((DOCKER_READY_RETRIES * DOCKER_READY_SLEEP))s)..."
  local i=1
  local docker_started=0
  while (( i <= DOCKER_READY_RETRIES )); do
    if docker info >/dev/null 2>&1; then
      ok "Docker daemon is running."
      return 0
    fi
    if (( i >= 3 && docker_started == 0 )); then
      docker_started=1
      try_start_docker_daemon || true
    fi
    warn "Docker not ready yet (attempt ${i}/${DOCKER_READY_RETRIES}) — waiting for Docker daemon..."
    sleep "$DOCKER_READY_SLEEP"
    ((i++)) || true
  done
  die "Docker daemon did not become ready. Start Docker Desktop / docker service and retry."
}

ensure_compose_file() {
  [[ -f "$COMPOSE_FILE" ]] || die "Missing ${COMPOSE_FILE} in ${ROOT_DIR}"
  resolve_compose || die "Neither 'docker compose' nor 'docker-compose' is available."
  ok "Using compose: ${COMPOSE[*]}"
}

container_running() {
  local status
  status="$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  [[ "$status" == "true" ]]
}

container_exists() {
  docker inspect "$CONTAINER_NAME" >/dev/null 2>&1
}

image_exists() {
  docker image ls --format '{{.Repository}}' 2>/dev/null | grep -q 'm3u8-downloader' || return 1
}

container_label_fp() {
  docker inspect -f '{{ index .Config.Labels "com.m3u8.fingerprint" }}' "$CONTAINER_NAME" 2>/dev/null || true
}

list_fingerprint_files() {
  local f
  for f in \
    Dockerfile \
    docker-compose.yml \
    package.json \
    package-lock.json \
    next.config.ts \
    tsconfig.json \
    prisma.config.ts \
    docker-entrypoint.sh
  do
    [[ -f "$f" ]] && printf '%s\n' "$f"
  done

  if command -v find >/dev/null 2>&1; then
    find src python prisma \
      \( -name node_modules -o -name .next -o -name generated \) -prune -o \
      -type f \
      ! -name '*.db' \
      ! -name '*.db-journal' \
      ! -name '.DS_Store' \
      -print 2>/dev/null | sort
  fi
}

hash_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 | awk '{print $NF}'
  else
    cksum | awk '{print $1"-"$2}'
  fi
}

compute_fingerprint() {
  local tmp
  tmp="$(mktemp 2>/dev/null || echo ".fp-manifest.$$")"
  {
    list_fingerprint_files | while IFS= read -r f; do
      [[ -f "$f" ]] || continue
      if command -v sha256sum >/dev/null 2>&1; then
        printf '%s %s\n' "$f" "$(sha256sum "$f" | awk '{print $1}')"
      elif command -v shasum >/dev/null 2>&1; then
        printf '%s %s\n' "$f" "$(shasum -a 256 "$f" | awk '{print $1}')"
      else
        printf '%s %s\n' "$f" "$(wc -c <"$f" 2>/dev/null | tr -d ' ')-$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo 0)"
      fi
    done
  } >"$tmp"

  CURRENT_FP="$(hash_stream <"$tmp")"
  rm -f "$tmp" 2>/dev/null || true
  [[ -n "$CURRENT_FP" ]] || CURRENT_FP="unknown"
}

load_stored_fingerprint() {
  if [[ -f "$FP_FILE" ]]; then
    STORED_FP="$(tr -d '[:space:]' <"$FP_FILE" || true)"
  else
    STORED_FP=""
  fi
}

save_fingerprint() {
  printf '%s\n' "$CURRENT_FP" >"$FP_FILE"
  ok "Saved build fingerprint → ${FP_FILE}"
}

detect_code_change() {
  compute_fingerprint
  load_stored_fingerprint

  log "Code fingerprint: ${CURRENT_FP:0:12}…"
  if [[ -n "$STORED_FP" ]]; then
    log "Last built:       ${STORED_FP:0:12}…"
  else
    log "Last built:       (none — first run or fingerprint missing)"
  fi

  if [[ "$FORCE_BUILD" == "1" ]]; then
    CODE_CHANGED=1
    NEED_BUILD=1
    NEED_RECREATE=1
    warn "FORCE_BUILD=1 — will rebuild and recreate container."
    return
  fi

  if [[ -z "$STORED_FP" || "$STORED_FP" != "$CURRENT_FP" ]]; then
    CODE_CHANGED=1
    NEED_BUILD=1
    NEED_RECREATE=1
    warn "Source code changed (old image ≠ current sources) — will rebuild container."
    return
  fi

  if container_exists; then
    local label_fp
    label_fp="$(container_label_fp | tr -d '[:space:]')"
    if [[ -n "$label_fp" && "$label_fp" != "$CURRENT_FP" ]]; then
      CODE_CHANGED=1
      NEED_BUILD=1
      NEED_RECREATE=1
      warn "Container label fingerprint is stale — will rebuild."
      return
    fi
  fi

  CODE_CHANGED=0
  ok "Sources match last build — no code rebuild required."
}

export_compose_fingerprint() {
  export M3U8_BUILD_FINGERPRINT="$CURRENT_FP"
}

start_stack() {
  local attempt=1
  local args=(up -d)

  export_compose_fingerprint

  if (( NEED_BUILD )); then
    args+=(--build)
  fi
  if (( NEED_RECREATE )); then
    args+=(--force-recreate)
  fi

  if ! image_exists; then
    log "No local image found — building."
    args=(up -d --build)
    NEED_BUILD=1
  fi

  if ! container_exists && (( ! NEED_BUILD )); then
    log "Container does not exist — creating."
  fi

  while (( attempt <= START_RETRIES )); do
    if (( NEED_BUILD )); then
      log "Updating stack with rebuild (attempt ${attempt}/${START_RETRIES})..."
    else
      log "Starting stack (attempt ${attempt}/${START_RETRIES})..."
    fi

    if compose "${args[@]}"; then
      ok "Compose up finished."
      save_fingerprint
      return 0
    fi

    warn "compose up failed (attempt ${attempt}/${START_RETRIES})."

    if (( attempt == 2 )); then
      warn "[self-heal] Retrying compose up with forced build and recreate..."
      args=(up -d --build --force-recreate)
      NEED_BUILD=1
      NEED_RECREATE=1
    elif (( attempt == 3 )); then
      warn "[self-heal] Cleaning stale container/builder state and fingerprint cache..."
      compose down --remove-orphans >/dev/null 2>&1 || true
      docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
      docker builder prune -f >/dev/null 2>&1 || true
      rm -f "$FP_FILE" 2>/dev/null || true
      args=(up -d --build --force-recreate)
      NEED_BUILD=1
      NEED_RECREATE=1
    fi

    ((attempt++)) || true
    sleep 3
  done
  die "Failed to start/update containers after ${START_RETRIES} attempts. Check: docker compose logs"
}

ensure_container_running() {
  local i=1
  local max=20
  log "Verifying container '${CONTAINER_NAME}' exists and is running..."

  while (( i <= max )); do
    if container_running; then
      ok "Container '${CONTAINER_NAME}' is running."
      return 0
    fi

    if container_exists; then
      warn "Container exists but is stopped — starting (attempt ${i}/${max})..."
      if ! docker start "$CONTAINER_NAME" >/dev/null 2>&1; then
        warn "[self-heal] docker start failed — compose up..."
        compose up -d >/dev/null 2>&1 || true
      fi
    else
      warn "Container missing — creating (attempt ${i}/${max})..."
      if (( CODE_CHANGED || NEED_BUILD )); then
        compose up -d --build >/dev/null 2>&1 || true
      else
        compose up -d >/dev/null 2>&1 || true
      fi
    fi

    sleep 2
    ((i++)) || true
  done

  err "Container status:"
  docker ps -a --filter "name=^/${CONTAINER_NAME}$" || true
  compose logs --tail 40 || true
  die "Container '${CONTAINER_NAME}' is not running."
}

wait_for_health() {
  log "Waiting for app health at ${HEALTH_URL} (up to $((HEALTH_RETRIES * HEALTH_SLEEP))s)..."
  local i=1
  while (( i <= HEALTH_RETRIES )); do
    if http_ok "$HEALTH_URL"; then
      ok "App is healthy."
      return 0
    fi
    if (( i % 8 == 0 )) && ! container_running; then
      warn "[self-heal] Container stopped during health wait — restarting..."
      compose up -d >/dev/null 2>&1 || docker start "$CONTAINER_NAME" >/dev/null 2>&1 || true
    fi
    if (( i == 25 )); then
      warn "[self-heal] Health check pending — attempting soft restart of container '${CONTAINER_NAME}'..."
      docker restart "$CONTAINER_NAME" >/dev/null 2>&1 || true
    fi
    printf '  … not ready yet (%s/%s)\r' "$i" "$HEALTH_RETRIES"
    sleep "$HEALTH_SLEEP"
    ((i++)) || true
  done
  printf '\n'
  err "Health check timed out. Recent logs:"
  compose logs --tail 60 || true
  die "App did not become healthy at ${HEALTH_URL}"
}

open_browser() {
  log "Opening ${APP_URL} in your browser..."
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$APP_URL" >/dev/null 2>&1 && return 0
  fi
  if command -v open >/dev/null 2>&1; then
    open "$APP_URL" >/dev/null 2>&1 && return 0
  fi
  if command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /c start "" "$APP_URL" >/dev/null 2>&1 && return 0
  fi
  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "Start-Process '$APP_URL'" >/dev/null 2>&1 && return 0
  fi
  if command -v sensible-browser >/dev/null 2>&1; then
    sensible-browser "$APP_URL" >/dev/null 2>&1 && return 0
  fi
  warn "Could not auto-open a browser. Please visit: ${APP_URL}"
}

print_summary() {
  local state="unknown"
  if container_running; then state="running"; elif container_exists; then state="stopped"; else state="missing"; fi

  printf '\n%s========================================%s\n' "$C_BOLD" "$C_RESET"
  printf '%s m3u8 Downloader is ready%s\n' "$C_BOLD" "$C_RESET"
  printf '  URL:         %s\n' "$APP_URL"
  printf '  Batch:       %s/batch\n' "$APP_URL"
  printf '  Extract:     %s/extract\n' "$APP_URL"
  printf '  Container:   %s (%s)\n' "$CONTAINER_NAME" "$state"
  printf '  Fingerprint: %s\n' "${CURRENT_FP:0:16}"
  if (( CODE_CHANGED )); then
    printf '  Update:      rebuilt (code changed)\n'
  else
    printf '  Update:      up-to-date\n'
  fi
  printf '  Logs:        docker compose logs -f\n'
  printf '  Stop:        docker compose down\n'
  printf '%s========================================%s\n\n' "$C_BOLD" "$C_RESET"
}

decide_actions() {
  detect_code_change

  local exists=0 running=0 healthy=0
  container_exists && exists=1
  container_running && running=1
  http_ok "$HEALTH_URL" && healthy=1

  log "Container exists=$( ((exists)) && echo yes || echo no )  running=$( ((running)) && echo yes || echo no )  healthy=$( ((healthy)) && echo yes || echo no )"

  if (( running && healthy && !CODE_CHANGED && FORCE_BUILD != 1 )); then
    ok "Container running with current code — no update needed."
    return 1
  fi

  if (( CODE_CHANGED )); then
    NEED_BUILD=1
    NEED_RECREATE=1
  fi

  if (( !exists )); then
    NEED_BUILD=1
    log "Will create new container."
  elif (( !running )); then
    log "Container present but stopped — will start (rebuild if code changed)."
  elif (( running && !healthy )); then
    warn "Container running but unhealthy — will recreate."
    NEED_RECREATE=1
    if (( CODE_CHANGED )); then NEED_BUILD=1; fi
  fi

  return 0
}

main() {
  log "Project root: ${ROOT_DIR}"
  wait_for_docker
  ensure_compose_file

  if ! decide_actions; then
    open_browser
    print_summary
    exit 0
  fi

  start_stack
  ensure_container_running
  wait_for_health
  open_browser
  print_summary
}

main "$@"
