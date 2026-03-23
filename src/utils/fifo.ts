/**
 * FIFO (First-In-First-Out) circular buffer implementation.
 * 
 * Mimics embedded systems FIFO behavior:
 * - Fixed-size buffer allocated at construction
 * - O(1) push and pop operations
 * - Head and tail pointers with wrap-around
 * - No dynamic memory allocation after init
 * - Overflow handling (oldest data discarded or rejected)
 */

export type FIFOOverflowPolicy = 'discard-oldest' | 'reject-new';

export interface FIFOStats {
  capacity: number;
  count: number;
  head: number;
  tail: number;
  overflowCount: number;
  isFull: boolean;
  isEmpty: boolean;
}

export class FIFO<T> {
  private buffer: (T | undefined)[];
  private head: number = 0;      // Next read position
  private tail: number = 0;      // Next write position
  private count: number = 0;     // Current item count
  private readonly capacity: number;
  private readonly overflowPolicy: FIFOOverflowPolicy;
  private overflowCount: number = 0;

  /**
   * Creates a new FIFO buffer.
   * 
   * @param capacity - Fixed buffer size (must be > 0)
   * @param overflowPolicy - What to do when buffer is full
   */
  constructor(capacity: number, overflowPolicy: FIFOOverflowPolicy = 'discard-oldest') {
    if (capacity <= 0) {
      throw new Error('FIFO capacity must be greater than 0');
    }
    this.capacity = capacity;
    this.overflowPolicy = overflowPolicy;
    // Pre-allocate buffer (like embedded malloc at init)
    this.buffer = new Array(capacity).fill(undefined);
  }

  /**
   * Push an item to the FIFO.
   * 
   * @param item - Item to add
   * @returns true if item was added, false if rejected (when policy is 'reject-new' and full)
   */
  push(item: T): boolean {
    if (this.count === this.capacity) {
      this.overflowCount++;
      
      if (this.overflowPolicy === 'reject-new') {
        return false;
      }
      
      // discard-oldest: overwrite head, advance head pointer
      this.head = (this.head + 1) % this.capacity;
      this.count--;
    }

    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    this.count++;
    return true;
  }

  /**
   * Pop an item from the FIFO.
   * 
   * @returns The oldest item, or undefined if empty
   */
  pop(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }

    const item = this.buffer[this.head];
    this.buffer[this.head] = undefined; // Clear reference (helps GC)
    this.head = (this.head + 1) % this.capacity;
    this.count--;
    return item;
  }

  /**
   * Peek at the oldest item without removing it.
   * 
   * @returns The oldest item, or undefined if empty
   */
  peek(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    return this.buffer[this.head];
  }

  /**
   * Peek at item at specific index from head.
   * 
   * @param index - Index from head (0 = oldest)
   * @returns Item at index, or undefined if out of range
   */
  peekAt(index: number): T | undefined {
    if (index < 0 || index >= this.count) {
      return undefined;
    }
    const actualIndex = (this.head + index) % this.capacity;
    return this.buffer[actualIndex];
  }

  /**
   * Check if FIFO is empty.
   */
  isEmpty(): boolean {
    return this.count === 0;
  }

  /**
   * Check if FIFO is full.
   */
  isFull(): boolean {
    return this.count === this.capacity;
  }

  /**
   * Get current item count.
   */
  getCount(): number {
    return this.count;
  }

  /**
   * Get buffer capacity.
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Get available space.
   */
  getAvailable(): number {
    return this.capacity - this.count;
  }

  /**
   * Get FIFO statistics.
   */
  getStats(): FIFOStats {
    return {
      capacity: this.capacity,
      count: this.count,
      head: this.head,
      tail: this.tail,
      overflowCount: this.overflowCount,
      isFull: this.isFull(),
      isEmpty: this.isEmpty(),
    };
  }

  /**
   * Clear all items from the FIFO.
   */
  clear(): void {
    this.buffer.fill(undefined);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  /**
   * Reset overflow counter.
   */
  resetOverflowCount(): void {
    this.overflowCount = 0;
  }

  /**
   * Drain all items from FIFO into an array.
   * FIFO will be empty after this operation.
   * 
   * @returns Array of all items in FIFO order
   */
  drain(): T[] {
    const items: T[] = [];
    while (!this.isEmpty()) {
      const item = this.pop();
      if (item !== undefined) {
        items.push(item);
      }
    }
    return items;
  }

  /**
   * Get all items as array without removing them.
   * 
   * @returns Array of all items in FIFO order
   */
  toArray(): T[] {
    const items: T[] = [];
    for (let i = 0; i < this.count; i++) {
      const item = this.peekAt(i);
      if (item !== undefined) {
        items.push(item);
      }
    }
    return items;
  }

  /**
   * Iterator support - allows for...of loops.
   */
  *[Symbol.iterator](): Iterator<T> {
    for (let i = 0; i < this.count; i++) {
      const item = this.peekAt(i);
      if (item !== undefined) {
        yield item;
      }
    }
  }
}

/**
 * Type-safe message FIFO for sensor data.
 * Pre-configured for typical embedded message queue behavior.
 */
export class MessageFIFO<T> extends FIFO<T> {
  private readonly name: string;

  constructor(name: string, capacity: number, overflowPolicy: FIFOOverflowPolicy = 'discard-oldest') {
    super(capacity, overflowPolicy);
    this.name = name;
  }

  getName(): string {
    return this.name;
  }

  /**
   * Push with timestamp wrapper.
   */
  pushWithTimestamp(item: T): boolean {
    return this.push(item);
  }

  /**
   * Blocking-style pop with timeout (async).
   * Polls until item available or timeout.
   * 
   * @param timeoutMs - Max wait time in ms
   * @param pollIntervalMs - Poll interval in ms
   * @returns Item or undefined if timeout
   */
  async popWithTimeout(timeoutMs: number, pollIntervalMs: number = 10): Promise<T | undefined> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const item = this.pop();
      if (item !== undefined) {
        return item;
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    
    return undefined;
  }
}
