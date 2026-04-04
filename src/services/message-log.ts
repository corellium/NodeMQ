/**
 * MessageLog - Append-only log-based message persistence.
 * 
 * Similar to Kafka/RabbitMQ architecture:
 * - Append-only sequential writes (fast)
 * - Batched writes to reduce I/O
 * - Segmented logs with rotation
 * - Index for fast recovery
 * - Thread-safe for parallel processing
 * 
 * File Structure:
 *   messages.log       - Current active log segment
 *   messages.index     - Offset index (messageId -> offset)
 *   messages.000001    - Rotated segment 1
 *   messages.000002    - Rotated segment 2
 */

import * as fs from 'fs';
import * as path from 'path';
import { IngestedMessage } from '../types/ingested-message.js';
import { pino } from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'warn',
});

// Configuration constants
const DEFAULT_SEGMENT_SIZE = 100 * 1024 * 1024; // 100MB per segment
const DEFAULT_BATCH_SIZE = 100; // Messages per batch
const DEFAULT_BATCH_INTERVAL_MS = 50; // Max time to wait before flushing (reduced from 100ms)
const INDEX_ENTRY_SIZE = 256; // Fixed size for index entries

export interface LogEntry {
  messageId: string;
  timestamp: string;
  status: 'pending' | 'completed' | 'failed';
  retryCount: number;
  data: IngestedMessage;
}

export interface IndexEntry {
  messageId: string;
  segment: number;
  offset: number;
  length: number;
  status: 'pending' | 'completed' | 'failed';
}

export interface MessageLogConfig {
  logDir: string;
  segmentSize?: number;
  batchSize?: number;
  batchIntervalMs?: number;
}

/**
 * MessageLog provides high-performance append-only log persistence.
 */
export class MessageLog {
  private logDir: string;
  private segmentSize: number;
  private batchSize: number;
  private batchIntervalMs: number;

  // Current segment
  private currentSegment: number = 0;
  private currentSegmentPath: string = '';
  private currentSegmentSize: number = 0;
  private writeStream: fs.WriteStream | null = null;

  // Index
  private index: Map<string, IndexEntry> = new Map();
  private indexPath: string = '';
  private indexStream: fs.WriteStream | null = null;

  // Write batching
  private writeBatch: LogEntry[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private flushPromise: Promise<void> | null = null;

  // Thread safety
  private writeLock: Promise<void> = Promise.resolve();
  private isInitialized: boolean = false;
  private isClosed: boolean = false;

  constructor(config: MessageLogConfig) {
    this.logDir = path.resolve(config.logDir);
    this.segmentSize = config.segmentSize ?? DEFAULT_SEGMENT_SIZE;
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
    this.batchIntervalMs = config.batchIntervalMs ?? DEFAULT_BATCH_INTERVAL_MS;
    this.indexPath = path.join(this.logDir, 'messages.index');
  }

  /**
   * Initializes the message log.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    await fs.promises.mkdir(this.logDir, { recursive: true });

    // Load existing index
    await this.loadIndex();

    // Find current segment
    await this.findCurrentSegment();

    // Open write stream for current segment
    await this.openSegment(this.currentSegment);

    // Open index write stream
    this.indexStream = fs.createWriteStream(this.indexPath, { flags: 'a' });

    this.isInitialized = true;
    logger.info({ logDir: this.logDir, segment: this.currentSegment }, 'MessageLog initialized');
  }

  /**
   * Loads the index from disk.
   */
  private async loadIndex(): Promise<void> {
    try {
      if (!fs.existsSync(this.indexPath)) {
        return;
      }

      const content = await fs.promises.readFile(this.indexPath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const entry: IndexEntry = JSON.parse(line);
          this.index.set(entry.messageId, entry);
        } catch {
          // Skip invalid lines
        }
      }

      logger.info({ entries: this.index.size }, 'Index loaded');
    } catch (error) {
      logger.warn({ error }, 'Failed to load index, starting fresh');
    }
  }

