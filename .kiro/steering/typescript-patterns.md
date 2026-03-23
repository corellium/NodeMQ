# TypeScript Patterns

## Validation Result Pattern

Use a generic `ValidationResult<T>` type for all validation functions to ensure consistency:

```typescript
interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}
```

Benefits:
- Single source of truth for validation result shape
- Type-safe with generic parameter
- Consistent error handling across the codebase

## Zod Error Formatting

Use a shared helper function for formatting Zod validation errors:

```typescript
function formatZodErrors(errors: z.ZodIssue[]): string {
  return errors
    .map((err) => `${err.path.join('.')}: ${err.message}`)
    .join('; ');
}
```

This ensures consistent error messages across all validation functions.

## Schema-First Types

Prefer inferring TypeScript types from Zod schemas rather than defining them separately:

```typescript
// Good: Single source of truth
export const SensorDataSchema = z.object({ ... });
export type SensorData = z.infer<typeof SensorDataSchema>;

// Avoid: Duplicate definitions that can drift
interface SensorData { ... }
const SensorDataSchema = z.object({ ... });
```

## Serialization Functions

For types that need JSON serialization, provide paired functions:
- `serialize<Type>(data: Type): string` - converts to JSON
- `deserialize<Type>(json: string): ValidationResult<Type>` - parses and validates

Always validate on deserialization to ensure data integrity.


## Event Type Constants

Use exported constant objects for event types, message types, and other string literals that are used across the codebase:

```typescript
// Good: Centralized, type-safe constants
export const SSE_EVENT_TYPES = {
  SENSOR: 'sensor',
  HEARTBEAT: 'heartbeat',
} as const;

// Usage
sendToClient(clientId, SSE_EVENT_TYPES.SENSOR, data);

// Avoid: Magic strings scattered throughout code
sendToClient(clientId, 'sensor', data);
```

Benefits:
- Single source of truth for string values
- IDE autocomplete and type checking
- Easy to refactor event names
- `as const` provides literal types for better type inference

## Optional Chaining for Map Operations

Use optional chaining when accessing Map values that may not exist:

```typescript
// Good: Concise and safe
this.deliveredMessages.get(clientId)?.add(messageId);

// Avoid: Verbose null checking
const delivered = this.deliveredMessages.get(clientId);
if (delivered) {
  delivered.add(messageId);
}
```


## Filter Criteria Types

When implementing filter functionality, define explicit interface types for filter criteria rather than inline object types:

```typescript
// Good: Explicit, reusable type
export interface SensorFilterCriteria {
  sourceModelId?: string;
  sensorType?: string;
  deviceBus?: string;
}

filter(criteria: SensorFilterCriteria): RegisteredSensor[] { ... }

// Avoid: Inline object types
filter(criteria: {
  sourceModelId?: string;
  sensorType?: string;
}): RegisteredSensor[] { ... }
```

Benefits:
- Reusable across multiple methods
- Easier to extend with new fields
- Better IDE support and documentation

## Registry Pattern Helper Methods

For Map-based registries, include these standard helper methods for better usability:

```typescript
class Registry<T> {
  private items: Map<string, T> = new Map();

  // Core CRUD
  get(key: string): T | undefined { return this.items.get(key); }
  getAll(): T[] { return Array.from(this.items.values()); }
  
  // Utility methods
  has(key: string): boolean { return this.items.has(key); }
  isEmpty(): boolean { return this.items.size === 0; }
  getCount(): number { return this.items.size; }
  clear(): void { this.items.clear(); }
}
```

## Nullish Coalescing for Defaults

Prefer nullish coalescing (`??`) over logical OR (`||`) for default values when `0` or empty string are valid values:

```typescript
// Good: Only replaces null/undefined
const count = existing?.messageCount ?? 0;

// Avoid: Also replaces 0, '', false
const count = existing?.messageCount || 0;
```

## Value Object Parsing Pattern

When a `value` field can hold multiple distinct shapes (e.g. structured sample, SPI transaction, raw number), define a named Zod schema and a `parse*` helper for each shape. Never use `as Record<string, unknown>` type assertions to inspect unknown value objects inline.

```typescript
// Good: Named schema + typed helper
export const SpiValueSchema = z.object({
  type: z.enum(['spiRead', 'spiWrite']),
  address: z.string(),
  timestamp: z.number(),
  bytes: z.array(z.number().int()),
});
export type SpiValue = z.infer<typeof SpiValueSchema>;

export function parseSpiValue(value: SensorData['value']): SpiValue | undefined {
  const result = SpiValueSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

// Usage — no type assertions needed
const spi = parseSpiValue(value);
if (spi) return `${base}/${spi.type}`;

// Avoid: inline type assertion
if (typeof value === 'object' && value !== null && 'type' in value) {
  const spiType = (value as Record<string, unknown>).type;
  if (spiType === 'spiRead' || spiType === 'spiWrite') { ... }
}
```

Benefits:
- Consistent with the `parseStructuredSampleValue` pattern already in the codebase
- Type-safe access to fields — no `as` casts
- Schema doubles as documentation of the wire format
- Easy to extend (add fields to the schema, not to scattered conditionals)

## Protocol String Constants

For string literals that come from an external protocol (C library JSON output, MQTT topic segments, etc.), define them as `as const` objects co-located with their Zod schema:

```typescript
export const SPI_TYPES = {
  READ: 'spiRead',
  WRITE: 'spiWrite',
} as const;

export type SpiType = (typeof SPI_TYPES)[keyof typeof SPI_TYPES];

// Schema references the constants — single source of truth
export const SpiValueSchema = z.object({
  type: z.enum([SPI_TYPES.READ, SPI_TYPES.WRITE]),
  ...
});
```

