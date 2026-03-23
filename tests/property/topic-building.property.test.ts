/**
 * Feature: sensor-subscription-service, Property 15: Hierarchical Topic Building
 * Validates: Requirements 8.1
 * 
 * For any sensor data with modelId, sensorType, sensorId, and optional deviceBus,
 * the built topic SHALL follow the pattern
 * `sensors/{modelId}/{deviceBus}/{sensorType}/{sensorId}`.
 * When deviceBus is not provided, 'default' is used.
 */

import fc from 'fast-check';
import { TopicManager } from '../../src/services/topic-manager.js';

// Generator for valid non-empty strings without slashes (topic segments)
const topicSegmentArb = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim().length > 0 && !s.includes('/'));

describe('Property 15: Hierarchical Topic Building', () => {
  const topicManager = new TopicManager();

  it('should build topics following the pattern sensors/{modelId}/{deviceBus}/{sensorType}/{sensorId}', () => {
    fc.assert(
      fc.property(
        topicSegmentArb,
        topicSegmentArb,
        topicSegmentArb,
        fc.option(topicSegmentArb, { nil: undefined }),
        (modelId, sensorType, sensorId, deviceBus) => {
          const topic = topicManager.buildTopic(modelId, sensorType, sensorId, deviceBus);
          const expectedBus = deviceBus ?? 'default';
          const expectedTopic = `sensors/${modelId}/${expectedBus}/${sensorType}/${sensorId}`;
          expect(topic).toBe(expectedTopic);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should always start with "sensors/" prefix', () => {
    fc.assert(
      fc.property(
        topicSegmentArb,
        topicSegmentArb,
        topicSegmentArb,
        (modelId, sensorType, sensorId) => {
          const topic = topicManager.buildTopic(modelId, sensorType, sensorId);
          expect(topic.startsWith('sensors/')).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should have exactly 5 segments separated by slashes', () => {
    fc.assert(
      fc.property(
        topicSegmentArb,
        topicSegmentArb,
        topicSegmentArb,
        fc.option(topicSegmentArb, { nil: undefined }),
        (modelId, sensorType, sensorId, deviceBus) => {
          const topic = topicManager.buildTopic(modelId, sensorType, sensorId, deviceBus);
          const segments = topic.split('/');
          const expectedBus = deviceBus ?? 'default';
          
          expect(segments.length).toBe(5);
          expect(segments[0]).toBe('sensors');
          expect(segments[1]).toBe(modelId);
          expect(segments[2]).toBe(expectedBus);
          expect(segments[3]).toBe(sensorType);
          expect(segments[4]).toBe(sensorId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should preserve the input values in the topic', () => {
    fc.assert(
      fc.property(
        topicSegmentArb,
        topicSegmentArb,
        topicSegmentArb,
        (modelId, sensorType, sensorId) => {
          const topic = topicManager.buildTopic(modelId, sensorType, sensorId);
          
          // The topic should contain all input values
          expect(topic).toContain(modelId);
          expect(topic).toContain(sensorType);
          expect(topic).toContain(sensorId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
