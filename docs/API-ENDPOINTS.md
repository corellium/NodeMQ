# Sensor Service API Endpoints

Complete reference for all HTTP endpoints exposed by the Sensor Subscription Service.

## Base URL

```
http://<host>:3000
```

Default port is 3000, configurable via `PORT` environment variable.

---

## Endpoints Overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/ingest` | Ingest sensor data messages |
| GET | `/subscribe` | Establish SSE connection for real-time updates |
| POST | `/subscribe` | Add topic subscription to existing client |
| DELETE | `/subscribe` | Remove topic subscription from client |
| GET | `/health` | Service health check |
| GET | `/metrics` | Service metrics and statistics |
| GET | `/topics` | Discover available sensor topics |
| GET | `/queues` | Query buffered messages for a topic |

---

## POST /ingest

Ingest sensor data into the service for processing and distribution.

### Request

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "sensorId": "max30123-spi",
  "sensorType": "spiRead",
  "value": {
    "type": "SPI",
    "address": "0c",
    "timestamp": 1234567890,
    "bytes": ["7f"]
  },
  "sourceModelId": "max30123-spi",
  "deviceBus": "spi0",
  "timestamp": "2024-03-18T10:30:00.000Z"
}
```

**Required Fields:**
- `sensorId` (string): Unique sensor identifier
- `sensorType` (string | string[]): Sensor type(s)
- `sourceModelId` (string): Source model identifier
- `value` (any): Sensor reading value

**Optional Fields:**
- `deviceBus` (string): Device bus identifier (default: "default")
- `timestamp` (string | number): ISO datetime or epoch milliseconds
- `metadata` (object): Additional metadata

### Response

**Success (200):**
```json
{
  "success": true,
  "messageId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Error (400):**
```json
{
  "success": false,
  "error": "sensorId must be a non-empty string"
}
```

**Queue Full (503):**
```json
{
  "success": false,
  "error": "Ingestion queue full",
  "messageId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Example

```bash
curl -X POST http://localhost:3000/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "sensorId": "temp-sensor-1",
    "sensorType": "temperature",
    "value": 23.5,
    "sourceModelId": "device-001"
  }'
```

---

## GET /subscribe

Establish a Server-Sent Events (SSE) connection for real-time sensor data updates.

### Request

**Query Parameters:**
- `topic` (string, repeatable): Topic pattern(s) to subscribe to
- `clientId` (string, optional): Client identifier (auto-generated if omitted)

### Response

**Headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Events:**

1. **connected** - Initial connection confirmation
```
event: connected
data: {"clientId":"abc-123","subscribedTopics":["sensors/#"]}
```

2. **sensor** - Sensor data message
```
event: sensor
data: {"sensorId":"temp-1","sensorType":"temperature","value":23.5,...}
```

3. **heartbeat** - Keep-alive comment (every 30 seconds)
```
: heartbeat 2024-03-18T10:30:00.000Z
```

### Example

```bash
# Subscribe to all sensors
curl -N http://localhost:3000/subscribe?topic=sensors/#

# Subscribe to specific sensor type
curl -N "http://localhost:3000/subscribe?topic=sensors/+/+/temperature/+"

# Subscribe to multiple patterns
curl -N "http://localhost:3000/subscribe?topic=sensors/model1/#&topic=sensors/model2/#"
```

**JavaScript Example:**
```javascript
const eventSource = new EventSource('http://localhost:3000/subscribe?topic=sensors/#');

eventSource.addEventListener('connected', (e) => {
  const data = JSON.parse(e.data);
  console.log('Connected:', data.clientId);
});

eventSource.addEventListener('sensor', (e) => {
  const data = JSON.parse(e.data);
  console.log('Sensor data:', data);
});
```

---

## POST /subscribe

Add a topic subscription to an existing SSE client connection.

### Request

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "clientId": "abc-123",
  "topic": "sensors/model1/#"
}
```

**Required Fields:**
- `clientId` (string): Existing client identifier
- `topic` (string): Topic pattern to subscribe to

### Response

**Success (200):**
```json
{
  "success": true,
  "clientId": "abc-123",
  "topic": "sensors/model1/#",
  "replayed": 47
}
```

**Client Not Found (404):**
```json
{
  "success": false,
  "error": "Client not found"
}
```

**Error (400):**
```json
{
  "success": false,
  "error": "Missing clientId or topic"
}
```

### Example

```bash
curl -X POST http://localhost:3000/subscribe \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "abc-123",
    "topic": "sensors/+/+/temperature/+"
  }'
```

