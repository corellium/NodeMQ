/**
 * Feature: sensor-subscription-service, Property 1: Sensor Data Validation
 * Validates: Requirements 1.1, 1.2, 1.4
 * 
 * For any input payload, the validation function SHALL accept it if and only if
 * it contains all required fields (sensorId, sensorType, value, sourceModelId)
 * with correct types, and reject it otherwise with an appropriate error.
 */

import fc from 'fast-check';
import { validateSensorData, SensorData } from '../../src/types/sensor-data.js';

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

// Generator for invalid SensorData (missing required fields)
const invalidSensorDataMissingFieldsArb = fc.oneof(
  // Missing sensorId
  fc.record({
    sensorType: fc.string({ minLength: 1 }),
    value: fc.oneof(fc.float({ noNaN: true }), fc.string(), fc.boolean()),
    sourceModelId: fc.string({ minLength: 1 }),
  }),
  // Missing sensorType
  fc.record({
    sensorId: fc.string({ minLength: 1 }),
    value: fc.oneof(fc.float({ noNaN: true }), fc.string(), fc.boolean()),
    sourceModelId: fc.string({ minLength: 1 }),
  }),
  // Missing value
  fc.record({
    sensorId: fc.string({ minLength: 1 }),
    sensorType: fc.string({ minLength: 1 }),
    sourceModelId: fc.string({ minLength: 1 }),
  }),
  // Missing sourceModelId
  fc.record({
    sensorId: fc.string({ minLength: 1 }),
    sensorType: fc.string({ minLength: 1 }),
    value: fc.oneof(fc.float({ noNaN: true }), fc.string(), fc.boolean()),
  })
);

// Generator for invalid SensorData (empty required string fields)
const invalidSensorDataEmptyStringsArb = fc.oneof(
  // Empty sensorId
  fc.record({
    sensorId: fc.constant(''),
    sensorType: fc.string({ minLength: 1 }),
    value: fc.oneof(fc.float({ noNaN: true }), fc.string(), fc.boolean()),
    sourceModelId: fc.string({ minLength: 1 }),
  }),
  // Empty sensorType
  fc.record({
    sensorId: fc.string({ minLength: 1 }),
    sensorType: fc.constant(''),
    value: fc.oneof(fc.float({ noNaN: true }), fc.string(), fc.boolean()),
    sourceModelId: fc.string({ minLength: 1 }),
  }),
  // Empty sourceModelId
  fc.record({
    sensorId: fc.string({ minLength: 1 }),
    sensorType: fc.string({ minLength: 1 }),
    value: fc.oneof(fc.float({ noNaN: true }), fc.string(), fc.boolean()),
    sourceModelId: fc.constant(''),
  })
);

describe('Property 1: Sensor Data Validation', () => {
  it('should accept valid sensor data with all required fields', () => {
    fc.assert(
      fc.property(validSensorDataArb, (data) => {
        const result = validateSensorData(data);
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data?.sensorId).toBe(data.sensorId);
        expect(result.data?.sensorType).toBe(data.sensorType);
        expect(result.data?.sourceModelId).toBe(data.sourceModelId);
      }),
      { numRuns: 100 }
    );
  });

  it('should reject sensor data with missing required fields', () => {
    fc.assert(
      fc.property(invalidSensorDataMissingFieldsArb, (data) => {
        const result = validateSensorData(data);
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });

  it('should reject sensor data with empty required string fields', () => {
    fc.assert(
      fc.property(invalidSensorDataEmptyStringsArb, (data) => {
        const result = validateSensorData(data);
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });

  it('should reject non-object inputs', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null), fc.constant(undefined)),
        (data) => {
          const result = validateSensorData(data);
          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should accept all valid value types (number, string, boolean, object)', () => {
    const valueTypes = [
      fc.float({ noNaN: true }),
      fc.string(),
      fc.boolean(),
      fc.dictionary(fc.string(), fc.jsonValue()),
    ];

    valueTypes.forEach((valueArb, index) => {
      fc.assert(
        fc.property(
          fc.record({
            sensorId: fc.string({ minLength: 1 }),
            sensorType: fc.string({ minLength: 1 }),
            value: valueArb,
            sourceModelId: fc.string({ minLength: 1 }),
          }),
          (data) => {
            const result = validateSensorData(data);
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 25 }
      );
    });
  });
});
