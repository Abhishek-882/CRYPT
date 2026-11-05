#!/usr/bin/env bash
# SafeCoiner VPS Liveness Watchdog & Heartbeat Guard
# Scheduled via crontab (e.g. * * * * * /opt/safecoiner/web/scripts/vps-watchdog.sh)

set -euo pipefail

LOCK_FILE="/opt/safecoiner/data/bot_daemon.lock"
HEALTH_URL="http://127.0.0.1:3000/api/health"
SERVICE_NAME="safecoiner.service"
MAX_HEARTBEAT_AGE_SEC=60

log() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [WATCHDOG] $*"
}

# 1. Check HTTP Health Endpoint
if ! curl -s -f -m 5 "${HEALTH_URL}" > /dev/null 2>&1; then
  log "WARN: Health check ${HEALTH_URL} failed or timed out."
fi

# 2. Check Lock File Heartbeat
if [[ -f "${LOCK_FILE}" ]]; then
  LOCK_CONTENT=$(cat "${LOCK_FILE}" 2>/dev/null || echo "{}")
  PID=$(echo "${LOCK_CONTENT}" | grep -o '"pid":[0-9]*' | cut -d':' -f2 || true)
  LAST_HEARTBEAT=$(echo "${LOCK_CONTENT}" | grep -o '"lastHeartbeat":[0-9]*' | cut -d':' -f2 || true)

  NOW_MS=$(date +%s%3N)
  if [[ -n "${LAST_HEARTBEAT}" && "${LAST_HEARTBEAT}" -gt 0 ]]; then
    DIFF_SEC=$(( (NOW_MS - LAST_HEARTBEAT) / 1000 ))
    if [[ "${DIFF_SEC}" -gt "${MAX_HEARTBEAT_AGE_SEC}" ]]; then
      log "CRITICAL: Lock heartbeat stale (${DIFF_SEC}s > ${MAX_HEARTBEAT_AGE_SEC}s). Checking PID ${PID}..."
      if [[ -n "${PID}" ]] && ! kill -0 "${PID}" 2>/dev/null; then
        log "PID ${PID} is dead. Cleaning stale lock and restarting ${SERVICE_NAME}..."
        rm -f "${LOCK_FILE}"
        systemctl restart "${SERVICE_NAME}"
      else
        log "PID ${PID} is frozen/unresponsive. Sending SIGTERM..."
        kill -15 "${PID}" 2>/dev/null || true
        sleep 3
        if kill -0 "${PID}" 2>/dev/null; then
          kill -9 "${PID}" 2>/dev/null || true
        fi
        rm -f "${LOCK_FILE}"
        systemctl restart "${SERVICE_NAME}"
      fi
    else
      log "OK: Daemon alive (PID: ${PID}, heartbeat age: ${DIFF_SEC}s)."
    fi
  fi
else
  log "INFO: No active lock file. System is idle or waiting for next cycle."
fi
