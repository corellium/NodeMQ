/**
 * Sensor Subscription Service - Main Entry Point
 *
 * Requirements: 1.1, 2.1, 5.1, 6.1
 *
 * This is the main entry point that:
 * - Creates HTTP server with REST endpoints
 * - Wires all components together with EventEmitter hub
 * - Handles sensor data ingestion, SSE streaming, and health checks
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { pino } from 'pino';

import { TopicManager } from './services/topic-manager.js';
import { SSEConnectionManager } from './services/sse-connection-manager.js';
import { SensorIngestionService } from './services/sensor-ingestion-service.js';
import { ConfigManager, ServiceConfig } from './services/config-manager.js';
import { MessagePersistence } from './services/message-persistence.js';
import { HealthMonitor } from './services/health-monitor.js';
import { TopicRegistry } from './services/topic-registry.js';
import { IngestedMessage } from './types/ingested-message.js';
import { MessageFIFO, FIFOStats } from './utils/fifo.js';
import { TopicMessageBuffer } from './utils/topic-message-buffer.js';
import { ParallelProcessor } from './services/parallel-processor.js';
import { IOTaskQueue, IOTask } from './utils/io-task-queue.js';

// Default FIFO capacities (overridden by config after load)
const DEFAULT_INGESTION_FIFO_SIZE = 512;
const DEFAULT_PROCESSING_FIFO_SIZE = 512;
// Default topic buffer size - per-topic ring buffer for replay to new subscribers
// Sized to hold ~2000 messages across all topics for historical replay
const DEFAULT_TOPIC_BUFFER_SIZE = 2000;
// Adaptive backoff: start at 0ms (tight loop), cap at 5ms when idle
const FIFO_POLL_MIN_MS = 0;
const FIFO_POLL_MAX_MS = 5;
// Default number of concurrent processing loops
const DEFAULT_PARALLEL_WORKERS = 4;

// Initialize logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'warn',  // Changed from 'info' to eliminate per-message logging
});

/**
 * Service event types for the EventEmitter hub.
 */
export interface ServiceEvents {
  'message:ingested': (message: IngestedMessage) => void;
  'message:persisted': (message: IngestedMessage) => void;
  'message:routed': (message: IngestedMessage) => void;
  'message:delivered': (message: IngestedMessage, clientIds: string[]) => void;
}

/**
 * SensorSubscriptionService orchestrates all components.
 */
export class SensorSubscriptionService {
  private server: ReturnType<typeof createServer> | null = null;
  private eventHub: EventEmitter;
  private topicManager: TopicManager;
  private sseManager: SSEConnectionManager;
  private ingestionService: SensorIngestionService;
  private configManager: ConfigManager;
  private messagePersistence: MessagePersistence;
  private healthMonitor: HealthMonitor;
  private topicRegistry: TopicRegistry;
  private port: number;
  private isRunning: boolean = false;

  // FIFO message queues - embedded-style bounded buffers
  private ingestionFifo: MessageFIFO<IngestedMessage>;
  private processingFifo: MessageFIFO<IngestedMessage>;
  private fifoWorkerRunning: boolean = false;

  // Parallel processor for concurrent message processing
  private parallelProcessor: ParallelProcessor | null = null;
  private useParallelProcessing: boolean = true;

  // Per-topic ring buffer for replay to new subscribers
  private topicBuffer: TopicMessageBuffer;

  // I/O task queue for Worker 1
  private ioTaskQueue: IOTaskQueue;

  constructor(configPath: string = './config.json', port: number = 3000) {
    this.port = port;
    this.eventHub = new EventEmitter();

    // Initialize FIFO queues with fixed capacity
    this.ingestionFifo = new MessageFIFO<IngestedMessage>('ingestion', DEFAULT_INGESTION_FIFO_SIZE, 'discard-oldest');
    this.processingFifo = new MessageFIFO<IngestedMessage>('processing', DEFAULT_PROCESSING_FIFO_SIZE, 'discard-oldest');

    // Initialize components
    this.topicManager = new TopicManager();
    this.sseManager = new SSEConnectionManager(this.topicManager);
    this.ingestionService = new SensorIngestionService();
    this.configManager = new ConfigManager(configPath);
    this.healthMonitor = new HealthMonitor();
    this.messagePersistence = new MessagePersistence();
    this.topicRegistry = new TopicRegistry();
    // Topic buffer will be initialized after config load with configured size
    this.topicBuffer = new TopicMessageBuffer(DEFAULT_TOPIC_BUFFER_SIZE);
    // I/O task queue for Worker 1 - sized to match FIFO capacity
    this.ioTaskQueue = new IOTaskQueue(50000);

    this.setupEventHandlers();
    this.setupHealthChecks();
  }


