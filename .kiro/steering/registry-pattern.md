# Registry Pattern Best Practices

## Overview

The Registry pattern maintains a centralized collection of objects that can be looked up by key. This document captures best practices for implementing registries in TypeScript.

## Core Structure

```typescript
export class Registry<T> {
  private items: Map<string, T> = new Map();

  // Registration
  register(key: string, item: T): void { ... }
  
  // Retrieval
  get(key: string): T | undefined { ... }
  getAll(): T[] { ... }
  
  // Filtering
  filter(criteria: FilterCriteria): T[] { ... }
  
  // Utility
  has(key: string): boolean { ... }
  isEmpty(): boolean { ... }
  getCount(): number { ... }
  clear(): void { ... }
}
```

## Registration Method Design

### Handle Updates Gracefully

When registering an item that may already exist, preserve relevant state from the existing entry:

```typescript
register(key: string, item: Partial<T>): void {
  const existing = this.items.get(key);
  
  // Preserve counters, timestamps, or other accumulated state
  const count = existing?.messageCount ?? 0;
  const metadata = existing?.metadata;
  
  this.items.set(key, {
    ...item,
    messageCount: count + 1,
    metadata: metadata ?? this.extractMetadata(item),
    lastSeen: new Date().toISOString(),
  });
}
```

### Extract Complex Logic to Private Helpers

Keep the registration method focused by extracting complex extraction or validation logic:

```typescript
register(topic: string, data: SensorData): void {
  const existing = this.items.get(topic);
  const type = this.extracttype(topic);
  const metadata = this.extractMetadata(data.value, existing);
  
  this.items.set(topic, {
    topic,
    type,
    metadata,
    lastSeen: new Date().toISOString(),
    messageCount: (existing?.messageCount ?? 0) + 1,
  });
}

private extracttype(topic: string): string | undefined { ... }
private extractMetadata(value: unknown, existing?: T): Metadata { ... }
```

## Filtering and Querying

### Use Explicit Filter Criteria Types

Define a dedicated interface for filter criteria rather than inline object types:

```typescript
export interface SensorFilterCriteria {
  sourceModelId?: string;
  sensorType?: string;
  deviceBus?: string;
  type?: string;
}

filter(criteria: SensorFilterCriteria): RegisteredSensor[] {
  return this.getAll().filter(sensor => this.matchesCriteria(sensor, criteria));
}
```

### Extract Matching Logic to Private Method

Keep the filter method simple by delegating to a private matching method:

```typescript
private matchesCriteria(item: T, criteria: FilterCriteria): boolean {
  const { field1, field2, field3 } = criteria;
  
  if (field1 && item.field1 !== field1) return false;
  if (field2 && item.field2 !== field2) return false;
  if (field3 && !this.matchesField3(item, field3)) return false;
  
  return true;
}
```

## Unique Value Extraction

Provide a method to extract unique values for each filterable field. This is useful for building filter dropdowns in UIs:

```typescript
export type FilterField = 'sourceModelId' | 'sensorType' | 'deviceBus';

getUniqueValues(field: FilterField): string[] {
  const values = new Set<string>();
  
  for (const item of this.items.values()) {
    const value = item[field];
    if (value != null) {
      // Handle both string and string[] types
      const normalized = Array.isArray(value) ? value : [value];
      normalized.forEach(v => values.add(v));
    }
  }
  
  return Array.from(values).sort();
}
```

## Pattern Generation

For registries that track hierarchical data (like MQTT topics), provide methods to generate suggested patterns:

```typescript
getSuggestedPatterns(): string[] {
  const patterns = new Set<string>();
  
  // Add wildcard for all items
  patterns.add('items/#');
  
  // Add patterns for each unique dimension
  for (const category of this.getUniqueValues('category')) {
    patterns.add(`items/${category}/#`);
  }
  
  for (const type of this.getUniqueValues('type')) {
    patterns.add(`items/+/${type}/+`);
  }
  
  return Array.from(patterns).sort();
}
```

## Topic/Key Parsing

When keys encode structured information (e.g., MQTT topics), extract parsing logic to private methods with named constants:

```typescript
// Define structure constants
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
```

## Validation for Extracted Data

When extracting structured data from unknown values, use Zod schemas with `safeParse()`:

```typescript
const MetadataSchema = z.object({
  types: z.array(z.string()),
  version: z.string(),
});

