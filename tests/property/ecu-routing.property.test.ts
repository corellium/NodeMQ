/**
 * Feature: sensor-subscription-service, Property 8: ECU Routing to Configured Targets
 * Validates: Requirements 3.1, 3.5
 *
 * For any sensor data with a configured ECU mapping, the Data_Router SHALL forward
 * the data to all configured chip select targets for that sensor type.
 */

import fc from 'fast-check';
import { DataRouter, ECUTarget, ECUForwarder } from '../../src/services/data-router.js';
import { ChipSelectConfig } from '../../src/services/config-manager.js';
import { IngestedMessage } from '../../src/types/ingested-message.js';
import { SensorData } from '../../src/types/sensor-data.js';

// Generator for valid sensor types (non-empty strings without special chars)
const sensorTypeArb = fc.string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0 && !s.includes('/'));

// Generator for valid model IDs
const modelIdArb = fc.string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0);

// Generator for valid sensor IDs
const sensorIdArb = fc.string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0);

// Generator for chip select addresses (valid range)
const chipSelectAddressArb = fc.integer({ min: 0, max: 255 });

// Generator for valid SensorData
const validSensorDataArb = (sensorType: string): fc.Arbitrary<SensorData> =>
  fc.record({
    sensorId: sensorIdArb,
    sensorType: fc.constant(sensorType),
    value: fc.oneof(
      fc.float({ noNaN: true }),
      fc.string(),
      fc.boolean()
    ),
    sourceModelId: modelIdArb,
  });

// Generator for IngestedMessage
const ingestedMessageArb = (sensorType: string): fc.Arbitrary<IngestedMessage> =>
  validSensorDataArb(sensorType).map((data) => ({
    messageId: `msg-${Math.random().toString(36).substring(7)}`,
    timestamp: new Date().toISOString(),
    data,
    topic: `sensors/${data.sourceModelId}/${data.sensorType}/${data.sensorId}`,
  }));

// Generator for ChipSelectConfig
const chipSelectConfigArb = (sensorTypes: string[]): fc.Arbitrary<ChipSelectConfig> =>
  fc.record({
    modelId: modelIdArb,
    chipSelectAddress: chipSelectAddressArb,
    sensorTypes: fc.constant(sensorTypes),
  });

// Generator for a set of chip select configs with specific sensor types
const chipSelectConfigsArb = (
  sensorTypes: string[],
  minConfigs: number = 1,
  maxConfigs: number = 5
): fc.Arbitrary<ChipSelectConfig[]> =>
  fc.array(chipSelectConfigArb(sensorTypes), { minLength: minConfigs, maxLength: maxConfigs });

describe('Property 8: ECU Routing to Configured Targets', () => {
  it('should forward sensor data to all configured ECU targets for that sensor type', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 1-3 sensor types
        fc.array(sensorTypeArb, { minLength: 1, maxLength: 3 })
          .chain((sensorTypes) => {
            // Generate 1-5 configs that include at least one of these sensor types
            return fc.tuple(
              fc.constant(sensorTypes),
              fc.array(
                fc.record({
                  modelId: modelIdArb,
                  chipSelectAddress: chipSelectAddressArb,
                  // Each config maps to a subset of the sensor types
                  sensorTypes: fc.shuffledSubarray(sensorTypes, { minLength: 1 }),
                }),
                { minLength: 1, maxLength: 5 }
              )
            );
          })
          .chain(([sensorTypes, configs]) => {
            // Pick one sensor type to test
            return fc.tuple(
              fc.constant(configs),
              fc.constantFrom(...sensorTypes)
            );
          })
          .chain(([configs, sensorType]) => {
            // Generate a message with that sensor type
            return fc.tuple(
              fc.constant(configs),
              fc.constant(sensorType),
              ingestedMessageArb(sensorType)
            );
          }),
        async ([configs, sensorType, message]) => {
          // Track which targets were forwarded to
          const forwardedTargets: ECUTarget[] = [];

          // Create a mock forwarder that tracks calls
          const mockForwarder: ECUForwarder = async (_msg, target) => {
            forwardedTargets.push(target);
          };

          const router = new DataRouter(mockForwarder, configs);

          // Forward the message
          const results = await router.forward(message);

          // Calculate expected targets for this sensor type
          const expectedTargets = configs
            .filter((c) => c.sensorTypes.includes(sensorType))
            .map((c) => ({
              modelId: c.modelId,
              chipSelectAddress: c.chipSelectAddress,
            }));

          // Verify all expected targets were forwarded to
          expect(forwardedTargets.length).toBe(expectedTargets.length);
          expect(results.length).toBe(expectedTargets.length);

          // Verify each expected target was hit
          for (const expected of expectedTargets) {
            const found = forwardedTargets.some(
              (t) =>
                t.modelId === expected.modelId &&
                t.chipSelectAddress === expected.chipSelectAddress
            );
            expect(found).toBe(true);
          }

          // Verify all results are successful
          for (const result of results) {
            expect(result.success).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should support multiple ECU targets per sensor type', async () => {
    await fc.assert(
      fc.asyncProperty(
        sensorTypeArb,
        fc.array(
          fc.record({
            modelId: modelIdArb,
            chipSelectAddress: chipSelectAddressArb,
          }),
          { minLength: 2, maxLength: 5 }
        ),
        async (sensorType, targetConfigs) => {
          // Create configs where all targets map to the same sensor type
          const configs: ChipSelectConfig[] = targetConfigs.map((t) => ({
            ...t,
            sensorTypes: [sensorType],
          }));

          const forwardedTargets: ECUTarget[] = [];
          const mockForwarder: ECUForwarder = async (_msg, target) => {
            forwardedTargets.push(target);
          };

          const router = new DataRouter(mockForwarder, configs);

          // Create a message with the sensor type
          const message: IngestedMessage = {
            messageId: 'test-msg',
            timestamp: new Date().toISOString(),
            data: {
              sensorId: 'sensor-1',
              sensorType,
              value: 42,
              sourceModelId: 'model-1',
            },
            topic: `sensors/model-1/${sensorType}/sensor-1`,
          };

          await router.forward(message);

          // All targets should have been forwarded to
          expect(forwardedTargets.length).toBe(targetConfigs.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should correctly identify targets for any sensor type', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            modelId: modelIdArb,
            chipSelectAddress: chipSelectAddressArb,
            sensorTypes: fc.array(sensorTypeArb, { minLength: 1, maxLength: 5 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        sensorTypeArb,
        (configs, querySensorType) => {
          const router = new DataRouter(async () => {}, configs);

          const targets = router.getTargetsForSensor(querySensorType);

          // Calculate expected targets manually
          const expectedTargets = configs
            .filter((c) => c.sensorTypes.includes(querySensorType))
            .map((c) => ({
              modelId: c.modelId,
              chipSelectAddress: c.chipSelectAddress,
            }));

          expect(targets.length).toBe(expectedTargets.length);

          // Verify each expected target is in the result
          for (const expected of expectedTargets) {
            const found = targets.some(
              (t) =>
                t.modelId === expected.modelId &&
                t.chipSelectAddress === expected.chipSelectAddress
            );
            expect(found).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