  /**
   * Sets up event handlers for the message processing pipeline.
   */
  private setupEventHandlers(): void {
    // Health monitor alerts
    this.healthMonitor.on('alert', (alertType: string, alertMessage: string) => {
      logger.warn({ alertType }, alertMessage);
    });
  }

  /**
   * Starts the FIFO worker loops for message processing.
   * Two-stage pipeline: ingestion -> persistence -> processing -> delivery
   * 
   * If parallel processing is enabled, uses concurrent async loops for processing stage.
   */
  private async startFifoWorkers(): Promise<void> {
    if (this.fifoWorkerRunning) return;
    this.fifoWorkerRunning = true;

    // Stage 1: Ingestion worker - persists messages then moves to processing queue
    this.runIngestionWorker();

    // Stage 2: Processing - either parallel (concurrent loops) or single-threaded
    if (this.useParallelProcessing) {
      await this.startParallelProcessing();
    } else {
      this.runProcessingWorker();
    }

    logger.info({
      ingestionCapacity: this.ingestionFifo.getCapacity(),
      processingCapacity: this.processingFifo.getCapacity(),
      parallelProcessing: this.useParallelProcessing,
    }, 'FIFO workers started');
  }

  /**
   * Ingestion worker loop - pulls from ingestion FIFO, persists, then pushes to processing FIFO.
   * Persistence is re-enabled - Worker 1 will handle the actual I/O writes.
   */
  private async runIngestionWorker(): Promise<void> {
    let idleMs = FIFO_POLL_MIN_MS;
    while (this.fifoWorkerRunning) {
      const message = this.ingestionFifo.pop();
      
      if (message) {
        idleMs = FIFO_POLL_MIN_MS; // reset backoff on activity
        
        // Persist message (Worker 1 will handle the actual I/O)
        await this.messagePersistence.persist(message);
        this.eventHub.emit('message:persisted', message);
        
        // Push to processing queue for broadcast
        const pushed = this.processingFifo.push(message);
        if (!pushed) {
          logger.warn({ messageId: message.messageId }, 'Processing FIFO full, message dropped');
        }
      } else {
        // Adaptive backoff: ramp up idle sleep to reduce CPU burn when quiet
        await new Promise(resolve => setTimeout(resolve, idleMs));
        if (idleMs < FIFO_POLL_MAX_MS) idleMs = Math.min(idleMs * 2, FIFO_POLL_MAX_MS);
      }
    }
  }

