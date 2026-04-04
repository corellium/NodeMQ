/**
 * TopicMessageBuffer - Per-topic ring buffer for message replay.
 *
 * Holds the last N messages per topic so new subscribers receive
 * recent history immediately on connect, without requiring disk reads.
 * 
 * Uses circular buffers internally to avoid O(n) Array.shift() operations.
 */

import { TopicManager } from '../services/topic-manager.js';
import { pino } from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'warn',
});

/** Maximum messages retained per topic (configurable at construction). */
const DEFAULT_BUFFER_SIZE = 200;

/**
 * Circular buffer for efficient FIFO operations without Array.shift().
 */
class CircularBuffer<T> {
  private buffer: (T | undefined)[];
  private head: number = 0;  // Next write position
  private count: number = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  toArray(): T[] {
    if (this.count === 0) return [];
    
    const result: T[] = [];
    const startIdx = this.count < this.capacity ? 0 : this.head;
    
    for (let i = 0; i < this.count; i++) {
      const idx = (startIdx + i) % this.capacity;
      const item = this.buffer[idx];
      if (item !== undefined) {
        result.push(item);
      }
    }
    
    return result;
  }

  get length(): number {
    return this.count;
  }
}

export class TopicMessageBuffer<T = unknown> {
  private buffers: Map<string, CircularBuffer<T>> = new Map();
  private readonly maxPerTopic: number;
  private readonly topicManager: TopicManager;

  constructor(maxPerTopic: number = DEFAULT_BUFFER_SIZE) {
    this.maxPerTopic = maxPerTopic;
    this.topicManager = new TopicManager();
  }

  /**
   * Append a message to the ring buffer for a topic.
   * Automatically drops the oldest entry when the buffer is full.
   * O(1) operation - no array shifting required.
   */
  push(topic: string, message: T): void {
    const buf = this.getOrCreateBuffer(topic);
    buf.push(message);
  }

  /**
   * Return all buffered messages for topics matching the given pattern.
   * Supports MQTT-style wildcards: `+` (one level) and `#` (multi-level).
   */
  getForPattern(pattern: string): T[] {
    const result: T[] = [];
    
    for (const [topic, buf] of this.buffers) {
      if (this.topicManager.matchTopic(pattern, topic)) {
        result.push(...buf.toArray());
      }
    }
    return result;
  }

  /** Number of topics with buffered messages. */
  getTopicCount(): number {
    return this.buffers.size;
  }

  /** Returns all topic strings that have buffered messages. */
  getTopics(): string[] {
    return Array.from(this.buffers.keys());
  }

  /** Total buffered messages across all topics. */
  getTotalCount(): number {
    let total = 0;
    for (const buf of this.buffers.values()) {
      total += buf.length;
    }
    return total;
  }

  clear(): void {
    this.buffers.clear();
  }

  private getOrCreateBuffer(topic: string): CircularBuffer<T> {
    let buf = this.buffers.get(topic);
    if (!buf) {
      buf = new CircularBuffer<T>(this.maxPerTopic);
      this.buffers.set(topic, buf);
    }
    return buf;
  }
}
