# Subscription Architecture

## Overview

This document explains how topic subscriptions work in the Sensor Subscription Service, including MQTT-style wildcard matching, message broadcasting, and the complete flow from subscription to message delivery.

## Topic Structure

Topics follow a hierarchical structure:

```
sensors/{modelId}/{deviceBus}/{sensorType}/{sensorId}/{messageType}
```

Example:
```
sensors/max30123-spi/default/PSTAT/max30123-spi/fifoPush
```

Components:
- `sensors` - Root namespace
- `max30123-spi` - Source model ID
- `default` - Device bus (spi0, i2c1, can0, or 'default')
- `PSTAT` - Sensor type
- `max30123-spi` - Sensor ID
- `fifoPush` - Message type (optional: fifoPush, replay, etc.)

## Wildcard Support

The service supports MQTT-style wildcards:

### Single-Level Wildcard (`+`)

Matches exactly one topic level:

```
Pattern: sensors/+/default/PSTAT/+/fifoPush
Matches: sensors/max30123-spi/default/PSTAT/max30123-spi/fifoPush ✓
Matches: sensors/other-sensor/default/PSTAT/other-sensor/fifoPush ✓
Matches: sensors/max30123-spi/default/PSTAT/max30123-spi/replay ✗
```

### Multi-Level Wildcard (`#`)

Matches zero or more remaining levels (must be last segment):

```
Pattern: sensors/max30123-spi/#
Matches: sensors/max30123-spi/default/PSTAT/max30123-spi/fifoPush ✓
Matches: sensors/max30123-spi/default/PSTAT/max30123-spi/replay ✓
Matches: sensors/max30123-spi/anything/else/here ✓
Matches: sensors/other-sensor/... ✗
```

## Subscription Flow

### 1. Client Subscribes

Client makes an SSE connection with topic pattern(s):

```bash
# Subscribe to specific message type
curl "http://localhost:3000/subscribe?topic=sensors/max30123-spi/default/PSTAT/max30123-spi/fifoPush"

# Subscribe to all messages from a sensor
curl "http://localhost:3000/subscribe?topic=sensors/max30123-spi/#"

# Subscribe to multiple patterns
curl "http://localhost:3000/subscribe?topic=sensors/+/default/PSTAT/+/fifoPush&topic=sensors/+/default/PSTAT/+/replay"
```

### 2. Server Handles Subscription

**File:** `src/index.ts` - `handleSubscribe()`

```typescript
private handleSubscribe(req: IncomingMessage, res: ServerResponse): void {
  const query = this.parseQuery(req.url || '');
  const topics = query.getAll('topic');
  const clientId = query.get('clientId') || randomUUID();

  // Add client to SSE manager
  this.sseManager.addClient(clientId, res);
  this.healthMonitor.incrementConnections();

  // Subscribe to requested topics
  for (const topic of topics) {
    this.sseManager.subscribe(clientId, topic);
    
    // Replay buffered history for each topic
    const history = this.topicBuffer.getForPattern(topic);
    for (const msg of history) {
      this.sseManager.sendToClient(clientId, 'sensor', msg);
    }
  }

  // Send initial connection event
  this.sseManager.sendToClient(clientId, 'connected', {
    clientId,
    subscribedTopics: topics,
  });
}
```

**Steps:**
1. Parse topic patterns from query string
2. Generate or use provided client ID
3. Add client to SSE connection manager
4. Subscribe client to each pattern
5. Replay historical messages matching each pattern
6. Send connection confirmation

### 3. Pattern Storage

**File:** `src/services/topic-manager.ts` - `subscribe()`

```typescript
subscribe(clientId: string, topicPattern: string): void {
  // Add to client's subscriptions
  if (!this.subscriptions.has(clientId)) {
    this.subscriptions.set(clientId, new Set());
  }
  this.subscriptions.get(clientId)!.add(topicPattern);

  // Add to pattern's clients
  if (!this.patternToClients.has(topicPattern)) {
    this.patternToClients.set(topicPattern, new Set());
  }
  this.patternToClients.get(topicPattern)!.add(clientId);
}
```

**Data Structures:**

```typescript
// Map: clientId -> Set of patterns
subscriptions: Map<string, Set<string>>
// Example: 'abc-123' -> Set(['sensors/.../fifoPush', 'sensors/.../replay'])

// Map: pattern -> Set of clientIds
patternToClients: Map<string, Set<string>>
// Example: 'sensors/.../fifoPush' -> Set(['abc-123', 'def-456'])
```

### 4. Historical Replay

**File:** `src/utils/topic-message-buffer.ts` - `getForPattern()`

When a client subscribes, they immediately receive recent messages matching their pattern:

