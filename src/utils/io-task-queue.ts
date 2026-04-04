/**
 * I/O Task Queue - Dedicated queue for I/O worker operations.
 * 
 * Uses a circular buffer (head/tail pointers) for O(1) push and pop.
 * Handles:
 * - Message persistence
 * - Persistence completion marking
 * - Historical data serving on subscription
 */

import { IngestedMessage } from '../types/ingested-message.js';

export type IOTaskType = 'persist' | 'mark-completed' | 'serve-history';

export interface IOTask {
  type: IOTaskType;
  messageId?: string;
  message?: IngestedMessage;
  clientId?: string;
  topic?: string;
  timestamp: number;
}

/**
 * Circular buffer FIFO queue for I/O tasks.
 * O(1) push and pop — no Array.shift() copying.
 */
export class IOTaskQueue {
  private buffer: (IOTask | undefined)[];
  private head: number = 0;
  private tail: number = 0;
  private count: number = 0;
  private readonly maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
    this.buffer = new Array(maxSize);
  }

  /**
   * Adds an I/O task to the queue.
   * Returns false if queue is full.
   */
  push(task: IOTask): boolean {
    if (this.count >= this.maxSize) {
      return false;
    }
    this.buffer[this.tail] = task;
    this.tail = (this.tail + 1) % this.maxSize;
    this.count++;
    return true;
  }

  /**
   * Removes and returns the next task from the queue.
   * Returns undefined if queue is empty.
   */
  pop(): IOTask | undefined {
    if (this.count === 0) {
      return undefined;
    }
    const task = this.buffer[this.head];
    this.buffer[this.head] = undefined;
    this.head = (this.head + 1) % this.maxSize;
    this.count--;
    return task;
  }

  /**
   * Returns the number of tasks in the queue.
   */
  getCount(): number {
    return this.count;
  }

  /**
   * Returns the maximum queue size.
   */
  getCapacity(): number {
    return this.maxSize;
  }

  /**
   * Checks if the queue is empty.
   */
  isEmpty(): boolean {
    return this.count === 0;
  }

  /**
   * Clears all tasks from the queue.
   */
  clear(): void {
    this.buffer = new Array(this.maxSize);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }
}
