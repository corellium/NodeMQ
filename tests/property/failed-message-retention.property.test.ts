/**
 * Feature: sensor-subscription-service, Property 12: Failed Message Retention
 * Validates: Requirements 5.4
 *
 * For any message whose processing fails, the message SHALL remain in the
 * persistence store with a 'failed' or 'pending' status for retry.
 */

import fc from 'fast-check';
import * as fs from 'fs';
import { MessagePersistence } from '../../src/services/message-persistence.js';
import { IngestedMessage } from '../../src/types/ingested-message.js';
import { SensorData } from '../../src/types/sensor-data.js';

// Test persistence path
const TEST_PERSISTENCE_PATH = './test-data/failed-message-retention';

// Generator for valid ISO datetime strings
const validDateTimeArb = fc
  .date({ min: new Date('2000-01-01'), max: new Date('2100-12-31') })
  .map((d) => d.toISOString());

// Generator for valid SensorData objects
const validSensorDataArb: fc.Arbitrary<SensorData> = fc.record({
  sensorId: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0 && !s.includes('/') && !s.includes('\\')),
  sensorType: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0 && !s.includes('/') && !s.includes('\\')),
  value: fc.oneof(
    fc.float({ noNaN: true, noDefaultInfinity: true }),
    fc.string(),
    fc.boolean()
  ),
  sourceModelId: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0 && !s.includes('/') && !s.includes('\\')),
  timestamp: fc.option(validDateTimeArb, { nil: undefined }),
  metadata: fc.option(fc.dictionary(fc.string(), fc.jsonValue()), { nil: undefined }),
});

// Generator for valid IngestedMessage objects
const validIngestedMessageArb: fc.Arbitrary<IngestedMessage> = fc.record({
  messageId: fc.uuid(),
  timestamp: validDateTimeArb,
  data: validSensorDataArb,
  topic: fc.constant('sensors/test/temperature/sensor1'),
}).map((msg) => ({
  ...msg,
  topic: `sensors/${msg.data.sourceModelId}/${msg.data.sensorType}/${msg.data.sensorId}`,
}));

describe('Property 12: Failed Message Retention', () => {
  let persistence: MessagePersistence;

  beforeEach(async () => {
    persistence = new MessagePersistence(TEST_PERSISTENCE_PATH);
    await persistence.initialize();
    await persistence.clear();
  });

  afterEach(async () => {
    await persistence.clear();
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      await persistence.clear();
      await fs.promises.rm(TEST_PERSISTENCE_PATH, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should retain message with failed status after markFailed', async () => {
    await fc.assert(
      fc.asyncProperty(validIngestedMessageArb, async (message) => {
        // Persist the message
        await persistence.persist(message);

        // Mark as failed (simulating processing failure)
        await persistence.markFailed(message.messageId);

        // Verify message still exists
        const retrieved = await persistence.getMessage(message.messageId);
        expect(retrieved).not.toBeNull();
        expect(retrieved?.status).toBe('failed');
        expect(retrieved?.messageId).toBe(message.messageId);
      }),
      { numRuns: 100 }
    );
  });

  it('should increment retry count when marking as failed', async () => {
    await fc.assert(
      fc.asyncProperty(validIngestedMessageArb, async (message) => {
        // Persist the message
        await persistence.persist(message);

        // Initial retry count should be 0
        let retrieved = await persistence.getMessage(message.messageId);
        expect(retrieved?.retryCount).toBe(0);

        // Mark as failed
        await persistence.markFailed(message.messageId);

        // Retry count should be incremented
        retrieved = await persistence.getMessage(message.messageId);
        expect(retrieved?.retryCount).toBe(1);
      }),
      { numRuns: 100 }
    );
  });

  it('should include failed messages in getPendingMessages for retry', async () => {
    await fc.assert(
      fc.asyncProperty(validIngestedMessageArb, async (message) => {
        // Persist and mark as failed
        await persistence.persist(message);
        await persistence.markFailed(message.messageId);

        // Get pending messages (should include failed for retry)
        const pending = await persistence.getPendingMessages();

        // Should include our failed message
        const found = pending.find((m) => m.messageId === message.messageId);
        expect(found).toBeDefined();
        expect(found?.status).toBe('failed');
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve message data after failure', async () => {
    await fc.assert(
      fc.asyncProperty(validIngestedMessageArb, async (message) => {
        // Persist the message
        await persistence.persist(message);

        // Mark as failed
        await persistence.markFailed(message.messageId);

        // Verify original data is preserved
        const retrieved = await persistence.getMessage(message.messageId);
        expect(retrieved?.data.messageId).toBe(message.messageId);
        expect(retrieved?.data.data.sensorId).toBe(message.data.sensorId);
        expect(retrieved?.data.data.sensorType).toBe(message.data.sensorType);
        expect(retrieved?.data.data.sourceModelId).toBe(message.data.sourceModelId);
      }),
      { numRuns: 100 }
    );
  });

  it('should not remove failed messages from disk', async () => {
    await fc.assert(
      fc.asyncProperty(validIngestedMessageArb, async (message) => {
        // Persist and mark as failed
        await persistence.persist(message);
        await persistence.markFailed(message.messageId);

        // Create a new persistence instance (simulating service restart)
        const newPersistence = new MessagePersistence(TEST_PERSISTENCE_PATH);
        await newPersistence.initialize();

        // Message should still be recoverable
        const retrieved = await newPersistence.getMessage(message.messageId);
        expect(retrieved).not.toBeNull();
        expect(retrieved?.status).toBe('failed');
      }),
      { numRuns: 100 }
    );
  });
});
