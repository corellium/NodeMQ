/**
 * Feature: sensor-subscription-service, Property 13: Message Ordering Per Source
 * Validates: Requirements 5.5
 *
 * For any sequence of messages from the same sourceModelId, the messages
 * SHALL be processed in the order they were received.
 */

import fc from 'fast-check';
import * as fs from 'fs';
import { MessagePersistence } from '../../src/services/message-persistence.js';
import { IngestedMessage } from '../../src/types/ingested-message.js';
import { SensorData } from '../../src/types/sensor-data.js';

// Base test persistence path
const TEST_PERSISTENCE_BASE = './test-data/message-ordering';

// Generator for valid ISO datetime strings
const validDateTimeArb = fc
  .date({ min: new Date('2000-01-01'), max: new Date('2100-12-31') })
  .map((d) => d.toISOString());

// Generator for valid SensorData objects with a specific sourceModelId
const validSensorDataWithSourceArb = (sourceModelId: string): fc.Arbitrary<SensorData> =>
  fc.record({
    sensorId: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0 && !s.includes('/') && !s.includes('\\')),
    sensorType: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0 && !s.includes('/') && !s.includes('\\')),
    value: fc.oneof(
      fc.float({ noNaN: true, noDefaultInfinity: true }),
      fc.string(),
      fc.boolean()
    ),
    sourceModelId: fc.constant(sourceModelId),
    timestamp: fc.option(validDateTimeArb, { nil: undefined }),
    metadata: fc.option(fc.dictionary(fc.string(), fc.jsonValue()), { nil: undefined }),
  });

// Generator for valid IngestedMessage objects with a specific sourceModelId
const validIngestedMessageWithSourceArb = (sourceModelId: string): fc.Arbitrary<IngestedMessage> =>
  fc.record({
    messageId: fc.uuid(),
    timestamp: validDateTimeArb,
    data: validSensorDataWithSourceArb(sourceModelId),
    topic: fc.constant('sensors/test/temperature/sensor1'),
  }).map((msg) => ({
    ...msg,
    topic: `sensors/${msg.data.sourceModelId}/${msg.data.sensorType}/${msg.data.sensorId}`,
  }));

// Generator for a sequence of messages from the same source with unique IDs
const messageSequenceArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0 && !s.includes('/') && !s.includes('\\'))
  .chain((sourceModelId) =>
    fc.array(
      fc.record({
        messageId: fc.uuid(),
        timestamp: validDateTimeArb,
        data: validSensorDataWithSourceArb(sourceModelId),
        topic: fc.constant('sensors/test/temperature/sensor1'),
      }).map((msg) => ({
        ...msg,
        topic: `sensors/${msg.data.sourceModelId}/${msg.data.sensorType}/${msg.data.sensorId}`,
      })),
      { minLength: 2, maxLength: 5 }
    )
  );

// Helper to create a unique persistence path for each test run
let testCounter = 0;
function getUniquePersistencePath(): string {
  return `${TEST_PERSISTENCE_BASE}-${Date.now()}-${testCounter++}`;
}

