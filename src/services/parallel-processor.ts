/**
 * Parallel Processor Service
 * 
 * Manages parallel processing of messages using sharded FIFO queues.
 * Each broadcast consumer owns a dedicated shard — zero contention on pop.
 * The last worker loop is a dedicated I/O worker for persistence and history.
 * 
 * Architecture:
 *   Ingestion worker → hash(topic) % N → Shard[i] → Consumer[i] (broadcast)
 *                                                  → I/O Worker  (persistence)
 */

import { pino } from 'pino';
import { MessageFIFO } from '../utils/fifo.js';
import { IngestedMessage } from '../types/ingested-message.js';
import { IOTaskQueue, IOTask } from '../utils/io-task-queue.js';
import { MessagePersistence } from './message-persistence.js';
import { SSEConnectionManager } from './sse-connection-manager.js';
import { TopicMessageBuffer } from '../utils/topic-message-buffer.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'warn',
});

export type MessageProcessor = (message: IngestedMessage, workerId: number) => Promise<{
  success: boolean;
  deliveredTo?: string[];
  error?: string;
}>;

/**
 * ParallelProcessor manages sharded parallel message processing.
 * Each broadcast worker owns its own FIFO shard — no contention.
 * The last worker is a dedicated I/O worker.
 */
export class ParallelProcessor {
  private processingShards: MessageFIFO<IngestedMessage>[];
  private ioTaskQueue: IOTaskQueue | null = null;
  private messagePersistence: MessagePersistence | null = null;
  private sseManager: SSEConnectionManager | null = null;
  private topicBuffer: TopicMessageBuffer | null = null;
  private isRunning: boolean = false;
  private workerLoops: Promise<void>[] = [];
  private messageProcessor: MessageProcessor;
  private readonly pollIntervalMs: number = 1;
  private readonly totalWorkers: number;
  private readonly broadcastWorkerCount: number;

  constructor(
    processingShards: MessageFIFO<IngestedMessage>[],
    messageProcessor: MessageProcessor,
    ioTaskQueue?: IOTaskQueue,
    messagePersistence?: MessagePersistence,
    sseManager?: SSEConnectionManager,
    topicBuffer?: TopicMessageBuffer,
  ) {
    this.processingShards = processingShards;
    this.messageProcessor = messageProcessor;
    this.broadcastWorkerCount = processingShards.length;
    this.totalWorkers = this.broadcastWorkerCount + 1; // +1 for I/O worker
    this.ioTaskQueue = ioTaskQueue || null;
    this.messagePersistence = messagePersistence || null;
    this.sseManager = sseManager || null;
    this.topicBuffer = topicBuffer || null;
  }

  /**
   * Initializes the parallel processor.
   */
  async initialize(): Promise<void> {
    logger.info({
      broadcastWorkers: this.broadcastWorkerCount,
      totalWorkers: this.totalWorkers,
    }, 'Parallel processor initialized (sharded)');
  }

  /**
   * Starts sharded parallel processing.
   * Spawns one consumer loop per shard + one dedicated I/O worker.
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Parallel processor already running');
      return;
    }

    this.isRunning = true;
    this.workerLoops = [];

    // Spawn one broadcast consumer per shard — each owns its own FIFO
    for (let i = 0; i < this.broadcastWorkerCount; i++) {
      this.workerLoops.push(this.runBroadcastLoop(i));
    }

    // Spawn dedicated I/O worker
    if (this.ioTaskQueue) {
      this.workerLoops.push(this.runIOWorkerLoop());
    }

    logger.info({
      broadcastWorkers: this.broadcastWorkerCount,
      ioWorker: !!this.ioTaskQueue,
    }, 'Sharded parallel processor started');
  }

  /**
   * Broadcast consumer loop — owns a dedicated shard FIFO.
   * No contention: only this loop pops from this shard.
   */
  private async runBroadcastLoop(shardIndex: number): Promise<void> {
    const myFifo = this.processingShards[shardIndex];
    logger.info({ shardIndex, capacity: myFifo.getCapacity() }, 'Broadcast consumer started');

    while (this.isRunning) {
      const message = myFifo.pop();

      if (message) {
        try {
          const result = await this.messageProcessor(message, shardIndex);

          if (!result.success) {
            logger.error(
              { messageId: message.messageId, error: result.error, shardIndex },
              'Message processing failed'
            );
          }
        } catch (error) {
          logger.error(
            { messageId: message.messageId, error, shardIndex },
            'Error in broadcast loop'
          );
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
      }
    }

    logger.info({ shardIndex }, 'Broadcast consumer stopped');
  }

  /**
   * Dedicated I/O worker loop — processes persistence and history tasks.
   */
  private async runIOWorkerLoop(): Promise<void> {
    logger.info('I/O worker started');

    while (this.isRunning) {
      const task = this.ioTaskQueue!.pop();

      if (task) {
        try {
          await this.processIOTask(task);
        } catch (error) {
          logger.error({ task, error }, 'Error processing I/O task');
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    }

    logger.info('I/O worker stopped');
  }

  /**
   * Processes an I/O task (Worker 1 only).
   */
  private async processIOTask(task: IOTask): Promise<void> {
    switch (task.type) {
      case 'serve-history':
        if (this.sseManager && this.topicBuffer && task.clientId && task.topic) {
          const history = this.topicBuffer.getForPattern(task.topic);
          for (const msg of history) {
            this.sseManager.sendToClient(task.clientId, 'sensor', msg);
          }
        }
        break;

      default:
        logger.warn({ task }, 'Unknown I/O task type');
    }
  }

  /**
   * Stops all processing workers.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping parallel processor');
    this.isRunning = false;

    // Wait for all loops to finish
    await Promise.all(this.workerLoops);

    logger.info('Parallel processor stopped');
  }

  /**
   * Gets statistics about the parallel processor.
   */
  getStats() {
    const shardStats = this.processingShards.map((shard, i) => ({
      shard: i,
      count: shard.getCount(),
      capacity: shard.getCapacity(),
      overflowCount: shard.getStats().overflowCount,
    }));

    return {
      isRunning: this.isRunning,
      broadcastWorkers: this.broadcastWorkerCount,
      totalWorkers: this.totalWorkers,
      shards: shardStats,
      totalFifoCount: shardStats.reduce((sum, s) => sum + s.count, 0),
      totalFifoCapacity: shardStats.reduce((sum, s) => sum + s.capacity, 0),
    };
  }
}