  /**
   * Starts parallel processing using concurrent async loops with specialized worker roles.
   * Worker 0: Handles message broadcasting (SSE delivery) - pulls from processing FIFO
   * Worker 1: Handles I/O operations (persistence, historical data) - pulls from I/O task queue
   */
  private async startParallelProcessing(): Promise<void> {
    const config = this.configManager.getConfig();
    const workerCount = config.parallelWorkers ?? DEFAULT_PARALLEL_WORKERS;

    if (workerCount !== 2) {
      logger.warn({ workerCount }, 'Two-worker architecture requires parallelWorkers=2, adjusting');
    }

    // Create message processor function with worker role specialization
    const messageProcessor = async (message: IngestedMessage, workerId: number) => {
      const startTime = Date.now();
      
      // Worker 0: Broadcast messages to SSE clients (fast path)
      if (workerId === 0) {
        try {
          // Register sensor in topic registry for discovery
          // Extract deviceBus from the topic that was already built (3rd segment)
          const topicParts = message.topic.split('/');
          const deviceBus = topicParts[2] || 'unknown';
          
          this.topicRegistry.register(
            message.topic,
            message.data.sensorId,
            message.data.sensorType,
            message.data.sourceModelId,
            deviceBus,
            message.data
          );

          // Buffer message for replay to future subscribers
          logger.warn({ topic: message.topic, messageId: message.messageId }, 'Worker 0: Pushing message to topic buffer');
          this.topicBuffer.push(message.topic, message.data);

          // Broadcast to SSE subscribers
          const deliveredTo = this.sseManager.broadcast(
            message.topic,
            message.data,
            message.messageId
          );

          // Queue I/O task for Worker 1 to mark as completed
          this.ioTaskQueue.push({
            type: 'mark-completed',
            messageId: message.messageId,
            timestamp: Date.now(),
          });

          this.healthMonitor.recordMessage(true, Date.now() - startTime);
          this.eventHub.emit('message:routed', message);

          if (deliveredTo.length > 0) {
            this.eventHub.emit('message:delivered', message, deliveredTo);
          }

          return { success: true, deliveredTo };
        } catch (error) {
          logger.error({ messageId: message.messageId, error, workerId }, 'Worker 0 broadcast error');
          this.healthMonitor.recordMessage(false, Date.now() - startTime);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }
      
      // Worker 1: This shouldn't be called with messages, only I/O tasks
      return { success: true };
    };

    this.parallelProcessor = new ParallelProcessor(
      this.processingFifo,
      messageProcessor,
      2, // Force 2 workers for specialized roles
      this.ioTaskQueue, // Pass I/O task queue for Worker 1
      this.messagePersistence, // Pass persistence for Worker 1
      this.sseManager, // Pass SSE manager for Worker 1 history serving
      this.topicBuffer // Pass topic buffer for Worker 1 history serving
    );

    await this.parallelProcessor.initialize();
    this.parallelProcessor.start();

    logger.info('Two-worker parallel processing started: Worker 0 (broadcast), Worker 1 (I/O)');
  }

  /**
   * Processing worker loop - pulls from processing FIFO, broadcasts to SSE.
   */
  private async runProcessingWorker(): Promise<void> {
    while (this.fifoWorkerRunning) {
      const message = this.processingFifo.pop();
      
      if (message) {
        const startTime = Date.now();
        try {
          // Register sensor in topic registry for discovery
          // Extract deviceBus from the topic that was already built (3rd segment)
          const topicParts = message.topic.split('/');
          const deviceBus = topicParts[2] || 'unknown';
          
          this.topicRegistry.register(
            message.topic,
            message.data.sensorId,
            message.data.sensorType,
            message.data.sourceModelId,
            deviceBus,
            message.data
          );

          // Buffer message for replay to future subscribers
          this.topicBuffer.push(message.topic, message.data);

          // Broadcast to SSE subscribers
          const deliveredTo = this.sseManager.broadcast(
            message.topic,
            message.data,
            message.messageId
          );

          if (deliveredTo.length > 0) {
            this.eventHub.emit('message:delivered', message, deliveredTo);
          }

          // Mark as completed (no-op - persistence disabled for max throughput)
          // this.messagePersistence.markCompleted(message.messageId).catch(...);

          this.healthMonitor.recordMessage(true, Date.now() - startTime);
          this.eventHub.emit('message:routed', message);
        } catch (error) {
          logger.error({ messageId: message.messageId, error }, 'Error routing message');
          await this.messagePersistence.markFailed(message.messageId);
          this.healthMonitor.recordMessage(false, Date.now() - startTime);
        }
      } else {
        // Fixed 1ms poll - negligible CPU overhead, eliminates latency spikes
        await new Promise(resolve => setTimeout(resolve, FIFO_POLL_MIN_MS));
      }
    }
  }

  /**
   * Stops the FIFO worker loops.
   */
  private async stopFifoWorkers(): Promise<void> {
    this.fifoWorkerRunning = false;

    // Stop parallel processor if running
    if (this.parallelProcessor) {
      await this.parallelProcessor.stop();
      this.parallelProcessor = null;
    }

    logger.info('FIFO workers stopped');
  }

  /**
   * Gets FIFO statistics for monitoring.
   */
  getFifoStats(): { ingestion: FIFOStats; processing: FIFOStats } {
    return {
      ingestion: this.ingestionFifo.getStats(),
      processing: this.processingFifo.getStats(),
    };
  }

  /**
   * Sets up health checks for the service.
   */
  private setupHealthChecks(): void {
    this.healthMonitor.registerHealthCheck('persistence', () => {
      return this.messagePersistence !== null;
    });

    this.healthMonitor.registerHealthCheck('configLoaded', () => {
      return this.configManager.getConfig() !== null;
    });
  }


  /**
   * Initializes the service by loading configuration and setting up persistence.
   */
  async initialize(): Promise<void> {
    const startTime = Date.now();

    // Load configuration
    const configResult = await this.configManager.load();
    if (configResult.success && configResult.config) {
      logger.info({ configPath: this.configManager.getConfigPath() }, 'Configuration loaded');

      // Update persistence path
      this.messagePersistence = new MessagePersistence(configResult.config.persistencePath);
      
      // Reinitialize topic buffer with configured size
      this.topicBuffer = new TopicMessageBuffer(configResult.config.topicBufferSize);

      // Reinitialize FIFOs with configured sizes
      this.ingestionFifo = new MessageFIFO<IngestedMessage>(
        'ingestion',
        configResult.config.ingestionFifoSize,
        'discard-oldest'
      );
      this.processingFifo = new MessageFIFO<IngestedMessage>(
        'processing',
        configResult.config.processingFifoSize,
        'discard-oldest'
      );

      logger.info({
        ingestionFifoSize: configResult.config.ingestionFifoSize,
        processingFifoSize: configResult.config.processingFifoSize,
        parallelWorkers: configResult.config.parallelWorkers,
      }, 'FIFO queues configured');
    } else {
      logger.warn({ error: configResult.error }, 'Using default configuration');
    }

    // Initialize persistence
    await this.messagePersistence.initialize();

    // Purge stale completed/exhausted messages left from previous runs
    const purged = await this.messagePersistence.purgeStaleMessages(
      configResult.config?.retryConfig?.maxRetries ?? 5
    );
    if (purged > 0) {
      logger.info({ purged }, 'Purged stale persisted messages');
    }

    // Set up config hot-reload
    this.configManager.onConfigChange((config: ServiceConfig) => {
      logger.info({ topicBufferSize: config.topicBufferSize }, 'Configuration reloaded');
      // Reinitialize topic buffer with new size
      this.topicBuffer = new TopicMessageBuffer(config.topicBufferSize);
      // Note: FIFO sizes cannot be hot-reloaded - requires service restart
    });
    this.configManager.startWatching();

    logger.info({ elapsedMs: Date.now() - startTime }, 'Service initialized');
  }

  /**
   * Recovers and processes pending messages from persistence.
   * Called on service startup to resume processing.
   * Pushes recovered messages directly to processing FIFO.
   */
  private async recoverPendingMessages(): Promise<void> {
    const pendingBySource = await this.messagePersistence.getPendingMessagesBySource();

    for (const [sourceModelId, messages] of pendingBySource) {
      logger.info({ sourceModelId, count: messages.length }, 'Recovering pending messages');

      for (const persistedMessage of messages) {
        // Push to processing FIFO (already persisted)
        this.processingFifo.push(persistedMessage.data);
      }
    }
  }

  /**
   * Parses the request body as JSON.
   */
  private parseBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (error) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * Parses URL query parameters.
   * Uses URLSearchParams for splitting, then decodeURIComponent on each value
   * so that %2B in topic patterns is preserved as the MQTT '+' wildcard
   * rather than being treated as a space by URLSearchParams.
   */
  private parseQuery(url: string): URLSearchParams {
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) return new URLSearchParams();
    // Re-encode spaces as %20 so URLSearchParams doesn't collapse + into space,
    // then decode each value properly via decodeURIComponent at the call site.
    // Simpler: parse the raw query string ourselves preserving %2B.
    const raw = url.slice(queryIndex + 1);
    const params = new URLSearchParams();
    for (const pair of raw.split('&')) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) continue;
      const key = decodeURIComponent(pair.slice(0, eqIdx));
      // Decode value but treat + as literal + (not space) by pre-replacing %2B
      const rawVal = pair.slice(eqIdx + 1).replace(/\+/g, '%2B');
      const val = decodeURIComponent(rawVal);
      params.append(key, val);
    }
    return params;
  }

  /**
   * Sends a JSON response.
   */
  private sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  /**
   * Handles POST /ingest - Sensor data ingestion endpoint.
   * Requirements: 1.1, 1.2, 1.3, 1.4
   * 
   * Pushes validated messages to the ingestion FIFO for processing.
   */
  private async handleIngest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.parseBody(req);
      
      const result = this.ingestionService.ingest(body);

      if (!result.success) {
        this.sendJson(res, 400, {
          success: false,
          error: result.error,
        });
        return;
      }

      // Push to ingestion FIFO (bounded queue)
      const pushed = this.ingestionFifo.push(result.message!);
      
      if (!pushed) {
        // FIFO full and policy is reject-new
        this.sendJson(res, 503, {
          success: false,
          error: 'Ingestion queue full',
          messageId: result.messageId,
        });
        return;
      }

      this.sendJson(res, 200, {
        success: true,
        messageId: result.messageId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.sendJson(res, 400, {
        success: false,
        error: errorMessage,
      });
    }
  }


  /**
   * Handles GET /subscribe - SSE subscription endpoint.
   * Requirements: 2.1, 2.2, 2.5
   * Worker 1 handles serving historical data via I/O task queue.
   */
  private handleSubscribe(req: IncomingMessage, res: ServerResponse): void {
    const query = this.parseQuery(req.url || '');
    const topics = query.getAll('topic');
    const clientId = query.get('clientId') || randomUUID();

    // Add client to SSE manager
    this.sseManager.addClient(clientId, res);
    this.healthMonitor.incrementConnections();

    logger.info({ clientId, topics }, 'SSE client connected');

    // Subscribe to requested topics
    for (const topic of topics) {
      this.sseManager.subscribe(clientId, topic);
      
      // Queue I/O task for Worker 1 to serve historical data
      const historyCount = this.topicBuffer.getForPattern(topic).length;
      if (historyCount > 0) {
        this.ioTaskQueue.push({
          type: 'serve-history',
          clientId,
          topic,
          timestamp: Date.now(),
        });
        logger.debug({ clientId, topic, historyCount }, 'Queued history serving task for Worker 1');
      }
    }

    // Send initial connection event
    this.sseManager.sendToClient(clientId, 'connected', {
      clientId,
      subscribedTopics: topics,
    });

    // Handle disconnect
    res.on('close', () => {
      this.healthMonitor.decrementConnections();
      logger.info({ clientId }, 'SSE client disconnected');
    });
  }

  /**
   * Handles POST /subscribe - Add subscription for existing client.
   * Worker 1 handles serving historical data via I/O task queue.
   */
  private async handleAddSubscription(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.parseBody(req) as { clientId?: string; topic?: string };

      if (!body.clientId || !body.topic) {
        this.sendJson(res, 400, {
          success: false,
          error: 'Missing clientId or topic',
        });
        return;
      }

      const success = this.sseManager.subscribe(body.clientId, body.topic);

      if (!success) {
        this.sendJson(res, 404, {
          success: false,
          error: 'Client not found',
        });
        return;
      }

      // Queue I/O task for Worker 1 to serve historical data
      const allTopics = this.topicBuffer.getTopics();
      const historyMessages = this.topicBuffer.getForPattern(body.topic);
      const historyCount = historyMessages.length;
      logger.warn({ 
        clientId: body.clientId, 
        topic: body.topic, 
        historyCount,
        totalTopicsInBuffer: allTopics.length,
        sampleTopics: allTopics.slice(0, 5),
        queueing: historyCount > 0
      }, 'POST /subscribe: Queueing history task');
      
      if (historyCount > 0) {
        this.ioTaskQueue.push({
          type: 'serve-history',
          clientId: body.clientId,
          topic: body.topic,
          timestamp: Date.now(),
        });
      }

      this.sendJson(res, 200, {
        success: true,
        clientId: body.clientId,
        topic: body.topic,
        historyQueued: historyCount,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.sendJson(res, 400, {
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * Handles DELETE /subscribe - Remove subscription.
   */
  private async handleRemoveSubscription(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.parseBody(req) as { clientId?: string; topic?: string };

      if (!body.clientId || !body.topic) {
        this.sendJson(res, 400, {
          success: false,
          error: 'Missing clientId or topic',
        });
        return;
      }

      const success = this.sseManager.unsubscribe(body.clientId, body.topic);

      if (!success) {
        this.sendJson(res, 404, {
          success: false,
          error: 'Client not found',
        });
        return;
      }

      this.sendJson(res, 200, {
        success: true,
        clientId: body.clientId,
        topic: body.topic,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.sendJson(res, 400, {
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * Handles GET /health - Health check endpoint.
   * Requirements: 6.1
   */
  private handleHealth(_req: IncomingMessage, res: ServerResponse): void {
    const health = this.healthMonitor.getHealth();
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;

    this.sendJson(res, statusCode, health);
  }

  /**
   * Handles GET /metrics - Metrics endpoint.
   * Requirements: 6.4
   */
  private handleMetrics(_req: IncomingMessage, res: ServerResponse): void {
    const metrics = this.healthMonitor.getMetrics();
    const fifoStats = this.getFifoStats();
    const persistenceStats = this.messagePersistence.getStats();
    
    const response: any = {
      ...metrics,
      // Topic buffer metrics - in-memory replay buffer for new subscribers
      buffer: {
        topicCount: this.topicBuffer.getTopicCount(),
        totalMessages: this.topicBuffer.getTotalCount(),
        maxPerTopic: this.configManager.getTopicBufferSize(),
      },
      // FIFO queue metrics - ingestion and processing queues
      fifo: {
        ingestion: {
          count: fifoStats.ingestion.count,
          capacity: fifoStats.ingestion.capacity,
          overflowCount: fifoStats.ingestion.overflowCount,
          fillPercent: Math.round((fifoStats.ingestion.count / fifoStats.ingestion.capacity) * 100),
        },
        processing: {
          count: fifoStats.processing.count,
          capacity: fifoStats.processing.capacity,
          overflowCount: fifoStats.processing.overflowCount,
          fillPercent: Math.round((fifoStats.processing.count / fifoStats.processing.capacity) * 100),
        },
      },
      // I/O task queue metrics - Worker 1 task queue
      ioTaskQueue: {
        count: this.ioTaskQueue.getCount(),
        capacity: this.ioTaskQueue.getCapacity(),
        fillPercent: Math.round((this.ioTaskQueue.getCount() / this.ioTaskQueue.getCapacity()) * 100),
      },
      // Persistence metrics - log-based storage
      persistence: persistenceStats,
    };

    // Add parallel processor stats if enabled
    if (this.parallelProcessor) {
      response.parallelProcessor = this.parallelProcessor.getStats();
    }
    
    this.sendJson(res, 200, response);
  }

  /**
   * Handles GET /topics - Returns all known sensor topics for discovery.
   */
  private handleTopics(req: IncomingMessage, res: ServerResponse): void {
    const query = this.parseQuery(req.url || '');
    const sourceModelId = query.get('sourceModelId') || undefined;
    const sensorType = query.get('sensorType') || undefined;
    const deviceBus = query.get('deviceBus') || undefined;
    const type = query.get('type') || undefined;

    const sensors = this.topicRegistry.filter({ sourceModelId, sensorType, deviceBus, type });
    const suggestedPatterns = this.topicRegistry.getSuggestedPatterns();
    const activeTopics = this.topicBuffer.getTopics();

    this.sendJson(res, 200, {
      sensors,
      activeTopics,
      suggestedPatterns,
      filters: {
        sourceModelIds: this.topicRegistry.getUniqueValues('sourceModelId'),
        sensorTypes: this.topicRegistry.getUniqueValues('sensorType'),
        deviceBuses: this.topicRegistry.getUniqueValues('deviceBus'),
        types: this.topicRegistry.getUniqueValues('type'),
      },
      count: sensors.length,
    });
  }

  /**
   * Handles GET /queues - Returns buffered messages for a topic or pattern.
   *
   * Query params:
   *   topic  - exact topic or MQTT wildcard pattern (required)
   *
   * Example:
   *   GET /queues?topic=sensors/max30123-spi/default/PSTAT/max30123-spi/fifoPush
   *   GET /queues?topic=sensors/max30123-spi/#
   *
   * Returns:
   *   { topic, messages: [...], count }
   */
  private handleQueues(req: IncomingMessage, res: ServerResponse): void {
    const query = this.parseQuery(req.url || '');
    const topic = query.get('topic');

    if (!topic) {
      this.sendJson(res, 400, { success: false, error: 'Missing required query param: topic' });
      return;
    }

    const messages = this.topicBuffer.getForPattern(topic);
    this.sendJson(res, 200, { topic, messages, count: messages.length });
  }

  /**
   * Main request handler.
   */
  private handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url || '/';
    const method = req.method || 'GET';
    const path = url.split('?')[0];

    logger.debug({ method, path }, 'Request received');

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // Route requests
      if (path === '/ingest' && method === 'POST') {
        await this.handleIngest(req, res);
      } else if (path === '/subscribe' && method === 'GET') {
        this.handleSubscribe(req, res);
      } else if (path === '/subscribe' && method === 'POST') {
        await this.handleAddSubscription(req, res);
      } else if (path === '/subscribe' && method === 'DELETE') {
        await this.handleRemoveSubscription(req, res);
      } else if (path === '/health' && method === 'GET') {
        this.handleHealth(req, res);
      } else if (path === '/metrics' && method === 'GET') {
        this.handleMetrics(req, res);
      } else if (path === '/topics' && method === 'GET') {
        this.handleTopics(req, res);
      } else if (path === '/queues' && method === 'GET') {
        this.handleQueues(req, res);
      } else {
        this.sendJson(res, 404, { error: 'Not found' });
      }
    } catch (error) {
      logger.error({ error, path, method }, 'Request handler error');
      this.sendJson(res, 500, { error: 'Internal server error' });
    }
  };


  /**
   * Starts the HTTP server.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Service is already running');
      return;
    }

    await this.initialize();

    this.server = createServer(this.handleRequest);

    // Start FIFO worker loops BEFORE recovery so they can drain the queue
    await this.startFifoWorkers();

    // Recover pending messages - workers will process them as they're pushed
    await this.recoverPendingMessages();

    // Start heartbeat for SSE connections
    const config = this.configManager.getConfig();
    this.sseManager.startHeartbeat(config.heartbeatIntervalMs);

    return new Promise((resolve) => {
      this.server!.listen(this.port, '0.0.0.0', () => {
        this.isRunning = true;
        logger.info({ port: this.port, host: '0.0.0.0' }, 'Sensor Subscription Service started');
        resolve();
      });
    });
  }

  /**
   * Stops the HTTP server and cleans up resources.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping Sensor Subscription Service...');

    // Stop FIFO workers
    await this.stopFifoWorkers();

    // Stop heartbeat
    this.sseManager.stopHeartbeat();

    // Stop config watching
    this.configManager.stopWatching();

    // Flush and close persistence
    await this.messagePersistence.flush();
    await this.messagePersistence.close();

    // Log final FIFO stats
    const fifoStats = this.getFifoStats();
    logger.info({
      ingestionRemaining: fifoStats.ingestion.count,
      processingRemaining: fifoStats.processing.count,
      ingestionOverflows: fifoStats.ingestion.overflowCount,
      processingOverflows: fifoStats.processing.overflowCount,
    }, 'Final FIFO statistics');

    // Log persistence stats
    const persistenceStats = this.messagePersistence.getStats();
    logger.info(persistenceStats, 'Final persistence statistics');

    // Close server
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.isRunning = false;
          logger.info('Sensor Subscription Service stopped');
          resolve();
        });
      });
    }

    this.isRunning = false;
  }

  /**
   * Gets the event hub for external event handling.
   */
  getEventHub(): EventEmitter {
    return this.eventHub;
  }

  /**
   * Gets the health monitor instance.
   */
  getHealthMonitor(): HealthMonitor {
    return this.healthMonitor;
  }

  /**
   * Gets the SSE connection manager.
   */
  getSSEManager(): SSEConnectionManager {
    return this.sseManager;
  }

  /**
   * Gets the topic manager.
   */
  getTopicManager(): TopicManager {
    return this.topicManager;
  }

  /**
   * Gets the message persistence.
   */
  getMessagePersistence(): MessagePersistence {
    return this.messagePersistence;
  }

  /**
   * Gets the config manager.
   */
  getConfigManager(): ConfigManager {
    return this.configManager;
  }

  /**
   * Gets the ingestion service.
   */
  getIngestionService(): SensorIngestionService {
    return this.ingestionService;
  }

  /**
   * Checks if the service is running.
   */
  isServiceRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Gets the server port.
   */
  getPort(): number {
    return this.port;
  }
}

// Export for use in tests and other modules
export {
  TopicManager,
  SSEConnectionManager,
  SensorIngestionService,
  ConfigManager,
  MessagePersistence,
  HealthMonitor,
};

// Main entry point - only run if this is the main module
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const configPath = process.env.CONFIG_PATH || './config.json';
  const port = parseInt(process.env.PORT || '3000', 10);

  const service = new SensorSubscriptionService(configPath, port);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await service.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await service.stop();
    process.exit(0);
  });

  // Start the service
  service.start().catch((error) => {
    logger.error({ error }, 'Failed to start service');
    process.exit(1);
  });
}
