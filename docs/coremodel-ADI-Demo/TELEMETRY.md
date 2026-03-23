# CoreModel Telemetry Library

HTTP-based telemetry streaming library for CoreModel device models. Sends sensor data to a remote server via HTTP POST requests.

## Building

The telemetry library is built automatically with the main CoreModel library:

```bash
cd coremodel-master
make
```

This produces:
- `libcoremodel_telemetry.a` - Static library
- `libcoremodel_telemetry.so` - Shared library

## Integration Guide

### Step 1: Update Your Makefile

Add the telemetry library to your example's Makefile:

```makefile
# Add telemetry library to dependencies
myexample: myexample.c libcoremodel.a libcoremodel_telemetry.a
	$(HOSTCC) $(CFLAGS) -o $@ $^

# Add build rule for telemetry library
libcoremodel_telemetry.a: $(LIBSRC)coremodel_telemetry.c $(LIBSRC)coremodel_telemetry.h
	$(HOSTCC) $(CFLAGS) -c -o coremodel_telemetry.o $(LIBSRC)coremodel_telemetry.c
	$(HOSTAR) cr $@ coremodel_telemetry.o
	@rm -f coremodel_telemetry.o

# Update clean target
clean:
	rm -rf myexample libcoremodel.a libcoremodel_telemetry.a *.dSYM
```

### Step 2: Add Include

```c
#include <coremodel_telemetry.h>
```

### Step 3: Add State Fields

Add telemetry fields to your device state structure:

```c
typedef struct mydevice_state {
    /* ... existing fields ... */
    
    /* Telemetry */
    coremodel_telemetry_t *telemetry;
    int telemetry_enabled;
    struct timeval last_telemetry_time;
} mydevice_state_t;
```

### Step 4: Initialize Telemetry

After `coremodel_connect()`, before attaching to the bus:

```c
/* Create sensor ID from bus info */
char sensor_id[256];
snprintf(sensor_id, sizeof(sensor_id), "mydevice-%s", bus_name);

/* Initialize telemetry client */
state->telemetry = coremodel_telemetry_create(
    sensor_id,           /* Unique sensor identifier */
    "192.168.1.100",     /* Server host */
    3000,                /* Server port */
    "/ingest"            /* HTTP endpoint path */
);

if (state->telemetry) {
    /* Optional: test connection before enabling */
    if (coremodel_telemetry_test(state->telemetry) == 0) {
        state->telemetry_enabled = 1;
        gettimeofday(&state->last_telemetry_time, NULL);
    }
}
```

### Step 5: Send Telemetry Data

Create an update function to send data at a controlled rate:

```c
#define TELEMETRY_RATE_HZ 10
#define TELEMETRY_INTERVAL_US (1000000 / TELEMETRY_RATE_HZ)

static void update_telemetry(mydevice_state_t *state, int value)
{
    struct timeval now;
    long elapsed_us;

    if (!state->telemetry_enabled || !state->telemetry) {
        return;
    }

    gettimeofday(&now, NULL);
    elapsed_us = (now.tv_sec - state->last_telemetry_time.tv_sec) * 1000000 +
                 (now.tv_usec - state->last_telemetry_time.tv_usec);

    if (elapsed_us >= TELEMETRY_INTERVAL_US) {
        coremodel_telemetry_send_int(state->telemetry, "sensor_type", value);
        state->last_telemetry_time = now;
    }
}
```

Call from your main loop or callbacks:

```c
/* In main loop */
while (running) {
    update_telemetry(state, current_value);
    coremodel_mainloop(100);
}

/* Or in a callback (e.g., SPI read) */
static void spi_read(mydevice_state_t *state, ...)
{
    /* ... handle read ... */
    update_telemetry(state, read_value);
}
```

### Step 6: Cleanup

Before freeing state:

```c
if (state->telemetry) {
    coremodel_telemetry_destroy(state->telemetry);
}
```

## API Reference

### Initialization

```c
/* Create telemetry client with custom settings */
coremodel_telemetry_t *coremodel_telemetry_create(
    const char *sensor_id,
    const char *host,
    int port,
    const char *path
);

/* Create with defaults (localhost:3000/ingest) */
coremodel_telemetry_t *coremodel_telemetry_create_default(const char *sensor_id);

/* Test server connectivity (returns 0 on success) */
int coremodel_telemetry_test(coremodel_telemetry_t *telem);
```

### Sending Data

```c
/* Send integer value */
int coremodel_telemetry_send_int(
    coremodel_telemetry_t *telem,
    const char *sensor_type,
    int32_t value
);

/* Send floating-point value */
int coremodel_telemetry_send_float(
    coremodel_telemetry_t *telem,
    const char *sensor_type,
    double value
);

/* Send raw JSON payload */
int coremodel_telemetry_send_json(
    coremodel_telemetry_t *telem,
    const char *json
);
```

### Statistics

```c
int coremodel_telemetry_get_sent_count(coremodel_telemetry_t *telem);
int coremodel_telemetry_get_error_count(coremodel_telemetry_t *telem);
int coremodel_telemetry_is_connected(coremodel_telemetry_t *telem);
```

### Cleanup

```c
void coremodel_telemetry_destroy(coremodel_telemetry_t *telem);
```

## JSON Payload Format

The library sends JSON in this format:

```json
{
  "sensorId": "mydevice-spi0",
  "sensorType": "temperature",
  "value": 2500,
  "sourceModelId": "mydevice-spi0"
}
```

For custom payloads, use `coremodel_telemetry_send_json()`.

## Configuration

Default values (defined in `coremodel_telemetry.h`):

| Constant | Default | Description |
|----------|---------|-------------|
| `TELEMETRY_DEFAULT_HOST` | `"localhost"` | Default server host |
| `TELEMETRY_DEFAULT_PORT` | `3000` | Default server port |
| `TELEMETRY_DEFAULT_PATH` | `"/ingest"` | Default HTTP endpoint |
| `TELEMETRY_HTTP_TIMEOUT_SEC` | `1` | HTTP request timeout |
| `TELEMETRY_MAX_ERRORS` | `10` | Errors before backoff |
| `TELEMETRY_BACKOFF_SEC` | `5` | Backoff duration |

## Error Handling

- Connection failures are counted; after 10 consecutive errors, the library backs off for 5 seconds
- During backoff, `send` calls return immediately without attempting connection
- Statistics are available via `coremodel_telemetry_get_error_count()`

## Example: Complete Integration

See `examples/spi-adi/coremodel-spi-adi.c` for a complete working example.

```c
#include <coremodel.h>
#include <coremodel_telemetry.h>

int main(int argc, char *argv[])
{
    mydevice_state_t *state;
    void *handle;
    
    coremodel_connect(argv[1]);
    
    state = calloc(1, sizeof(mydevice_state_t));
    
    /* Initialize telemetry */
    state->telemetry = coremodel_telemetry_create(
        "mydevice", "10.11.0.30", 3000, "/ingest");
    if (state->telemetry && coremodel_telemetry_test(state->telemetry) == 0) {
        state->telemetry_enabled = 1;
        gettimeofday(&state->last_telemetry_time, NULL);
    }
    
    /* Attach to bus */
    handle = coremodel_attach_spi(...);
    
    /* Main loop */
    while (running) {
        update_telemetry(state, state->current_value);
        coremodel_mainloop(100);
    }
    
    /* Cleanup */
    coremodel_detach(handle);
    if (state->telemetry) {
        coremodel_telemetry_destroy(state->telemetry);
    }
    free(state);
    coremodel_disconnect();
    
    return 0;
}
```
