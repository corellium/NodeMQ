/**
 * Feature: sensor-subscription-service, Property 10: Unmapped Sensor Handling
 * Validates: Requirements 4.3
 *
 * For any sensor data whose sensor type has no configured ECU mapping,
 * the Data_Router SHALL not attempt to forward to any ECU target.
 */

import fc from 'fast-check';
import { DataRouter, ECUTarget, ECUForwarder } from '../../src/services/data-router.js';
import { ChipSelectConfig } from '../../src/services/config-manager.js';
import { IngestedMessage } from '../../src/types/ingested-message.js';

// Generator for valid sensor types (non-empty strings without special chars)
const sensorTypeArb = fc.string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0 && !s.includes('/'));

// Generator for valid model IDs
const modelIdArb = fc.string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0);

// Generator for chip select addresses (valid range)
const chipSelectAddressArb = fc.integer({ min: 0, max: 255 });

// Generator for IngestedMessage with a specific sensor type
const ingestedMessageArb = (sensorType: string): fc.Arbitrary<IngestedMessage> =>
  fc.record({
    messageId: fc.string({ minLength: 1 }),
    timestamp: fc.date().map((d) => d.toISOString()),
    data: fc.record({
      sensorId: fc.string({ minLength: 1 }),
      sensorType: fc.constant(sensorType),
      value: fc.oneof(fc.float({ noNaN: true }), fc.string(), fc.boolean()),
      sourceModelId: modelIdArb,
    }),
    topic: fc.constant(`sensors/model/${sensorType}/sensor`),
  });

describe('Property 10: Unmapped Sensor Handling', () => {
  it('should not forward sensor data when sensor type has no ECU mapping', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a set of configured sensor types
        fc.array(sensorTypeArb, { minLength: 1, maxLength: 5 }),
        // Generate an unmapped sensor type (different from configured ones)
        sensorTypeArb,
        async (configuredTypes, unmappedType) => {
          // Ensure unmapped type is actually not in configured types
          const actualUnmappedType = configuredTypes.includes(unmappedType)
            ? `${unmappedType}_unmapped`
            : unmappedType;

          // Create configs for the configured types
          const configs: ChipSelectConfig[] = configuredTypes.map((type, i) => ({
            modelId: `model-${i}`,
            chipSelectAddress: i,
            sensorTypes: [type],
          }));

          // Track forwarding attempts
          let forwardAttempts = 0;
          const mockForwarder: ECUForwarder = async () => {
            forwardAttempts++;
          };

          const router = new DataRouter(mockForwarder, configs);

          // Create a message with the unmapped sensor type
          const message: IngestedMessage = {
            messageId: 'test-msg',
            timestamp: new Date().toISOString(),
            data: {
              sensorId: 'sensor-1',
              sensorType: actualUnmappedType,
              value: 42,
              sourceModelId: 'model-1',
            },
            topic: `sensors/model-1/${actualUnmappedType}/sensor-1`,
          };

          const results = await router.forward(message);

          // No forwarding should have occurred
          expect(forwardAttempts).toBe(0);
          expect(results.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should emit unmappedSensor event when sensor type has no mapping', async () => {
    await fc.assert(
      fc.asyncProperty(
        sensorTypeArb,
        async (unmappedType) => {
          // Create router with no configs
          const router = new DataRouter(async () => {}, []);

          // Track unmapped sensor events
          let unmappedEventFired = false;
          let eventSensorType: string | null = null;

          router.on('unmappedSensor', (sensorType) => {
            unmappedEventFired = true;
            eventSensorType = sensorType;
          });

          const message: IngestedMessage = {
            messageId: 'test-msg',
            timestamp: new Date().toISOString(),
            data: {
              sensorId: 'sensor-1',
              sensorType: unmappedType,
              value: 42,
              sourceModelId: 'model-1',
            },
            topic: `sensors/model-1/${unmappedType}/sensor-1`,
          };

          await router.forward(message);

          expect(unmappedEventFired).toBe(true);
          expect(eventSensorType).toBe(unmappedType);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return empty results for unmapped sensor types', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate configs with specific sensor types
        fc.array(
          fc.record({
            modelId: modelIdArb,
            chipSelectAddress: chipSelectAddressArb,
            sensorTypes: fc.array(sensorTypeArb, { minLength: 1, maxLength: 3 }),
          }),
          { minLength: 0, maxLength: 5 }
        ),
        sensorTypeArb,
        async (configs, querySensorType) => {
          // Get all configured sensor types
          const allConfiguredTypes = new Set(
            configs.flatMap((c) => c.sensorTypes)
          );

          // Only test if the query type is actually unmapped
          if (allConfiguredTypes.has(querySensorType)) {
            return; // Skip this case - sensor type is mapped
          }

          const router = new DataRouter(async () => {}, configs);

          const message: IngestedMessage = {
            messageId: 'test-msg',
            timestamp: new Date().toISOString(),
            data: {
              sensorId: 'sensor-1',
              sensorType: querySensorType,
              value: 42,
              sourceModelId: 'model-1',
            },
            topic: `sensors/model-1/${querySensorType}/sensor-1`,
          };

          const results = await router.forward(message);

          // Results should be empty for unmapped sensor types
          expect(results).toEqual([]);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should correctly report no mapping exists via hasMappingForSensor', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            modelId: modelIdArb,
            chipSelectAddress: chipSelectAddressArb,
            sensorTypes: fc.array(sensorTypeArb, { minLength: 1, maxLength: 3 }),
          }),
          { minLength: 0, maxLength: 5 }
        ),
        sensorTypeArb,
        (configs, querySensorType) => {
          const router = new DataRouter(async () => {}, configs);

          // Get all configured sensor types
          const allConfiguredTypes = new Set(
            configs.flatMap((c) => c.sensorTypes)
          );

          const hasMapping = router.hasMappingForSensor(querySensorType);
          const expectedHasMapping = allConfiguredTypes.has(querySensorType);

          expect(hasMapping).toBe(expectedHasMapping);
        }
      ),
      { numRuns: 100 }
    );
  });
});
