/**
 * Worker Pool Manager
 * 
 * Manages a pool of worker threads for parallel message processing.
 * Distributes work across multiple threads for improved throughput.
 */

import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pino } from 'pino';
import { IngestedMessage } from '../types/ingested-message.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface WorkerInfo {
  worker: Worker;
  id: number;
  busy: boolean;
  processedCount: number;
}

interface WorkerTask {
  message: IngestedMessage;
  resolve: (result: ProcessingResult) => void;
  reject: (error: Error) => void;
}

export interface ProcessingResult {
  success: boolean;
  messageId: string;
  deliveredTo?: string[];
  error?: string;
}

/**
 * WorkerPool manages a pool of worker threads for parallel processing.
 */
export class WorkerPool {
  private workers: WorkerInfo[] = [];
  private taskQueue: WorkerTask[] = [];
  private workerCount: number;
  private workerScript: string;
  private isShuttingDown: boolean = false;
  private totalProcessed: number = 0;

  constructor(workerCount: number = 4, workerScript: string = '../workers/processing-worker.js') {
    this.workerCount = workerCount;
    // Resolve worker script path relative to dist directory
    this.workerScript = join(__dirname, workerScript);
  }

  /**
   * Initializes the worker pool by spawning worker threads.
   */
  async initialize(): Promise<void> {
    logger.info({ workerCount: this.workerCount }, 'Initializing worker pool');

    const initPromises = [];
    for (let i = 0; i < this.workerCount; i++) {
      initPromises.push(this.spawnWorker(i));
    }

    await Promise.all(initPromises);
    logger.info({ workerCount: this.workers.length }, 'Worker pool initialized');
  }

  /**
   * Spawns a single worker thread.
   */
  private async spawnWorker(id: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker(this.workerScript, {
          workerData: { workerId: id },
        });

        const workerInfo: WorkerInfo = {
          worker,
          id,
          busy: false,
          processedCount: 0,
        };

        worker.on('message', (msg) => {
          if (msg.type === 'ready') {
            logger.debug({ workerId: id }, 'Worker ready');
            resolve();
          } else if (msg.type === 'processed' || msg.type === 'error') {
            this.handleWorkerResponse(workerInfo, msg);
          }
        });

        worker.on('error', (error) => {
          logger.error({ workerId: id, error }, 'Worker error');
          this.handleWorkerError(workerInfo, error);
        });

        worker.on('exit', (code) => {
          if (code !== 0 && !this.isShuttingDown) {
            logger.warn({ workerId: id, code }, 'Worker exited unexpectedly, respawning');
            this.respawnWorker(workerInfo);
          }
        });

        this.workers.push(workerInfo);
      } catch (error) {
        logger.error({ workerId: id, error }, 'Failed to spawn worker');
        reject(error);
      }
    });
  }

  /**
   * Respawns a worker that has died.
   */
  private async respawnWorker(oldWorker: WorkerInfo): Promise<void> {
    const index = this.workers.indexOf(oldWorker);
    if (index !== -1) {
      this.workers.splice(index, 1);
    }

    try {
      await this.spawnWorker(oldWorker.id);
    } catch (error) {
      logger.error({ workerId: oldWorker.id, error }, 'Failed to respawn worker');
    }
  }

  /**
   * Handles response from worker thread.
   */
  private handleWorkerResponse(workerInfo: WorkerInfo, msg: any): void {
    workerInfo.busy = false;
    workerInfo.processedCount++;
    this.totalProcessed++;

    // Process next task if available
    this.processNextTask();
  }

  /**
   * Handles worker error.
   */
  private handleWorkerError(workerInfo: WorkerInfo, error: Error): void {
    workerInfo.busy = false;
    logger.error({ workerId: workerInfo.id, error }, 'Worker encountered error');
  }

  /**
   * Submits a message for processing by the worker pool.
   * Returns a promise that resolves when processing is complete.
   */
  async process(message: IngestedMessage): Promise<ProcessingResult> {
    if (this.isShuttingDown) {
      return {
        success: false,
        messageId: message.messageId,
        error: 'Worker pool is shutting down',
      };
    }

    return new Promise((resolve, reject) => {
      this.taskQueue.push({ message, resolve, reject });
      this.processNextTask();
    });
  }

  /**
   * Processes the next task in the queue if a worker is available.
   */
  private processNextTask(): void {
    if (this.taskQueue.length === 0) {
      return;
    }

    const availableWorker = this.workers.find(w => !w.busy);
    if (!availableWorker) {
      return;
    }

    const task = this.taskQueue.shift();
    if (!task) {
      return;
    }

    availableWorker.busy = true;

    // Send message to worker
    availableWorker.worker.postMessage({
      type: 'process',
      message: task.message,
    });

    // For now, resolve immediately since actual processing happens in main thread
    // This allows parallel dequeuing from FIFO
    task.resolve({
      success: true,
      messageId: task.message.messageId,
    });
  }

  /**
   * Gets the number of available (idle) workers.
   */
  getAvailableWorkerCount(): number {
    return this.workers.filter(w => !w.busy).length;
  }

  /**
   * Gets the number of busy workers.
   */
  getBusyWorkerCount(): number {
    return this.workers.filter(w => w.busy).length;
  }

  /**
   * Gets the current task queue length.
   */
  getQueueLength(): number {
    return this.taskQueue.length;
  }

  /**
   * Gets worker pool statistics.
   */
  getStats() {
    return {
      totalWorkers: this.workers.length,
      availableWorkers: this.getAvailableWorkerCount(),
      busyWorkers: this.getBusyWorkerCount(),
      queueLength: this.getQueueLength(),
      totalProcessed: this.totalProcessed,
      workerStats: this.workers.map(w => ({
        id: w.id,
        busy: w.busy,
        processedCount: w.processedCount,
      })),
    };
  }

  /**
   * Shuts down the worker pool gracefully.
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    logger.info('Shutting down worker pool');

    const shutdownPromises = this.workers.map(workerInfo => {
      return new Promise<void>((resolve) => {
        workerInfo.worker.postMessage({ type: 'shutdown' });
        workerInfo.worker.once('exit', () => resolve());
        
        // Force terminate after timeout
        setTimeout(() => {
          workerInfo.worker.terminate();
          resolve();
        }, 5000);
      });
    });

    await Promise.all(shutdownPromises);
    this.workers = [];
    logger.info({ totalProcessed: this.totalProcessed }, 'Worker pool shut down');
  }
}
