/**
 * Unit tests for HealthMonitor
 * Validates: Requirements 6.1, 6.3, 6.4
 *
 * Tests:
 * - Health status reporting
 * - Metrics accumulation
 * - Alert threshold triggering
 */

import {
  HealthMonitor,
  DEFAULT_ALERT_THRESHOLDS,
} from '../../src/services/health-monitor.js';

describe('HealthMonitor', () => {
  let monitor: HealthMonitor;

  beforeEach(() => {
    monitor = new HealthMonitor();
  });

  describe('getHealth()', () => {
    it('should return healthy status when no errors', () => {
      const health = monitor.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.uptime).toBeGreaterThanOrEqual(0);
      expect(health.checks.errorRate).toBe(true);
      expect(health.checks.latency).toBe(true);
    });

    it('should return degraded status when one check fails', () => {
      // Record messages with high error rate
      for (let i = 0; i < 10; i++) {
        monitor.recordMessage(false, 10);
      }

      const health = monitor.getHealth();

      expect(health.status).toBe('degraded');
      expect(health.checks.errorRate).toBe(false);
      expect(health.checks.latency).toBe(true);
    });

    it('should return unhealthy status when multiple checks fail', () => {
      // Record messages with high error rate and high latency
      for (let i = 0; i < 10; i++) {
        monitor.recordMessage(false, 10000);
      }

      const health = monitor.getHealth();

      expect(health.status).toBe('unhealthy');
      expect(health.checks.errorRate).toBe(false);
      expect(health.checks.latency).toBe(false);
    });


    it('should include custom health checks in status', () => {
      monitor.registerHealthCheck('database', () => true);
      monitor.registerHealthCheck('cache', () => false);

      const health = monitor.getHealth();

      expect(health.checks.database).toBe(true);
      expect(health.checks.cache).toBe(false);
      expect(health.status).toBe('degraded');
    });

    it('should handle health check exceptions gracefully', () => {
      monitor.registerHealthCheck('failing', () => {
        throw new Error('Check failed');
      });

      const health = monitor.getHealth();

      expect(health.checks.failing).toBe(false);
    });

    it('should track uptime correctly', async () => {
      const initialHealth = monitor.getHealth();
      const initialUptime = initialHealth.uptime;

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      const laterHealth = monitor.getHealth();
      expect(laterHealth.uptime).toBeGreaterThan(initialUptime);
    });
  });

  describe('getMetrics()', () => {
    it('should return zero metrics initially', () => {
      const metrics = monitor.getMetrics();

      expect(metrics.messagesReceived).toBe(0);
      expect(metrics.messagesProcessed).toBe(0);
      expect(metrics.messagesFailed).toBe(0);
      expect(metrics.ecuForwardsSucceeded).toBe(0);
      expect(metrics.ecuForwardsFailed).toBe(0);
      expect(metrics.activeConnections).toBe(0);
      expect(metrics.averageLatencyMs).toBe(0);
    });

    it('should accumulate message metrics correctly', () => {
      monitor.recordMessage(true, 100);
      monitor.recordMessage(true, 200);
      monitor.recordMessage(false, 50);

      const metrics = monitor.getMetrics();

      expect(metrics.messagesReceived).toBe(3);
      expect(metrics.messagesProcessed).toBe(2);
      expect(metrics.messagesFailed).toBe(1);
    });

    it('should calculate average latency correctly', () => {
      monitor.recordMessage(true, 100);
      monitor.recordMessage(true, 200);
      monitor.recordMessage(true, 300);

      const metrics = monitor.getMetrics();

      expect(metrics.averageLatencyMs).toBe(200);
    });


    it('should accumulate ECU forward metrics correctly', () => {
      monitor.recordECUForward(true);
      monitor.recordECUForward(true);
      monitor.recordECUForward(false);

      const metrics = monitor.getMetrics();

      expect(metrics.ecuForwardsSucceeded).toBe(2);
      expect(metrics.ecuForwardsFailed).toBe(1);
    });

    it('should track active connections', () => {
      monitor.setActiveConnections(5);
      expect(monitor.getMetrics().activeConnections).toBe(5);

      monitor.incrementConnections();
      expect(monitor.getMetrics().activeConnections).toBe(6);

      monitor.decrementConnections();
      expect(monitor.getMetrics().activeConnections).toBe(5);
    });

    it('should not decrement connections below zero', () => {
      monitor.setActiveConnections(0);
      monitor.decrementConnections();

      expect(monitor.getMetrics().activeConnections).toBe(0);
    });
  });

  describe('checkAlertThresholds()', () => {
    it('should emit alert when error rate exceeds threshold', () => {
      const alerts: { type: string; message: string }[] = [];
      monitor.on('alert', (type, message) => {
        alerts.push({ type, message });
      });

      // Create high error rate (> 10%)
      for (let i = 0; i < 5; i++) {
        monitor.recordMessage(true, 10);
      }
      for (let i = 0; i < 5; i++) {
        monitor.recordMessage(false, 10);
      }

      monitor.checkAlertThresholds();

      const errorAlert = alerts.find((a) => a.type === 'errorRate');
      expect(errorAlert).toBeDefined();
      expect(errorAlert?.message).toContain('exceeds threshold');
    });

    it('should emit alert when latency exceeds threshold', () => {
      const alerts: { type: string; message: string }[] = [];
      monitor.on('alert', (type, message) => {
        alerts.push({ type, message });
      });

      // Create high latency (> 5000ms default)
      monitor.recordMessage(true, 10000);

      monitor.checkAlertThresholds();

      const latencyAlert = alerts.find((a) => a.type === 'latency');
      expect(latencyAlert).toBeDefined();
      expect(latencyAlert?.message).toContain('exceeds threshold');
    });


    it('should emit alert when connections below minimum', () => {
      const customMonitor = new HealthMonitor({
        minHealthyConnections: 5,
      });

      const alerts: { type: string; message: string }[] = [];
      customMonitor.on('alert', (type, message) => {
        alerts.push({ type, message });
      });

      customMonitor.setActiveConnections(2);
      customMonitor.checkAlertThresholds();

      const connAlert = alerts.find((a) => a.type === 'connections');
      expect(connAlert).toBeDefined();
      expect(connAlert?.message).toContain('below minimum');
    });

    it('should not emit alerts when within thresholds', () => {
      const alerts: { type: string; message: string }[] = [];
      monitor.on('alert', (type, message) => {
        alerts.push({ type, message });
      });

      // Record successful messages with low latency
      for (let i = 0; i < 10; i++) {
        monitor.recordMessage(true, 100);
      }

      monitor.checkAlertThresholds();

      expect(alerts).toHaveLength(0);
    });
  });

  describe('threshold configuration', () => {
    it('should use default thresholds', () => {
      const thresholds = monitor.getThresholds();

      expect(thresholds).toEqual(DEFAULT_ALERT_THRESHOLDS);
    });

    it('should allow custom thresholds on construction', () => {
      const customMonitor = new HealthMonitor({
        errorRatePercent: 5,
        maxLatencyMs: 1000,
      });

      const thresholds = customMonitor.getThresholds();

      expect(thresholds.errorRatePercent).toBe(5);
      expect(thresholds.maxLatencyMs).toBe(1000);
      expect(thresholds.minHealthyConnections).toBe(DEFAULT_ALERT_THRESHOLDS.minHealthyConnections);
    });

    it('should allow updating thresholds', () => {
      monitor.updateThresholds({ errorRatePercent: 20 });

      const thresholds = monitor.getThresholds();
      expect(thresholds.errorRatePercent).toBe(20);
    });
  });

  describe('resetMetrics()', () => {
    it('should reset all metrics to zero', () => {
      monitor.recordMessage(true, 100);
      monitor.recordMessage(false, 200);
      monitor.recordECUForward(true);
      monitor.recordECUForward(false);

      monitor.resetMetrics();

      const metrics = monitor.getMetrics();
      expect(metrics.messagesReceived).toBe(0);
      expect(metrics.messagesProcessed).toBe(0);
      expect(metrics.messagesFailed).toBe(0);
      expect(metrics.ecuForwardsSucceeded).toBe(0);
      expect(metrics.ecuForwardsFailed).toBe(0);
      expect(metrics.averageLatencyMs).toBe(0);
    });
  });

  describe('health check management', () => {
    it('should allow registering and unregistering health checks', () => {
      monitor.registerHealthCheck('custom', () => true);

      let health = monitor.getHealth();
      expect(health.checks.custom).toBe(true);

      monitor.unregisterHealthCheck('custom');

      health = monitor.getHealth();
      expect(health.checks.custom).toBeUndefined();
    });
  });
});
