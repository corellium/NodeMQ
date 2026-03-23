/**
 * Feature: sensor-subscription-service, Property 9: Exponential Backoff Retry
 * Validates: Requirements 3.3
 *
 * For any failed ECU forwarding attempt, the retry delay SHALL follow exponential
 * backoff where delay(n) = min(initialDelay * backoffMultiplier^n, maxDelay).
 */

import fc from 'fast-check';
import { calculateBackoffDelay, RetryQueue, DEFAULT_RETRY_CONFIG } from '../../src/utils/retry.js';
import { RetryConfig } from '../../src/services/config-manager.js';
import { DataRouter } from '../../src/services/data-router.js';

// Generator for valid retry configurations
const retryConfigArb: fc.Arbitrary<RetryConfig> = fc.record({
  maxRetries: fc.integer({ min: 1, max: 10 }),
  initialDelayMs: fc.integer({ min: 1, max: 1000 }),
  maxDelayMs: fc.integer({ min: 1000, max: 60000 }),
  backoffMultiplier: fc.float({ min: Math.fround(1.1), max: Math.fround(4), noNaN: true }),
});

// Generator for retry attempt numbers
const attemptArb = fc.integer({ min: 0, max: 20 });

describe('Property 9: Exponential Backoff Retry', () => {
  describe('calculateBackoffDelay', () => {
    it('should follow exponential backoff formula: delay(n) = min(initialDelay * multiplier^n, maxDelay)', () => {
      fc.assert(
        fc.property(retryConfigArb, attemptArb, (config, attempt) => {
          const delay = calculateBackoffDelay(attempt, config);

          // Calculate expected delay using the formula
          const expectedUnbounded =
            config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
          const expectedDelay = Math.min(expectedUnbounded, config.maxDelayMs);

          expect(delay).toBeCloseTo(expectedDelay, 5);
        }),
        { numRuns: 100 }
      );
    });

    it('should never exceed maxDelayMs', () => {
      fc.assert(
        fc.property(retryConfigArb, attemptArb, (config, attempt) => {
          const delay = calculateBackoffDelay(attempt, config);
          expect(delay).toBeLessThanOrEqual(config.maxDelayMs);
        }),
        { numRuns: 100 }
      );
    });

    it('should return initialDelayMs for attempt 0', () => {
      fc.assert(
        fc.property(retryConfigArb, (config) => {
          const delay = calculateBackoffDelay(0, config);
          // For attempt 0: initialDelay * multiplier^0 = initialDelay * 1 = initialDelay
          const expected = Math.min(config.initialDelayMs, config.maxDelayMs);
          expect(delay).toBeCloseTo(expected, 5);
        }),
        { numRuns: 100 }
      );
    });

    it('should increase delay with each attempt (until maxDelay)', () => {
      fc.assert(
        fc.property(
          retryConfigArb,
          fc.integer({ min: 0, max: 10 }),
          (config, attempt) => {
            const delay1 = calculateBackoffDelay(attempt, config);
            const delay2 = calculateBackoffDelay(attempt + 1, config);

            // delay2 should be >= delay1 (monotonically increasing until cap)
            expect(delay2).toBeGreaterThanOrEqual(delay1);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use default config when none provided', () => {
      fc.assert(
        fc.property(attemptArb, (attempt) => {
          const delay = calculateBackoffDelay(attempt);

          const expectedUnbounded =
            DEFAULT_RETRY_CONFIG.initialDelayMs *
            Math.pow(DEFAULT_RETRY_CONFIG.backoffMultiplier, attempt);
          const expectedDelay = Math.min(
            expectedUnbounded,
            DEFAULT_RETRY_CONFIG.maxDelayMs
          );

          expect(delay).toBeCloseTo(expectedDelay, 5);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('RetryQueue', () => {
    it('should calculate correct nextRetryAt based on exponential backoff', () => {
      fc.assert(
        fc.property(
          retryConfigArb,
          fc.string({ minLength: 1 }),
          fc.anything(),
          (config, id, data) => {
            const queue = new RetryQueue(config);
            const beforeEnqueue = Date.now();

            const queued = queue.enqueue(id, data);

            if (queued) {
              const afterEnqueue = Date.now();
              const expectedDelay = calculateBackoffDelay(0, config);

              // nextRetryAt should be approximately now + delay
              expect(queued.nextRetryAt).toBeGreaterThanOrEqual(
                beforeEnqueue + expectedDelay
              );
              expect(queued.nextRetryAt).toBeLessThanOrEqual(
                afterEnqueue + expectedDelay + 10 // small tolerance
              );
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should increment retry count and delay on subsequent enqueues', () => {
      fc.assert(
        fc.property(
          retryConfigArb.filter((c) => c.maxRetries >= 3),
          fc.string({ minLength: 1 }),
          fc.anything(),
          (config, id, data) => {
            const queue = new RetryQueue(config);

            // First enqueue
            const first = queue.enqueue(id, data);
            expect(first?.retryCount).toBe(0);

            // Second enqueue (same id)
            const second = queue.enqueue(id, data);
            expect(second?.retryCount).toBe(1);

            // Third enqueue
            const third = queue.enqueue(id, data);
            expect(third?.retryCount).toBe(2);

            // Verify delays are increasing
            if (first && second && third) {
              const delay0 = calculateBackoffDelay(0, config);
              const delay1 = calculateBackoffDelay(1, config);
              const delay2 = calculateBackoffDelay(2, config);

              expect(delay1).toBeGreaterThanOrEqual(delay0);
              expect(delay2).toBeGreaterThanOrEqual(delay1);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return null when max retries exceeded', () => {
      fc.assert(
        fc.property(
          retryConfigArb,
          fc.string({ minLength: 1 }),
          fc.anything(),
          (config, id, data) => {
            const queue = new RetryQueue(config);

            // Enqueue until max retries
            for (let i = 0; i <= config.maxRetries; i++) {
              queue.enqueue(id, data);
            }

            // Next enqueue should return null
            const result = queue.enqueue(id, data);
            expect(result).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('DataRouter backoff integration', () => {
    it('should calculate correct backoff delay via DataRouter', () => {
      fc.assert(
        fc.property(retryConfigArb, attemptArb, (config, attempt) => {
          const router = new DataRouter(async () => {}, [], config);

          const delay = router.calculateBackoffDelay(attempt);
          const expectedDelay = calculateBackoffDelay(attempt, config);

          expect(delay).toBeCloseTo(expectedDelay, 5);
        }),
        { numRuns: 100 }
      );
    });

    it('should queue failed forwards for retry with correct backoff', async () => {
      await fc.assert(
        fc.asyncProperty(
          retryConfigArb.filter((c) => c.maxRetries >= 1),
          async (config) => {
            let forwardAttempts = 0;
            const failingForwarder = async () => {
              forwardAttempts++;
              throw new Error('Connection failed');
            };

            const router = new DataRouter(
              failingForwarder,
              [
                {
                  modelId: 'model-1',
                  chipSelectAddress: 0x10,
                  sensorTypes: ['temperature'],
                },
              ],
              config
            );

            const message = {
              messageId: 'test-msg',
              timestamp: new Date().toISOString(),
              data: {
                sensorId: 'sensor-1',
                sensorType: 'temperature',
                value: 42,
                sourceModelId: 'model-1',
              },
              topic: 'sensors/model-1/temperature/sensor-1',
            };

            // First forward attempt should fail and queue for retry
            const results = await router.forward(message);

            expect(forwardAttempts).toBe(1);
            expect(results.length).toBe(1);
            expect(results[0].success).toBe(false);
            expect(results[0].retryCount).toBe(0);
            expect(router.getRetryQueueSize()).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