---

## DELETE /subscribe

Remove a topic subscription from an existing SSE client.

### Request

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "clientId": "abc-123",
  "topic": "sensors/model1/#"
}
```

**Required Fields:**
- `clientId` (string): Existing client identifier
- `topic` (string): Topic pattern to unsubscribe from

### Response

**Success (200):**
```json
{
  "success": true,
  "clientId": "abc-123",
  "topic": "sensors/model1/#"
}
```

**Client Not Found (404):**
```json
{
  "success": false,
  "error": "Client not found"
}
```

### Example

```bash
curl -X DELETE http://localhost:3000/subscribe \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "abc-123",
    "topic": "sensors/model1/#"
  }'
```

---

## GET /health

Service health check endpoint.

### Request

No parameters required.

### Response

**Healthy (200):**
```json
{
  "status": "healthy",
  "uptime": 3600000,
  "checks": {
    "persistence": true,
    "configLoaded": true,
    "errorRate": true,
    "latency": true
  }
}
```

**Degraded (200):**
```json
{
  "status": "degraded",
  "uptime": 3600000,
  "checks": {
    "persistence": true,
    "configLoaded": true,
    "errorRate": false,
    "latency": true
  }
}
```

**Unhealthy (503):**
```json
{
  "status": "unhealthy",
  "uptime": 3600000,
  "checks": {
    "persistence": false,
    "configLoaded": true,
    "errorRate": false,
    "latency": false
  }
}
```

### Status Codes

- `200` - Service is healthy or degraded
- `503` - Service is unhealthy

### Example

```bash
curl http://localhost:3000/health
```

---

## GET /metrics

Service metrics and performance statistics.

### Request

No parameters required.

### Response

**Success (200):**
```json
{
  "messagesReceived": 1234,
  "messagesProcessed": 1234,
  "messagesFailed": 0,
  "activeConnections": 3,
  "averageLatencyMs": 2.5,
  "buffer": {
    "topicCount": 16,
    "totalMessages": 487,
    "maxPerTopic": 2000
  },
  "fifo": {
    "ingestion": {
      "count": 0,
      "capacity": 256,
      "overflowCount": 0,
      "fillPercent": 0
    },
    "processing": {
      "count": 0,
      "capacity": 128,
      "overflowCount": 0,
      "fillPercent": 0
    }
  }
}
```

### Metrics Description

**Message Metrics:**
- `messagesReceived` - Total messages ingested since startup
- `messagesProcessed` - Total messages successfully processed
- `messagesFailed` - Total messages that failed processing
- `activeConnections` - Current number of SSE clients connected
- `averageLatencyMs` - Average message processing time in milliseconds

**Buffer Metrics:**
- `buffer.topicCount` - Number of topics with buffered messages
- `buffer.totalMessages` - Total messages across all topic buffers
- `buffer.maxPerTopic` - Configured buffer capacity per topic (default: 2000)

**FIFO Queue Metrics:**
- `fifo.ingestion.count` - Current messages in ingestion queue
- `fifo.ingestion.capacity` - Maximum ingestion queue capacity
- `fifo.ingestion.overflowCount` - Total messages dropped due to overflow
- `fifo.ingestion.fillPercent` - Queue fill percentage (0-100)
- `fifo.processing.*` - Same metrics for processing queue

### Example

```bash
curl http://localhost:3000/metrics | jq '.'
```

---

## GET /topics

Discover available sensor topics and get subscription suggestions.

### Request

**Query Parameters (all optional):**
- `sourceModelId` (string): Filter by source model
- `sensorType` (string): Filter by sensor type
- `deviceBus` (string): Filter by device bus
- `type` (string): Filter by measurement type

### Response

**Success (200):**
```json
{
  "sensors": [
    {
      "topic": "sensors/max30123-spi/default/spiRead/max30123-spi/SPI",
      "sensorId": "max30123-spi",
      "sensorType": "spiRead",
      "sourceModelId": "max30123-spi",
      "deviceBus": "default",
      "type": "SPI",
      "lastSeen": "2024-03-18T10:30:00.000Z",
      "messageCount": 47,
      "registrationMetadata": {
        "type": ["PSTAT", "CHRONO A"]
      },
      "lastValue": {
        "sensorId": "max30123-spi",
        "sensorType": "spiRead",
        "value": {
          "type": "SPI",
          "address": "0c",
          "timestamp": 1234567890,
          "bytes": ["7f"]
        },
        "sourceModelId": "max30123-spi"
      }
    }
  ],
  "activeTopics": [
    "sensors/max30123-spi/default/spiRead/max30123-spi/SPI",
    "sensors/max30123-spi/default/spiWrite/max30123-spi/SPI"
  ],
  "suggestedPatterns": [
    "sensors/#",
    "sensors/max30123-spi/#",
    "sensors/+/+/spiRead/+"
  ],
  "filters": {
    "sourceModelIds": ["max30123-spi"],
    "sensorTypes": ["spiRead", "spiWrite", "generate"],
    "deviceBuses": ["default", "spi0"],
    "types": ["PSTAT", "CHRONO A", "SPI"]
  },
  "count": 14
}
```

### Response Fields

- `sensors` - Array of registered sensor details
- `activeTopics` - List of topics with recent activity
- `suggestedPatterns` - Recommended subscription patterns
- `filters` - Available filter values for each dimension
- `count` - Total number of sensors

### Example

```bash
# Get all topics
curl http://localhost:3000/topics

