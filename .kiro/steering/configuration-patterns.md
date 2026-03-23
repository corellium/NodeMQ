# Configuration Patterns

## Overview

Configuration should be centralized, validated, and support hot-reloading. This document captures best practices for managing service configuration.

## Named Constants for Defaults

Always define named constants for default values rather than using magic numbers inline:

```typescript
// Good: Named constant with documentation
// Default topic buffer size - per-topic ring buffer for replay to new subscribers
// Sized to hold ~2000 messages across all topics for historical replay
const DEFAULT_TOPIC_BUFFER_SIZE = 2000;

// Usage
this.topicBuffer = new TopicMessageBuffer(DEFAULT_TOPIC_BUFFER_SIZE);

// Avoid: Magic number without context
this.topicBuffer = new TopicMessageBuffer(2000);
```

Benefits:
- Self-documenting code
- Single source of truth for default values
- Easy to find and update defaults
- Clear intent and reasoning

## Configuration Schema with Zod

Use Zod schemas to validate configuration with sensible defaults:

```typescript
export const ServiceConfigSchema = z.object({
  heartbeatIntervalMs: z.number().int().min(1000).default(30000),
  topicBufferSize: z.number().int().min(1).default(2000),
  persistencePath: z.string().default('./data/messages'),
});

export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;
```

Benefits:
- Runtime validation of configuration
- Type-safe configuration access
- Automatic defaults for missing values
- Clear constraints (min/max values)

## Default Configuration Object

Maintain a separate default configuration object that matches the schema:

```typescript
export const DEFAULT_CONFIG: ServiceConfig = {
  heartbeatIntervalMs: 30000,
  topicBufferSize: 2000,
  persistencePath: './data/messages',
};
```

This serves as:
- Fallback when config file is missing
- Documentation of expected values
- Reference for creating config files

## Configuration-Driven Initialization

Initialize components with default values, then reinitialize with configured values after config load:

```typescript
constructor() {
  // Initialize with defaults
  this.topicBuffer = new TopicMessageBuffer(DEFAULT_TOPIC_BUFFER_SIZE);
}

async initialize(): Promise<void> {
  const configResult = await this.configManager.load();
  
  if (configResult.success && configResult.config) {
    // Reinitialize with configured values
    this.topicBuffer = new TopicMessageBuffer(configResult.config.topicBufferSize);
  }
}
```

This pattern ensures:
- Service can start even if config is invalid
- Configuration is applied consistently
- Components use configured values when available

## Getter Methods for Configuration Values

Provide typed getter methods for each configuration value:

```typescript
class ConfigManager {
  getTopicBufferSize(): number {
    return this.config.topicBufferSize;
  }
  
  getHeartbeatIntervalMs(): number {
    return this.config.heartbeatIntervalMs;
  }
}
```

Benefits:
- Type-safe access to configuration
- Encapsulation of configuration structure
- Easy to add validation or transformation logic
- Better IDE autocomplete

## Configuration File Structure

Keep configuration files flat and well-documented:

```json
{
  "heartbeatIntervalMs": 30000,
  "topicBufferSize": 2000,
  "persistencePath": "./data/messages",
  "retryConfig": {
    "maxRetries": 5,
    "initialDelayMs": 100,
    "maxDelayMs": 30000,
    "backoffMultiplier": 2
  }
}
```

Guidelines:
- Use camelCase for field names
- Group related settings in nested objects
- Include all configurable values (even if using defaults)
- Keep nesting shallow (max 2 levels)

## Hot-Reload Support

Support configuration changes without service restart:

```typescript
// Set up config hot-reload
this.configManager.onConfigChange((config: ServiceConfig) => {
  logger.info('Configuration reloaded');
  // Apply new configuration
  this.topicBuffer = new TopicMessageBuffer(config.topicBufferSize);
});

this.configManager.startWatching();
```

Considerations:
- Not all settings can be hot-reloaded (e.g., port numbers)
- Document which settings require restart
- Handle reload failures gracefully
- Log configuration changes for debugging

## Configuration Validation

Always validate configuration on load with clear error messages:

```typescript
async load(): Promise<ConfigLoadResult> {
  try {
    const rawConfig = JSON.parse(fileContent);
    const parseResult = ServiceConfigSchema.safeParse(rawConfig);
    
    if (!parseResult.success) {
      return {
        success: false,
        error: `Invalid config format: ${parseResult.error.message}`,
      };
    }
    
    return { success: true, config: parseResult.data };
  } catch (error) {
    return {
      success: false,
      error: `Failed to load config: ${error.message}`,
    };
  }
}
```

## Environment Variable Overrides

Support environment variables for deployment flexibility:

```typescript
const configPath = process.env.CONFIG_PATH || './config.json';
const port = parseInt(process.env.PORT || '3000', 10);
```

Priority order:
1. Environment variables (highest priority)
2. Configuration file
3. Default values (lowest priority)

## Configuration Documentation

Document configuration options in:
- Schema comments
- README or separate config documentation
- Example configuration files
- Inline comments in default config

Example:
```typescript
export const ServiceConfigSchema = z.object({
  // Interval between SSE heartbeat messages (milliseconds)
  // Recommended: 30000 (30 seconds)
  heartbeatIntervalMs: z.number().int().min(1000).default(30000),
  
  // Maximum messages buffered per topic for replay to new subscribers
  // Higher values = more memory usage but better replay capability
  // Recommended: 2000 for typical workloads
  topicBufferSize: z.number().int().min(1).default(2000),
});
```
