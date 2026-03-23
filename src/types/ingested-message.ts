import { z } from 'zod';
import { SensorData, SensorDataSchema, ValidationResult, formatZodErrors, parseStructuredSampleValue, parseSpiValue, type_NAMES } from './sensor-data.js';

/**
 * Zod schema for ingested message validation.
 * An IngestedMessage wraps SensorData with tracking metadata.
 * 
 * Requirements: 1.3
 */
export const IngestedMessageSchema = z.object({
  messageId: z.string().min(1, 'messageId must be a non-empty string'),
  timestamp: z.string().datetime(),
  data: SensorDataSchema,
  topic: z.string().min(1, 'topic must be a non-empty string'),
});

/**
 * TypeScript type inferred from the Zod schema.
 */
export type IngestedMessage = z.infer<typeof IngestedMessageSchema>;

/**
 * Type alias for IngestedMessage validation results.
 * Uses the generic ValidationResult from sensor-data.
 */
export type IngestedMessageValidationResult = ValidationResult<IngestedMessage>;

/**
 * Validates an ingested message against the schema.
 * 
 * @param data - Unknown input to validate
 * @returns IngestedMessageValidationResult with parsed data or error message
 */
export function validateIngestedMessage(data: unknown): IngestedMessageValidationResult {
  const result = IngestedMessageSchema.safeParse(data);
  
  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }
  
  return {
    success: false,
    error: formatZodErrors(result.error.errors),
  };
}

/**
 * Serializes IngestedMessage to JSON string.
 * 
 * @param message - IngestedMessage object to serialize
 * @returns JSON string representation
 */
export function serializeIngestedMessage(message: IngestedMessage): string {
  return JSON.stringify(message);
}

/**
 * Deserializes JSON string to IngestedMessage.
 * 
 * @param json - JSON string to parse
 * @returns IngestedMessageValidationResult with parsed data or error message
 */
export function deserializeIngestedMessage(json: string): IngestedMessageValidationResult {
  try {
    const parsed = JSON.parse(json);
    return validateIngestedMessage(parsed);
  } catch (e) {
    return {
      success: false,
      error: `Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
    };
  }
}

/**
 * Extracts device bus identifier from sensorType or sensorId.
 * The C library sends sensorType values like "spiRead", "spiWrite" which encode the bus.
 * For other sensorTypes (debugString, fifoPush, generate), we extract from sensorId.
 * 
 * Examples:
 *   sensorType="spiRead" -> "spi0"
 *   sensorType="generate", sensorId="max30123-spi" -> "spi0"
 *   sensorType="fifoPush", sensorId="adxl36x-i2c" -> "i2c1"
 * 
 * @param sensorType - Sensor type from C library
 * @param sensorId - Sensor identifier
 * @returns Device bus identifier or 'unknown'
 */
function extractDeviceBus(sensorType: string | string[], sensorId: string): string {
  const type = Array.isArray(sensorType) ? sensorType[0] : sensorType;
  const lowerType = type.toLowerCase();
  
  // First try to extract from sensorType (spiRead, spiWrite, etc.)
  if (lowerType.includes('spi')) return 'spi0';
  if (lowerType.includes('i2c')) return 'i2c1';
  if (lowerType.includes('can')) return 'can0';
  
  // Fall back to extracting from sensorId (max30123-spi, adxl36x-i2c, etc.)
  const lowerSensorId = sensorId.toLowerCase();
  if (lowerSensorId.includes('spi')) return 'spi0';
  if (lowerSensorId.includes('i2c')) return 'i2c1';
  if (lowerSensorId.includes('can')) return 'can0';
  
  return 'unknown';
}

/**
 * Builds a topic string from sensor data components.
 * 
 * The C telemetry library sends:
 * - sensorType: Telemetry channel (fifoPop, fifoPush, generate, spiRead, spiWrite, debug)
 * - value.type: Actual measurement type (PSTAT, CHRONO A, CHRONO B, etc.)
 * 
 * Topic format: sensors/{modelId}/{deviceBus}/{telemetryChannel}/{sensorId}/{measurementType}
 * 
 * Examples:
 *   sensorType="fifoPop", value.type="PSTAT" 
 *     -> sensors/max30123-spi/spi0/fifoPop/max30123-spi/PSTAT
 *   
 *   sensorType="spiRead", value.type="SPI"
 *     -> sensors/max30123-spi/spi0/spiRead/max30123-spi/SPI
 *
 * @param modelId - Source model identifier
 * @param sensorType - Telemetry channel from C library (fifoPop, spiRead, etc.)
 * @param sensorId - Sensor identifier
 * @param deviceBus - Optional device bus identifier (e.g., 'spi0', 'i2c1', 'can0')
 * @param value - Optional value object; type field used for topic routing
 * @returns Hierarchical topic string
 */
export function buildTopic(
  modelId: string,
  sensorType: string | string[],
  sensorId: string,
  deviceBus?: string,
  value?: SensorData['value'],
): string {
  // Extract deviceBus from sensorType or sensorId if not explicitly provided
  const bus = deviceBus || extractDeviceBus(sensorType, sensorId);
  
  // Use first sensorType if array for topic building (topics must be single path)
  const telemetryChannel = Array.isArray(sensorType) ? sensorType[0] : sensorType;
  const base = `sensors/${modelId}/${bus}/${telemetryChannel}/${sensorId}`;

  if (value == null) return base;

  // Structured sample value — use value.type field (CSV measurement type) as final segment
  // This handles fifoPop, fifoPush, generate with value.type = PSTAT, CHRONO A, etc.
  const structured = parseStructuredSampleValue(value);
  if (structured?.type) {
    return `${base}/${structured.type}`;
  }

  // SPI value object — use value.type field (SPI) as final segment
  // This handles spiRead, spiWrite with value.type = SPI
  const spi = parseSpiValue(value);
  if (spi?.type) {
    return `${base}/${spi.type}`;
  }

  // For any other object value that carries a top-level `type` string
  // (e.g. debug messages), use it as the suffix
  if (typeof value === 'object' && value !== null) {
    const v = value as Record<string, unknown>;
    const suffix = typeof v['type'] === 'string' ? v['type'] : null;
    if (suffix) return `${base}/${suffix}`;
  }

  return base;
}

/**
 * Creates an IngestedMessage from SensorData.
 * Generates a unique messageId and timestamp.
 * 
 * @param data - Validated SensorData
 * @param messageId - Unique message identifier
 * @returns IngestedMessage with tracking metadata
 */
export function createIngestedMessage(data: SensorData, messageId: string): IngestedMessage {
  return {
    messageId,
    timestamp: new Date().toISOString(),
    data,
    topic: buildTopic(data.sourceModelId, data.sensorType, data.sensorId, data.deviceBus, data.value),
  };
}