# Filter by sensor type
curl "http://localhost:3000/topics?sensorType=spiRead"

# Filter by model and bus
curl "http://localhost:3000/topics?sourceModelId=max30123-spi&deviceBus=default"
```

---

## GET /queues

Query buffered messages for a specific topic or pattern.

### Request

**Query Parameters:**
- `topic` (string, required): Topic or MQTT wildcard pattern

### Response

**Success (200):**
```json
{
  "topic": "sensors/max30123-spi/+/+/max30123-spi/SPI",
  "messages": [
    {
      "sensorId": "max30123-spi",
      "sensorType": "spiRead",
      "value": {
        "type": "SPI",
        "address": "0c",
        "timestamp": 1234567890,
        "bytes": ["7f"]
      },
      "sourceModelId": "max30123-spi"
    }
  ],
  "count": 47
}
```

**Missing Topic (400):**
```json
{
  "success": false,
  "error": "Missing required query param: topic"
}
```

### MQTT Wildcards

- `+` - Single-level wildcard (matches one level)
- `#` - Multi-level wildcard (matches zero or more levels)

### Example

```bash
# Get messages for exact topic
curl "http://localhost:3000/queues?topic=sensors/max30123-spi/default/spiRead/max30123-spi/SPI"

# Get messages matching pattern
curl "http://localhost:3000/queues?topic=sensors/max30123-spi/%2B/%2B/max30123-spi/SPI"

# Get all SPI messages
curl "http://localhost:3000/queues?topic=sensors/%2B/%2B/spi%23/%2B/SPI"
```

**Note:** URL-encode wildcards: `+` → `%2B`, `#` → `%23`

---

## Topic Pattern Format

Topics follow the hierarchical structure:

```
sensors/{sourceModelId}/{deviceBus}/{sensorType}/{sensorId}[/{type}]
```

**Examples:**
- `sensors/max30123-spi/default/spiRead/max30123-spi/SPI`
- `sensors/max30123-spi/default/generate/max30123-spi/PSTAT`
- `sensors/device-001/i2c0/temperature/temp-sensor-1`

**Wildcard Patterns:**
- `sensors/#` - All sensors
- `sensors/max30123-spi/#` - All sensors from specific model
- `sensors/+/+/spiRead/+` - All SPI read operations
- `sensors/+/+/+/+/PSTAT` - All PSTAT measurements

---

## Error Responses

All endpoints return consistent error format:

```json
{
  "success": false,
  "error": "Error message description"
}
```

### Common HTTP Status Codes

- `200` - Success
- `400` - Bad Request (invalid input)
- `404` - Not Found (resource doesn't exist)
- `503` - Service Unavailable (queue full, service unhealthy)

---

## CORS Support

All endpoints support CORS with the following headers:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

---

## Rate Limiting

Currently no rate limiting is enforced. Consider implementing rate limiting in production deployments.

---

## Authentication

Currently no authentication is required. Consider implementing authentication/authorization for production deployments.

---

## WebSocket Alternative

The service uses Server-Sent Events (SSE) for real-time updates. SSE is simpler than WebSockets and works well for server-to-client streaming. If bidirectional communication is needed, consider implementing WebSocket support.

---

## See Also

- [Buffer Configuration Guide](../BUFFER-CONFIGURATION.md)
- [Architecture Documentation](./ARCHITECTURE.md)
- [Subscription Examples](./Subscription%20Examples.md)