  /**
   * Finds the current active segment.
   */
  private async findCurrentSegment(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.logDir);
      const segments = files
        .filter(f => f.startsWith('messages.') && f !== 'messages.index')
        .map(f => {
          const match = f.match(/messages\.(\d+)/);
          return match ? parseInt(match[1], 10) : 0;
        })
        .filter(n => !isNaN(n))
        .sort((a, b) => b - a);

      if (segments.length > 0) {
        this.currentSegment = segments[0];
        const segmentPath = this.getSegmentPath(this.currentSegment);
        const stats = await fs.promises.stat(segmentPath);
        this.currentSegmentSize = stats.size;
      } else {
        this.currentSegment = 1;
        this.currentSegmentSize = 0;
      }
    } catch {
      this.currentSegment = 1;
      this.currentSegmentSize = 0;
    }
  }

  /**
   * Gets the path for a segment number.
   */
  private getSegmentPath(segment: number): string {
    return path.join(this.logDir, `messages.${segment.toString().padStart(6, '0')}`);
  }

  /**
   * Opens a segment for writing.
   */
  private async openSegment(segment: number): Promise<void> {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }

    this.currentSegment = segment;
    this.currentSegmentPath = this.getSegmentPath(segment);
    
    // Check if segment exists to get current size
    try {
      const stats = await fs.promises.stat(this.currentSegmentPath);
      this.currentSegmentSize = stats.size;
    } catch {
      this.currentSegmentSize = 0;
    }

    this.writeStream = fs.createWriteStream(this.currentSegmentPath, { flags: 'a' });
  }

  /**
   * Rotates to a new segment if current is full.
   */
  private async rotateSegmentIfNeeded(): Promise<void> {
    if (this.currentSegmentSize >= this.segmentSize) {
      logger.info({ segment: this.currentSegment, size: this.currentSegmentSize }, 'Rotating segment');
      await this.openSegment(this.currentSegment + 1);
    }
  }

  /**
   * Appends a message to the log (immediate write).
   * Thread-safe - can be called from the I/O worker.
   * Uses direct write since this runs in a background worker, not the critical path.
   */
  async append(message: IngestedMessage, status: 'pending' | 'completed' | 'failed' = 'pending'): Promise<void> {
    if (this.isClosed) {
      throw new Error('MessageLog is closed');
    }

    const entry: LogEntry = {
      messageId: message.messageId,
      timestamp: new Date().toISOString(),
      status,
      retryCount: 0,
      data: message,
    };

    await this.writeEntryDirect(entry);
  }

  /**
   * Schedules a batch flush after the batch interval.
   */
  private scheduleBatchFlush(): void {
    if (this.batchTimer) return;

    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this.flush().catch(error => {
        logger.error({ error }, 'Batch flush failed');
      });
    }, this.batchIntervalMs);
  }

  /**
   * Writes a single entry directly to disk - bypasses batching.
   * Thread-safe - uses lock to serialize writes.
   * Used for status updates where immediate persistence is critical.
   */
  private async writeEntryDirect(entry: LogEntry): Promise<void> {
    logger.info({ messageId: entry.messageId, status: entry.status }, 'writeEntryDirect starting');
    
    // Wait for any in-progress flush
    await this.flushPromise;

    // Acquire write lock
    this.flushPromise = this.writeLock.then(async () => {
      try {
        await this.rotateSegmentIfNeeded();

        const line = JSON.stringify(entry) + '\n';
        const offset = this.currentSegmentSize;
        const length = Buffer.byteLength(line, 'utf-8');

        // Write to log
        await new Promise<void>((resolve, reject) => {
          this.writeStream!.write(line, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });

        // Update index
        const indexEntry: IndexEntry = {
          messageId: entry.messageId,
          segment: this.currentSegment,
          offset,
          length,
          status: entry.status,
        };

        this.index.set(entry.messageId, indexEntry);

        // Write to index file
        const indexLine = JSON.stringify(indexEntry) + '\n';
        await new Promise<void>((resolve, reject) => {
          this.indexStream!.write(indexLine, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });

        this.currentSegmentSize += length;

        logger.info({ messageId: entry.messageId, status: entry.status, offset, length }, 'Entry written directly to disk');
      } catch (error) {
        logger.error({ error, messageId: entry.messageId }, 'Failed to write entry directly');
        throw error;
      }
    });

    this.writeLock = this.flushPromise;
    await this.flushPromise;
    logger.info({ messageId: entry.messageId }, 'writeEntryDirect completed');
  }

  /**
   * Flushes the write batch to disk.
   * Thread-safe - uses lock to serialize writes.
   */
  async flush(): Promise<void> {
    if (this.writeBatch.length === 0) {
      return;
    }

    // Wait for any in-progress flush
    await this.flushPromise;

    // Acquire write lock
    this.flushPromise = this.writeLock.then(async () => {
      const batch = this.writeBatch;
      this.writeBatch = [];

      if (batch.length === 0) {
        return;
      }

      try {
        await this.rotateSegmentIfNeeded();

        for (const entry of batch) {
          const line = JSON.stringify(entry) + '\n';
          const offset = this.currentSegmentSize;
          const length = Buffer.byteLength(line, 'utf-8');

          // Write to log
          await new Promise<void>((resolve, reject) => {
            this.writeStream!.write(line, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });

          // Update index
          const indexEntry: IndexEntry = {
            messageId: entry.messageId,
            segment: this.currentSegment,
            offset,
            length,
            status: entry.status,
          };

          this.index.set(entry.messageId, indexEntry);

          // Write to index file
          const indexLine = JSON.stringify(indexEntry) + '\n';
          await new Promise<void>((resolve, reject) => {
            this.indexStream!.write(indexLine, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });

          this.currentSegmentSize += length;
        }

        logger.debug({ count: batch.length, segment: this.currentSegment }, 'Batch flushed');
      } catch (error) {
        logger.error({ error, count: batch.length }, 'Failed to flush batch');
        // Re-add failed entries to batch for retry
        this.writeBatch.unshift(...batch);
        throw error;
      }
    });

    this.writeLock = this.flushPromise;
    await this.flushPromise;
  }

  /**
   * Updates message status.
   * For append-only log, we just append a new entry with updated status.
   * OPTIMIZED: Just updates the in-memory index, no disk I/O.
   * The index is the source of truth for message status.
   */
  async updateStatus(messageId: string, status: 'pending' | 'completed' | 'failed'): Promise<void> {
    const indexEntry = this.index.get(messageId);
    if (!indexEntry) {
      // Message may have been purged or compacted - this is normal
      return;
    }

    // Update status in-memory only - no disk I/O
    indexEntry.status = status;
  }

  /**
   * Reads a message from the log.
   */
  async readMessage(messageId: string): Promise<LogEntry | null> {
    const indexEntry = this.index.get(messageId);
    if (!indexEntry) return null;

    try {
      const segmentPath = this.getSegmentPath(indexEntry.segment);
      const fd = await fs.promises.open(segmentPath, 'r');
      const buffer = Buffer.alloc(indexEntry.length);
      await fd.read(buffer, 0, indexEntry.length, indexEntry.offset);
      await fd.close();

      const line = buffer.toString('utf-8').trim();
      return JSON.parse(line) as LogEntry;
    } catch (error) {
      logger.error({ error, messageId }, 'Failed to read message');
      return null;
    }
  }

  /**
   * Gets all pending messages for recovery.
   * Scans index for pending/failed messages.
   */
  async getPendingMessages(): Promise<LogEntry[]> {
    const pending: LogEntry[] = [];

    // Group by messageId, keep only latest status
    const latestStatus = new Map<string, IndexEntry>();
    for (const [messageId, entry] of this.index) {
      const existing = latestStatus.get(messageId);
      if (!existing || entry.offset > existing.offset) {
        latestStatus.set(messageId, entry);
      }
    }

    // Read pending/failed messages
    for (const [messageId, entry] of latestStatus) {
      if (entry.status === 'pending' || entry.status === 'failed') {
        const message = await this.readMessage(messageId);
        if (message) {
          pending.push(message);
        }
      }
    }

    return pending;
  }

  /**
   * Gets pending messages grouped by source.
   */
  async getPendingMessagesBySource(): Promise<Map<string, LogEntry[]>> {
    const pending = await this.getPendingMessages();
    const bySource = new Map<string, LogEntry[]>();

    for (const entry of pending) {
      const sourceId = entry.data.data.sourceModelId;
      const group = bySource.get(sourceId);
      if (group) {
        group.push(entry);
      } else {
        bySource.set(sourceId, [entry]);
      }
    }

    // Sort each group by timestamp
    for (const [, messages] of bySource) {
      messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }

    return bySource;
  }

  /**
   * Compacts the log by removing completed messages.
   * Creates new segments with only pending/failed messages.
   */
  async compact(): Promise<void> {
    logger.info('Starting log compaction');

    // Flush any pending writes
    await this.flush();

    // Get all pending/failed messages
    const pending = await this.getPendingMessages();

    // Close current streams
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
    if (this.indexStream) {
      this.indexStream.end();
      this.indexStream = null;
    }

    // Archive old segments
    const files = await fs.promises.readdir(this.logDir);
    for (const file of files) {
      if (file.startsWith('messages.')) {
        const oldPath = path.join(this.logDir, file);
        const archivePath = path.join(this.logDir, `archive.${file}`);
        await fs.promises.rename(oldPath, archivePath);
      }
    }

    // Reset state
    this.index.clear();
    this.currentSegment = 1;
    this.currentSegmentSize = 0;

    // Reopen streams
    await this.openSegment(1);
    this.indexStream = fs.createWriteStream(this.indexPath, { flags: 'w' });

    // Rewrite pending messages
    for (const entry of pending) {
      this.writeBatch.push(entry);
      if (this.writeBatch.length >= this.batchSize) {
        await this.flush();
      }
    }

    if (this.writeBatch.length > 0) {
      await this.flush();
    }

    // Delete archived files
    for (const file of files) {
      if (file.startsWith('messages.')) {
        const archivePath = path.join(this.logDir, `archive.${file}`);
        try {
          await fs.promises.unlink(archivePath);
        } catch {
          // Ignore errors
        }
      }
    }

    logger.info({ kept: pending.length }, 'Log compaction complete');
  }

  /**
   * Gets statistics about the log.
   */
  getStats() {
    let pendingCount = 0;
    let completedCount = 0;
    let failedCount = 0;

    const latestStatus = new Map<string, IndexEntry>();
    for (const [messageId, entry] of this.index) {
      const existing = latestStatus.get(messageId);
      if (!existing || entry.offset > existing.offset) {
        latestStatus.set(messageId, entry);
      }
    }

    for (const entry of latestStatus.values()) {
      if (entry.status === 'pending') pendingCount++;
      else if (entry.status === 'completed') completedCount++;
      else if (entry.status === 'failed') failedCount++;
    }

    return {
      currentSegment: this.currentSegment,
      currentSegmentSize: this.currentSegmentSize,
      totalMessages: latestStatus.size,
      pendingCount,
      completedCount,
      failedCount,
      indexSize: this.index.size,
    };
  }

  /**
   * Closes the message log.
   */
  async close(): Promise<void> {
    if (this.isClosed) return;

    this.isClosed = true;

    // Clear batch timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Flush any pending writes
    await this.flush();

    // Close streams
    if (this.writeStream) {
      await new Promise<void>((resolve) => {
        this.writeStream!.end(() => resolve());
      });
      this.writeStream = null;
    }

    if (this.indexStream) {
      await new Promise<void>((resolve) => {
        this.indexStream!.end(() => resolve());
      });
      this.indexStream = null;
    }

    logger.info('MessageLog closed');
  }
}
