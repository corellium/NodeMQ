import { z } from 'zod';

/**
 * SPI transaction type literals used for topic routing.
 * Matches the `type` field emitted by thread_telemetry_spi() in the C library.
 */
export const SPI_TYPES = {
  READ: 'spiRead',
  WRITE: 'spiWrite',
} as const;

export type SpiType = (typeof SPI_TYPES)[keyof typeof SPI_TYPES];

/**
 * type names emitted by the C telemetry library.
 * Used as the final topic segment to separate data streams.
 */
export const type_NAMES = new Set([
  'generate',
  'fifoPush',
  'fifoPop',
  'spiRead',
  'spiWrite',
  'debug',
] as const);

/**
 * Zod schema for SPI transaction value objects sent by the C telemetry library.
 * Matches the JSON shape from thread_telemetry_spi():
 *   { "type": "SPI", "address": "<hex>", "timestamp": <ms epoch>, "bytes": [...] }
 *
 * Note: 
 * - sensorType field contains "spiRead" or "spiWrite" (the telemetry channel)
 * - value.type field contains "SPI" (the measurement type)
 * - timestamp here is wall-clock ms epoch, NOT CSV seconds
 * 
 * The bytes field can contain:
 * - Hex strings (e.g., "3e", "50", "2f") - preferred format
 * - Raw hex values without quotes (e.g., 0x3e, 0xa0, 0x2f) - legacy format
 * - Decimal numbers (e.g., 62, 80, 47) - legacy format
 */
export const SpiValueSchema = z.object({
  type: z.literal("SPI"),  // C code sends "SPI" as the measurement type
  address: z.string(),
  timestamp: z.number(),  // wall-clock ms epoch — NOT CSV seconds
  bytes: z.array(z.union([z.string(), z.number()])),
});

export type SpiValue = z.infer<typeof SpiValueSchema>;

/**
 * Zod schema for structured sample value objects sent by the C telemetry library.
 * These contain the full sample_line_t fields packed into the `value` object.
 *
 * Field names match the camelCase JSON output from coremodel_telemetry_flush():
 *   measurement, min, tag, units, timestamp (seconds from CSV), bytes, type
 *
 * The bytes field can contain:
 * - Bare hex strings (e.g., "62", "80", "32") - C library format using %x
 * - Hex strings with 0x prefix (e.g., "0x62", "0x80", "0x32")
 * - Decimal numbers (e.g., 98, 128, 50)
 *
 * The min and tag fields can be:
 * - Hex strings (e.g., "03", "02") - C library format using %x
 * - Decimal numbers (e.g., 3, 2)
 *
 * Requirements: 9.1, 9.3
 */
export const StructuredSampleValueSchema = z.object({
  measurement: z.number(),
  min: z.union([z.number().int(), z.string()]),
  tag: z.union([z.number().int(), z.string()]),
  units: z.string(),
  timestamp: z.number(),           // seconds from CSV — required, never remove
  bytes: z.tuple([
    z.union([z.string(), z.number()]),
    z.union([z.string(), z.number()]),
    z.union([z.string(), z.number()]),
  ]),
  sampleValue: z.number().int().optional(),
  type: z.string().optional(),     // Sample type from CSV (e.g., "CHRONO A", "PSTAT") — used for topic routing
  deviceBus: z.string().optional(),
});

/**
 * TypeScript type inferred from the StructuredSampleValueSchema.
 */
export type StructuredSampleValue = z.infer<typeof StructuredSampleValueSchema>;

/**
 * Zod schema for sensor data validation.
 * Validates that all required fields are present with correct types.
 *
 * Accepts both ISO datetime strings and numeric timestamps (milliseconds)
 * to support the C telemetry library which sends integer ms timestamps.
 * 
 * The C telemetry library sends TWO types of messages:
 * 
 * 1. Registration message (announces available channels):
 *    - sensorType: Array of telemetry channels ["debugString","fifoPush","fifoPop","generate","spiRead","spiWrite"]
 *    - type: Array of measurement types ["SPI","PSTAT","CHRONO A"]
 * 
 * 2. Data messages (actual samples):
 *    - sensorType: Single telemetry channel "fifoPop"
 *    - value.type: Single measurement type "PSTAT"
 * 
 * Requirements: 1.1, 1.2, 1.4, 9.1
 */
export const SensorDataSchema = z.object({
  sensorId: z.string().min(1, 'sensorId must be a non-empty string'),
  sensorType: z.union([z.string().min(1), z.array(z.string().min(1))]),  // Single channel OR array for registration
  value: z.union([
    z.number(),
    z.string(),
    z.boolean(),
    SpiValueSchema,               // must be before StructuredSampleValueSchema — no overlap
    StructuredSampleValueSchema,
    z.record(z.unknown()),
  ]).optional(),
  sourceModelId: z.string().min(1, 'sourceModelId must be a non-empty string'),
  deviceBus: z.string().min(1, 'deviceBus must be a non-empty string').optional(),
  timestamp: z.union([z.string().datetime(), z.number()]).optional(),
  metadata: z.record(z.unknown()).optional(),
  type: z.array(z.string()).optional(),  // Array of measurement types the sensor supports (registration message)
});

/**
 * TypeScript type inferred from the Zod schema.
 */
export type SensorData = z.infer<typeof SensorDataSchema>;

/**
 * Generic validation result type.
 * Can be used for any validated data type.
 */
export interface ValidationResult<T = SensorData> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Formats Zod validation errors into a readable string.
 * 
 * @param errors - Array of Zod error issues
 * @returns Formatted error message string
 */
export function formatZodErrors(errors: z.ZodIssue[]): string {
  return errors
    .map((err) => `${err.path.join('.')}: ${err.message}`)
    .join('; ');
}

/**
 * Validates sensor data against the schema.
 * Returns a ValidationResult indicating success or failure with error details.
 * 
 * @param data - Unknown input to validate
 * @returns ValidationResult with parsed data or error message
 */
export function validateSensorData(data: unknown): ValidationResult<SensorData> {
  const result = SensorDataSchema.safeParse(data);
  
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
 * Checks if a sensor data value is a structured sample from the C telemetry library.
 * Returns the parsed StructuredSampleValue if valid, undefined otherwise.
 *
 * @param value - The value field from SensorData
 * @returns Parsed StructuredSampleValue or undefined
 */
export function parseStructuredSampleValue(
  value: SensorData['value']
): StructuredSampleValue | undefined {
  const result = StructuredSampleValueSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

/**
 * Checks if a sensor data value is an SPI transaction object from the C telemetry library.
 * Returns the parsed SpiValue if valid, undefined otherwise.
 *
 * @param value - The value field from SensorData
 * @returns Parsed SpiValue or undefined
 */
export function parseSpiValue(value: SensorData['value']): SpiValue | undefined {
  const result = SpiValueSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

/**
 * Serializes SensorData to JSON string.
 * 
 * @param data - SensorData object to serialize
 * @returns JSON string representation
 */
export function serializeSensorData(data: SensorData): string {
  return JSON.stringify(data);
}

/**
 * Deserializes JSON string to SensorData.
 * Returns ValidationResult to handle parsing and validation errors.
 * 
 * @param json - JSON string to parse
 * @returns ValidationResult with parsed data or error message
 */
export function deserializeSensorData(json: string): ValidationResult<SensorData> {
  try {
    const parsed = JSON.parse(json);
    return validateSensorData(parsed);
  } catch (e) {
    return {
      success: false,
      error: `Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
    };
  }
}