This prevents magic strings from drifting between the schema, topic-building logic, and any future consumers.

## Reuse Shared Logic — No Duplicate Implementations

When a utility needs logic that already exists in another class (e.g. topic matching), inject or import that class rather than re-implementing the logic inline. Duplicate implementations drift silently.

```typescript
// Good: inject TopicManager and delegate
import { TopicManager } from '../services/topic-manager.js';

export class TopicMessageBuffer<T = unknown> {
  private readonly topicManager: TopicManager;

  constructor(maxPerTopic = DEFAULT_BUFFER_SIZE) {
    this.topicManager = new TopicManager();
  }

  getForPattern(pattern: string): T[] {
    for (const [topic, msgs] of this.buffers) {
      if (this.topicManager.matchTopic(pattern, topic)) { ... }
    }
  }
}

// Avoid: copy-pasting matchTopic with a comment "same logic as TopicManager"
function matchTopic(pattern: string, topic: string): boolean { /* duplicate */ }
```

## Generic Utility Classes

Utility classes that hold or transform arbitrary data should be generic rather than typed as `unknown[]`. This preserves type safety at the call site without requiring casts.

```typescript
// Good: caller gets T[] back, no cast needed
export class TopicMessageBuffer<T = unknown> { ... }
const buf = new TopicMessageBuffer<SensorData>();
const msgs: SensorData[] = buf.getForPattern('sensors/#');

// Avoid: loses type information
export class TopicMessageBuffer {
  getForPattern(pattern: string): unknown[] { ... }
}
```

## Extract Private Helper Methods for Repeated Patterns

Repeated inline patterns (e.g. "get map entry or create it") should be extracted into a private helper to keep public methods focused and readable.

```typescript
// Good: intent is clear at the call site
buf.push(message);  // internally calls getOrCreateBuffer(topic)

private getOrCreateBuffer(topic: string): T[] {
  let buf = this.buffers.get(topic);
  if (!buf) { buf = []; this.buffers.set(topic, buf); }
  return buf;
}

// Avoid: lazy-init pattern repeated inline in every method that touches the map
```

## Magic Numbers and String Constants

Replace magic numbers and repeated string literals with named constants. This improves readability and makes refactoring safer.

```typescript
// Good: Named constants with semantic meaning
const TOPIC_STRUCTURE = {
  SEGMENT_COUNT_WITH_type: 6,
  SEGMENT_COUNT_WITHOUT_type: 5,
  type_SEGMENT_INDEX: 5,
} as const;

private extracttypeFromTopic(topic: string): string | undefined {
  const parts = topic.split('/');
  return parts.length === TOPIC_STRUCTURE.SEGMENT_COUNT_WITH_type
    ? parts[TOPIC_STRUCTURE.type_SEGMENT_INDEX]
    : undefined;
}

// Avoid: Magic numbers without context
private extracttypeFromTopic(topic: string): string | undefined {
  const parts = topic.split('/');
  return parts.length === 6 ? parts[5] : undefined;
}
```

## Validation Schemas for Internal Data Extraction

When extracting structured data from `unknown` values (e.g., metadata from lastValue), use Zod schemas with `safeParse()` instead of type assertions. This provides runtime validation and prevents silent failures.

```typescript
// Good: Schema-based validation with fallback
const RegistrationMetadataSchema = z.object({
  type: z.array(z.string()),
});

private extractRegistrationMetadata(
  lastValue: unknown,
  existing?: RegisteredSensor
): RegisteredSensor['registrationMetadata'] {
  if (!lastValue || typeof lastValue !== 'object') {
    return existing?.registrationMetadata;
  }

  const result = RegistrationMetadataSchema.safeParse(lastValue);
  if (result.success) {
    return { type: result.data.type };
  }

  return existing?.registrationMetadata;
}

// Avoid: Type assertions that bypass validation
if (lastValue && typeof lastValue === 'object') {
  const data = lastValue as Record<string, unknown>;
  if ('type' in data && Array.isArray(data.type)) {
    registrationMetadata = { type: data.type as string[] };
  }
}
```

Benefits:
- Runtime validation ensures data integrity
- Graceful fallback on invalid data
- No unsafe type assertions
- Self-documenting expected structure

## Normalize Union Types with Helper Methods

When a field can be `string | string[]`, create a normalization helper to avoid duplicating the array-handling logic across multiple methods.

```typescript
// Good: Single normalization helper
private normalizeSensorType(sensorType: string | string[]): string[] {
  return Array.isArray(sensorType) ? sensorType : [sensorType];
}

// Usage in multiple places
private matchesCriteria(sensor: RegisteredSensor, criteria: SensorFilterCriteria): boolean {
  if (criteria.sensorType) {
    const normalizedTypes = this.normalizeSensorType(sensor.sensorType);
    if (!normalizedTypes.includes(criteria.sensorType)) return false;
  }
  // ...
}

getUniqueValues(field: SensorFilterField): string[] {
  const values = new Set<string>();
  for (const sensor of this.sensors.values()) {
    const v = sensor[field];
    if (v != null) {
      const normalizedValues = Array.isArray(v) ? v : [v];
      normalizedValues.forEach(item => values.add(item));
    }
  }
  return Array.from(values).sort();
}

// Avoid: Duplicating the array check in every method
if (Array.isArray(sensor.sensorType)) {
  if (!sensor.sensorType.includes(sensorType)) return false;
} else {
  if (sensor.sensorType !== sensorType) return false;
}
```
