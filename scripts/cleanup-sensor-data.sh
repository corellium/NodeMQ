#!/bin/bash
# Cleanup script for sensor-service telemetry data
# Runs at shutdown to remove cached messages from /opt/sensor-service/data/

DATA_DIR="/opt/sensor-service/data"

echo "$(date): cleanup-sensor-data.sh triggered" | tee -a /var/log/sensor-cleanup.log

if [ -d "$DATA_DIR" ]; then
    rm -rf "${DATA_DIR:?}"/*
    echo "$(date): Sensor service data cleaned: $DATA_DIR" | tee -a /var/log/sensor-cleanup.log
else
    echo "$(date): Data directory not found: $DATA_DIR" | tee -a /var/log/sensor-cleanup.log
fi