```typescript
getForPattern(pattern: string): T[] {
  const matches: T[] = [];
  
  for (const [topic, messages] of this.buffers) {
    if (this.topicManager.matchTopic(pattern, topic)) {
      matches.push(...messages);
    }
  }
  
  return matches;
}
```

**Buffer Structure:**

```typescript
// Map: exact topic -> array of messages (ring buffer)
buffers: Map<string, T[]>
// Example: 'sensors/.../fifoPush' -> [msg1, msg2, msg3, ...]
```

**Configuration:**
- Default buffer size: 2000 messages total across all topics
- Configurable via `topicBufferSize` in config.json
- Per-topic ring buffer (oldest messages discarded when full)

## Message Broadcasting

### 5. New Message Arrives

When a new message is ingested via `POST /ingest`:

```
1. Ingestion FIFO (bounded queue)
   ↓
2. Persistence (append-only log)
   ↓
3. Processing FIFO (bounded queue)
   ↓
4. Parallel Processing Loops (4-8 concurrent)
   ↓
5. Broadcast to Subscribers
```

### 6. Find Matching Subscribers

**File:** `src/services/topic-manager.ts` - `getMatchingSubscribers()`

```typescript
getMatchingSubscribers(topic: string): string[] {
  const matchingClients = new Set<string>();

  for (const [pattern, clients] of this.patternToClients) {
    if (this.matchTopic(pattern, topic)) {
      for (const clientId of clients) {
        matchingClients.add(clientId);
      }
    }
  }

  return Array.from(matchingClients);
}
```

**Example:**

```typescript
// Incoming message topic
topic = 'sensors/max30123-spi/default/PSTAT/max30123-spi/fifoPush'

// Active subscriptions
patterns = [
  'sensors/max30123-spi/#',                                    // MATCH ✓
  'sensors/+/default/PSTAT/+/fifoPush',                       // MATCH ✓
  'sensors/max30123-spi/default/PSTAT/max30123-spi/replay',  // NO MATCH ✗
  'sensors/other-sensor/#'                                     // NO MATCH ✗
]

// Result: clients subscribed to first two patterns receive the message
```

### 7. Topic Matching Algorithm

**File:** `src/services/topic-manager.ts` - `matchTopic()`

```typescript
matchTopic(pattern: string, topic: string): boolean {
  const patternParts = pattern.split('/');
  const topicParts = topic.split('/');

  let patternIdx = 0;
  let topicIdx = 0;

  while (patternIdx < patternParts.length) {
    const patternPart = patternParts[patternIdx];

    // Multi-level wildcard (#) matches zero or more remaining levels
    if (patternPart === '#') {
      // # must be the last segment in the pattern
      return patternIdx === patternParts.length - 1;
    }

    // If we've run out of topic parts but still have pattern parts
    if (topicIdx >= topicParts.length) {
      return false;
    }

    const topicPart = topicParts[topicIdx];

    // Single-level wildcard (+) matches exactly one level
    if (patternPart === '+') {
      patternIdx++;
      topicIdx++;
      continue;
    }

    // Exact match required
    if (patternPart !== topicPart) {
      return false;
    }

    patternIdx++;
    topicIdx++;
  }

  // Pattern exhausted - topic must also be exhausted for a match
  return topicIdx === topicParts.length;
}
```

**Matching Examples:**

| Pattern | Topic | Match? | Reason |
|---------|-------|--------|--------|
| `sensors/#` | `sensors/max30123-spi/default/PSTAT/max30123-spi/fifoPush` | ✓ | `#` matches all remaining levels |
| `sensors/+/default/+/+/fifoPush` | `sensors/max30123-spi/default/PSTAT/max30123-spi/fifoPush` | ✓ | Each `+` matches one level |
| `sensors/max30123-spi/default/PSTAT/max30123-spi/fifoPush` | `sensors/max30123-spi/default/PSTAT/max30123-spi/fifoPush` | ✓ | Exact match |
| `sensors/+/default/PSTAT/+/replay` | `sensors/max30123-spi/default/PSTAT/max30123-spi/fifoPush` | ✗ | Last segment doesn't match |
| `sensors/other-sensor/#` | `sensors/max30123-spi/default/PSTAT/max30123-spi/fifoPush` | ✗ | Second segment doesn't match |

### 8. Broadcast to Clients

**File:** `src/services/sse-connection-manager.ts` - `broadcast()`

```typescript
broadcast(topic: string, data: unknown, messageId?: string): string[] {
  // Get all clients subscribed to patterns matching this topic
  const subscribers = this.topicManager.getMatchingSubscribers(topic);
  const deliveredTo: string[] = [];

  // Send to each matching subscriber
  for (const clientId of subscribers) {
    const success = this.sendToClient(clientId, 'sensor', data);
    if (success) {
      deliveredTo.push(clientId);
      if (messageId) {
        this.deliveredMessages.get(clientId)?.add(messageId);
      }
    }
  }

  return deliveredTo;
}
```

