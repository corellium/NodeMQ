/**
 * Feature: sensor-subscription-service, Property 14: Serialization Round-Trip
 * Validates: Requirements 7.1, 7.2, 7.3
 * 
 * For any valid SensorData object, serializing to JSON and then deserializing
 * SHALL produce an object equivalent to the original.
 */

import fc from 'fast-check';
import {
  SensorData,
  serializeSensorData,
  deserializeSensorData,
} from '../../src/types/sensor-data.js';

// Generator for valid ISO datetime strings (within reasonable date range)
const validDateTimeArb = fc
  .date({ min: new Date('2000-01-01'), max: new Date('2100-12-31') })
  .map((d) => d.toISOString());

// Generator for safe dictionary keys (excluding __proto__ which has special behavior in JS)
const safeDictKeyArb = fc.string().filter((s) => s !== '__proto__' && s !== 'constructor' && s !== 'prototype');

// Generator for valid SensorData objects
const validSensorDataArb: fc.Arbitrary<SensorData> = fc.record({
  sensorId: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  sensorType: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  value: fc.oneof(
    fc.float({ noNaN: true, noDefaultInfinity: true }),
    fc.string(),
    fc.boolean(),
    fc.dictionary(safeDictKeyArb, fc.jsonValue())
  ),
  sourceModelId: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  timestamp: fc.option(validDateTimeArb, { nil: undefined }),
  metadata: fc.option(fc.dictionary(safeDictKeyArb, fc.jsonValue()), { nil: undefined }),
});

/**
 * Deep equality check for SensorData objects.
 * Handles undefined vs missing keys and floating point comparison.
 */
function sensorDataEquals(a: SensorData, b: SensorData): boolean {
  if (a.sensorId !== b.sensorId) return false;
  if (a.sensorType !== b.sensorType) return false;
  if (a.sourceModelId !== b.sourceModelId) return false;
  
  // Compare values - handle object comparison
  if (typeof a.value !== typeof b.value) return false;
  if (typeof a.value === 'object' && a.value !== null) {
    if (JSON.stringify(a.value) !== JSON.stringify(b.value)) return false;
  } else if (a.value !== b.value) {
    return false;
  }
  
  // Compare optional timestamp
  if (a.timestamp !== b.timestamp) return false;
  
  // Compare optional metadata
  if (a.metadata === undefined && b.metadata === undefined) {
    return true;
  }
  if (a.metadata === undefined || b.metadata === undefined) {
    return false;
  }
  if (JSON.stringify(a.metadata) !== JSON.stringify(b.metadata)) {
    return false;
  }
  
  return true;
}

describe('Property 14: Serialization Round-Trip', () => {
  it('should produce equivalent object after serialize then deserialize', () => {
    fc.assert(
      fc.property(validSensorDataArb, (original) => {
        // Serialize to JSON
        const json = serializeSensorData(original);
        
        // Deserialize back
        const result = deserializeSensorData(json);
        
        // Should succeed
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        
        // Should be equivalent to original
        const deserialized = result.data!;
        expect(sensorDataEquals(original, deserialized)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve all required fields through round-trip', () => {
    fc.assert(
      fc.property(validSensorDataArb, (original) => {
        const json = serializeSensorData(original);
        const result = deserializeSensorData(json);
        
        expect(result.success).toBe(true);
        expect(result.data?.sensorId).toBe(original.sensorId);
        expect(result.data?.sensorType).toBe(original.sensorType);
        expect(result.data?.sourceModelId).toBe(original.sourceModelId);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve value type through round-trip', () => {
    fc.assert(
      fc.property(validSensorDataArb, (original) => {
        const json = serializeSensorData(original);
        const result = deserializeSensorData(json);
        
        expect(result.success).toBe(true);
        expect(typeof result.data?.value).toBe(typeof original.value);
      }),
      { numRuns: 100 }
    );
  });

  it('should produce valid JSON string', () => {
    fc.assert(
      fc.property(validSensorDataArb, (original) => {
        const json = serializeSensorData(original);
        
        // Should be valid JSON
        expect(() => JSON.parse(json)).not.toThrow();
        
        // Should be a string
        expect(typeof json).toBe('string');
      }),
      { numRuns: 100 }
    );
  });

  it('should reject invalid JSON strings', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => {
          try {
            JSON.parse(s);
            return false; // Valid JSON, skip
          } catch {
            return true; // Invalid JSON, keep
          }
        }),
        (invalidJson) => {
          const result = deserializeSensorData(invalidJson);
          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});
