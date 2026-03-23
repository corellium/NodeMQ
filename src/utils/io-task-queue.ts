/**
 * I/O Task Queue - Dedicated queue for Worker 1 I/O operations.
 * 
 * Handles:
 * - Persistence completion marking
 * - Historical data serving on subscription
 * - Any other I/O-bound operations
 */

import { IngestedMessage } from '../types/ingested-message.js';

export type IOTaskType = 'mark-completed' | 'serve-history';

export interface IOTask {
  type: IOTaskType;
  messageId?: string;
  clientId?: string;
  topic?: string;
  timestamp: number;
}

/**
 * Simple FIFO queue for I/O tasks handled by Worker 1.
 */
export class IOTaskQueue {
  private tasks: IOTask[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  /**
   * Adds an I/O task to the queue.
   * Returns false if queue is full.
   */
  push(task: IOTask): boolean {
    if (this.tasks.length >= this.maxSize) {
      return false;
    }
    this.tasks.push(task);
    return true;
  }

  /**
   * Removes and returns the next task from the queue.
   * Returns undefined if queue is empty.
   */
  pop(): IOTask | undefined {
    return this.tasks.shift();
  }

  /**
   * Returns the number of tasks in the queue.
   */
  getCount(): number {
    return this.tasks.length;
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
    return this.tasks.length === 0;
  }

  /**
   * Clears all tasks from the queue.
   */
  clear(): void {
    this.tasks = [];
  }
}
