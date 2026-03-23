import { z } from 'zod';

/**
 * TopicRegistry - Tracks all known sensor topics for discovery.
 *
 * Maintains a registry of sensors that have sent data, allowing
 * clients to discover available data streams.
 */

/**
 * Zod schema for registered sensor validation.
 * Ensures type safety when deserializing from external sources.
 */
export const RegisteredSensorSchema = z.object({
  topic: z.string().min(1),
  sensorId: z.string().min(1),
  sensorType: z.union([z.string().min(1), z.array(z.string().min(1))]),
  sourceModelId: z.string().min(1),
  deviceBus: z.string().min(1),
  type: z.string().optional(),      // e.g. 'generate' | 'fifoPush' | 'fifoPop' | 'spiRead' | 'spiWrite'
  lastSeen: z.string().datetime(),
  messageCount: z.number().int().nonnegative(),
  lastValue: z.unknown().optional(),
  // Full registration metadata - preserves type array from registration
  registrationMetadata: z.object({
    type: z.array(z.string()).optional(),
  }).optional(),
});

/**
 * TypeScript type inferred from the Zod schema.
 */
export type RegisteredSensor = z.infer<typeof RegisteredSensorSchema>;

/**
 * Filter criteria for querying registered sensors.
 */
export interface SensorFilterCriteria {
  sourceModelId?: string;
  sensorType?: string;
  deviceBus?: string;
  type?: string;
}

/**
 * Fields that can be used for unique value extraction.
 */
export type SensorFilterField = 'sourceModelId' | 'sensorType' | 'deviceBus' | 'type';

/**
 * Subscription pattern constants for topic suggestions.
 */
export const TOPIC_PATTERNS = {
  ALL_SENSORS: 'sensors/#',
  MODEL_PREFIX: 'sensors/',
  BUS_WILDCARD: 'sensors/+/',
  TYPE_WILDCARD: 'sensors/+/+/',
} as const;

/**
 * Topic structure constants for parsing.
 * Topics: sensors/{modelId}/{bus}/{sensorType}/{sensorId}[/{type}]
 */
const TOPIC_STRUCTURE = {
  SEGMENT_COUNT_WITH_TYPE: 6,
  SEGMENT_COUNT_WITHOUT_TYPE: 5,
  TYPE_SEGMENT_INDEX: 5,
} as const;

/**
 * Zod schema for validating registration metadata from lastValue.
 * Ensures the type array contains only strings.
 */
const RegistrationMetadataSchema = z.object({
  type: z.array(z.string()),
});

export class TopicRegistry {
  private sensors: Map<string, RegisteredSensor> = new Map();

  /**
   * Registers or updates a sensor in the registry.
   *
   * @param topic - The full topic path for the sensor
   * @param sensorId - Unique identifier for the sensor
   * @param sensorType - Type of sensor (e.g., 'temperature', 'pressure') or array of types
   * @param sourceModelId - ID of the source model/device
   * @param deviceBus - Bus the sensor is connected to (e.g., 'spi0', 'i2c0')
   * @param lastValue - Optional last value received from the sensor
   * @param type - Optional measurement type identifier (e.g., 'PSTAT', 'SPI', 'generate')
   */
  register(
    topic: string,
    sensorId: string,
    sensorType: string | string[],
    sourceModelId: string,
    deviceBus: string,
    lastValue?: unknown,
    type?: string
  ): void {
    const existingCount = this.sensors.get(topic)?.messageCount ?? 0;
    const existing = this.sensors.get(topic);

    // If type not passed explicitly, derive it from the last topic segment.
    // Topic format: sensors/{modelId}/{bus}/{sensorType}/{sensorId}[/{type}]
    const resolvedType = type ?? this.extractTypeFromTopic(topic);

    // Preserve registration metadata if lastValue contains type array
    const registrationMetadata = this.extractRegistrationMetadata(lastValue, existing);

    this.sensors.set(topic, {
      topic,
      sensorId,
      sensorType,
      sourceModelId,
      deviceBus,
      type: resolvedType,
      lastSeen: new Date().toISOString(),
      messageCount: existingCount + 1,
      lastValue,
      registrationMetadata,
    });
  }

  /**
   * Extracts the type segment from a topic string if present.
   * Topics with a type have 6 segments; without have 5.
   * Format: sensors/{modelId}/{bus}/{sensorType}/{sensorId}[/{type}]
   */
  private extractTypeFromTopic(topic: string): string | undefined {
    const parts = topic.split('/');
    // sensors / modelId / bus / sensorType / sensorId / type  => 6 parts
    return parts.length === TOPIC_STRUCTURE.SEGMENT_COUNT_WITH_TYPE
      ? parts[TOPIC_STRUCTURE.TYPE_SEGMENT_INDEX]
      : undefined;
  }

