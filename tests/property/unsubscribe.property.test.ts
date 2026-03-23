/**
 * Feature: sensor-subscription-service, Property 4: Unsubscribe Stops Delivery
 * Validates: Requirements 2.3
 * 
 * For any client that unsubscribes from a topic pattern, subsequent messages
 * matching that pattern SHALL NOT be delivered to that client.
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

describe('Property 4: Unsubscribe Stops Delivery', () => {
  it('should not deliver messages to unsubscribed clients', () => {
    fc.assert(
      fc.property(
        clientIdArb,
        concreteTopicArb,
        messageDataArb,
        messageDataArb,
        (clientId, topic, messageBeforeUnsub, messageAfterUnsub) => {
          const topicManager = new TopicManager();
          const sseManager = new SSEConnectionManager(topicManager);
          
          const mock = createMockResponse();
          sseManager.addClient(clientId, mock.response);
          sseManager.subscribe(clientId, topic);
          
          // Broadcast first message - should be delivered
          const deliveredBefore = sseManager.broadcast(topic, messageBeforeUnsub);
          expect(deliveredBefore).toContain(clientId);
          const messagesBeforeUnsub = mock.writtenData.length;
          
          // Unsubscribe
          sseManager.unsubscribe(clientId, topic);
          
          // Broadcast second message - should NOT be delivered
          const deliveredAfter = sseManager.broadcast(topic, messageAfterUnsub);
          expect(deliveredAfter).not.toContain(clientId);
          
          // No new messages should have been written
          expect(mock.writtenData.length).toBe(messagesBeforeUnsub);
        }
      ),
      { numRuns: 100 }
    );
  });


  it('should stop delivery only for unsubscribed topic, not other subscriptions', () => {
    fc.assert(
      fc.property(
        clientIdArb,
        topicSegmentArb,
        topicSegmentArb,
        messageDataArb,
        (clientId, topic1Prefix, topic2Prefix, messageData) => {
          fc.pre(topic1Prefix !== topic2Prefix);
          
          const topicManager = new TopicManager();
          const sseManager = new SSEConnectionManager(topicManager);
          
          const mock = createMockResponse();
          sseManager.addClient(clientId, mock.response);
          
          const topic1 = `${topic1Prefix}/data`;
          const topic2 = `${topic2Prefix}/data`;
          
          // Subscribe to both topics
          sseManager.subscribe(clientId, topic1);
          sseManager.subscribe(clientId, topic2);
          
          // Unsubscribe from topic1 only
          sseManager.unsubscribe(clientId, topic1);
          
          // Messages to topic1 should NOT be delivered
          const deliveredToTopic1 = sseManager.broadcast(topic1, messageData);
          expect(deliveredToTopic1).not.toContain(clientId);
          
          // Messages to topic2 should still be delivered
          const deliveredToTopic2 = sseManager.broadcast(topic2, messageData);
          expect(deliveredToTopic2).toContain(clientId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle multiple unsubscribes correctly', () => {
    fc.assert(
      fc.property(
        clientIdArb,
        fc.array(topicSegmentArb, { minLength: 2, maxLength: 5 }),
        messageDataArb,
        (clientId, topicPrefixes, messageData) => {
          // Ensure unique prefixes
          const uniquePrefixes = [...new Set(topicPrefixes)];
          if (uniquePrefixes.length < 2) return;
          
          const topicManager = new TopicManager();
          const sseManager = new SSEConnectionManager(topicManager);
          
          const mock = createMockResponse();
          sseManager.addClient(clientId, mock.response);
          
          const topics = uniquePrefixes.map((p) => `${p}/data`);
          
          // Subscribe to all topics
          for (const topic of topics) {
            sseManager.subscribe(clientId, topic);
          }
          
          // Unsubscribe from all but the last topic
          for (let i = 0; i < topics.length - 1; i++) {
            sseManager.unsubscribe(clientId, topics[i]);
          }
          
          // Messages to unsubscribed topics should NOT be delivered
          for (let i = 0; i < topics.length - 1; i++) {
            const delivered = sseManager.broadcast(topics[i], messageData);
            expect(delivered).not.toContain(clientId);
          }
          
          // Messages to the last topic should still be delivered
          const lastTopic = topics[topics.length - 1];
          const delivered = sseManager.broadcast(lastTopic, messageData);
          expect(delivered).toContain(clientId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle unsubscribe from wildcard patterns', () => {
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
          
          const wildcardPattern = `sensors/${modelId}/#`;
          const concreteTopic = `sensors/${modelId}/${sensorType}/${sensorId}`;
          
          // Subscribe to wildcard pattern
          sseManager.subscribe(clientId, wildcardPattern);
          
          // Message should be delivered
          const deliveredBefore = sseManager.broadcast(concreteTopic, messageData);
          expect(deliveredBefore).toContain(clientId);
          
          // Unsubscribe from wildcard pattern
          sseManager.unsubscribe(clientId, wildcardPattern);
          
          // Message should NOT be delivered
          const deliveredAfter = sseManager.broadcast(concreteTopic, messageData);
          expect(deliveredAfter).not.toContain(clientId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should be idempotent - unsubscribing twice has same effect as once', () => {
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
          
          // Unsubscribe twice
          sseManager.unsubscribe(clientId, topic);
          sseManager.unsubscribe(clientId, topic);
          
          // Message should NOT be delivered
          const delivered = sseManager.broadcast(topic, messageData);
          expect(delivered).not.toContain(clientId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
