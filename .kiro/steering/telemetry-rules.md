# Telemetry Rules

## Timestamp is mandatory on every sample

Every sample payload sent from the C telemetry library MUST include a sample timestamp field. It has been accidentally dropped twice during refactors — do not remove it.

### C side (coremodel_telemetry.c)

The `telemetry_sample_entry_t` struct stores `float timestamp` (seconds, from the CSV). The `coremodel_telemetry_flush()` function MUST include it in the JSON value object as `timestamp` (camelCase, to match the NodeMQ schema):

```c
pos += snprintf(fragment + pos, sizeof(fragment) - pos,
    "\"sensorType\":\"%s\",\"value\":{\"measurement\":%.6g,"
    "\"min\":%d,\"tag\":%d,\"units\":\"%s\","
    "\"timestamp\":%.6g,\"bytes\":[",
    entry.type,
    (double)entry.measurement,
    (int)entry.min, (int)entry.tag, entry.units,
    (double)entry.timestamp);
```

The full value object shape is:
```json
{
  "measurement": 32.899302,
  "min": 0,
  "tag": 0,
  "units": "nA",
  "timestamp": 205.788818,
  "bytes": [0, 83, 152],
  "sampleValue": 21400,
  "type": "replay"
}
```

`timestamp` is the third-to-last field before `bytes`. Never remove it.

### NodeMQ side (sensor-data.ts)

`StructuredSampleValueSchema` must include `timestamp` and `sampleValue` (camelCase). The `type` field is optional and used for topic routing:

```typescript
export const StructuredSampleValueSchema = z.object({
  measurement: z.number(),
  min: z.number().int(),
  tag: z.number().int(),
  units: z.string(),
  timestamp: z.number(),           // seconds from CSV — required, never remove
  bytes: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
  sampleValue: z.number().int(),
  type: z.string().optional(),  // 'replay' | 'fifoPush' — used for topic routing
  deviceBus: z.string().optional(),
});
```

### Dashboard side (sensor-dashboard.html)

The dashboard renders two timestamps per card:
- `Sample time` — from `value.timestamp` (seconds, from CSV)
- `Received` — from top-level `sensor.timestamp` (ISO string set by NodeMQ on ingest)

```javascript
const sampleTs = (typeof val === 'object' && val !== null && 'timestamp' in val)
  ? `${parseFloat(val.timestamp).toFixed(3)}s`
  : null;
const receivedTs = sensor.timestamp
  ? new Date(sensor.timestamp).toLocaleTimeString()
  : new Date().toLocaleTimeString();
```

Both must be present in the card render. Do not collapse them into one.

## SPI transactions also carry a timestamp

SPI JSON includes a wall-clock `timestamp` in milliseconds (from `telemetry_now_ms()`):

```json
{
  "type": "spiRead",
  "address": "09",
  "bytes": [0, 0],
  "timestamp": 1771615795710
}
```

This is a different timestamp (ms epoch) from the sample timestamp (seconds from CSV). Do not conflate them.
