# Requirements Document: Generic Telemetry Bus Support

## Introduction

The telemetry system currently handles specific device bus types (GPIO, SPI, I2C) with hardcoded logic. This feature makes the system fully generic and flexible to automatically handle telemetry data from ANY device bus type (GPIO, SPI, I2C, USB, UART, CAN, LIN, or future bus types) without requiring code changes. When properly formatted telemetry data is sent, the system will automatically create appropriate MQTT topics that can be subscribed to, enabling dynamic discovery and routing of telemetry streams.

## Glossary

- **Telemetry_System**: The complete system including the C telemetry library (coremodel_telemetry) and NodeMQ service
- **Device_Bus**: A hardware communication interface (e.g., SPI, I2C, USB, UART, CAN, LIN, GPIO)
- **Bus_Type**: The string identifier for a device bus (e.g., "spi0", "i2c1", "can0", "uart2")
- **Topic**: An MQTT-style hierarchical path used for message routing (format: sensors/{modelId}/{busType}/{sensorType}/{sensorId}[/{type}])
- **C_Library**: The coremodel_telemetry C library embedded in device models
- **NodeMQ_Service**: The Node.js HTTP ingestion server with SSE streaming
- **Topic_Registry**: The service component that tracks discovered sensor topics
- **Sensor_Data**: JSON payload containing sensor measurements and metadata
- **type**: Optional data stream identifier (e.g., "fifoPush", "spiRead", "generate")

## Requirements

### Requirement 1: Generic Bus Type Acceptance

**User Story:** As a device model developer, I want to send telemetry data with any device bus type identifier, so that I can stream data from any hardware interface without modifying the telemetry system.

#### Acceptance Criteria

1. WHEN Sensor_Data is received with a deviceBus field, THE Telemetry_System SHALL accept any non-empty string value as a valid Bus_Type
2. THE Telemetry_System SHALL NOT validate deviceBus against a predefined list of allowed bus types
3. WHEN deviceBus is not provided in Sensor_Data, THE Telemetry_System SHALL use "default" as the Bus_Type
4. THE Telemetry_System SHALL preserve the exact deviceBus string value in all processing and storage operations

### Requirement 2: Automatic Topic Creation

**User Story:** As a device model developer, I want topics to be automatically created when I send telemetry data, so that I don't need to pre-register sensors or configure routing rules.

#### Acceptance Criteria

1. WHEN Sensor_Data is ingested with valid required fields, THE NodeMQ_Service SHALL automatically create a Topic using the format sensors/{sourceModelId}/{deviceBus}/{sensorType}/{sensorId}[/{type}]
2. WHEN a Topic is created, THE Topic_Registry SHALL register the sensor with all provided metadata
3. THE NodeMQ_Service SHALL route messages to the created Topic without requiring pre-configuration
4. WHEN multiple messages arrive for the same Topic, THE Telemetry_System SHALL reuse the existing Topic and increment the message count

### Requirement 3: Dynamic Topic Discovery

**User Story:** As a dashboard developer, I want to discover all active sensor topics dynamically, so that I can subscribe to any telemetry stream without knowing the bus types in advance.

#### Acceptance Criteria

1. WHEN a GET request is made to /topics, THE NodeMQ_Service SHALL return all registered sensors with their deviceBus values
2. THE NodeMQ_Service SHALL provide unique deviceBus values in the filters section of the /topics response
3. WHEN a query parameter deviceBus is provided to /topics, THE NodeMQ_Service SHALL filter sensors matching that Bus_Type
4. THE NodeMQ_Service SHALL generate suggested subscription patterns that include discovered deviceBus values

### Requirement 4: Bus-Agnostic Message Validation

**User Story:** As a system maintainer, I want the validation logic to work for any device bus type, so that the system remains maintainable and doesn't accumulate bus-specific code.

#### Acceptance Criteria

1. THE SensorDataSchema SHALL validate deviceBus as an optional non-empty string without enum constraints
2. THE Telemetry_System SHALL NOT contain conditional logic that branches based on specific deviceBus values
3. WHEN validating Sensor_Data, THE Telemetry_System SHALL apply the same validation rules regardless of deviceBus value
4. THE Telemetry_System SHALL reject Sensor_Data only if required fields are missing or malformed, not based on deviceBus content

### Requirement 5: Wildcard Subscription Support

**User Story:** As a dashboard user, I want to subscribe to sensors by device bus type using wildcards, so that I can monitor all sensors on a specific bus without knowing individual sensor IDs.

#### Acceptance Criteria

