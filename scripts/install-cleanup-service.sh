#!/bin/bash
# Installs the sensor-data-cleanup systemd service on Ubuntu 24.04
# Run with: sudo bash install-cleanup-service.sh
#
# Strategy: The service starts at boot (does nothing) and stays "active".
# At shutdown, systemd stops it, which triggers ExecStop to clean the data.
# This is the reliable pattern for shutdown-time scripts in systemd.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLEANUP_SCRIPT="/usr/local/bin/cleanup-sensor-data.sh"
SERVICE_FILE="/etc/systemd/system/sensor-data-cleanup.service"

# Copy cleanup script
cp "$SCRIPT_DIR/cleanup-sensor-data.sh" "$CLEANUP_SCRIPT"
chmod +x "$CLEANUP_SCRIPT"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Clean sensor-service telemetry data on shutdown
After=local-fs.target
Before=sensor-service.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/true
ExecStop=/usr/local/bin/cleanup-sensor-data.sh

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the service so it's "active" and can be stopped at shutdown
systemctl daemon-reload
systemctl enable sensor-data-cleanup.service
systemctl start sensor-data-cleanup.service

echo "sensor-data-cleanup service installed and enabled."
echo "Verify it is active: systemctl status sensor-data-cleanup"
echo "It will clean /opt/sensor-service/data/ at shutdown."
