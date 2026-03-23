/**
 * Feature: sensor-subscription-service, Property 6: Broadcast to All Subscribers
 * Validates: Requirements 2.6
 * 
 * For any topic with N subscribers and any message published to that topic,
 * all N subscribers SHALL receive the message.
 */

import fc from 'fast-check';
import { EventEmitter } from 'events';
import { TopicManager } from '../../src/services/topic-manager.js';
import { SSEConnectionManager, SSE_EVENT_TYPES } from '../../src/services/sse-connection-manager.js';

// Generator for valid topic segments (non-empty, no slashes, no wildcards)
const topicSegmentArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0 && !s.includes('/') && s !== '+' && s !== '#');

// Generator for client IDs
const clientIdArb = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);

// Generator for concrete topics (no wildcards)
const concreteTopicArb = fc
  .array(topicSegmentArb, { minLength: 1, maxLength: 5 })
  .map((parts) => parts.join('/'));

// Generator for message data
const messageDataArb = fc.record({
  value: fc.oneof(fc.float(), fc.string(), fc.boolean()),
  timestamp: fc.date().map((d) => d.toISOString()),
});

/**
 * Creates a mock ServerResponse for testing SSE.
 * Tracks written data and emits events.
 */
function createMockResponse(): {
  response: any;
  writtenData: string[];
  emitter: EventEmitter;
} {
  const emitter = new EventEmitter();
  const writtenData: string[] = [];
  
  const response = {
    writableEnded: false,
    writeHead: () => {},
    write: (data: string) => {
      writtenData.push(data);
      return true;
    },
    end: function() {
      this.writableEnded = true;
    },
    on: (event: string, handler: () => void) => {
      emitter.on(event, handler);
      return response;
    },
  };
  
  return { response, writtenData, emitter };
}

