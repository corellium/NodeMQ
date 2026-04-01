#!/bin/bash
# Installs the sensor-data-cleanup systemd service on Ubuntu 24.04
# Run with: sudo bash install-cleanup-service.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLEANUP_SCRIPT="/usr/local/bin/cleanup-sensor-data.sh"
SERVICE_FILE="/etc/systemd/system/sensor-data-cleanup.service"

# Copy cleanup script
cp "$SCRIPT_DIR/cleanup-sensor-data.sh" "$CLEANUP_SCRIPT"
chmod +x "$CLEANUP_SCRIPT"

# Create systemd service that runs the cleanup script AT shutdown
# Uses ExecStart bound to shutdown/reboot targets so it reliably fires
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Clean sensor-service telemetry data on shutdown
DefaultDependencies=no
Before=umount.target
After=final.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/cleanup-sensor-data.sh

[Install]
WantedBy=reboot.target halt.target poweroff.target
EOF

# Enable the service (no need to start — it only runs at shutdown)
systemctl daemon-reload
systemctl enable sensor-data-cleanup.service

echo "sensor-data-cleanup service installed and enabled."
echo "It will run cleanup-sensor-data.sh on every shutdown/reboot."
