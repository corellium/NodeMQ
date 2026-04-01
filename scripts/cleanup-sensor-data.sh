#!/bin/bash
# Cleanup script for sensor-service telemetry data
# Runs at shutdown to remove cached messages from /opt/sensor-service/data/

DATA_DIR="/opt/sensor-service/data"

if [ -d "$DATA_DIR" ]; then
    rm -rf "${DATA_DIR:?}"/*
    echo "Sensor service data cleaned: $DATA_DIR"
else
    echo "Data directory not found: $DATA_DIR"
fi
