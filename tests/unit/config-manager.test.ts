/**
 * Unit tests for ConfigManager
 * Validates: Requirements 4.1, 4.2
 *
 * Tests:
 * - Loading valid configuration
 * - Handling missing config file
 * - Handling invalid config format
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager, DEFAULT_CONFIG, ServiceConfig } from '../../src/services/config-manager.js';

// Test config directory
const TEST_CONFIG_DIR = path.join(process.cwd(), 'tests', 'fixtures');
const TEST_CONFIG_PATH = path.join(TEST_CONFIG_DIR, 'test-config.json');

describe('ConfigManager', () => {
  beforeAll(() => {
    // Ensure test fixtures directory exists
    if (!fs.existsSync(TEST_CONFIG_DIR)) {
      fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test config file after each test
    if (fs.existsSync(TEST_CONFIG_PATH)) {
      fs.unlinkSync(TEST_CONFIG_PATH);
    }
  });

  afterAll(() => {
    // Clean up fixtures directory
    if (fs.existsSync(TEST_CONFIG_DIR)) {
      fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    }
  });

  describe('load()', () => {
    it('should load valid configuration from file', async () => {
      const validConfig: ServiceConfig = {
        chipSelectMappings: [
          {
            modelId: 'model-001',
            chipSelectAddress: 16,
            sensorTypes: ['temperature', 'pressure'],
          },
        ],
        bufferSize: 2000,
        heartbeatIntervalMs: 15000,
        retryConfig: {
          maxRetries: 3,
          initialDelayMs: 200,
          maxDelayMs: 60000,
          backoffMultiplier: 2.5,
        },
        persistencePath: './custom/path',
      };

      fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(validConfig, null, 2));

      const manager = new ConfigManager(TEST_CONFIG_PATH);
      const result = await manager.load();

      expect(result.success).toBe(true);
      expect(result.config).toBeDefined();
      expect(result.config?.chipSelectMappings).toHaveLength(1);
      expect(result.config?.chipSelectMappings[0].modelId).toBe('model-001');
      expect(result.config?.bufferSize).toBe(2000);
      expect(result.config?.heartbeatIntervalMs).toBe(15000);
      expect(result.config?.persistencePath).toBe('./custom/path');
    });


    it('should use default configuration when file does not exist', async () => {
      const nonExistentPath = path.join(TEST_CONFIG_DIR, 'non-existent.json');
      const manager = new ConfigManager(nonExistentPath);
      const result = await manager.load();

      expect(result.success).toBe(true);
      expect(result.config).toEqual(DEFAULT_CONFIG);
      expect(result.error).toContain('Config file not found');
    });

    it('should reject invalid JSON format', async () => {
      fs.writeFileSync(TEST_CONFIG_PATH, '{ invalid json }');

      const manager = new ConfigManager(TEST_CONFIG_PATH);
      const result = await manager.load();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });

    it('should reject invalid config schema', async () => {
      const invalidConfig = {
        chipSelectMappings: [
          {
            // Missing required modelId
            chipSelectAddress: 16,
            sensorTypes: ['temperature'],
          },
        ],
      };

      fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(invalidConfig));

      const manager = new ConfigManager(TEST_CONFIG_PATH);
      const result = await manager.load();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid config format');
    });

    it('should apply defaults for missing optional fields', async () => {
      const partialConfig = {
        chipSelectMappings: [
          {
            modelId: 'model-001',
            chipSelectAddress: 16,
            sensorTypes: ['temperature'],
          },
        ],
      };

      fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(partialConfig));

      const manager = new ConfigManager(TEST_CONFIG_PATH);
      const result = await manager.load();

      expect(result.success).toBe(true);
      expect(result.config?.bufferSize).toBe(DEFAULT_CONFIG.bufferSize);
      expect(result.config?.heartbeatIntervalMs).toBe(DEFAULT_CONFIG.heartbeatIntervalMs);
      expect(result.config?.persistencePath).toBe(DEFAULT_CONFIG.persistencePath);
    });
  });

  describe('reload()', () => {
    it('should reload configuration and notify callbacks on change', async () => {
      const initialConfig = {
        chipSelectMappings: [],
        bufferSize: 1000,
        heartbeatIntervalMs: 30000,
        retryConfig: DEFAULT_CONFIG.retryConfig,
        persistencePath: './data/messages',
      };

      fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(initialConfig));

      const manager = new ConfigManager(TEST_CONFIG_PATH);
      await manager.load();

      let callbackCalled = false;
      let receivedBufferSize = 0;

      manager.onConfigChange((config) => {
        callbackCalled = true;
        receivedBufferSize = config.bufferSize;
      });

      // Update config file
      const updatedConfig = { ...initialConfig, bufferSize: 2000 };
      fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(updatedConfig));

      const result = await manager.reload();

      expect(result.success).toBe(true);
      expect(callbackCalled).toBe(true);
      expect(receivedBufferSize).toBe(2000);
    });

    it('should not notify callbacks when config has not changed', async () => {
      const config = {
        chipSelectMappings: [],
        bufferSize: 1000,
        heartbeatIntervalMs: 30000,
        retryConfig: DEFAULT_CONFIG.retryConfig,
        persistencePath: './data/messages',
      };

      fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

      const manager = new ConfigManager(TEST_CONFIG_PATH);
      await manager.load();

      let callbackCount = 0;
      manager.onConfigChange(() => {
        callbackCount++;
      });

      await manager.reload();

      expect(callbackCount).toBe(0);
    });
  });


  describe('getters', () => {
    it('should return chip select mappings', async () => {
      const config = {
        chipSelectMappings: [
          { modelId: 'model-001', chipSelectAddress: 16, sensorTypes: ['temp'] },
          { modelId: 'model-002', chipSelectAddress: 32, sensorTypes: ['pressure'] },
        ],
      };

      fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

      const manager = new ConfigManager(TEST_CONFIG_PATH);
      await manager.load();

      const mappings = manager.getChipSelectMappings();
      expect(mappings).toHaveLength(2);
      expect(mappings[0].modelId).toBe('model-001');
      expect(mappings[1].modelId).toBe('model-002');
    });

    it('should return a copy of config to prevent mutation', async () => {
      fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ chipSelectMappings: [] }));

      const manager = new ConfigManager(TEST_CONFIG_PATH);
      await manager.load();

      const config1 = manager.getConfig();
      const config2 = manager.getConfig();

      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  describe('callback management', () => {
    it('should allow removing callbacks', async () => {
      const config = { chipSelectMappings: [], bufferSize: 1000 };
      fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

      const manager = new ConfigManager(TEST_CONFIG_PATH);
      await manager.load();

      let callbackCount = 0;
      const callback = () => {
        callbackCount++;
      };

      manager.onConfigChange(callback);

      // Update and reload
      fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ ...config, bufferSize: 2000 }));
      await manager.reload();
      expect(callbackCount).toBe(1);

      // Remove callback
      manager.offConfigChange(callback);

      // Update and reload again
      fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ ...config, bufferSize: 3000 }));
      await manager.reload();
      expect(callbackCount).toBe(1); // Should not have increased
    });
  });
});
