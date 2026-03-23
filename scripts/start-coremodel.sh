#!/bin/bash
cd /home/user

exec > /dev/ttyAMA0 2>&1

while ! systemctl is-active --quiet sensor-service; do
    echo "$(date): Waiting for sensor-service..."
    sleep 1
done

echo "$(date): sensor-service active, waiting for port 3000..."

while ! nc -z localhost 3000 2>/dev/null; do
    echo "$(date): Port 3000 not ready yet..."
    sleep 2
done

echo "$(date): Port 3000 is up, launching binary"
./coremodel-spi-max30123-file Viser_max30123_Meas_Timing.py 10.11.1.3:1900 spi 0