### 9. SSE Message Delivery

**File:** `src/services/sse-connection-manager.ts` - `sendToClient()`

```typescript
sendToClient(clientId: string, eventType: string, data: unknown): boolean {
  const client = this.clients.get(clientId);
  if (!client || client.response.writableEnded) {
    return false;
  }

  try {
    // Format as Server-Sent Events
    client.response.write(`event: ${eventType}\n`);
    client.response.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch (error) {
    this.removeClient(clientId);
    return false;
  }
}
```

**SSE Format:**

```
event: sensor
data: {"sensorId":"max30123-spi","sensorType":"PSTAT","value":{...}}

event: sensor
data: {"sensorId":"max30123-spi","sensorType":"PSTAT","value":{...}}

: heartbeat 2026-03-20T16:30:00.000Z

event: sensor
data: {"sensorId":"max30123-spi","sensorType":"PSTAT","value":{...}}
```

## Complete Example Flow

### Scenario: Subscribe to fifoPush Messages Only

**1. Client Subscribes**

```bash
curl "http://localhost:3000/subscribe?topic=sensors/max30123-spi/default/PSTAT/max30123-spi/fifoPush"
```

**2. Server Processes Subscription**

```typescript
clientId = 'abc-123' (generated)
pattern = 'sensors/max30123-spi/default/PSTAT/max30123-spi/fifoPush'

// Store subscription
subscriptions.set('abc-123', Set([pattern]))
patternToClients.set(pattern, Set(['abc-123']))
```

**3. Replay Historical Messages**

```typescript
// Get buffered messages matching pattern
history = topicBuffer.getForPattern(pattern)
// Returns: [msg1, msg2, msg3] (only fifoPush messages)

// Send each to client via SSE
for (msg of history) {
  sendToClient('abc-123', 'sensor', msg)
}
```

**4. New Message Arrives**

```typescript
// Message ingested
topic = 'sensors/max30123-spi/default/PSTAT/max30123-spi/fifoPush'
data = { sensorId: 'max30123-spi', value: {...} }

// Pipeline: Ingestion → Persistence → Processing → Broadcast
```

**5. Find Matching Subscribers**

```typescript
subscribers = getMatchingSubscribers(topic)
// Checks all patterns:
// - 'sensors/.../fifoPush' matches topic ✓
// Returns: ['abc-123']
```

**6. Broadcast to Client**

```typescript
broadcast(topic, data, messageId)
// Sends to 'abc-123' via SSE
// Client receives the message!
```

## Performance Characteristics

### Why Subtopics Were Slow (Before Fixes)

- **Single-threaded processing**: Messages processed sequentially
- **Queue backup**: High message rate caused FIFO overflow
- **Blocking**: Wildcard subscribers (`sensors/#`) blocked specific subscribers
- **Result**: Subtopic subscribers experienced delays

### Why Subtopics Are Fast (After Fixes)

- **Parallel processing**: 4-8 concurrent processing loops
- **Larger FIFOs**: 512-2512 capacity (configurable)
- **Concurrent broadcasting**: Multiple subscribers receive messages simultaneously
- **No queue backup**: Proper capacity sizing prevents overflow
- **Result**: All subscribers receive messages with low latency

### Throughput Comparison

| Configuration | Throughput | Latency | Message Loss |
|---------------|------------|---------|--------------|
| Old (1 loop, 128 FIFO) | ~50 msg/sec | High (seconds) | 80% during recovery |
| New (4 loops, 512 FIFO) | ~200 msg/sec | Low (milliseconds) | 0% |
| New (8 loops, 2512 FIFO) | ~400 msg/sec | Very low | 0% |

## Key Data Structures

### TopicManager

```typescript
// Client subscriptions
subscriptions: Map<clientId, Set<patterns>>
// Example: 'abc-123' -> Set(['sensors/.../fifoPush', 'sensors/.../replay'])

// Pattern to clients mapping
patternToClients: Map<pattern, Set<clientIds>>
// Example: 'sensors/.../fifoPush' -> Set(['abc-123', 'def-456'])
```

### SSEConnectionManager

```typescript
// Active SSE connections
clients: Map<clientId, SSEClient>
// Example: 'abc-123' -> { response, subscriptions: [...] }

// Message delivery tracking
deliveredMessages: Map<clientId, Set<messageIds>>
// Example: 'abc-123' -> Set(['msg-1', 'msg-2', 'msg-3'])
```

### TopicMessageBuffer

