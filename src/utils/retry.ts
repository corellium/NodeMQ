/**
 * Retry utility with exponential backoff.
 *
 * Requirements: 3.3
 *
 * Implements exponential backoff retry logic where:
 * delay(n) = min(initialDelay * backoffMultiplier^n, maxDelay)
 */

import { RetryConfig } from '../services/config-manager.js';

/**
 * Default retry configuration.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  initialDelayMs: 100,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * Calculates the delay for a given retry attempt using exponential backoff.
 *
 * @param attempt - The retry attempt number (0-indexed)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const { initialDelayMs, maxDelayMs, backoffMultiplier } = config;
  const delay = initialDelayMs * Math.pow(backoffMultiplier, attempt);
  return Math.min(delay, maxDelayMs);
}

/**
 * Result of a retry operation.
 */
export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDelayMs: number;
}

/**
 * Sleeps for the specified duration.
 *
 * @param ms - Duration in milliseconds
 * @returns Promise that resolves after the delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes an async operation with exponential backoff retry.
 *
 * @param operation - Async function to execute
 * @param config - Retry configuration
 * @returns Promise resolving to the retry result
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<RetryResult<T>> {
  let attempts = 0;
  let totalDelayMs = 0;
  let lastError: Error | undefined;

  while (attempts <= config.maxRetries) {
    try {
      const result = await operation();
      return {
        success: true,
        result,
        attempts: attempts + 1,
        totalDelayMs,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempts++;

      if (attempts <= config.maxRetries) {
        const delay = calculateBackoffDelay(attempts - 1, config);
        totalDelayMs += delay;
        await sleep(delay);
      }
    }
  }

  return {
    success: false,
    error: lastError,
    attempts,
    totalDelayMs,
  };
}

/**
 * Queued message for retry processing.
 */
export interface QueuedRetryMessage<T> {
  id: string;
  data: T;
  retryCount: number;
  nextRetryAt: number;
  lastError?: string;
}

/**
 * RetryQueue manages messages that need to be retried.
 */
export class RetryQueue<T> {
  private queue: Map<string, QueuedRetryMessage<T>> = new Map();
  private config: RetryConfig;

  constructor(config: RetryConfig = DEFAULT_RETRY_CONFIG) {
    this.config = config;
  }

  /**
   * Adds a message to the retry queue.
   *
   * @param id - Unique message identifier
   * @param data - Message data
   * @param error - Error that caused the retry
   * @returns The queued message, or null if max retries exceeded
   */
  enqueue(id: string, data: T, error?: string): QueuedRetryMessage<T> | null {
    const existing = this.queue.get(id);
    const retryCount = existing ? existing.retryCount + 1 : 0;

    if (retryCount > this.config.maxRetries) {
      this.queue.delete(id);
      return null;
    }

    const delay = calculateBackoffDelay(retryCount, this.config);
    const message: QueuedRetryMessage<T> = {
      id,
      data,
      retryCount,
      nextRetryAt: Date.now() + delay,
      lastError: error,
    };

    this.queue.set(id, message);
    return message;
  }

  /**
   * Gets messages that are ready for retry.
   *
   * @returns Array of messages ready to be retried
   */
  getReadyMessages(): QueuedRetryMessage<T>[] {
    const now = Date.now();
    const ready: QueuedRetryMessage<T>[] = [];

    for (const message of this.queue.values()) {
      if (message.nextRetryAt <= now) {
        ready.push(message);
      }
    }

    return ready;
  }

  /**
   * Removes a message from the retry queue.
   *
   * @param id - Message identifier to remove
   * @returns True if the message was removed
   */
  remove(id: string): boolean {
    return this.queue.delete(id);
  }

  /**
   * Gets the current size of the retry queue.
   *
   * @returns Number of messages in the queue
   */
  size(): number {
    return this.queue.size;
  }

  /**
   * Clears all messages from the queue.
   */
  clear(): void {
    this.queue.clear();
  }

  /**
   * Gets a message by ID.
   *
   * @param id - Message identifier
   * @returns The queued message or undefined
   */
  get(id: string): QueuedRetryMessage<T> | undefined {
    return this.queue.get(id);
  }

  /**
   * Updates the retry configuration.
   *
   * @param config - New retry configuration
   */
  updateConfig(config: RetryConfig): void {
    this.config = config;
  }
}
