/**
 * Feature: sensor-subscription-service, Property 7: Wildcard Topic Matching
 * Validates: Requirements 2.7, 8.2, 8.3
 * 
 * For any topic pattern containing wildcards (+ or #) and any concrete topic string:
 * - Single-level wildcard (+) SHALL match exactly one topic level
 * - Multi-level wildcard (#) SHALL match zero or more topic levels
 * - The match function SHALL be symmetric with the subscription filtering
 */

import fc from 'fast-check';
import { TopicManager } from '../../src/services/topic-manager.js';

// Generator for valid topic segments (non-empty, no slashes, no wildcards)
const topicSegmentArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0 && !s.includes('/') && s !== '+' && s !== '#');

// Generator for concrete topics (no wildcards)
const concreteTopicArb = fc
  .array(topicSegmentArb, { minLength: 1, maxLength: 5 })
  .map((parts) => parts.join('/'));

// Generator for topic patterns with single-level wildcards (+)
const singleWildcardPatternArb = fc
  .array(
    fc.oneof(topicSegmentArb, fc.constant('+')),
    { minLength: 1, maxLength: 5 }
  )
  .filter((parts) => parts.includes('+'))
  .map((parts) => parts.join('/'));

// Generator for topic patterns with multi-level wildcard (#) at the end
const multiWildcardPatternArb = fc
  .array(topicSegmentArb, { minLength: 0, maxLength: 4 })
  .map((parts) => [...parts, '#'].join('/'));

describe('Property 7: Wildcard Topic Matching', () => {
  const topicManager = new TopicManager();

  describe('Single-level wildcard (+) matching', () => {
    it('should match exactly one topic level with + wildcard', () => {
      fc.assert(
        fc.property(
          fc.array(topicSegmentArb, { minLength: 1, maxLength: 5 }),
          fc.integer({ min: 0, max: 4 }),
          (segments, wildcardIndex) => {
            // Ensure wildcardIndex is within bounds
            const idx = wildcardIndex % segments.length;
            
            // Create pattern with + at the specified index
            const patternParts = [...segments];
            patternParts[idx] = '+';
            const pattern = patternParts.join('/');
            
            // The original topic should match
            const topic = segments.join('/');
            expect(topicManager.matchTopic(pattern, topic)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not match when + is expected but level is missing', () => {
      fc.assert(
        fc.property(
          fc.array(topicSegmentArb, { minLength: 2, maxLength: 5 }),
          (segments) => {
            // Create pattern with + at the end
            const patternParts = [...segments];
            patternParts.push('+');
            const pattern = patternParts.join('/');
            
            // Topic without the extra level should not match
            const topic = segments.join('/');
            expect(topicManager.matchTopic(pattern, topic)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should match any value at the + position', () => {
      fc.assert(
        fc.property(
          topicSegmentArb,
          topicSegmentArb,
          topicSegmentArb,
          topicSegmentArb,
          (seg1, seg2, seg3, anyValue) => {
            // Pattern: seg1/+/seg3
            const pattern = `${seg1}/+/${seg3}`;
            
            // Topic: seg1/anyValue/seg3 should match
            const topic = `${seg1}/${anyValue}/${seg3}`;
            expect(topicManager.matchTopic(pattern, topic)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Multi-level wildcard (#) matching', () => {
    it('should match zero or more levels with # wildcard', () => {
      fc.assert(
        fc.property(
          fc.array(topicSegmentArb, { minLength: 1, maxLength: 3 }),
          fc.array(topicSegmentArb, { minLength: 0, maxLength: 3 }),
          (prefix, suffix) => {
            // Pattern: prefix/#
            const pattern = [...prefix, '#'].join('/');
            
            // Topic: prefix/suffix... should match
            const topic = [...prefix, ...suffix].join('/');
            expect(topicManager.matchTopic(pattern, topic)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should match when # matches zero levels', () => {
      fc.assert(
        fc.property(
          fc.array(topicSegmentArb, { minLength: 1, maxLength: 4 }),
          (segments) => {
            // Pattern: segments/#
            const pattern = [...segments, '#'].join('/');
            
            // Topic: exactly segments (# matches zero levels)
            const topic = segments.join('/');
            expect(topicManager.matchTopic(pattern, topic)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should match when # matches multiple levels', () => {
      fc.assert(
        fc.property(
          topicSegmentArb,
          fc.array(topicSegmentArb, { minLength: 2, maxLength: 4 }),
          (prefix, suffix) => {
            // Pattern: prefix/#
            const pattern = `${prefix}/#`;
            
            // Topic: prefix/suffix[0]/suffix[1]/... should match
            const topic = [prefix, ...suffix].join('/');
            expect(topicManager.matchTopic(pattern, topic)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not match when prefix does not match', () => {
      fc.assert(
        fc.property(
          topicSegmentArb,
          topicSegmentArb,
          fc.array(topicSegmentArb, { minLength: 0, maxLength: 3 }),
          (prefix1, prefix2, suffix) => {
            fc.pre(prefix1 !== prefix2); // Ensure prefixes are different
            
            // Pattern: prefix1/#
            const pattern = `${prefix1}/#`;
            
            // Topic: prefix2/suffix... should not match
            const topic = [prefix2, ...suffix].join('/');
            expect(topicManager.matchTopic(pattern, topic)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Exact matching (no wildcards)', () => {
    it('should match identical topics', () => {
      fc.assert(
        fc.property(concreteTopicArb, (topic) => {
          expect(topicManager.matchTopic(topic, topic)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should not match different topics', () => {
      fc.assert(
        fc.property(
          concreteTopicArb,
          concreteTopicArb,
          (topic1, topic2) => {
            fc.pre(topic1 !== topic2);
            expect(topicManager.matchTopic(topic1, topic2)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Edge cases', () => {
    it('should handle # as the only pattern segment', () => {
      fc.assert(
        fc.property(concreteTopicArb, (topic) => {
          // Pattern "#" should match any topic
          expect(topicManager.matchTopic('#', topic)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should handle + as the only pattern segment', () => {
      fc.assert(
        fc.property(topicSegmentArb, (segment) => {
          // Pattern "+" should match any single-segment topic
          expect(topicManager.matchTopic('+', segment)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should not match + against multi-segment topics', () => {
      fc.assert(
        fc.property(
          fc.array(topicSegmentArb, { minLength: 2, maxLength: 5 }),
          (segments) => {
            // Pattern "+" should not match multi-segment topics
            const topic = segments.join('/');
            expect(topicManager.matchTopic('+', topic)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
