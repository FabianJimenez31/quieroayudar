#!/usr/bin/env bash
# Despliegue continuo: aplica lo que haya en la rama de producción y reconstruye
# los contenedores. Pensado para correr sin supervisión desde un timer de systemd.
#
#   ./scripts/deploy.sh          # despliega si hay algo nuevo
#   ./scripts/deploy.sh --force  # reconstruye aunque el commit ya esté desplegado
#
# Si la comprobación de salud falla, vuelve al commit anterior y lo reconstruye.
set -euo pipefail

REPO_DIR="${DEPLOY_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# El despliegue puede reescribir este mismo archivo, y bash lo lee mientras lo
# ejecuta: primero nos corremos a una copia aparte, que se borra al terminar.
if [ -z "${DEPLOY_REEXEC:-}" ]; then
  copia="$(mktemp /tmp/quieroayudar-deploy-XXXXXXXX.sh)"
  cat "${BASH_SOURCE[0]}" >"$copia"
  export DEPLOY_REEXEC=1 DEPLOY_REPO_DIR="$REPO_DIR"
  exec bash "$copia" "$@"
fi
trap 'rm -f "$0"' EXIT

# El directorio pertenece a otro UID, así que git lo marcaría como sospechoso al
# correr desde systemd. Se declara de confianza sin escribir en ningún .gitconfig.
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=safe.directory
export GIT_CONFIG_VALUE_0="$REPO_DIR"

# Valores ajustables sin tocar el repo.
[ -f /etc/default/quieroayudar-deploy ] && . /etc/default/quieroayudar-deploy

DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR:-/var/lib/quieroayudar-deploy}"
DEPLOY_API_HEALTH_URL="${DEPLOY_API_HEALTH_URL:-http://127.0.0.1:8123/health}"
DEPLOY_WEB_HEALTH_URL="${DEPLOY_WEB_HEALTH_URL:-http://127.0.0.1:8124/}"
DEPLOY_HEALTH_RETRIES="${DEPLOY_HEALTH_RETRIES:-20}"
DEPLOY_HEALTH_DELAY="${DEPLOY_HEALTH_DELAY:-6}"
DEPLOY_RUN_TESTS="${DEPLOY_RUN_TESTS:-1}"

STATE_FILE="$DEPLOY_STATE_DIR/deployed_commit"
FAILED_FILE="$DEPLOY_STATE_DIR/failed_commit"
LOCK_FILE="$DEPLOY_STATE_DIR/deploy.lock"

log() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

# Un solo despliegue a la vez: si el anterior sigue construyendo, este se retira.
mkdir -p "$DEPLOY_STATE_DIR"
exec 9>"$LOCK_FILE"
if ! flock --nonblock 9; then
  log "omitido: ya hay un despliegue en curso"
  exit 0
fi

cd "$REPO_DIR"

force=0
[ "${1:-}" = "--force" ] && force=1

git fetch --quiet origin "$DEPLOY_BRANCH"

# Guardas: este directorio también se usa para desarrollar, así que nunca se
# pisa trabajo sin confirmar ni se cambia de rama por debajo.
current_branch="$(git symbolic-ref --short -q HEAD || echo 'HEAD-suelto')"
if [ "$current_branch" != "$DEPLOY_BRANCH" ]; then
  log "omitido: el checkout está en '$current_branch', no en '$DEPLOY_BRANCH'"
  exit 0
fi
if ! git diff --quiet HEAD --; then
  log "omitido: hay cambios sin confirmar en el árbol de trabajo"
  exit 0
fi

previous_rev="$(git rev-parse HEAD)"
remote_rev="$(git rev-parse "origin/$DEPLOY_BRANCH")"
deployed_rev="$(cat "$STATE_FILE" 2>/dev/null || true)"

if [ "$force" -eq 0 ] && [ "$previous_rev" = "$remote_rev" ] && [ "$previous_rev" = "$deployed_rev" ]; then
  exit 0  # nada nuevo; silencioso para no llenar el journal
fi

# Un commit que ya falló no se reintenta cada minuto: se espera al arreglo
# (o a un './scripts/deploy.sh --force' a mano).
if [ "$force" -eq 0 ] && [ "$remote_rev" = "$(cat "$FAILED_FILE" 2>/dev/null || true)" ]; then
  exit 0
fi

if [ "$previous_rev" != "$remote_rev" ]; then
  log "novedad en origin/$DEPLOY_BRANCH: ${previous_rev:0:8} -> ${remote_rev:0:8}"
  git reset --hard --quiet "$remote_rev"
fi

target_rev="$(git rev-parse HEAD)"

# Los tests usan SQLite en /tmp, no tocan la base de producción.
if [ "$DEPLOY_RUN_TESTS" = "1" ] && [ -x "$REPO_DIR/.venv/bin/python" ]; then
  log "corriendo pruebas de la API"
  if ! "$REPO_DIR/.venv/bin/python" -m pytest -q; then
    log "ERROR: las pruebas fallaron; se descarta ${target_rev:0:8} y no se toca lo que está en el aire"
    printf '%s\n' "$target_rev" >"$FAILED_FILE"
    git reset --hard --quiet "$previous_rev"
    exit 1
  fi
fi

esperar_salud() {
  local intento=1
  while [ "$intento" -le "$DEPLOY_HEALTH_RETRIES" ]; do
    if curl --fail --silent --show-error --max-time 5 "$DEPLOY_API_HEALTH_URL" >/dev/null 2>&1 \
      && curl --fail --silent --show-error --max-time 10 "$DEPLOY_WEB_HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$DEPLOY_HEALTH_DELAY"
    intento=$((intento + 1))
  done
  return 1
}

log "desplegando ${target_rev:0:8} — $(git log -1 --pretty=%s)"
if ! docker compose up -d --build; then
  log "ERROR: falló la construcción o el arranque de los contenedores"
  printf '%s\n' "$target_rev" >"$FAILED_FILE"
  if [ "$previous_rev" != "$target_rev" ]; then
    log "volviendo a ${previous_rev:0:8}"
    git reset --hard --quiet "$previous_rev"
    docker compose up -d --build || log "ERROR: la reconstrucción del commit anterior también falló"
  fi
  exit 1
fi

if esperar_salud; then
  printf '%s\n' "$target_rev" >"$STATE_FILE"
  rm -f "$FAILED_FILE"
  log "listo: ${target_rev:0:8} desplegado y respondiendo"
  docker image prune --force --filter 'until=168h' >/dev/null 2>&1 || true
  exit 0
fi

log "ERROR: ${target_rev:0:8} no pasó la comprobación de salud"
printf '%s\n' "$target_rev" >"$FAILED_FILE"
log "no se reintentará solo: subí un arreglo a $DEPLOY_BRANCH o corré './scripts/deploy.sh --force'"
if [ "$previous_rev" = "$target_rev" ]; then
  log "no hay commit anterior al que volver; revisá 'docker compose logs'"
  exit 1
fi

log "volviendo a ${previous_rev:0:8}"
git reset --hard --quiet "$previous_rev"
if docker compose up -d --build && esperar_salud; then
  printf '%s\n' "$previous_rev" >"$STATE_FILE"
  log "restaurado ${previous_rev:0:8}; el servicio está en línea"
else
  log "ERROR: el servicio sigue caído tras volver atrás; hace falta intervención manual"
fi
exit 1
