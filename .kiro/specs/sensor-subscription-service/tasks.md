# Implementation Plan: Sensor Subscription Service

## Overview

This plan implements the sensor subscription service incrementally, starting with core data models and validation, then building out the topic system, SSE connections, ECU routing, and persistence. Property-based tests validate correctness properties alongside implementation.

## Tasks

- [x] 1. Project setup and core data models
  - [x] 1.1 Initialize TypeScript project with dependencies
    - Create package.json with type: module
    - Install dependencies: zod, pino, fast-check, jest, typescript
    - Configure tsconfig.json and jest.config.js
    - _Requirements: Tech stack setup_

  - [x] 1.2 Implement SensorData and IngestedMessage types with Zod schemas
    - Create src/types/sensor-data.ts with SensorData interface and schema
    - Create src/types/ingested-message.ts with IngestedMessage interface
    - Implement validation function using Zod
    - _Requirements: 1.1, 1.2, 1.4_

  - [x] 1.3 Write property test for sensor data validation
    - **Property 1: Sensor Data Validation**
    - **Validates: Requirements 1.1, 1.2, 1.4**

  - [x] 1.4 Write property test for serialization round-trip
    - **Property 14: Serialization Round-Trip**
    - **Validates: Requirements 7.1, 7.2, 7.3**

