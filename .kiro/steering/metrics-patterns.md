# Metrics Endpoint Patterns

## Overview

Metrics endpoints should return aggregate, numeric data suitable for monitoring dashboards and alerting systems. They should NOT return detailed lists or large data structures that belong in dedicated discovery/query endpoints.

## Core Principles

### 1. Metrics vs. Discovery Endpoints

**Metrics endpoints** (`/metrics`, `/health`) should return:
- Counts, percentages, rates
- Resource utilization (memory, CPU, queue depth)
- Performance indicators (latency, throughput)
- Error rates and overflow counts

**Discovery endpoints** (`/topics`, `/queues`, `/sensors`) should return:
- Lists of entities (topics, sensors, devices)
- Detailed entity metadata
- Filterable/pageable collections

**Real-world example from this codebase**:
- `/metrics` returns `topicCount` (aggregate) - ✓ Correct
- `/topics` returns `activeTopics: string[]` (detailed list) - ✓ Correct
- Never include `topics: string[]` in `/metrics` - ❌ Wrong

```typescript
// Good: Metrics endpoint with aggregate data
private handleMetrics(_req: IncomingMessage, res: ServerResponse): void {
  this.sendJson(res, 200, {
    buffer: {
      topicCount: this.topicBuffer.getTopicCount(),
      totalMessages: this.topicBuffer.getTotalCount(),
      maxPerTopic: this.configManager.getTopicBufferSize(),
    },
    fifo: {
      ingestion: {
        count: stats.count,
        capacity: stats.capacity,
        fillPercent: Math.round((stats.count / stats.capacity) * 100),
      },
    },
  });
}

// Avoid: Including large arrays in metrics
private handleMetrics(_req: IncomingMessage, res: ServerResponse): void {
  this.sendJson(res, 200, {
    buffer: {
      topicCount: this.topicBuffer.getTopicCount(),
      topics: this.topicBuffer.getTopics(), // ❌ Could be thousands of strings
    },
  });
}
```

### 2. Use Configuration Getter Methods

Always use dedicated getter methods from ConfigManager rather than accessing the config object directly:

```typescript
// Good: Use dedicated getter method
const maxPerTopic = this.configManager.getTopicBufferSize();

// Avoid: Direct property access
const config = this.configManager.getConfig();
const maxPerTopic = config.topicBufferSize;
```

Benefits:
- Encapsulation - internal config structure can change
- Type safety - getters provide explicit return types
- Validation - getters can add runtime checks
- Consistency - single pattern across codebase

### 3. Document Metric Sections

Add inline comments explaining what each metric section represents:

```typescript
this.sendJson(res, 200, {
  ...metrics,
  // Topic buffer metrics - in-memory replay buffer for new subscribers
  buffer: {
    topicCount: this.topicBuffer.getTopicCount(),
    totalMessages: this.topicBuffer.getTotalCount(),
    maxPerTopic: this.configManager.getTopicBufferSize(),
  },
  // FIFO queue metrics - ingestion and processing queues
  fifo: {
    ingestion: { /* ... */ },
    processing: { /* ... */ },
  },
});
```

### 4. Calculated Metrics

Include derived metrics that provide immediate insight:

```typescript
// Good: Include calculated percentage
fifo: {
  ingestion: {
    count: stats.count,
    capacity: stats.capacity,
    fillPercent: Math.round((stats.count / stats.capacity) * 100), // ✓ Immediate insight
  },
}

// Avoid: Requiring clients to calculate
fifo: {
  ingestion: {
    count: stats.count,
    capacity: stats.capacity,
    // Client must calculate: (count / capacity) * 100
  },
}
```

### 5. Consistent Metric Naming

Use consistent naming conventions across all metric sections:

- `count` - number of items
- `capacity` - maximum items
- `fillPercent` - utilization percentage
- `overflowCount` - number of dropped items
- `totalMessages` - aggregate count across all entities
- `maxPerTopic` - configured limit per entity

## Metrics Response Structure

```typescript
interface MetricsResponse {
  // Health status
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  
  // Buffer metrics
  buffer: {
    topicCount: number;
    totalMessages: number;
    maxPerTopic: number;
  };
  
  // Queue metrics
  fifo: {
    ingestion: QueueMetrics;
    processing: QueueMetrics;
  };
  
  // Connection metrics
  connections: {
    active: number;
    total: number;
  };
}

interface QueueMetrics {
  count: number;
  capacity: number;
  overflowCount: number;
  fillPercent: number;
}
```

## Performance Considerations

### Avoid Expensive Operations

Metrics endpoints are often polled frequently by monitoring systems. Keep them fast:

```typescript
// Good: O(1) operations
getTopicCount(): number {
  return this.buffers.size; // Map.size is O(1)
}

// Avoid: O(n) operations in metrics
getTopicCount(): number {
  return Array.from(this.buffers.keys()).length; // Unnecessary array conversion
}
```

### Cache Expensive Calculations

If a metric requires expensive calculation, cache it and update incrementally:

```typescript
class TopicBuffer {
  private totalMessageCount: number = 0; // Cached
  
  push(topic: string, message: T): void {
    const buf = this.getOrCreateBuffer(topic);
    const oldLength = buf.length;
    buf.push(message);
    if (buf.length > this.maxPerTopic) {
      buf.shift();
    }
    // Update cached count incrementally
    this.totalMessageCount += (buf.length - oldLength);
  }
  
  getTotalCount(): number {
    return this.totalMessageCount; // O(1) instead of O(n)
  }
}
```

## Separation of Concerns

Keep metrics logic separate from business logic:

```typescript
// Good: Dedicated metrics method
private handleMetrics(_req: IncomingMessage, res: ServerResponse): void {
  const metrics = this.collectMetrics();
  this.sendJson(res, 200, metrics);
}

private collectMetrics(): MetricsResponse {
  return {
    buffer: this.getBufferMetrics(),
    fifo: this.getFifoMetrics(),
    connections: this.getConnectionMetrics(),
  };
}

private getBufferMetrics(): BufferMetrics {
  return {
    topicCount: this.topicBuffer.getTopicCount(),
    totalMessages: this.topicBuffer.getTotalCount(),
    maxPerTopic: this.configManager.getTopicBufferSize(),
  };
}
```

## Testing Metrics Endpoints

Ensure metrics endpoints:
- Return valid JSON
- Include all expected fields
- Return numeric values in expected ranges
- Respond quickly (< 100ms for typical workloads)
- Don't leak sensitive information

```typescript
describe('GET /metrics', () => {
  it('should return aggregate metrics without detailed lists', async () => {
    const response = await request(app).get('/metrics');
    
    expect(response.status).toBe(200);
    expect(response.body.buffer).toHaveProperty('topicCount');
    expect(response.body.buffer).toHaveProperty('totalMessages');
    expect(response.body.buffer).not.toHaveProperty('topics'); // ✓ No detailed lists
  });
  
  it('should return metrics quickly', async () => {
    const start = Date.now();
    await request(app).get('/metrics');
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(100); // Should be fast
  });
});
```

## Related Patterns

- See `configuration-patterns.md` for ConfigManager getter method patterns
- See `registry-pattern.md` for efficient count/aggregate methods
- See `typescript-patterns.md` for consistent naming conventions