1. WHEN a subscription pattern sensors/+/{busType}/# is provided, THE NodeMQ_Service SHALL deliver messages from all sensors on that Bus_Type
2. WHEN a subscription pattern sensors/{modelId}/{busType}/# is provided, THE NodeMQ_Service SHALL deliver messages from the specified model and Bus_Type combination
3. THE NodeMQ_Service SHALL support the + wildcard to match any single Bus_Type in topic patterns
4. THE NodeMQ_Service SHALL support the # wildcard to match all remaining topic segments including Bus_Type

### Requirement 6: C Library Bus Type Flexibility

**User Story:** As a device model developer, I want the C telemetry library to accept any device bus string, so that I can specify the hardware interface my sensor uses.

#### Acceptance Criteria

1. WHEN calling telemetry functions, THE C_Library SHALL accept a deviceBus parameter as a string
2. THE C_Library SHALL include the deviceBus value in the JSON payload sent to NodeMQ_Service
3. THE C_Library SHALL NOT validate or restrict deviceBus to specific values
4. WHEN deviceBus is NULL or empty, THE C_Library SHALL omit the deviceBus field from the JSON payload

### Requirement 7: Backward Compatibility

**User Story:** As a system operator, I want existing device models to continue working, so that I don't need to update all models simultaneously when deploying the generic bus support.

#### Acceptance Criteria

1. WHEN Sensor_Data is received without a deviceBus field, THE Telemetry_System SHALL use "default" as the Bus_Type
2. THE Telemetry_System SHALL continue to support existing topics with "default" as the deviceBus value
3. WHEN querying /topics without filters, THE NodeMQ_Service SHALL return sensors with both explicit and default deviceBus values
4. THE Telemetry_System SHALL maintain the existing topic structure format sensors/{modelId}/{bus}/{sensorType}/{sensorId}[/{type}]

### Requirement 8: Bus Type in Topic Registry

**User Story:** As a system administrator, I want to see which device bus each sensor uses, so that I can understand the hardware topology and troubleshoot connectivity issues.

#### Acceptance Criteria

1. WHEN a sensor is registered, THE Topic_Registry SHALL store the deviceBus value in the RegisteredSensor record
2. WHEN querying registered sensors, THE Topic_Registry SHALL include the deviceBus field in the response
3. THE Topic_Registry SHALL support filtering by deviceBus using the filter() method
4. THE Topic_Registry SHALL include deviceBus in the unique values extraction via getUniqueValues('deviceBus')

### Requirement 9: Documentation of Bus Type Format

**User Story:** As a device model developer, I want clear documentation on bus type naming conventions, so that I can choose consistent identifiers across my models.

#### Acceptance Criteria

1. THE documentation SHALL specify that deviceBus accepts any non-empty string value
2. THE documentation SHALL provide examples of common Bus_Type formats (e.g., "spi0", "i2c1", "can0", "uart2", "usb0", "gpio", "lin0")
3. THE documentation SHALL recommend lowercase naming with numeric suffixes for multiple instances
4. THE documentation SHALL explain that deviceBus is optional and defaults to "default" when omitted

### Requirement 10: No Hardcoded Bus Type Lists

**User Story:** As a system maintainer, I want to avoid maintaining lists of valid bus types, so that the system automatically supports new hardware interfaces as they emerge.

#### Acceptance Criteria

1. THE Telemetry_System SHALL NOT contain arrays, enums, or sets that enumerate specific device bus types
2. THE Telemetry_System SHALL NOT use switch statements or if-else chains that branch on specific deviceBus values
3. WHEN new Bus_Type values appear in telemetry data, THE Telemetry_System SHALL handle them identically to existing types
4. THE codebase SHALL use generic string handling for deviceBus throughout all components

### Requirement 11: Bus Type in Message Routing

**User Story:** As a dashboard developer, I want messages routed by device bus type, so that I can create bus-specific visualizations and monitoring views.

#### Acceptance Criteria

1. WHEN building a Topic, THE buildTopic() function SHALL include the deviceBus value as the second segment
2. WHEN matching subscription patterns, THE TopicManager SHALL treat deviceBus as a standard topic segment for wildcard matching
3. THE NodeMQ_Service SHALL deliver messages to subscribers whose patterns match the deviceBus segment
4. WHEN a client subscribes to sensors/+/spi0/#, THE NodeMQ_Service SHALL deliver only messages where deviceBus equals "spi0"

### Requirement 12: Bus Type Persistence

**User Story:** As a system operator, I want device bus information persisted with message history, so that I can analyze historical data by hardware interface.

#### Acceptance Criteria

1. WHEN messages are persisted, THE MessagePersistence service SHALL store the deviceBus field in the message record
2. WHEN retrieving buffered messages, THE NodeMQ_Service SHALL include the deviceBus field in the response
3. THE persisted message format SHALL maintain deviceBus as an optional string field
4. WHEN querying message history by topic pattern, THE system SHALL filter by deviceBus segment correctly
