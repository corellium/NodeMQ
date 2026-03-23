/**
 * Parallel Processor Service
 * 
 * Manages parallel processing of messages using concurrent async loops.
 * Multiple independent loops pull from FIFO and process messages concurrently.
 * 
 * This provides true parallelism for I/O-bound operations (SSE broadcasts, 
 * persistence) without the overhead of worker threads. Each loop runs 
 * independently in the Node.js event loop.
 */

import { pino } from 'pino';
import { WorkerPool } from './worker-pool.js';
import { MessageFIFO } from '../utils/fifo.js';
import { IngestedMessage } from '../types/ingested-message.js';
import { IOTaskQueue, IOTask } from '../utils/io-task-queue.js';
import { MessagePersistence } from './message-persistence.js';
import { SSEConnectionManager } from './sse-connection-manager.js';
import { TopicMessageBuffer } from '../utils/topic-message-buffer.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'warn',  // Changed from 'info' to eliminate per-message logging
});

export type MessageProcessor = (message: IngestedMessage, workerId: number) => Promise<{
  success: boolean;
  deliveredTo?: string[];
  error?: string;
}>;

/**
 * ParallelProcessor manages parallel message processing with worker threads.
 */
export class ParallelProcessor {
  private workerPool: WorkerPool;
  private processingFifo: MessageFIFO<IngestedMessage>;
  private ioTaskQueue: IOTaskQueue | null = null;
  private messagePersistence: MessagePersistence | null = null;
  private sseManager: SSEConnectionManager | null = null;
  private topicBuffer: TopicMessageBuffer | null = null;
  private isRunning: boolean = false;
  private workerLoops: Promise<void>[] = [];
  private messageProcessor: MessageProcessor;
  private readonly pollIntervalMs: number = 0;
  private readonly parallelWorkers: number;

  constructor(
    processingFifo: MessageFIFO<IngestedMessage>,
    messageProcessor: MessageProcessor,
    parallelWorkers: number = 4,
    ioTaskQueue?: IOTaskQueue,
    messagePersistence?: MessagePersistence,
    sseManager?: SSEConnectionManager,
    topicBuffer?: TopicMessageBuffer,
  ) {
    this.processingFifo = processingFifo;
    this.messageProcessor = messageProcessor;
    this.parallelWorkers = parallelWorkers;
    this.ioTaskQueue = ioTaskQueue || null;
    this.messagePersistence = messagePersistence || null;
    this.sseManager = sseManager || null;
    this.topicBuffer = topicBuffer || null;
    // Worker pool is created but not used - concurrent async loops provide parallelism
    this.workerPool = new WorkerPool(parallelWorkers);
  }

  /**
   * Initializes the parallel processor.
   * Worker pool is initialized but not actively used - concurrent loops provide parallelism.
   */
  async initialize(): Promise<void> {
    await this.workerPool.initialize();
    logger.info({ concurrentLoops: this.parallelWorkers }, 'Parallel processor initialized');
  }

  /**
   * Starts parallel processing with concurrent async loops.
   * Spawns multiple independent loops that pull from FIFO and process concurrently.
   * 
   * This achieves true parallelism for I/O-bound operations without worker thread overhead.
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Parallel processor already running');
      return;
    }

    this.isRunning = true;
    this.workerLoops = [];

    // Spawn multiple concurrent consumer loops for parallel processing
    // Each loop independently pulls from FIFO and processes messages
    for (let i = 0; i < this.parallelWorkers; i++) {
      this.workerLoops.push(this.runProcessorLoop(i));
    }

    logger.info({ concurrentLoops: this.parallelWorkers }, 'Parallel processor started');
  }

  /**
   * Individual processor loop - pulls from FIFO and processes messages.
   * Each loop runs independently and processes messages in parallel.
   * 
   * Worker 0: Pulls from FIFO and broadcasts messages (fast path)
   * Worker 1: Processes I/O tasks from dedicated I/O queue
   */
  private async runProcessorLoop(loopId: number): Promise<void> {
    logger.info({ loopId }, 'Processor loop started');

    // Worker 1: Dedicated I/O worker - processes I/O tasks
    if (loopId === 1 && this.ioTaskQueue) {
      logger.info({ loopId }, 'Worker 1 running in I/O mode (processing I/O tasks)');
      
      while (this.isRunning) {
        const task = this.ioTaskQueue.pop();

        if (task) {
          try {
            await this.processIOTask(task);
          } catch (error) {
            logger.error({ task, error, loopId }, 'Error processing I/O task');
          }
        } else {
          // No task available, brief sleep to avoid busy-waiting
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      }
      
      logger.info({ loopId }, 'Worker 1 stopped');
      return;
    }

    // Worker 0: Process messages from FIFO
    while (this.isRunning) {
      const message = this.processingFifo.pop();

      if (message) {
        try {
          // Process message directly in this async loop (true parallelism)
          // Pass worker ID to processor for role-based handling
          const result = await this.messageProcessor(message, loopId);

          if (!result.success) {
            logger.error(
              { messageId: message.messageId, error: result.error, loopId },
              'Message processing failed'
            );
          }
          // Success logging removed - use metrics endpoints for throughput monitoring
        } catch (error) {
          logger.error(
            { messageId: message.messageId, error, loopId },
            'Error in processor loop'
          );
        }
      } else {
        // No message available, brief sleep to avoid busy-waiting
        await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
      }
    }

    logger.info({ loopId }, 'Processor loop stopped');
  }

  /**
   * Processes an I/O task (Worker 1 only).
   */
  private async processIOTask(task: IOTask): Promise<void> {
    switch (task.type) {
      case 'mark-completed':
        if (this.messagePersistence && task.messageId) {
          await this.messagePersistence.markCompleted(task.messageId);
          logger.debug({ messageId: task.messageId }, 'Worker 1: Marked message as completed');
        }
        break;

      case 'serve-history':
        if (this.sseManager && this.topicBuffer && task.clientId && task.topic) {
          const history = this.topicBuffer.getForPattern(task.topic);
          logger.warn({ 
            clientId: task.clientId, 
            topic: task.topic, 
            historyCount: history.length 
          }, 'Worker 1: Serving historical data');
          for (const msg of history) {
            this.sseManager.sendToClient(task.clientId, 'sensor', msg);
          }
        } else {
          logger.error({ 
            task,
            hasSseManager: !!this.sseManager,
            hasTopicBuffer: !!this.topicBuffer,
            hasClientId: !!task.clientId,
            hasTopic: !!task.topic
          }, 'Worker 1: Missing dependencies for serve-history');
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

    // Shutdown worker pool
    await this.workerPool.shutdown();

    logger.info('Parallel processor stopped');
  }

  /**
   * Gets statistics about the parallel processor.
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      activeLoops: this.workerLoops.length,
      workerPool: this.workerPool.getStats(),
      fifoCount: this.processingFifo.getCount(),
      fifoCapacity: this.processingFifo.getCapacity(),
    };
  }

  /**
   * Gets the worker pool instance.
   */
  getWorkerPool(): WorkerPool {
    return this.workerPool;
  }
}
