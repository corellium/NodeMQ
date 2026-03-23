/**
 * Feature: sensor-subscription-service, Property 5: Disconnect Cleanup
 * Validates: Requirements 2.4
 * 
 * For any client that disconnects, all of its subscriptions SHALL be removed
 * and the client SHALL not appear in any subscriber lists.
 */

import fc from 'fast-check';
import { EventEmitter } from 'events';
import { TopicManager } from '../../src/services/topic-manager.js';
import { SSEConnectionManager } from '../../src/services/sse-connection-manager.js';

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

describe('Property 5: Disconnect Cleanup', () => {
  it('should remove all subscriptions when client disconnects', () => {
    fc.assert(
      fc.property(
        clientIdArb,
        fc.array(concreteTopicArb, { minLength: 1, maxLength: 5 }),
        messageDataArb,
        (clientId, topics, messageData) => {
          // Ensure unique topics
          const uniqueTopics = [...new Set(topics)];
          if (uniqueTopics.length === 0) return;
          
          const topicManager = new TopicManager();
          const sseManager = new SSEConnectionManager(topicManager);
          
          const mock = createMockResponse();
          sseManager.addClient(clientId, mock.response);
          
          // Subscribe to all topics
          for (const topic of uniqueTopics) {
            sseManager.subscribe(clientId, topic);
          }
          
          // Verify subscriptions exist
          for (const topic of uniqueTopics) {
            const subscribers = topicManager.getMatchingSubscribers(topic);
            expect(subscribers).toContain(clientId);
          }
          
          // Simulate disconnect by triggering close event
          mock.emitter.emit('close');
          
          // Verify all subscriptions are removed
          for (const topic of uniqueTopics) {
            const subscribers = topicManager.getMatchingSubscribers(topic);
            expect(subscribers).not.toContain(clientId);
          }
          
          // Verify client is no longer tracked
          expect(sseManager.hasClient(clientId)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });


  it('should not deliver messages to disconnected clients', () => {
    fc.assert(
      fc.property(
        clientIdArb,
        concreteTopicArb,
        messageDataArb,
        (clientId, topic, messageData) => {
          const topicManager = new TopicManager();
          const sseManager = new SSEConnectionManager(topicManager);
          
          const mock = createMockResponse();
          sseManager.addClient(clientId, mock.response);
          sseManager.subscribe(clientId, topic);
          
          // Verify message is delivered before disconnect
          const deliveredBefore = sseManager.broadcast(topic, messageData);
          expect(deliveredBefore).toContain(clientId);
          const messagesBeforeDisconnect = mock.writtenData.length;
          
          // Simulate disconnect
          mock.emitter.emit('close');
          
          // Verify message is NOT delivered after disconnect
          const deliveredAfter = sseManager.broadcast(topic, messageData);
          expect(deliveredAfter).not.toContain(clientId);
          
          // No new messages should have been written
          expect(mock.writtenData.length).toBe(messagesBeforeDisconnect);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should clean up client from all subscriber lists', () => {
    fc.assert(
      fc.property(
        clientIdArb,
        clientIdArb,
        concreteTopicArb,
        messageDataArb,
        (client1, client2, topic, messageData) => {
          fc.pre(client1 !== client2);
          
          const topicManager = new TopicManager();
          const sseManager = new SSEConnectionManager(topicManager);
          
          // Add both clients
          const mock1 = createMockResponse();
          const mock2 = createMockResponse();
          sseManager.addClient(client1, mock1.response);
          sseManager.addClient(client2, mock2.response);
          
          // Both subscribe to same topic
          sseManager.subscribe(client1, topic);
          sseManager.subscribe(client2, topic);
          
          // Disconnect client1
          mock1.emitter.emit('close');
          
          // Client1 should not be in subscriber list
          const subscribers = topicManager.getMatchingSubscribers(topic);
          expect(subscribers).not.toContain(client1);
          expect(subscribers).toContain(client2);
          
          // Broadcast should only reach client2
          const delivered = sseManager.broadcast(topic, messageData);
          expect(delivered).not.toContain(client1);
          expect(delivered).toContain(client2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle removeClient method directly', () => {
    fc.assert(
      fc.property(
        clientIdArb,
        fc.array(concreteTopicArb, { minLength: 1, maxLength: 5 }),
        (clientId, topics) => {
          // Ensure unique topics
          const uniqueTopics = [...new Set(topics)];
          if (uniqueTopics.length === 0) return;
          
          const topicManager = new TopicManager();
          const sseManager = new SSEConnectionManager(topicManager);
          
          const mock = createMockResponse();
          sseManager.addClient(clientId, mock.response);
          
          // Subscribe to all topics
          for (const topic of uniqueTopics) {
            sseManager.subscribe(clientId, topic);
          }
          
          // Remove client directly
          sseManager.removeClient(clientId);
          
          // Verify all subscriptions are removed
          for (const topic of uniqueTopics) {
            const subscribers = topicManager.getMatchingSubscribers(topic);
            expect(subscribers).not.toContain(clientId);
          }
          
          // Verify client is no longer tracked
          expect(sseManager.hasClient(clientId)).toBe(false);
          expect(sseManager.getClientIds()).not.toContain(clientId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle disconnect with wildcard subscriptions', () => {
    fc.assert(
      fc.property(
        clientIdArb,
        topicSegmentArb,
        topicSegmentArb,
        topicSegmentArb,
        messageDataArb,
        (clientId, modelId, sensorType, sensorId, messageData) => {
          const topicManager = new TopicManager();
          const sseManager = new SSEConnectionManager(topicManager);
          
          const mock = createMockResponse();
          sseManager.addClient(clientId, mock.response);
          
          // Subscribe to wildcard pattern
          const wildcardPattern = `sensors/${modelId}/#`;
          sseManager.subscribe(clientId, wildcardPattern);
          
          const concreteTopic = `sensors/${modelId}/${sensorType}/${sensorId}`;
          
          // Verify subscription works
          const subscribersBefore = topicManager.getMatchingSubscribers(concreteTopic);
          expect(subscribersBefore).toContain(clientId);
          
          // Disconnect
          mock.emitter.emit('close');
          
          // Verify subscription is removed
          const subscribersAfter = topicManager.getMatchingSubscribers(concreteTopic);
          expect(subscribersAfter).not.toContain(clientId);
          
          // Verify no delivery
          const delivered = sseManager.broadcast(concreteTopic, messageData);
          expect(delivered).not.toContain(clientId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should be idempotent - removing twice has same effect as once', () => {
    fc.assert(
      fc.property(
        clientIdArb,
        concreteTopicArb,
        (clientId, topic) => {
          const topicManager = new TopicManager();
          const sseManager = new SSEConnectionManager(topicManager);
          
          const mock = createMockResponse();
          sseManager.addClient(clientId, mock.response);
          sseManager.subscribe(clientId, topic);
          
          // Remove twice
          sseManager.removeClient(clientId);
          sseManager.removeClient(clientId);
          
          // Verify client is removed
          expect(sseManager.hasClient(clientId)).toBe(false);
          
          // Verify subscriptions are removed
          const subscribers = topicManager.getMatchingSubscribers(topic);
          expect(subscribers).not.toContain(clientId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
