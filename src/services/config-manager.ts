/**
 * ConfigManager - Manages service configuration with hot-reload support.
 *
 * Requirements: 4.1, 4.2, 4.4
 *
 * Features:
 * - Load chip select mappings from configuration on startup
 * - Apply configuration changes without requiring restart
 * - Support mapping sensor types to specific chip select addresses
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Schema for retry configuration.
 */
export const RetryConfigSchema = z.object({
  maxRetries: z.number().int().min(0).default(5),
  initialDelayMs: z.number().int().min(0).default(100),
  maxDelayMs: z.number().int().min(0).default(30000),
  backoffMultiplier: z.number().min(1).default(2),
});

export type RetryConfig = z.infer<typeof RetryConfigSchema>;

/**
 * Schema for the complete service configuration.
 */
export const ServiceConfigSchema = z.object({
  heartbeatIntervalMs: z.number().int().min(1000).default(30000),
  retryConfig: RetryConfigSchema.default({}),
  persistencePath: z.string().default('./data/messages'),
  topicBufferSize: z.number().int().min(1).default(2000),
  parallelWorkers: z.number().int().min(1).max(16).default(4),
  ingestionFifoSize: z.number().int().min(64).default(512),
  processingFifoSize: z.number().int().min(128).default(512),
});

export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;


/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: ServiceConfig = {
  heartbeatIntervalMs: 30000,
  retryConfig: {
    maxRetries: 5,
    initialDelayMs: 100,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
  },
  persistencePath: './data/messages',
  topicBufferSize: 2000,
  parallelWorkers: 4,
  ingestionFifoSize: 512,
  processingFifoSize: 512,
};

/**
 * Result of a configuration load operation.
 */
export interface ConfigLoadResult {
  success: boolean;
  config?: ServiceConfig;
  error?: string;
}

/**
 * Callback type for configuration change events.
 */
export type ConfigChangeCallback = (config: ServiceConfig) => void;

/**
 * ConfigManager handles loading, validating, and hot-reloading service configuration.
 */
export class ConfigManager {
  private config: ServiceConfig;
  private configPath: string;
  private watcher: fs.FSWatcher | null = null;
  private changeCallbacks: Set<ConfigChangeCallback> = new Set();
  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceMs: number = 100;

  /**
   * Creates a new ConfigManager instance.
   *
   * @param configPath - Path to the JSON configuration file
   */
  constructor(configPath: string = './config.json') {
    this.configPath = path.resolve(configPath);
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * Loads configuration from the JSON file.
   * If the file doesn't exist or is invalid, returns default configuration.
   *
   * @returns Promise resolving to the load result
   */
  async load(): Promise<ConfigLoadResult> {
    try {
      // Check if file exists
      if (!fs.existsSync(this.configPath)) {
        // Use defaults if file doesn't exist
        this.config = { ...DEFAULT_CONFIG };
        return {
          success: true,
          config: this.config,
          error: `Config file not found at ${this.configPath}, using defaults`,
        };
      }

      // Read and parse the file
      const fileContent = await fs.promises.readFile(this.configPath, 'utf-8');
      const rawConfig = JSON.parse(fileContent);

      // Validate against schema
      const parseResult = ServiceConfigSchema.safeParse(rawConfig);

      if (!parseResult.success) {
        // Invalid format - keep current config
        return {
          success: false,
          error: `Invalid config format: ${parseResult.error.message}`,
        };
      }

      this.config = parseResult.data;
      return {
        success: true,
        config: this.config,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Handle JSON parse errors
      if (error instanceof SyntaxError) {
        return {
          success: false,
          error: `Invalid JSON in config file: ${errorMessage}`,
        };
      }

      return {
        success: false,
        error: `Failed to load config: ${errorMessage}`,
      };
    }
  }


  /**
   * Reloads configuration from the file.
   * Notifies all registered callbacks if the configuration changes.
   *
   * @returns Promise resolving to the reload result
   */
  async reload(): Promise<ConfigLoadResult> {
    const previousConfig = { ...this.config };
    const result = await this.load();

    if (result.success && result.config) {
      // Check if config actually changed
      const configChanged =
        JSON.stringify(previousConfig) !== JSON.stringify(result.config);

      if (configChanged) {
        // Notify all callbacks
        this.notifyCallbacks();
      }
    }

    return result;
  }

  /**
   * Starts watching the configuration file for changes.
   * When changes are detected, the configuration is automatically reloaded.
   */
  startWatching(): void {
    if (this.watcher) {
      return; // Already watching
    }

    try {
      // Ensure the directory exists for watching
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      this.watcher = fs.watch(
        this.configPath,
        { persistent: false },
        (eventType) => {
          if (eventType === 'change' || eventType === 'rename') {
            this.handleFileChange();
          }
        }
      );

      this.watcher.on('error', () => {
        // Silently handle watcher errors - file may not exist yet
        this.stopWatching();
      });
    } catch {
      // File may not exist yet - that's okay
    }
  }

  /**
   * Stops watching the configuration file.
   */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Handles file change events with debouncing.
   */
  private handleFileChange(): void {
    // Debounce rapid file changes
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      await this.reload();
    }, this.debounceMs);
  }

  /**
   * Notifies all registered callbacks of a configuration change.
   */
  private notifyCallbacks(): void {
    for (const callback of this.changeCallbacks) {
      try {
        callback(this.config);
      } catch {
        // Ignore callback errors
      }
    }
  }

  /**
   * Registers a callback to be called when configuration changes.
   *
   * @param callback - Function to call when configuration changes
   */
  onConfigChange(callback: ConfigChangeCallback): void {
    this.changeCallbacks.add(callback);
  }

  /**
   * Removes a previously registered configuration change callback.
   *
   * @param callback - The callback to remove
   */
  offConfigChange(callback: ConfigChangeCallback): void {
    this.changeCallbacks.delete(callback);
  }

  /**
   * Gets the current service configuration.
   *
   * @returns Current configuration object
   */
  getConfig(): ServiceConfig {
    return { ...this.config };
  }

  /**
   * Gets the configured heartbeat interval.
   *
   * @returns Heartbeat interval in milliseconds
   */
  getHeartbeatIntervalMs(): number {
    return this.config.heartbeatIntervalMs;
  }

  /**
   * Gets the retry configuration.
   *
   * @returns Retry configuration object
   */
  getRetryConfig(): RetryConfig {
    return { ...this.config.retryConfig };
  }

  /**
   * Gets the persistence path.
   *
   * @returns Path for message persistence
   */
  getPersistencePath(): string {
    return this.config.persistencePath;
  }

  /**
   * Gets the path to the configuration file.
   *
   * @returns Configuration file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Gets the topic buffer size.
   *
   * @returns Topic buffer size (max messages per topic)
   */
  getTopicBufferSize(): number {
    return this.config.topicBufferSize;
  }

  /**
   * Gets the number of parallel workers.
   *
   * @returns Number of parallel processing workers
   */
  getParallelWorkers(): number {
    return this.config.parallelWorkers;
  }

  /**
   * Gets the ingestion FIFO size.
   *
   * @returns Ingestion FIFO capacity
   */
  getIngestionFifoSize(): number {
    return this.config.ingestionFifoSize;
  }

  /**
   * Gets the processing FIFO size.
   *
   * @returns Processing FIFO capacity
   */
  getProcessingFifoSize(): number {
    return this.config.processingFifoSize;
  }
}
