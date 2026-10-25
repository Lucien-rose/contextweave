#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$EUID" -eq 0 ]] || { printf 'Run as root.\n' >&2; exit 1; }
APP_DIR="${MOSS_APP_DIR:-/opt/moss-memory}"
CONFIG_DIR="${MOSS_CONFIG_DIR:-/etc/moss-memory}"
NODE="$(command -v node)"
id moss >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin moss
install -d -o moss -g moss -m 700 "$APP_DIR/data" "$CONFIG_DIR" "$CONFIG_DIR/models"
if [[ ! -e "$CONFIG_DIR/backend.env" ]]; then
  TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  printf '%s=%s\n' MOSS_ADMIN_TOKEN "$TOKEN" MOSS_CONFIG_DIR "$CONFIG_DIR" MOSS_DB_PATH "$APP_DIR/data/moss-memory.sqlite" > "$CONFIG_DIR/backend.env"
  chmod 600 "$CONFIG_DIR/backend.env"
  unset TOKEN
fi
(cd "$APP_DIR" && npm ci --omit=dev && MOSS_CONFIG_DIR="$CONFIG_DIR" node scripts/init-backend.js)
chown -R moss:moss "$APP_DIR/data" "$CONFIG_DIR/models" "$CONFIG_DIR/models.key"
cat > /etc/systemd/system/moss-backend.service <<UNIT
[Unit]
Description=ContextWeave Core
After=network-online.target
[Service]
User=moss
Group=moss
WorkingDirectory=$APP_DIR
EnvironmentFile=$CONFIG_DIR/backend.env
EnvironmentFile=-$CONFIG_DIR/vector.env
ExecStart=$NODE $APP_DIR/server/src/backend.js --http
Restart=on-failure
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
for scope in daily weekly; do
  if [[ "$scope" == daily ]]; then schedule="${CW_HEALTH_DAILY_SCHEDULE:-daily}"; else schedule="${CW_HEALTH_WEEKLY_SCHEDULE:-weekly}"; fi
  cat > "/etc/systemd/system/moss-backend-health-$scope.service" <<UNIT
[Unit]
Description=ContextWeave $scope health inspection
[Service]
Type=oneshot
User=moss
Group=moss
WorkingDirectory=$APP_DIR
EnvironmentFile=$CONFIG_DIR/backend.env
EnvironmentFile=-$CONFIG_DIR/vector.env
ExecStart=$NODE $APP_DIR/scripts/health-check.js $scope
UMask=0077
UNIT
  cat > "/etc/systemd/system/moss-backend-health-$scope.timer" <<UNIT
[Timer]
OnCalendar=$schedule
RandomizedDelaySec=5m
Persistent=true
[Install]
WantedBy=timers.target
UNIT
done
systemctl daemon-reload
systemctl enable --now moss-backend.service moss-backend-health-daily.timer moss-backend-health-weekly.timer
printf 'ContextWeave backend installed. Owner token is stored in %s/backend.env.\n' "$CONFIG_DIR"
