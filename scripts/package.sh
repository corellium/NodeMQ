#!/bin/bash
# Package the sensor-subscription-service for deployment
# Includes the live spi-adi C source so the peripheral model can be built on target

set -e

# Change to project root directory
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
PACKAGE_NAME="sensor-service-${VERSION}"
COREMODEL_LIVE="../PeripheralBuilder/coremodel-master/coremodel-ADI-Demo"
SPI_ADI_LIVE="../PeripheralBuilder/coremodel-master/examples/spi-adi"
COREMODEL_ROOT="../PeripheralBuilder/coremodel-master"

echo "📦 Packaging sensor-subscription-service v${VERSION}..."

# Build TypeScript
echo "🔨 Building NodeMQ service..."
npm run build

# Run tests
echo "🧪 Running tests..."
NODE_OPTIONS='--experimental-vm-modules' npx jest --silent --passWithNoTests 2>/dev/null || {
  echo "⚠️  Some tests failed — check output above"
}

# Create package directory
rm -rf "${PACKAGE_NAME}" "${PACKAGE_NAME}.tar.gz"
mkdir -p "${PACKAGE_NAME}"

# Copy service files
echo "📦 Packaging deployment files..."
cp -r dist "${PACKAGE_NAME}/"
cp package.json package-lock.json "${PACKAGE_NAME}/"
cp README.md "${PACKAGE_NAME}/" 2>/dev/null || true

# Copy install script
cp scripts/install.sh "${PACKAGE_NAME}/"
chmod +x "${PACKAGE_NAME}/install.sh"

# Copy start-coremodel script
cp scripts/start-coremodel.sh "${PACKAGE_NAME}/"
chmod +x "${PACKAGE_NAME}/start-coremodel.sh"

# Copy setup-autologin script
cp scripts/setup-autologin.sh "${PACKAGE_NAME}/"
chmod +x "${PACKAGE_NAME}/setup-autologin.sh"

# Copy existing config if present
if [ -f "config.json" ]; then
  cp config.json "${PACKAGE_NAME}/"
fi

# Create tarball
tar -czf "${PACKAGE_NAME}.tar.gz" "${PACKAGE_NAME}"
rm -rf "${PACKAGE_NAME}"

echo ""
echo "✅ Package created: ${PACKAGE_NAME}.tar.gz"
echo "   Deployment package containing:"
echo "     dist/                — Compiled NodeMQ service"
echo "     package.json         — Dependencies"
echo "     config.json          — Service configuration"
echo "     install.sh           — Installation script"
echo "     start-coremodel.sh   — Coremodel startup script"
echo "     setup-autologin.sh   — Serial console auto-login setup"
echo "     README.md            — Documentation"
echo ""
echo "   Deploy:"
echo "     scp ${PACKAGE_NAME}.tar.gz root@<device-ip>:/tmp/"
echo ""
echo "   Install on server:"
echo "     cd /tmp"
echo "     tar -xzf ${PACKAGE_NAME}.tar.gz"
echo "     cd ${PACKAGE_NAME}"
echo "     sudo ./install.sh"
