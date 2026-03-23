/**
 * HealthMonitor - Tracks service health and operational metrics.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4
 *
 * Features:
 * - Expose health check endpoints for monitoring
 * - Log all significant events with structured logging
 * - Emit alerts when error rates exceed thresholds
 * - Track and expose metrics for message throughput and latency
 */

import { EventEmitter } from 'events';

/**
 * Health status of the service.
 */
export type HealthStatusLevel = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Health status response.
 */
export interface HealthStatus {
  status: HealthStatusLevel;
  uptime: number;
  checks: Record<string, boolean>;
}

/**
 * Operational metrics.
 */
export interface Metrics {
  messagesReceived: number;
  messagesProcessed: number;
  messagesFailed: number;
  activeConnections: number;
  averageLatencyMs: number;
}

/**
 * Alert threshold configuration.
 */
export interface AlertThresholds {
  errorRatePercent: number;
  maxLatencyMs: number;
  minHealthyConnections: number;
}

/**
 * Default alert thresholds.
 */
export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  errorRatePercent: 10,
  maxLatencyMs: 5000,
  minHealthyConnections: 0,
};


/**
 * Events emitted by the HealthMonitor.
 */
export interface HealthMonitorEvents {
  alert: (alertType: string, message: string) => void;
}

/**
 * HealthMonitor tracks service health and operational metrics.
 */
export class HealthMonitor extends EventEmitter {
  private startTime: number;
  private messagesReceived: number = 0;
  private messagesProcessed: number = 0;
  private messagesFailed: number = 0;
  private activeConnections: number = 0;
  private latencySum: number = 0;
  private latencyCount: number = 0;
  private thresholds: AlertThresholds;
  private healthChecks: Map<string, () => boolean> = new Map();

  /**
   * Creates a new HealthMonitor instance.
   *
   * @param thresholds - Alert threshold configuration
   */
  constructor(thresholds: Partial<AlertThresholds> = {}) {
    super();
    this.startTime = Date.now();
    this.thresholds = { ...DEFAULT_ALERT_THRESHOLDS, ...thresholds };
  }

  /**
   * Gets the current health status of the service.
   *
   * @returns Health status object
   */
  getHealth(): HealthStatus {
    const checks: Record<string, boolean> = {};

    // Run all registered health checks
    for (const [name, checkFn] of this.healthChecks) {
      try {
        checks[name] = checkFn();
      } catch {
        checks[name] = false;
      }
    }

    // Add built-in checks
    checks['errorRate'] = this.getErrorRate() <= this.thresholds.errorRatePercent;
    checks['latency'] = this.getAverageLatencyMs() <= this.thresholds.maxLatencyMs;

    // Determine overall status
    const failedChecks = Object.values(checks).filter((v) => !v).length;
    let status: HealthStatusLevel;

    if (failedChecks === 0) {
      status = 'healthy';
    } else if (failedChecks <= 1) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      uptime: Date.now() - this.startTime,
      checks,
    };
  }

  /**
   * Gets the current operational metrics.
   *
   * @returns Metrics object
   */
  getMetrics(): Metrics {
    return {
      messagesReceived: this.messagesReceived,
      messagesProcessed: this.messagesProcessed,
      messagesFailed: this.messagesFailed,
      activeConnections: this.activeConnections,
      averageLatencyMs: this.getAverageLatencyMs(),
    };
  }

  /**
   * Records a message processing event.
   *
   * @param success - Whether the message was processed successfully
   * @param latencyMs - Processing latency in milliseconds
   */
  recordMessage(success: boolean, latencyMs: number): void {
    this.messagesReceived++;

    if (success) {
      this.messagesProcessed++;
    } else {
      this.messagesFailed++;
    }

    if (latencyMs >= 0) {
      this.latencySum += latencyMs;
      this.latencyCount++;
    }
  }

  /**
   * Updates the active connection count.
   *
   * @param count - Number of active connections
   */
  setActiveConnections(count: number): void {
    this.activeConnections = count;
  }

  /**
   * Increments the active connection count.
   */
  incrementConnections(): void {
    this.activeConnections++;
  }

  /**
   * Decrements the active connection count.
   */
  decrementConnections(): void {
    if (this.activeConnections > 0) {
      this.activeConnections--;
    }
  }

  /**
   * Registers a custom health check.
   *
   * @param name - Name of the health check
   * @param checkFn - Function that returns true if healthy
   */
  registerHealthCheck(name: string, checkFn: () => boolean): void {
    this.healthChecks.set(name, checkFn);
  }

  /**
   * Removes a registered health check.
   *
   * @param name - Name of the health check to remove
   */
  unregisterHealthCheck(name: string): void {
    this.healthChecks.delete(name);
  }

  /**
   * Checks alert thresholds and emits alerts if exceeded.
   */
  checkAlertThresholds(): void {
    const errorRate = this.getErrorRate();
    const avgLatency = this.getAverageLatencyMs();

    // Check error rate threshold
    if (errorRate > this.thresholds.errorRatePercent) {
      this.emit(
        'alert',
        'errorRate',
        `Error rate ${errorRate.toFixed(2)}% exceeds threshold ${this.thresholds.errorRatePercent}%`
      );
    }

    // Check latency threshold
    if (avgLatency > this.thresholds.maxLatencyMs) {
      this.emit(
        'alert',
        'latency',
        `Average latency ${avgLatency.toFixed(2)}ms exceeds threshold ${this.thresholds.maxLatencyMs}ms`
      );
    }

    // Check minimum connections threshold
    if (this.activeConnections < this.thresholds.minHealthyConnections) {
      this.emit(
        'alert',
        'connections',
        `Active connections ${this.activeConnections} below minimum ${this.thresholds.minHealthyConnections}`
      );
    }
  }

  /**
   * Gets the current error rate as a percentage.
   *
   * @returns Error rate percentage (0-100)
   */
  getErrorRate(): number {
    if (this.messagesReceived === 0) {
      return 0;
    }
    return (this.messagesFailed / this.messagesReceived) * 100;
  }

  /**
   * Gets the average latency in milliseconds.
   *
   * @returns Average latency in ms, or 0 if no measurements
   */
  getAverageLatencyMs(): number {
    if (this.latencyCount === 0) {
      return 0;
    }
    return this.latencySum / this.latencyCount;
  }

  /**
   * Updates the alert thresholds.
   *
   * @param thresholds - New threshold values
   */
  updateThresholds(thresholds: Partial<AlertThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  /**
   * Gets the current alert thresholds.
   *
   * @returns Current threshold configuration
   */
  getThresholds(): AlertThresholds {
    return { ...this.thresholds };
  }

  /**
   * Resets all metrics to zero.
   * Useful for testing or periodic metric resets.
   */
  resetMetrics(): void {
    this.messagesReceived = 0;
    this.messagesProcessed = 0;
    this.messagesFailed = 0;
    this.latencySum = 0;
    this.latencyCount = 0;
  }

  /**
   * Resets the start time for uptime calculation.
   */
  resetUptime(): void {
    this.startTime = Date.now();
  }
}
