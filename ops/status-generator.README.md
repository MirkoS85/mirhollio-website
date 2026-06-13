# MirSFlr OPS Status Feed

This feed powers `https://www.mirhollio.com/ops/` missing operational signals.

The dashboard reads:

```text
https://node.mirhollio.com/ops/status.json
```

## Generate The JSON

Copy `status-generator.mjs` to the node server and run it every 30 seconds.

Minimal command:

```bash
node /opt/mirsflr-ops/status-generator.mjs \
  --out /var/www/node.mirhollio.com/ops/status.json
```

With daemon log scanning:

```bash
MIRSFLR_DAEMON_LOG=/var/log/oracle-daemon/oracle-daemon.log \
MIRSFLR_DAEMON_SERVICE=oracle-daemon \
node /opt/mirsflr-ops/status-generator.mjs \
  --out /var/www/node.mirhollio.com/ops/status.json
```

Most reliable mode is marker files. Your daemon or wrapper writes the timestamp after each successful event:

```bash
MIRSFLR_LAST_SUBMIT_FILE=/run/mirsflr-ops/last-submit \
MIRSFLR_LAST_REVEAL_FILE=/run/mirsflr-ops/last-reveal \
MIRSFLR_LAST_SIGNATURE_FILE=/run/mirsflr-ops/last-signature \
MIRSFLR_LAST_FDC_SIGNATURE_FILE=/run/mirsflr-ops/last-fdc-signature \
node /opt/mirsflr-ops/status-generator.mjs \
  --out /var/www/node.mirhollio.com/ops/status.json
```

Each marker file can contain an ISO timestamp, for example:

```text
2026-06-13T18:00:00Z
```

If the file content is empty or not a valid timestamp, the generator uses file modification time.

## Optional Feed Metrics

Set these when you have them:

```bash
MIRSFLR_FEED_MISSES_LAST_HOUR=0
MIRSFLR_STALE_FEEDS=0
MIRSFLR_LATE_FEEDS=0
```

Host telemetry is generated automatically from the Linux host:

- CPU percent from `/proc/stat`
- RAM percent from `os.totalmem/free`
- load 1m from `os.loadavg`
- disk percent from `df -Pk /`

## systemd Example

`/etc/systemd/system/mirsflr-ops-status.service`

```ini
[Unit]
Description=Generate MirSFlr OPS status JSON

[Service]
Type=oneshot
Environment=MIRSFLR_DAEMON_SERVICE=oracle-daemon
Environment=MIRSFLR_DAEMON_LOG=/var/log/oracle-daemon/oracle-daemon.log
Environment=MIRSFLR_STATUS_OUT=/var/www/node.mirhollio.com/ops/status.json
ExecStart=/usr/bin/node /opt/mirsflr-ops/status-generator.mjs
User=www-data
Group=www-data
```

`/etc/systemd/system/mirsflr-ops-status.timer`

```ini
[Unit]
Description=Refresh MirSFlr OPS status JSON

[Timer]
OnBootSec=15
OnUnitActiveSec=30
AccuracySec=5
Unit=mirsflr-ops-status.service

[Install]
WantedBy=timers.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mirsflr-ops-status.timer
sudo systemctl start mirsflr-ops-status.service
```

## Nginx CORS

The frontend runs on `www.mirhollio.com`, so the node endpoint must allow it:

```nginx
location /ops/status.json {
    add_header Access-Control-Allow-Origin "https://www.mirhollio.com" always;
    add_header Cache-Control "no-store" always;
    default_type application/json;
    try_files /ops/status.json =404;
}
```

## Security

Do not expose keys, private addresses, secrets, logs, process args, or environment dumps.

The feed should contain only timestamps and health counters:

- daemon event timestamps
- basic host telemetry
- feed miss counters