describe('Property 6: Broadcast to All Subscribers', () => {
  it('should deliver message to all N subscribers of a topic', () => {
    fc.assert(
      fc.property(
        fc.array(clientIdArb, { minLength: 1, maxLength: 10 }),
        concreteTopicArb,
        messageDataArb,
        (clientIds, topic, messageData) => {
          const topicManager = new TopicManager();
          const sseManager = new SSEConnectionManager(topicManager);
          
          // Ensure unique client IDs
          const uniqueClientIds = [...new Set(clientIds)];
          if (uniqueClientIds.length === 0) return;
          
          // Add all clients and subscribe them to the topic
          const mockResponses = new Map<string, ReturnType<typeof createMockResponse>>();
          
          for (const clientId of uniqueClientIds) {
            const mock = createMockResponse();
            mockResponses.set(clientId, mock);
            sseManager.addClient(clientId, mock.response);
            sseManager.subscribe(clientId, topic);
          }
          
          // Broadcast message to the topic
          const deliveredTo = sseManager.broadcast(topic, messageData);
          
          // Verify: all N subscribers received the message
          expect(deliveredTo.length).toBe(uniqueClientIds.length);
          expect(deliveredTo.sort()).toEqual(uniqueClientIds.sort());
          
          // Verify: each client's response received the data
          for (const clientId of uniqueClientIds) {
            const mock = mockResponses.get(clientId)!;
            expect(mock.writtenData.length).toBeGreaterThan(0);
            
            // Check that the message contains the sensor event type
            const lastWrite = mock.writtenData[mock.writtenData.length - 1];
            expect(lastWrite).toContain(`event: ${SSE_EVENT_TYPES.SENSOR}`);
            // Parse the data to verify it matches the sent data
            const dataMatch = lastWrite.match(/data: (.+)/);
            expect(dataMatch).not.toBeNull();
            const parsedData = JSON.parse(dataMatch![1]);
            expect(parsedData).toEqual(messageData);
          }
        }
      ),
      { numRuns: 100 }
    );
  });


  it('should deliver to all subscribers regardless of subscription order', () => {
    fc.assert(
      fc.property(
        fc.array(clientIdArb, { minLength: 2, maxLength: 5 }),
        concreteTopicArb,
        messageDataArb,
        (clientIds, topic, messageData) => {
          const topicManager = new TopicManager();
          const sseManager = new SSEConnectionManager(topicManager);
          
          // Ensure unique client IDs
          const uniqueClientIds = [...new Set(clientIds)];
          if (uniqueClientIds.length < 2) return;
          
          // Add clients in random order
          const mockResponses = new Map<string, ReturnType<typeof createMockResponse>>();
          
          for (const clientId of uniqueClientIds) {
            const mock = createMockResponse();
            mockResponses.set(clientId, mock);
            sseManager.addClient(clientId, mock.response);
            sseManager.subscribe(clientId, topic);
          }
          
          // Broadcast message
          const deliveredTo = sseManager.broadcast(topic, messageData);
          
          // All subscribers should receive regardless of order
          expect(deliveredTo.sort()).toEqual(uniqueClientIds.sort());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should deliver to subscribers with matching wildcard patterns', () => {
    fc.assert(
      fc.property(
        fc.array(clientIdArb, { minLength: 2, maxLength: 5 }),
        topicSegmentArb,
        topicSegmentArb,
        topicSegmentArb,
        messageDataArb,
        (clientIds, modelId, sensorType, sensorId, messageData) => {
          const topicManager = new TopicManager();
          const sseManager = new SSEConnectionManager(topicManager);
          
          // Ensure unique client IDs
          const uniqueClientIds = [...new Set(clientIds)];
          if (uniqueClientIds.length < 2) return;
          
          const mockResponses = new Map<string, ReturnType<typeof createMockResponse>>();
          const concreteTopic = `sensors/${modelId}/${sensorType}/${sensorId}`;
          
          // First client subscribes to exact topic
          const client1 = uniqueClientIds[0];
          const mock1 = createMockResponse();
          mockResponses.set(client1, mock1);
          sseManager.addClient(client1, mock1.response);
          sseManager.subscribe(client1, concreteTopic);
          
          // Second client subscribes to wildcard pattern
          const client2 = uniqueClientIds[1];
          const mock2 = createMockResponse();
          mockResponses.set(client2, mock2);
          sseManager.addClient(client2, mock2.response);
          sseManager.subscribe(client2, `sensors/${modelId}/#`);
          
          // Broadcast to concrete topic
          const deliveredTo = sseManager.broadcast(concreteTopic, messageData);
          
          // Both clients should receive the message
          expect(deliveredTo).toContain(client1);
          expect(deliveredTo).toContain(client2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should not deliver to clients subscribed to non-matching topics', () => {
    fc.assert(
      fc.property(
        clientIdArb,
        clientIdArb,
        topicSegmentArb,
        topicSegmentArb,
        messageDataArb,
        (client1, client2, topic1Prefix, topic2Prefix, messageData) => {
          fc.pre(client1 !== client2);
          fc.pre(topic1Prefix !== topic2Prefix);
          
          const topicManager = new TopicManager();
          const sseManager = new SSEConnectionManager(topicManager);
          
          // Client 1 subscribes to topic1
          const mock1 = createMockResponse();
          sseManager.addClient(client1, mock1.response);
          sseManager.subscribe(client1, `${topic1Prefix}/data`);
          
          // Client 2 subscribes to topic2
          const mock2 = createMockResponse();
          sseManager.addClient(client2, mock2.response);
          sseManager.subscribe(client2, `${topic2Prefix}/data`);
          
          // Broadcast to topic1 only
          const deliveredTo = sseManager.broadcast(`${topic1Prefix}/data`, messageData);
          
          // Only client1 should receive
          expect(deliveredTo).toContain(client1);
          expect(deliveredTo).not.toContain(client2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should track message delivery with messageId', () => {
    fc.assert(
      fc.property(
        fc.array(clientIdArb, { minLength: 1, maxLength: 5 }),
        concreteTopicArb,
        messageDataArb,
        fc.uuid(),
        (clientIds, topic, messageData, messageId) => {
          const topicManager = new TopicManager();
          const sseManager = new SSEConnectionManager(topicManager);
          
          // Ensure unique client IDs
          const uniqueClientIds = [...new Set(clientIds)];
          if (uniqueClientIds.length === 0) return;
          
          // Add all clients and subscribe them
          for (const clientId of uniqueClientIds) {
            const mock = createMockResponse();
            sseManager.addClient(clientId, mock.response);
            sseManager.subscribe(clientId, topic);
          }
          
          // Broadcast with messageId
          sseManager.broadcast(topic, messageData, messageId);
          
          // Verify delivery tracking
          for (const clientId of uniqueClientIds) {
            expect(sseManager.wasMessageDelivered(clientId, messageId)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
