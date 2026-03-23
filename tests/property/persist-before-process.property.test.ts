/**
 * Feature: sensor-subscription-service, Property 11: Persist Before Process
 * Validates: Requirements 5.2
 *
 * For any sensor data received by the service, the data SHALL be persisted
 * to disk before the processing completion is signaled.
 */

import fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import { MessagePersistence } from '../../src/services/message-persistence.js';
import { IngestedMessage } from '../../src/types/ingested-message.js';
import { SensorData } from '../../src/types/sensor-data.js';

// Test persistence path
const TEST_PERSISTENCE_PATH = './test-data/persist-before-process';

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

describe('Property 11: Persist Before Process', () => {
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

  it('should persist message to disk before returning success', async () => {
    await fc.assert(
      fc.asyncProperty(validIngestedMessageArb, async (message) => {
        // Persist the message
        const result = await persistence.persist(message);

        // Verify persist succeeded
        expect(result.success).toBe(true);
        expect(result.messageId).toBe(message.messageId);

        // Verify message exists on disk AFTER persist returns
        const filePath = path.join(
          TEST_PERSISTENCE_PATH,
          'messages',
          `${message.messageId}.json`
        );
        const fileExists = fs.existsSync(filePath);
        expect(fileExists).toBe(true);

        // Verify the persisted content matches
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const persisted = JSON.parse(content);
        expect(persisted.messageId).toBe(message.messageId);
        expect(persisted.status).toBe('pending');
        expect(persisted.data.messageId).toBe(message.messageId);
      }),
      { numRuns: 100 }
    );
  });

  it('should have pending status immediately after persist', async () => {
    await fc.assert(
      fc.asyncProperty(validIngestedMessageArb, async (message) => {
        // Persist the message
        await persistence.persist(message);

        // Retrieve the message
        const retrieved = await persistence.getMessage(message.messageId);

        // Should exist and be pending
        expect(retrieved).not.toBeNull();
        expect(retrieved?.status).toBe('pending');
        expect(retrieved?.data.messageId).toBe(message.messageId);
      }),
      { numRuns: 100 }
    );
  });

  it('should be recoverable from getPendingMessages after persist', async () => {
    await fc.assert(
      fc.asyncProperty(validIngestedMessageArb, async (message) => {
        // Persist the message
        await persistence.persist(message);

        // Get pending messages
        const pending = await persistence.getPendingMessages();

        // Should include our message
        const found = pending.find((m) => m.messageId === message.messageId);
        expect(found).toBeDefined();
        expect(found?.status).toBe('pending');
      }),
      { numRuns: 100 }
    );
  });

  it('should persist data before any status update can occur', async () => {
    await fc.assert(
      fc.asyncProperty(validIngestedMessageArb, async (message) => {
        // Persist the message
        const persistResult = await persistence.persist(message);
        expect(persistResult.success).toBe(true);

        // Immediately try to mark as processing (simulating processing start)
        await persistence.markProcessing(message.messageId);

        // Verify the message was persisted first (status should now be processing)
        const retrieved = await persistence.getMessage(message.messageId);
        expect(retrieved).not.toBeNull();
        expect(retrieved?.status).toBe('processing');

        // The fact that markProcessing succeeded proves persist happened first
        // because markProcessing reads and updates the persisted file
      }),
      { numRuns: 100 }
    );
  });
});
