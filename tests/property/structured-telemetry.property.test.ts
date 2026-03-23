/**
 * Feature: struct-telemetry-subscriptions, Property: Structured Telemetry Ingestion
 * Validates: Requirements 9.1, 9.2, 9.3
 *
 * For any structured telemetry payload from the C library (with numeric timestamp
 * and structured value object), NodeMQ SHALL:
 * - Accept the payload through validation
 * - Parse the structured value object fields correctly
 * - Pass the full value object through to SSE clients intact
 */

import fc from 'fast-check';
import {
  validateSensorData,
  parseStructuredSampleValue,
  StructuredSampleValue,
} from '../../src/types/sensor-data.js';
import { createIngestedMessage, buildTopic } from '../../src/types/ingested-message.js';

// Generator for structured sample value objects matching the C library format
const structuredSampleValueArb: fc.Arbitrary<StructuredSampleValue> = fc.record({
  measurement: fc.float({ noNaN: true, noDefaultInfinity: true }),
  min: fc.integer({ min: 0, max: 65535 }),
  tag: fc.integer({ min: 0, max: 255 }),
  units: fc.stringOf(fc.constantFrom('nA', 'mV', 'Ohm', 'degC', 'Hz', '%', 'V', 'uA')),
  timestamp: fc.float({ noNaN: true, noDefaultInfinity: true, min: 0 }),
  bytes: fc.tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 })
  ),
  type: fc.option(
    fc.constantFrom('replay', 'fifoPush'),
    { nil: undefined }
  ),
  deviceBus: fc.option(
    fc.constantFrom('spi0', 'spi1', 'i2c0', 'i2c1', 'can0', 'uart0'),
    { nil: undefined }
  ),
});

// Generator for a full structured telemetry payload as sent by the C library
const structuredPayloadArb = fc.record({
  sensorId: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
  sourceModelId: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
  sensorType: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
  timestamp: fc.integer({ min: 0, max: 2_000_000_000_000 }),
  value: structuredSampleValueArb.map((v) => v as Record<string, unknown>),
  deviceBus: fc.option(
    fc.constantFrom('spi0', 'spi1', 'i2c0', 'i2c1'),
    { nil: undefined }
  ),
});

describe('Structured Telemetry Ingestion', () => {
  describe('Numeric timestamp acceptance', () => {
    it('should accept payloads with numeric timestamps (milliseconds)', () => {
      fc.assert(
        fc.property(structuredPayloadArb, (payload) => {
          const result = validateSensorData(payload);
          expect(result.success).toBe(true);
          expect(result.data).toBeDefined();
          expect(result.data?.timestamp).toBe(payload.timestamp);
        }),
        { numRuns: 200 }
      );
    });

    it('should accept payloads with ISO string timestamps', () => {
      const isoPayloadArb = fc.record({
        sensorId: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        sourceModelId: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        sensorType: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        timestamp: fc
          .date({ min: new Date('2000-01-01'), max: new Date('2100-12-31') })
          .map((d) => d.toISOString()),
        value: fc.float({ noNaN: true }),
      });

      fc.assert(
        fc.property(isoPayloadArb, (payload) => {
          const result = validateSensorData(payload);
          expect(result.success).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should accept payloads with no timestamp', () => {
      const noTimestampArb = fc.record({
        sensorId: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        sourceModelId: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        sensorType: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        value: fc.float({ noNaN: true }),
      });

      fc.assert(
        fc.property(noTimestampArb, (payload) => {
          const result = validateSensorData(payload);
          expect(result.success).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Structured value object validation', () => {
    it('should parse valid structured sample values', () => {
      fc.assert(
        fc.property(structuredSampleValueArb, (sampleValue) => {
          const parsed = parseStructuredSampleValue(sampleValue);
          expect(parsed).toBeDefined();
          expect(parsed?.min).toBe(sampleValue.min);
          expect(parsed?.tag).toBe(sampleValue.tag);
          expect(parsed?.units).toBe(sampleValue.units);
          expect(parsed?.timestamp).toBe(sampleValue.timestamp);
          expect(parsed?.bytes).toEqual(sampleValue.bytes);
          expect(parsed?.deviceBus).toBe(sampleValue.deviceBus);
        }),
        { numRuns: 200 }
      );
    });

    it('should return undefined for non-structured values', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.float({ noNaN: true }),
            fc.string(),
            fc.boolean(),
            fc.constant(null)
          ),
          (value) => {
            const parsed = parseStructuredSampleValue(value as any);
            expect(parsed).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('End-to-end structured payload flow', () => {
    it('should create IngestedMessage with correct topic from structured payload', () => {
      fc.assert(
        fc.property(structuredPayloadArb, (payload) => {
          const result = validateSensorData(payload);
          expect(result.success).toBe(true);

          const data = result.data!;
          const message = createIngestedMessage(data, 'test-msg-id');

          // Topic should include deviceBus
          const expectedTopic = buildTopic(
            data.sourceModelId,
            data.sensorType,
            data.sensorId,
            data.deviceBus
          );
          expect(message.topic).toBe(expectedTopic);

          // The value object should be passed through intact
          expect(message.data.value).toEqual(payload.value);
        }),
        { numRuns: 200 }
      );
    });

    it('should preserve all structured value fields through ingestion', () => {
      fc.assert(
        fc.property(structuredPayloadArb, (payload) => {
          const result = validateSensorData(payload);
          expect(result.success).toBe(true);

          const data = result.data!;
          const message = createIngestedMessage(data, 'test-msg-id');

          // Parse the value back as a structured sample
          const parsed = parseStructuredSampleValue(message.data.value);
          expect(parsed).toBeDefined();
          expect(parsed?.units).toBe(
            (payload.value as Record<string, unknown>).units
          );
        }),
        { numRuns: 200 }
      );
    });
  });
});
