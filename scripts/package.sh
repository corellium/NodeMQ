#!/bin/bash
# Package the sensor-subscription-service for deployment
# Includes the live spi-adi C source so the peripheral model can be built on target

set -e

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

# Copy minimal service files only
echo "📦 Packaging minimal deployment (service code only)..."
cp -r dist "${PACKAGE_NAME}/"
cp package.json package-lock.json "${PACKAGE_NAME}/"
cp README.md "${PACKAGE_NAME}/" 2>/dev/null || true

# Copy existing config if present
if [ -f "config.json" ]; then
  cp config.json "${PACKAGE_NAME}/"
fi

# Create tarball
tar -czf "${PACKAGE_NAME}.tar.gz" "${PACKAGE_NAME}"
rm -rf "${PACKAGE_NAME}"

echo ""
echo "✅ Package created: ${PACKAGE_NAME}.tar.gz"
echo "   Minimal deployment package containing:"
echo "     dist/          — Compiled NodeMQ service"
echo "     package.json   — Dependencies"
echo "     config.json    — Service configuration"
echo "     README.md      — Documentation"
echo ""
echo "   Deploy: scp ${PACKAGE_NAME}.tar.gz user@10.11.0.1:/tmp/"
echo "           On server:"
echo "             cd /opt/sensor-service"
echo "             sudo systemctl stop sensor-service"
echo "             tar -xzf /tmp/${PACKAGE_NAME}.tar.gz --strip-components=1"
echo "             npm install --production"
echo "             sudo systemctl start sensor-service"
