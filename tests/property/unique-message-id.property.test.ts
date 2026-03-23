/**
 * Feature: sensor-subscription-service, Property 2: Unique Message Identification
 * Validates: Requirements 1.3
 * 
 * For any set of valid sensor data payloads ingested by the service,
 * each resulting IngestedMessage SHALL have a unique messageId that is
 * different from all other message IDs in the system.
 */

import fc from 'fast-check';
import { SensorIngestionService } from '../../src/services/sensor-ingestion-service.js';

// Generator for valid ISO datetime strings (within reasonable date range)
const validDateTimeArb = fc
  .date({ min: new Date('2000-01-01'), max: new Date('2100-12-31') })
  .map((d) => d.toISOString());

// Generator for valid SensorData objects
const validSensorDataArb = fc.record({
  sensorId: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  sensorType: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  value: fc.oneof(
    fc.float({ noNaN: true }),
    fc.string(),
    fc.boolean(),
    fc.dictionary(fc.string(), fc.jsonValue())
  ),
  sourceModelId: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  timestamp: fc.option(validDateTimeArb, { nil: undefined }),
  metadata: fc.option(fc.dictionary(fc.string(), fc.jsonValue()), { nil: undefined }),
});

// Generator for arrays of valid sensor data (2-50 items)
const validSensorDataArrayArb = fc.array(validSensorDataArb, { minLength: 2, maxLength: 50 });

describe('Property 2: Unique Message Identification', () => {
  it('should generate unique message IDs for all ingested sensor data', () => {
    fc.assert(
      fc.property(validSensorDataArrayArb, (dataArray) => {
        const service = new SensorIngestionService();
        const results = dataArray.map((data) => service.ingest(data));
        
        // Filter successful ingestions
        const successfulResults = results.filter((r) => r.success);
        const messageIds = successfulResults.map((r) => r.messageId);
        
        // All message IDs should be unique
        const uniqueIds = new Set(messageIds);
        expect(uniqueIds.size).toBe(messageIds.length);
      }),
      { numRuns: 100 }
    );
  });

  it('should generate unique message IDs across multiple service instances', () => {
    fc.assert(
      fc.property(validSensorDataArb, validSensorDataArb, (data1, data2) => {
        const service1 = new SensorIngestionService();
        const service2 = new SensorIngestionService();
        
        const result1 = service1.ingest(data1);
        const result2 = service2.ingest(data2);
        
        // Both should succeed
        expect(result1.success).toBe(true);
        expect(result2.success).toBe(true);
        
        // Message IDs should be different even across instances
        expect(result1.messageId).not.toBe(result2.messageId);
      }),
      { numRuns: 100 }
    );
  });

  it('should track all generated message IDs within a service instance', () => {
    fc.assert(
      fc.property(validSensorDataArrayArb, (dataArray) => {
        const service = new SensorIngestionService();
        const results = dataArray.map((data) => service.ingest(data));
        
        // All successful message IDs should be tracked
        const successfulResults = results.filter((r) => r.success);
        for (const result of successfulResults) {
          expect(service.hasGeneratedMessageId(result.messageId!)).toBe(true);
        }
        
        // The count of tracked IDs should match successful ingestions
        expect(service.getGeneratedMessageIds().size).toBe(successfulResults.length);
      }),
      { numRuns: 100 }
    );
  });

  it('should generate non-empty message IDs', () => {
    fc.assert(
      fc.property(validSensorDataArb, (data) => {
        const service = new SensorIngestionService();
        const result = service.ingest(data);
        
        expect(result.success).toBe(true);
        expect(result.messageId).toBeDefined();
        expect(result.messageId!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should include the message ID in the IngestedMessage', () => {
    fc.assert(
      fc.property(validSensorDataArb, (data) => {
        const service = new SensorIngestionService();
        const result = service.ingest(data);
        
        expect(result.success).toBe(true);
        expect(result.message).toBeDefined();
        expect(result.message!.messageId).toBe(result.messageId);
      }),
      { numRuns: 100 }
    );
  });
});
