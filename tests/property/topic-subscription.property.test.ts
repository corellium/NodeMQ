/**
 * Feature: sensor-subscription-service, Property 3: Topic Subscription Filtering
 * Validates: Requirements 2.2
 * 
 * For any client subscribed to a topic pattern and any set of published messages,
 * the client SHALL receive exactly those messages whose topics match the subscription
 * pattern and no others.
 */

import fc from 'fast-check';
import { TopicManager } from '../../src/services/topic-manager.js';

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

// Generator for topic patterns (may include wildcards)
const topicPatternArb = fc
  .array(
    fc.oneof(
      topicSegmentArb,
      fc.constant('+'),
    ),
    { minLength: 1, maxLength: 4 }
  )
  .chain((parts) => 
    fc.boolean().map((addHash) => 
      addHash ? [...parts, '#'].join('/') : parts.join('/')
    )
  );

describe('Property 3: Topic Subscription Filtering', () => {
  it('should deliver messages only to clients whose subscriptions match the topic', () => {
    fc.assert(
      fc.property(
        fc.array(clientIdArb, { minLength: 1, maxLength: 5 }),
        fc.array(topicPatternArb, { minLength: 1, maxLength: 5 }),
        concreteTopicArb,
        (clientIds, patterns, publishedTopic) => {
          const topicManager = new TopicManager();
          
          // Ensure unique client IDs
          const uniqueClientIds = [...new Set(clientIds)];
          if (uniqueClientIds.length === 0) return;
          
          // Subscribe each client to a pattern
          const clientPatterns = new Map<string, string>();
          uniqueClientIds.forEach((clientId, idx) => {
            const pattern = patterns[idx % patterns.length];
            topicManager.subscribe(clientId, pattern);
            clientPatterns.set(clientId, pattern);
          });
          
          // Get matching subscribers
          const matchingSubscribers = topicManager.getMatchingSubscribers(publishedTopic);
          
          // Verify: each matching subscriber's pattern should match the topic
          for (const clientId of matchingSubscribers) {
            const pattern = clientPatterns.get(clientId)!;
            expect(topicManager.matchTopic(pattern, publishedTopic)).toBe(true);
          }
          
          // Verify: each non-matching subscriber's pattern should NOT match the topic
          for (const [clientId, pattern] of clientPatterns) {
            if (!matchingSubscribers.includes(clientId)) {
              expect(topicManager.matchTopic(pattern, publishedTopic)).toBe(false);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return all subscribers when topic matches their patterns', () => {
    fc.assert(
      fc.property(
        fc.array(clientIdArb, { minLength: 2, maxLength: 5 }),
        concreteTopicArb,
        (clientIds, topic) => {
          const topicManager = new TopicManager();
          
          // Ensure unique client IDs
          const uniqueClientIds = [...new Set(clientIds)];
          if (uniqueClientIds.length < 2) return;
          
          // Subscribe all clients to the exact topic
          uniqueClientIds.forEach((clientId) => {
            topicManager.subscribe(clientId, topic);
          });
          
          // All clients should receive the message
          const matchingSubscribers = topicManager.getMatchingSubscribers(topic);
          expect(matchingSubscribers.sort()).toEqual(uniqueClientIds.sort());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return no subscribers when no patterns match', () => {
    fc.assert(
      fc.property(
        fc.array(clientIdArb, { minLength: 1, maxLength: 5 }),
        topicSegmentArb,
        topicSegmentArb,
        (clientIds, patternPrefix, topicPrefix) => {
          fc.pre(patternPrefix !== topicPrefix); // Ensure different prefixes
          
          const topicManager = new TopicManager();
          
          // Ensure unique client IDs
          const uniqueClientIds = [...new Set(clientIds)];
          if (uniqueClientIds.length === 0) return;
          
          // Subscribe all clients to patterns starting with patternPrefix
          uniqueClientIds.forEach((clientId) => {
            topicManager.subscribe(clientId, `${patternPrefix}/data`);
          });
          
          // Publish to a topic starting with topicPrefix (different)
          const matchingSubscribers = topicManager.getMatchingSubscribers(`${topicPrefix}/data`);
          expect(matchingSubscribers).toEqual([]);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle wildcard subscriptions correctly', () => {
    fc.assert(
      fc.property(
        clientIdArb,
        clientIdArb,
        topicSegmentArb,
        topicSegmentArb,
        topicSegmentArb,
        (client1, client2, modelId, sensorType, sensorId) => {
          fc.pre(client1 !== client2); // Ensure different clients
          
          const topicManager = new TopicManager();
          
          // Client 1 subscribes to specific topic
          const specificPattern = `sensors/${modelId}/${sensorType}/${sensorId}`;
          topicManager.subscribe(client1, specificPattern);
          
          // Client 2 subscribes to wildcard pattern
          const wildcardPattern = `sensors/${modelId}/+/${sensorId}`;
          topicManager.subscribe(client2, wildcardPattern);
          
          // Publish to the specific topic
          const matchingSubscribers = topicManager.getMatchingSubscribers(specificPattern);
          
          // Both clients should receive the message
          expect(matchingSubscribers).toContain(client1);
          expect(matchingSubscribers).toContain(client2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle multi-level wildcard (#) subscriptions', () => {
    fc.assert(
      fc.property(
        clientIdArb,
        topicSegmentArb,
        fc.array(topicSegmentArb, { minLength: 1, maxLength: 3 }),
        (clientId, prefix, suffixParts) => {
          const topicManager = new TopicManager();
          
          // Subscribe to prefix/#
          topicManager.subscribe(clientId, `${prefix}/#`);
          
          // Publish to prefix/suffix[0]/suffix[1]/...
          const topic = [prefix, ...suffixParts].join('/');
          const matchingSubscribers = topicManager.getMatchingSubscribers(topic);
          
          // Client should receive the message
          expect(matchingSubscribers).toContain(clientId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should not deliver to unsubscribed clients', () => {
    fc.assert(
      fc.property(
        clientIdArb,
        concreteTopicArb,
        (clientId, topic) => {
          const topicManager = new TopicManager();
          
          // Subscribe then unsubscribe
          topicManager.subscribe(clientId, topic);
          topicManager.unsubscribe(clientId, topic);
          
          // Client should not receive messages
          const matchingSubscribers = topicManager.getMatchingSubscribers(topic);
          expect(matchingSubscribers).not.toContain(clientId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