  /**
   * Extracts and validates registration metadata from lastValue.
   * Returns existing metadata if extraction fails or no type array present.
   */
  private extractRegistrationMetadata(
    lastValue: unknown,
    existing?: RegisteredSensor
  ): RegisteredSensor['registrationMetadata'] {
    if (!lastValue || typeof lastValue !== 'object') {
      return existing?.registrationMetadata;
    }

    const result = RegistrationMetadataSchema.safeParse(lastValue);
    if (result.success) {
      return { type: result.data.type };
    }

    return existing?.registrationMetadata;
  }

  /**
   * Normalizes sensorType to an array for consistent handling.
   */
  private normalizeSensorType(sensorType: string | string[]): string[] {
    return Array.isArray(sensorType) ? sensorType : [sensorType];
  }

  /**
   * Gets all registered sensors.
   *
   * @returns Array of all registered sensors
   */
  getAll(): RegisteredSensor[] {
    return Array.from(this.sensors.values());
  }

  /**
   * Gets a sensor by its topic.
   *
   * @param topic - The topic to look up
   * @returns The registered sensor or undefined if not found
   */
  getByTopic(topic: string): RegisteredSensor | undefined {
    return this.sensors.get(topic);
  }

  /**
   * Gets sensors filtered by criteria.
   *
   * @param criteria - Filter criteria object
   * @returns Array of sensors matching all specified criteria
   */
  filter(criteria: SensorFilterCriteria): RegisteredSensor[] {
    return this.getAll().filter((sensor) => this.matchesCriteria(sensor, criteria));
  }

  /**
   * Checks if a sensor matches the given filter criteria.
   */
  private matchesCriteria(sensor: RegisteredSensor, criteria: SensorFilterCriteria): boolean {
    const { sourceModelId, sensorType, deviceBus, type } = criteria;

    if (sourceModelId && sensor.sourceModelId !== sourceModelId) return false;
    
    // Handle both string and string[] for sensorType
    if (sensorType) {
      const normalizedTypes = this.normalizeSensorType(sensor.sensorType);
      if (!normalizedTypes.includes(sensorType)) return false;
    }
    
    if (deviceBus && sensor.deviceBus !== deviceBus) return false;
    if (type && sensor.type !== type) return false;

    return true;
  }

  /**
   * Gets unique values for a field (for building filter dropdowns).
   *
   * @param field - The field to extract unique values from
   * @returns Sorted array of unique values
   */
  getUniqueValues(field: SensorFilterField): string[] {
    const values = new Set<string>();
    for (const sensor of this.sensors.values()) {
      const v = sensor[field];
      if (v != null) {
        // Handle both string and string[] for sensorType
        const normalizedValues = Array.isArray(v) ? v : [v];
        normalizedValues.forEach(item => values.add(item));
      }
    }
    return Array.from(values).sort();
  }

  /**
   * Gets suggested subscription patterns based on registered sensors.
   *
   * @returns Sorted array of suggested topic patterns
   */
  getSuggestedPatterns(): string[] {
    const patterns = new Set<string>();

    // Add wildcard for all sensors
    patterns.add(TOPIC_PATTERNS.ALL_SENSORS);

    // Add patterns for each unique model
    for (const modelId of this.getUniqueValues('sourceModelId')) {
      patterns.add(`${TOPIC_PATTERNS.MODEL_PREFIX}${modelId}/#`);
    }

    // Add patterns for each unique bus
    for (const bus of this.getUniqueValues('deviceBus')) {
      patterns.add(`${TOPIC_PATTERNS.BUS_WILDCARD}${bus}/#`);
    }

    // Add patterns for each unique sensor type
    for (const type of this.getUniqueValues('sensorType')) {
      patterns.add(`${TOPIC_PATTERNS.TYPE_WILDCARD}${type}/+`);
    }

    return Array.from(patterns).sort();
  }

  /**
   * Gets count of registered sensors.
   *
   * @returns Number of sensors in the registry
   */
  getCount(): number {
    return this.sensors.size;
  }

  /**
   * Checks if the registry is empty.
   *
   * @returns True if no sensors are registered
   */
  isEmpty(): boolean {
    return this.sensors.size === 0;
  }

  /**
   * Checks if a topic is registered.
   *
   * @param topic - The topic to check
   * @returns True if the topic exists in the registry
   */
  has(topic: string): boolean {
    return this.sensors.has(topic);
  }

  /**
   * Clears the registry.
   */
  clear(): void {
    this.sensors.clear();
  }
}
