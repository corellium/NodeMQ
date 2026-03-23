#!/bin/bash
set -e

INSTALL_DIR="/opt/sensor-service"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🚀 Installing Sensor Subscription Service..."

# Stop service if running
if systemctl is-active --quiet sensor-service; then
    echo "⏸️  Stopping sensor-service..."
    sudo systemctl stop sensor-service
    SERVICE_WAS_RUNNING=true
else
    SERVICE_WAS_RUNNING=false
fi

sudo mkdir -p "${INSTALL_DIR}"

# Remove old dist to ensure clean install
echo "🧹 Removing old dist folder..."
sudo rm -rf "${INSTALL_DIR}/dist"

# Copy new files
echo "📦 Installing new version..."
sudo cp -r "${SCRIPT_DIR}/dist" "${INSTALL_DIR}/"
sudo cp "${SCRIPT_DIR}/package.json" "${SCRIPT_DIR}/package-lock.json" "${INSTALL_DIR}/"

# Copy docs if they exist
if [ -d "${SCRIPT_DIR}/docs" ]; then
    sudo cp -r "${SCRIPT_DIR}/docs" "${INSTALL_DIR}/" 2>/dev/null || true
fi

# Copy README
sudo cp "${SCRIPT_DIR}/README.md" "${INSTALL_DIR}/" 2>/dev/null || true

# Copy config if it doesn't exist
if [ ! -f "${INSTALL_DIR}/config.json" ]; then
    if [ -f "${SCRIPT_DIR}/config.json" ]; then
        sudo cp "${SCRIPT_DIR}/config.json" "${INSTALL_DIR}/"
        echo "📝 Installed config.json"
    else
        echo "⚙️  Creating default config.json..."
        sudo tee "${INSTALL_DIR}/config.json" > /dev/null <<EOF
{
  "heartbeatIntervalMs": 30000,
  "topicBufferSize": 2000,
  "persistencePath": "./data/messages",
  "parallelWorkers": 4,
  "retryConfig": {
    "maxRetries": 5,
    "initialDelayMs": 100,
    "maxDelayMs": 30000,
    "backoffMultiplier": 2
  }
}
EOF
        echo "📝 Created default config.json"
    fi
else
    echo "📝 Keeping existing config.json"
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo ""
    echo "❌ Node.js is not installed!"
    echo ""
    echo "Install Node.js 20.x with:"
    echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -"
    echo "  sudo apt-get install -y nodejs"
    echo ""
    exit 1
fi

# Check for npm
if ! command -v npm &> /dev/null; then
    echo ""
    echo "❌ npm is not installed!"
    echo ""
    echo "Install npm with:"
    echo "  sudo apt-get install -y npm"
    echo ""
    exit 1
fi

echo "📚 Installing dependencies..."
cd "${INSTALL_DIR}"
sudo npm install --production --silent

echo "💾 Creating data directory..."
sudo mkdir -p "${INSTALL_DIR}/data/messages"

# Create systemd service file if it doesn't exist
if [ ! -f /etc/systemd/system/sensor-service.service ]; then
    echo "⚙️  Creating systemd service..."
    sudo tee /etc/systemd/system/sensor-service.service > /dev/null <<EOF
[Unit]
Description=Sensor Subscription Service (NodeMQ)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    sudo systemctl enable sensor-service
    echo "✅ Systemd service created and enabled"
else
    echo "✅ Systemd service already exists"
    sudo systemctl daemon-reload
fi

# Restart service if it was running
if [ "$SERVICE_WAS_RUNNING" = true ]; then
    echo "▶️  Restarting sensor-service..."
    sudo systemctl start sensor-service
    sleep 2
    if systemctl is-active --quiet sensor-service; then
        echo "✅ Service restarted successfully"
    else
        echo "❌ Service failed to start - check logs: sudo journalctl -u sensor-service -n 50"
    fi
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "🚀 Next steps:"
echo "  1. Edit /opt/sensor-service/config.json if needed"
echo "     - Set parallelWorkers to match CPU cores (run: nproc)"
echo "     - Adjust topicBufferSize based on your needs"
echo ""
echo "  2. Start the service:"
echo "     sudo systemctl start sensor-service"
echo ""
echo "  3. Check status:"
echo "     sudo systemctl status sensor-service"
echo "     curl http://localhost:3000/health"
echo "     curl http://localhost:3000/metrics"
echo ""
echo "📊 Service Management:"
echo "  Start:   sudo systemctl start sensor-service"
echo "  Stop:    sudo systemctl stop sensor-service"
echo "  Restart: sudo systemctl restart sensor-service"
echo "  Status:  sudo systemctl status sensor-service"
echo "  Logs:    sudo journalctl -u sensor-service -f"
echo ""
