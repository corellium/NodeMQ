# Requirements Document

## Introduction

A Node.js subscription service that receives sensor data from CoreModel devices, provides real-time data streaming to frontend clients, and forwards sensor data to Corellium ECU chip selects on designated models. The service leverages Node.js built-in capabilities for message handling and runs on Linux.

## Glossary

- **Subscription_Service**: The Node.js service that manages sensor data subscriptions, routing, and delivery
- **CoreModel**: Corellium's virtual device model that generates sensor data
- **ECU**: Electronic Control Unit - the target Corellium device receiving sensor data
- **Chip_Select**: The specific hardware interface on the ECU for receiving sensor data
- **Sensor_Data**: Structured data packets containing sensor readings with metadata
- **Frontend_Client**: Web-based interface that subscribes to and displays sensor data
- **Data_Router**: Component that directs sensor data to appropriate destinations (frontend, ECU)

## Requirements

### Requirement 1: Sensor Data Ingestion

**User Story:** As a developer, I want to send sensor data from CoreModel to the subscription service, so that the data can be processed and distributed to consumers.

#### Acceptance Criteria

1. WHEN sensor data is received from CoreModel, THE Subscription_Service SHALL validate the data structure and accept valid payloads
2. WHEN sensor data contains invalid structure or missing required fields, THE Subscription_Service SHALL reject the data and return an error response
3. WHEN sensor data is accepted, THE Subscription_Service SHALL assign a unique message ID and timestamp for tracking
4. THE Sensor_Data SHALL contain at minimum: sensor ID, sensor type, value, and source model identifier

### Requirement 2: Frontend Subscription Management

**User Story:** As a frontend developer, I want to connect to the subscription service and receive real-time sensor data via Server-Sent Events, so that I can display live sensor readings to users.

#### Acceptance Criteria

1. WHEN a frontend client connects, THE Subscription_Service SHALL establish a Server-Sent Events (SSE) connection for data streaming
2. WHEN a frontend client subscribes to a topic, THE Subscription_Service SHALL filter and deliver only sensor data matching that topic
3. WHEN a frontend client unsubscribes from a topic, THE Subscription_Service SHALL stop delivering data for that topic to the client
4. WHEN a frontend client disconnects, THE Subscription_Service SHALL clean up all subscriptions and release resources
5. WHILE a frontend client is connected, THE Subscription_Service SHALL send SSE heartbeat comments to maintain connection health
6. WHEN multiple frontend clients subscribe to the same topic, THE Subscription_Service SHALL broadcast data to all subscribers
7. THE Subscription_Service SHALL support wildcard topic subscriptions for flexible filtering

### Requirement 3: ECU Data Forwarding

**User Story:** As a developer, I want sensor data forwarded to specific Corellium ECU chip selects, so that the virtual ECU can process sensor inputs in real-time.

#### Acceptance Criteria

1. WHEN sensor data is received, THE Data_Router SHALL forward it to the configured ECU chip select
2. WHEN forwarding to ECU, THE Subscription_Service SHALL use the designated model's chip select configuration
3. IF the ECU connection fails, THEN THE Subscription_Service SHALL queue the data and retry with exponential backoff
4. WHEN ECU forwarding succeeds, THE Subscription_Service SHALL log the delivery confirmation
5. THE Subscription_Service SHALL support configuring multiple ECU targets per sensor type

### Requirement 4: Model and Chip Select Configuration

**User Story:** As a system administrator, I want to configure which sensors map to which ECU chip selects, so that data routing is flexible and maintainable.

#### Acceptance Criteria

1. THE Subscription_Service SHALL load chip select mappings from configuration on startup
2. WHEN configuration is updated, THE Subscription_Service SHALL apply changes without requiring restart
3. WHEN a sensor has no configured ECU mapping, THE Subscription_Service SHALL log a warning and skip ECU forwarding
4. THE Configuration SHALL support mapping sensor types to specific chip select addresses on target models

### Requirement 5: Message Queue and Persistence

**User Story:** As a developer, I want reliable message processing with disk persistence, so that sensor data is not lost during high load or service restarts.

#### Acceptance Criteria

1. THE Subscription_Service SHALL use Node.js EventEmitter for internal message routing
2. WHEN sensor data is received, THE Subscription_Service SHALL persist it to disk before processing
3. THE Subscription_Service SHALL read sensor data from telemetry files on disk
4. WHEN message processing fails, THE Subscription_Service SHALL retain the message for retry
5. THE Subscription_Service SHALL process messages in order per sensor source
6. WHEN the service restarts, THE Subscription_Service SHALL resume processing from persisted data
7. THE Subscription_Service SHALL support configurable buffer sizes for in-memory message queuing

### Requirement 6: Service Health and Monitoring

**User Story:** As an operator, I want to monitor service health and performance, so that I can ensure reliable operation.

#### Acceptance Criteria

1. THE Subscription_Service SHALL expose health check endpoints for monitoring
2. THE Subscription_Service SHALL log all significant events with structured logging
3. WHEN error rates exceed thresholds, THE Subscription_Service SHALL emit alerts
4. THE Subscription_Service SHALL track and expose metrics for message throughput and latency

### Requirement 7: Data Serialization

**User Story:** As a developer, I want consistent data serialization, so that sensor data is reliably transmitted between components.

#### Acceptance Criteria

1. WHEN storing or transmitting sensor data, THE Subscription_Service SHALL serialize using JSON format
2. WHEN receiving sensor data, THE Subscription_Service SHALL parse and validate against the expected schema
3. FOR ALL valid Sensor_Data objects, serializing then deserializing SHALL produce an equivalent object (round-trip property)

### Requirement 8: Topic Management

**User Story:** As a developer, I want an MQTT-like topic system, so that I can organize and filter sensor data flexibly.

#### Acceptance Criteria

1. THE Subscription_Service SHALL organize sensor data into hierarchical topics (e.g., `sensors/{modelId}/{sensorType}/{sensorId}`)
2. WHEN a client subscribes with a wildcard topic, THE Subscription_Service SHALL match all topics fitting the pattern
3. THE Subscription_Service SHALL support single-level wildcards (`+`) and multi-level wildcards (`#`) in topic subscriptions
4. WHEN publishing sensor data, THE Subscription_Service SHALL route to all matching topic subscribers