describe('Property 13: Message Ordering Per Source', () => {
  afterAll(async () => {
    // Clean up all test directories
    try {
      const parentDir = './test-data';
      const entries = await fs.promises.readdir(parentDir);
      for (const entry of entries) {
        if (entry.startsWith('message-ordering')) {
          await fs.promises.rm(`${parentDir}/${entry}`, { recursive: true, force: true });
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should maintain insertion order when retrieving messages by source', async () => {
    await fc.assert(
      fc.asyncProperty(messageSequenceArb, async (messages) => {
        const testPath = getUniquePersistencePath();
        const persistence = new MessagePersistence(testPath);
        
        try {
          await persistence.initialize();

          // Persist messages in order
          for (const message of messages) {
            await persistence.persist(message);
          }

          // Get messages by source
          const sourceModelId = messages[0].data.sourceModelId;
          const retrieved = await persistence.getMessagesBySource(sourceModelId);

          // Should have same number of messages
          expect(retrieved.length).toBe(messages.length);

          // Should be in the same order as inserted
          for (let i = 0; i < messages.length; i++) {
            expect(retrieved[i].messageId).toBe(messages[i].messageId);
          }
        } finally {
          await persistence.clear();
          await fs.promises.rm(testPath, { recursive: true, force: true }).catch(() => {});
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should return next pending message in sequence order', async () => {
    await fc.assert(
      fc.asyncProperty(messageSequenceArb, async (messages) => {
        const testPath = getUniquePersistencePath();
        const persistence = new MessagePersistence(testPath);
        
        try {
          await persistence.initialize();

          // Persist messages in order
          for (const message of messages) {
            await persistence.persist(message);
          }

          const sourceModelId = messages[0].data.sourceModelId;

          // Get next pending - should be the first message
          const nextPending = await persistence.getNextPendingForSource(sourceModelId);
          expect(nextPending).not.toBeNull();
          expect(nextPending?.messageId).toBe(messages[0].messageId);
        } finally {
          await persistence.clear();
          await fs.promises.rm(testPath, { recursive: true, force: true }).catch(() => {});
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should return second message after first is completed', async () => {
    await fc.assert(
      fc.asyncProperty(messageSequenceArb, async (messages) => {
        const testPath = getUniquePersistencePath();
        const persistence = new MessagePersistence(testPath);
        
        try {
          await persistence.initialize();

          // Persist messages in order
          for (const message of messages) {
            await persistence.persist(message);
          }

          const sourceModelId = messages[0].data.sourceModelId;

          // Complete the first message
          await persistence.markCompleted(messages[0].messageId);

          // Get next pending - should be the second message
          const nextPending = await persistence.getNextPendingForSource(sourceModelId);
          
          if (messages.length > 1) {
            expect(nextPending).not.toBeNull();
            expect(nextPending?.messageId).toBe(messages[1].messageId);
          } else {
            expect(nextPending).toBeNull();
          }
        } finally {
          await persistence.clear();
          await fs.promises.rm(testPath, { recursive: true, force: true }).catch(() => {});
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve order across multiple sources', async () => {
    const testPath = getUniquePersistencePath();
    const persistence = new MessagePersistence(testPath);
    
    try {
      await persistence.initialize();

      // Generate messages for two different sources
      const source1Messages = await fc.sample(
        validIngestedMessageWithSourceArb('source-1'),
        3
      );
      const source2Messages = await fc.sample(
        validIngestedMessageWithSourceArb('source-2'),
        3
      );

      // Interleave messages from both sources
      for (let i = 0; i < 3; i++) {
        await persistence.persist(source1Messages[i]);
        await persistence.persist(source2Messages[i]);
      }

      // Verify order for source 1
      const retrieved1 = await persistence.getMessagesBySource('source-1');
      expect(retrieved1.length).toBe(3);
      for (let i = 0; i < 3; i++) {
        expect(retrieved1[i].messageId).toBe(source1Messages[i].messageId);
      }

      // Verify order for source 2
      const retrieved2 = await persistence.getMessagesBySource('source-2');
      expect(retrieved2.length).toBe(3);
      for (let i = 0; i < 3; i++) {
        expect(retrieved2[i].messageId).toBe(source2Messages[i].messageId);
      }
    } finally {
      await persistence.clear();
      await fs.promises.rm(testPath, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('should track sequence numbers correctly', async () => {
    await fc.assert(
      fc.asyncProperty(messageSequenceArb, async (messages) => {
        const testPath = getUniquePersistencePath();
        const persistence = new MessagePersistence(testPath);
        
        try {
          await persistence.initialize();

          // Persist messages in order
          for (const message of messages) {
            await persistence.persist(message);
          }

          const sourceModelId = messages[0].data.sourceModelId;

          // Get source sequence
          const sequence = await persistence.getSourceSequence(sourceModelId);
          expect(sequence).not.toBeNull();
          expect(sequence?.lastSequence).toBe(messages.length);
          expect(sequence?.messageIds.length).toBe(messages.length);

          // Verify message IDs are in order
          for (let i = 0; i < messages.length; i++) {
            expect(sequence?.messageIds[i]).toBe(messages[i].messageId);
          }
        } finally {
          await persistence.clear();
          await fs.promises.rm(testPath, { recursive: true, force: true }).catch(() => {});
        }
      }),
      { numRuns: 100 }
    );
  });
});
