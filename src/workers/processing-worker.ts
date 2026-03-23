/**
 * Processing Worker Thread
 * 
 * Runs in a separate thread to process messages from the processing FIFO.
 * Communicates with main thread via message passing.
 */

import { parentPort, workerData } from 'worker_threads';
import { pino } from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  name: `worker-${workerData.workerId}`,
});

interface WorkerMessage {
  type: 'process' | 'shutdown';
  message?: unknown;
}

interface WorkerResponse {
  type: 'processed' | 'error' | 'ready' | 'shutdown';
  messageId?: string;
  error?: string;
  deliveredTo?: string[];
}

if (!parentPort) {
  throw new Error('This module must be run as a worker thread');
}

logger.info({ workerId: workerData.workerId }, 'Processing worker started');

// Listen for messages from main thread
parentPort.on('message', async (msg: WorkerMessage) => {
  if (msg.type === 'shutdown') {
    logger.info('Worker shutting down');
    parentPort!.postMessage({ type: 'shutdown' } as WorkerResponse);
    process.exit(0);
  }

  if (msg.type === 'process' && msg.message) {
    try {
      // Message processing happens in main thread via callback
      // Worker just signals readiness and handles the message
      parentPort!.postMessage({
        type: 'processed',
        messageId: (msg.message as any).messageId,
      } as WorkerResponse);
    } catch (error) {
      logger.error({ error }, 'Error processing message');
      parentPort!.postMessage({
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      } as WorkerResponse);
    }
  }
});

// Signal ready
parentPort.postMessage({ type: 'ready' } as WorkerResponse);
