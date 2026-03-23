# Bytes Parsing Pattern

## Overview

The C telemetry library sends byte arrays as hex strings WITHOUT the `0x` prefix (e.g., `"62"`, `"80"`, `"32"`). This is the output of the `%x` format specifier in C. The service must accept bare hex strings, prefixed hex strings, and decimal numbers.

## Pattern

### 1. Parse Helper Function

Create a dedicated `parseByte()` function that handles bare hex strings, prefixed hex strings, and numbers:

```typescript
function parseByte(byteValue: number | string): number {
  if (typeof byteValue === 'number') {
    if (!Number.isInteger(byteValue) || byteValue < 0 || byteValue > 255) {
      throw new Error(`Byte value must be an integer between 0-255, got ${byteValue}`);
    }
    return byteValue;
  }
  
  // Handle both bare hex ("62") and prefixed hex ("0x62")
  const hexMatch = /^(?:0[xX])?([0-9a-fA-F]+)$/.test(byteValue);
  if (!hexMatch) {
    throw new Error(`Byte must be a number or hex string, got '${byteValue}'`);
  }
  
  const value = parseInt(byteValue, 16);
  if (value < 0 || value > 255) {
    throw new Error(`Byte value must be between 0-255, got ${value} from '${byteValue}'`);
  }
  
  return value;
}
```

### 2. Schema Definition

Use `z.union()` to accept both types. The schema accepts bare hex strings (C library format), prefixed hex strings, and decimal numbers:

```typescript
export const StructuredSampleValueSchema = z.object({
  // ... other fields
  bytes: z.tuple([
    z.union([z.number().int(), z.string()]),
    z.union([z.number().int(), z.string()]),
    z.union([z.number().int(), z.string()]),
  ]),
  // ... other fields
});
```

No refinement needed - validation happens in `parseByte()` when you need the normalized values.

### 3. Usage Pattern

When you need the normalized integer array, map over the bytes:

```typescript
const result = StructuredSampleValueSchema.parse(data);
const normalizedBytes = result.bytes.map(parseByte) as [number, number, number];
```

## Benefits

- **Flexibility**: Accepts both decimal and hex formats from the C library
- **Validation**: Ensures hex strings are in correct format (`0xNN`)
- **Type Safety**: Normalizes to integers for downstream processing
- **Clear Errors**: Provides specific error messages for invalid inputs

## When to Use This Pattern

Use this pattern when:
- The C telemetry library may send byte values in different formats
- You need to validate hex string format
- Downstream code expects integer byte values

## Alternative: Transform at Schema Level

If you want automatic normalization, use Zod's `.transform()`:

```typescript
export const StructuredSampleValueSchema = z.object({
  // ... other fields
  bytes: z.tuple([
    z.union([z.number().int(), z.string()]),
    z.union([z.number().int(), z.string()]),
    z.union([z.number().int(), z.string()]),
  ]),
  // ... other fields
}).transform((data) => ({
  ...data,
  bytes: data.bytes.map(parseByte) as [number, number, number],
}));
```

This returns a type with `bytes: [number, number, number]` directly, but note that the parsed type will differ from the input type.