private extractMetadata(
  value: unknown,
  existing?: T
): Metadata | undefined {
  if (!value || typeof value !== 'object') {
    return existing?.metadata;
  }
  
  const result = MetadataSchema.safeParse(value);
  return result.success ? result.data : existing?.metadata;
}
```

## Union Type Normalization

When fields can be `string | string[]`, create a normalization helper:

```typescript
private normalizeToArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

// Usage
private matchesCriteria(item: T, criteria: FilterCriteria): boolean {
  if (criteria.type) {
    const normalizedTypes = this.normalizeToArray(item.type);
    if (!normalizedTypes.includes(criteria.type)) return false;
  }
  return true;
}
```

## Standard Utility Methods

Always include these standard utility methods for better usability:

```typescript
class Registry<T> {
  // Check existence
  has(key: string): boolean {
    return this.items.has(key);
  }
  
  // Check if empty
  isEmpty(): boolean {
    return this.items.size === 0;
  }
  
  // Get count
  getCount(): number {
    return this.items.size;
  }
  
  // Clear all
  clear(): void {
    this.items.clear();
  }
}
```

## Schema Definition

Define a Zod schema for the registered items to enable validation when deserializing from external sources:

```typescript
export const RegisteredItemSchema = z.object({
  id: z.string().min(1),
  type: z.union([z.string(), z.array(z.string())]),
  lastSeen: z.string().datetime(),
  messageCount: z.number().int().nonnegative(),
  metadata: z.record(z.unknown()).optional(),
});

export type RegisteredItem = z.infer<typeof RegisteredItemSchema>;
```

## Complete Example

```typescript
import { z } from 'zod';

// Schema
export const RegisteredSensorSchema = z.object({
  topic: z.string().min(1),
  sensorId: z.string().min(1),
  sensorType: z.union([z.string(), z.array(z.string())]),
  type: z.string().optional(),
  lastSeen: z.string().datetime(),
  messageCount: z.number().int().nonnegative(),
});

export type RegisteredSensor = z.infer<typeof RegisteredSensorSchema>;

// Filter criteria
export interface SensorFilterCriteria {
  sensorType?: string;
  type?: string;
}

export type SensorFilterField = 'sensorType' | 'type';

// Constants
const TOPIC_STRUCTURE = {
  SEGMENT_COUNT_WITH_type: 6,
  type_SEGMENT_INDEX: 5,
} as const;

// Registry class
export class SensorRegistry {
  private sensors: Map<string, RegisteredSensor> = new Map();

  register(topic: string, sensorId: string, sensorType: string | string[]): void {
    const existing = this.sensors.get(topic);
    const type = this.extracttype(topic);

    this.sensors.set(topic, {
      topic,
      sensorId,
      sensorType,
      type,
      lastSeen: new Date().toISOString(),
      messageCount: (existing?.messageCount ?? 0) + 1,
    });
  }

  private extracttype(topic: string): string | undefined {
    const parts = topic.split('/');
    return parts.length === TOPIC_STRUCTURE.SEGMENT_COUNT_WITH_type
      ? parts[TOPIC_STRUCTURE.type_SEGMENT_INDEX]
      : undefined;
  }

  private normalizeSensorType(sensorType: string | string[]): string[] {
    return Array.isArray(sensorType) ? sensorType : [sensorType];
  }

  getAll(): RegisteredSensor[] {
    return Array.from(this.sensors.values());
  }

  filter(criteria: SensorFilterCriteria): RegisteredSensor[] {
    return this.getAll().filter(sensor => this.matchesCriteria(sensor, criteria));
  }

  private matchesCriteria(sensor: RegisteredSensor, criteria: SensorFilterCriteria): boolean {
    if (criteria.sensorType) {
      const types = this.normalizeSensorType(sensor.sensorType);
      if (!types.includes(criteria.sensorType)) return false;
    }
    if (criteria.type && sensor.type !== criteria.type) return false;
    return true;
  }

  getUniqueValues(field: SensorFilterField): string[] {
    const values = new Set<string>();
    for (const sensor of this.sensors.values()) {
      const v = sensor[field];
      if (v != null) {
        const normalized = Array.isArray(v) ? v : [v];
        normalized.forEach(item => values.add(item));
      }
    }
    return Array.from(values).sort();
  }

  has(topic: string): boolean {
    return this.sensors.has(topic);
  }

  isEmpty(): boolean {
    return this.sensors.size === 0;
  }

  getCount(): number {
    return this.sensors.size;
  }

  clear(): void {
    this.sensors.clear();
  }
}
```
