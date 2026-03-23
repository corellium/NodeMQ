# Technology Stack

## Build System

- npm or yarn for package management
- Node.js runtime (LTS recommended, 18.x or 20.x)

## Languages

- TypeScript (preferred) or JavaScript
- Use ES modules (`"type": "module"` in package.json)

## Frameworks & Libraries

### Core
- `mqtt` or `async-mqtt` - MQTT client
- `@corellium/corellium-api` - Corellium API client (if available)
- `axios` or `node-fetch` - HTTP client for Corellium REST API

### Message Queue
- `bull` or `bullmq` - Redis-backed job queue
- `amqplib` - RabbitMQ client (alternative)

### Utilities
- `dotenv` - Environment configuration
- `winston` or `pino` - Structured logging
- `zod` or `joi` - Schema validation

## Common Commands

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run development
npm run dev

# Run tests
npm test

# Lint
npm run lint
```

## MQTT Best Practices

- Use QoS 1 or 2 for critical device commands
- Implement reconnection with exponential backoff
- Structure topics hierarchically: `corellium/{projectId}/{deviceId}/{event}`
- Always handle `error`, `close`, and `offline` events
- Use retained messages for device state
- Implement message deduplication for QoS > 0

## Message Queue Best Practices

- Use dead-letter queues for failed jobs
- Implement idempotent job handlers
- Set appropriate job timeouts
- Use job priorities for critical operations
- Persist job state for crash recovery
- Monitor queue depth and processing latency

## Corellium API Guidelines

- Store API tokens securely (env vars, secrets manager)
- Implement rate limiting to respect API quotas
- Cache device/project metadata to reduce API calls
- Handle API errors gracefully with retries
- Use webhooks where available instead of polling
- Clean up virtual devices when done to manage costs

## Development Setup

1. Node.js 18+ installed
2. Access to MQTT broker (local Mosquitto or cloud)
3. Corellium account with API access
4. Redis (if using Bull/BullMQ)
