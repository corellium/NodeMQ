#!/bin/bash

# Throughput test script for NodeMQ
# Tests message ingestion performance

echo "=== NodeMQ Throughput Test ==="
echo ""

# Configuration
HOST="http://localhost:3000"
NUM_MESSAGES=1000
CONCURRENT=50

echo "Configuration:"
echo "  Host: $HOST"
echo "  Messages: $NUM_MESSAGES"
echo "  Concurrent: $CONCURRENT"
echo ""

# Test payload
PAYLOAD='{
  "sensorId": "sensor_001",
  "sensorType": "PSTAT",
  "sourceModelId": "model_123",
  "deviceBus": "spi0",
  "value": {
    "measurement": 32.899302,
    "min": 0,
    "tag": 0,
    "units": "nA",
    "timestamp": 205.788818,
    "bytes": ["00", "53", "98"],
    "sampleValue": 21400,
    "type": "replay"
  }
}'

echo "Starting test..."
START_TIME=$(date +%s)

# Send messages in batches
BATCH_SIZE=$((NUM_MESSAGES / CONCURRENT))
for ((batch=0; batch<CONCURRENT; batch++)); do
  (
    for ((i=0; i<BATCH_SIZE; i++)); do
      curl -s -X POST "$HOST/ingest" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" > /dev/null
    done
  ) &
done

# Wait for all background jobs
wait

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "=== Results ==="
echo "  Total messages: $NUM_MESSAGES"
echo "  Duration: ${DURATION}s"
echo "  Throughput: $((NUM_MESSAGES / DURATION)) msg/sec"
echo ""

# Check metrics
echo "=== Service Metrics ==="
curl -s "$HOST/metrics" | jq '.'
echo ""

# Check queue status
echo "=== Queue Status ==="
curl -s "$HOST/queues" | jq '.'
