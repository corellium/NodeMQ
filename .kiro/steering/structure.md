# Project Structure

## Directory Layout

```
.
├── src/
│   ├── index.ts           # Application entry point
│   ├── config/            # Configuration and env handling
│   ├── mqtt/              # MQTT client, handlers, topic management
│   ├── queue/             # Message queue processors and jobs
│   ├── corellium/         # Corellium API client and models
│   │   ├── client.ts      # API client wrapper
│   │   ├── coremodel.ts   # CoreModel interactions
│   │   └── types.ts       # Corellium type definitions
│   ├── handlers/          # Message and event handlers
│   ├── services/          # Business logic
│   └── utils/             # Shared utilities
├── tests/                 # Test files
├── .kiro/                 # Kiro AI configuration
│   └── steering/          # Steering rules
├── .env.example           # Environment template
└── package.json
```

## Conventions

### File Naming
- Use kebab-case for files: `device-manager.ts`
- Use PascalCase for classes: `DeviceManager`
- Use camelCase for functions and variables
- Suffix types/interfaces files with `.types.ts`

### MQTT Topics
- Format: `corellium/{projectId}/{deviceId}/{action}`
- Actions: `state`, `command`, `event`, `error`
- Use wildcards carefully: `corellium/+/+/state`

### Message Queue Jobs
- Name jobs descriptively: `device:start`, `device:snapshot`
- Include correlation IDs for tracing
- Structure job data with `deviceId`, `action`, `payload`

## Architecture

### Event Flow
```
MQTT Broker <-> MQTT Client <-> Handlers <-> Services <-> Corellium API
                                   |
                            Message Queue
                                   |
                            Job Processors
```

### Key Patterns
- Event-driven architecture for device state changes
- Command pattern for device operations
- Repository pattern for Corellium resource access
- Circuit breaker for external API calls