```typescript
// Per-topic message buffers (ring buffers)
buffers: Map<topic, messages[]>
// Example: 'sensors/.../fifoPush' -> [msg1, msg2, msg3, ...]
```

## Configuration

### Topic Buffer Size

Controls how many historical messages are kept for replay:

```json
{
  "topicBufferSize": 2000
}
```

- Default: 2000 messages total across all topics
- Higher values: More memory usage, better replay capability
- Lower values: Less memory usage, limited history

### Parallel Workers

Controls concurrent processing loops:

```json
{
  "parallelWorkers": 8
}
```

- Default: 4 workers
- Recommended: Match CPU cores or 2x message rate
- Higher values: Better throughput, more CPU usage

### FIFO Capacity

Controls message queue sizes:

```json
{
  "ingestionFifoSize": 512,
  "processingFifoSize": 512
}
```

- Default: 512 each
- Increase if seeing overflow in `/metrics`
- Size based on: `message_rate * processing_time * 2`

## Monitoring

### Check Active Subscriptions

```bash
curl http://localhost:3000/topics | jq '.suggestedPatterns'
```

Returns common subscription patterns based on active topics.

### Check Message Delivery

```bash
curl http://localhost:3000/metrics | jq '{
  connections: .connections,
  buffer: .buffer,
  fifo: .fifo
}'
```

Key metrics:
- `connections.active` - Number of connected clients
- `buffer.topicCount` - Number of unique topics with buffered messages
- `fifo.processing.overflowCount` - Messages dropped (should be 0)

### Monitor Subscription Performance

```bash
watch -n 1 'curl -s http://localhost:3000/metrics | jq "{
  clients: .connections.active,
  pending: .persistence.pendingCount,
  completed: .persistence.completedCount,
  loops: .parallelProcessor.activeLoops
}"'
```

Healthy system:
- `pending` stays low or decreases
- `completed` increases steadily
- `loops` matches configured `parallelWorkers`

## API Endpoints

### Subscribe (GET)

```bash
GET /subscribe?topic=<pattern>&topic=<pattern2>&clientId=<optional>
```

Establishes SSE connection and subscribes to topic patterns.

**Response:** SSE stream with events:
- `connected` - Initial connection confirmation
- `sensor` - Sensor data messages
- `heartbeat` - Keep-alive comments (every 30s)

### Add Subscription (POST)

```bash
POST /subscribe
Content-Type: application/json

{
  "clientId": "abc-123",
  "topic": "sensors/max30123-spi/#"
}
```

Adds a new subscription to an existing SSE connection.

### Remove Subscription (DELETE)

```bash
DELETE /subscribe
Content-Type: application/json

{
  "clientId": "abc-123",
  "topic": "sensors/max30123-spi/#"
}
```

Removes a subscription from an existing SSE connection.

### List Topics (GET)

```bash
GET /topics?sourceModelId=<filter>&sensorType=<filter>
```

Returns discovered topics and suggested subscription patterns.

## Best Practices

### For Clients

1. **Use specific patterns when possible** - Reduces unnecessary messages
2. **Handle reconnection** - SSE connections can drop, implement retry logic
3. **Process messages asynchronously** - Don't block the SSE stream
4. **Monitor connection health** - Watch for heartbeat comments

### For Server Operators

1. **Size FIFOs appropriately** - Monitor overflow metrics
2. **Scale parallel workers** - Match message rate and CPU cores
3. **Monitor buffer usage** - Adjust `topicBufferSize` based on replay needs
4. **Watch for slow clients** - They can block the SSE write buffer

## Troubleshooting

### Clients Not Receiving Messages

1. Check pattern matching: `curl http://localhost:3000/topics`
2. Verify client is connected: Check `/metrics` for `connections.active`
3. Check FIFO overflow: Look for `overflowCount` > 0 in `/metrics`
4. Verify parallel processing: Ensure `activeLoops` matches config

### High Latency

1. Increase `parallelWorkers` in config
2. Increase FIFO capacity if seeing overflows
3. Check if clients are slow (blocking writes)
4. Monitor CPU usage (may need more workers)

### Messages Dropped

1. Check `/metrics` for `fifo.processing.overflowCount`
2. Increase `processingFifoSize` in config
3. Increase `parallelWorkers` to process faster
4. Verify recovery order (workers start before recovery)

## Related Documentation

- [API Endpoints](./API-ENDPOINTS.md) - Complete API reference
- [Parallel Processing](./PARALLEL-PROCESSING.md) - Concurrent processing architecture
- [Log-Based Persistence](./LOG-BASED-PERSISTENCE.md) - Message persistence system
- [Architecture Overview](./ARCHITECTURE.md) - Complete system architecture