- [x] 2. Topic management system
  - [x] 2.1 Implement TopicManager with hierarchical topic support
    - Create src/services/topic-manager.ts
    - Implement buildTopic() for constructing sensor topics
    - Implement subscribe/unsubscribe methods
    - Implement getMatchingSubscribers()
    - _Requirements: 8.1, 2.2, 2.3_

  - [x] 2.2 Implement wildcard topic matching
    - Implement matchTopic() with + and # wildcard support
    - Single-level (+) matches exactly one level
    - Multi-level (#) matches zero or more levels
    - _Requirements: 2.7, 8.2, 8.3_

  - [x] 2.3 Write property test for topic building
    - **Property 15: Hierarchical Topic Building**
    - **Validates: Requirements 8.1**

  - [x] 2.4 Write property test for wildcard topic matching
    - **Property 7: Wildcard Topic Matching**
    - **Validates: Requirements 2.7, 8.2, 8.3**

  - [x] 2.5 Write property test for topic subscription filtering
    - **Property 3: Topic Subscription Filtering**
    - **Validates: Requirements 2.2**

- [x] 3. Checkpoint - Core models and topic system
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. SSE connection management
  - [x] 4.1 Implement SSEConnectionManager
    - Create src/services/sse-connection-manager.ts
    - Implement addClient/removeClient methods
    - Implement sendToClient and broadcast methods
    - Implement heartbeat mechanism
    - _Requirements: 2.1, 2.5, 2.6_

  - [x] 4.2 Implement subscription lifecycle in SSE manager
    - Wire TopicManager with SSEConnectionManager
    - Handle client disconnect cleanup
    - Implement unsubscribe behavior
    - _Requirements: 2.3, 2.4_

  - [x] 4.3 Write property test for broadcast to all subscribers
    - **Property 6: Broadcast to All Subscribers**
    - **Validates: Requirements 2.6**

  - [x] 4.4 Write property test for unsubscribe stops delivery
    - **Property 4: Unsubscribe Stops Delivery**
    - **Validates: Requirements 2.3**

  - [x] 4.5 Write property test for disconnect cleanup
    - **Property 5: Disconnect Cleanup**
    - **Validates: Requirements 2.4**

- [x] 5. Sensor data ingestion
  - [x] 5.1 Implement SensorIngestionService
    - Create src/services/sensor-ingestion-service.ts
    - Implement ingest() method with validation
    - Generate unique messageId and timestamp
    - Build topic from sensor data
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 5.2 Write property test for unique message identification
    - **Property 2: Unique Message Identification**
    - **Validates: Requirements 1.3**

- [x] 6. Checkpoint - Ingestion and SSE streaming
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Configuration management
  - [x] 7.1 Implement ConfigManager with hot-reload
    - Create src/services/config-manager.ts
    - Implement load() from JSON config file
    - Implement reload() for hot-reload support
    - Implement file watcher for config changes
    - _Requirements: 4.1, 4.2, 4.4_

  - [x] 7.2 Write unit tests for configuration loading
    - Test loading valid config
    - Test handling missing config file
    - Test handling invalid config format
    - _Requirements: 4.1, 4.2_

- [x] 8. ECU data routing
  - [x] 8.1 Implement DataRouter for ECU forwarding
    - Create src/services/data-router.ts
    - Implement getTargetsForSensor() using config mappings
    - Implement forward() to send to all configured targets
    - Handle unmapped sensor types
    - _Requirements: 3.1, 3.2, 3.5, 4.3_

  - [x] 8.2 Implement exponential backoff retry logic
    - Create src/utils/retry.ts with exponential backoff
    - Integrate retry logic into DataRouter
    - Queue failed messages for retry
    - _Requirements: 3.3_

  - [x] 8.3 Write property test for ECU routing to configured targets
    - **Property 8: ECU Routing to Configured Targets**
    - **Validates: Requirements 3.1, 3.5**

  - [x] 8.4 Write property test for unmapped sensor handling
    - **Property 10: Unmapped Sensor Handling**
    - **Validates: Requirements 4.3**

  - [x] 8.5 Write property test for exponential backoff retry
    - **Property 9: Exponential Backoff Retry**
    - **Validates: Requirements 3.3**

- [x] 9. Checkpoint - Routing and configuration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Message persistence
  - [x] 10.1 Implement MessagePersistence for disk storage
    - Create src/services/message-persistence.ts
    - Implement persist() to write messages to disk
    - Implement markCompleted/markFailed status updates
    - Implement getPendingMessages() for recovery
    - _Requirements: 5.2, 5.3, 5.4, 5.6_

  - [x] 10.2 Implement message ordering per source
    - Track message sequence per sourceModelId
    - Process messages in order within each source
    - _Requirements: 5.5_

  - [x] 10.3 Write property test for persist before process
    - **Property 11: Persist Before Process**
    - **Validates: Requirements 5.2**

  - [x] 10.4 Write property test for failed message retention
    - **Property 12: Failed Message Retention**
    - **Validates: Requirements 5.4**

  - [x] 10.5 Write property test for message ordering per source
    - **Property 13: Message Ordering Per Source**
    - **Validates: Requirements 5.5**

- [x] 11. Health monitoring and metrics
  - [x] 11.1 Implement HealthMonitor with metrics tracking
    - Create src/services/health-monitor.ts
    - Implement getHealth() and getMetrics()
    - Track message throughput and latency
    - Implement alert threshold checking
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 11.2 Write unit tests for health monitoring
    - Test health status reporting
    - Test metrics accumulation
    - Test alert threshold triggering
    - _Requirements: 6.1, 6.3, 6.4_

- [x] 12. REST API and service wiring
  - [x] 12.1 Implement HTTP server with REST endpoints
    - Create src/index.ts as entry point
    - Implement POST /ingest for sensor data ingestion
    - Implement GET /subscribe for SSE connections
    - Implement GET /health for health checks
    - _Requirements: 1.1, 2.1, 6.1_

  - [x] 12.2 Wire all components together
    - Initialize all services with EventEmitter hub
    - Connect ingestion → persistence → routing → delivery
    - Set up config hot-reload
    - _Requirements: 5.1_

  - [x] 12.3 Write integration tests for end-to-end flow
    - Test sensor data ingestion to SSE delivery
    - Test ECU forwarding flow
    - Test service restart recovery
    - _Requirements: All_

- [x] 13. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including property tests are required for comprehensive coverage
- Each task references specific requirements for traceability
- Property tests use fast-check with minimum 100 iterations
- Checkpoints ensure incremental validation before proceeding
