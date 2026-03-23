/*
 *  CoreModel Telemetry Library
 *
 *  HTTP-based telemetry streaming for CoreModel device models.
 *  Provides a simple API for sending sensor data to a subscription server.
 *
 *  Copyright Corellium 2022-2023
 *  SPDX-License-Identifier: Apache-2.0
 */

#ifndef _COREMODEL_TELEMETRY_H
#define _COREMODEL_TELEMETRY_H

#include <stdint.h>

/* ========== Configuration Constants ========== */

#define TELEMETRY_DEFAULT_HOST      "localhost"
#define TELEMETRY_DEFAULT_PORT      3000
#define TELEMETRY_DEFAULT_PATH      "/ingest"
#define TELEMETRY_DEFAULT_RATE_HZ   10

#define TELEMETRY_HTTP_BUFFER_SIZE  4096
#define TELEMETRY_HTTP_TIMEOUT_SEC  1
#define TELEMETRY_MAX_ERRORS        10
#define TELEMETRY_BACKOFF_SEC       5

/* ========== Opaque Handle ========== */

typedef struct coremodel_telemetry coremodel_telemetry_t;

/* ========== Initialization ========== */

/**
 * Create a new telemetry client.
 *
 * @param sensor_id   Unique identifier for this sensor (e.g., "max30123-spi0-cs0")
 * @param host        Server hostname or IP address
 * @param port        Server port number
 * @param path        HTTP endpoint path (e.g., "/ingest")
 * @return            Telemetry handle, or NULL on failure
 */
coremodel_telemetry_t *coremodel_telemetry_create(
    const char *sensor_id,
    const char *host,
    int port,
    const char *path
);

/**
 * Create a telemetry client with default settings.
 *
 * @param sensor_id   Unique identifier for this sensor
 * @return            Telemetry handle, or NULL on failure
 */
coremodel_telemetry_t *coremodel_telemetry_create_default(const char *sensor_id);

/**
 * Test connection to the telemetry server.
 *
 * @param telem       Telemetry handle
 * @return            0 if server is reachable, -1 otherwise
 */
int coremodel_telemetry_test(coremodel_telemetry_t *telem);

/* ========== Data Transmission ========== */

/**
 * Send a single integer sample value.
 *
 * @param telem       Telemetry handle
 * @param sensor_type Type of sensor (e.g., "electrochemical", "temperature")
 * @param value       Sample value to send
 * @return            0 on success, -1 on failure
 */
int coremodel_telemetry_send_int(
    coremodel_telemetry_t *telem,
    const char *sensor_type,
    int32_t value
);

/**
 * Send a single floating-point sample value.
 *
 * @param telem       Telemetry handle
 * @param sensor_type Type of sensor
 * @param value       Sample value to send
 * @return            0 on success, -1 on failure
 */
int coremodel_telemetry_send_float(
    coremodel_telemetry_t *telem,
    const char *sensor_type,
    double value
);

/**
 * Send raw JSON payload.
 *
 * @param telem       Telemetry handle
 * @param json        JSON string to send
 * @return            0 on success, -1 on failure
 */
int coremodel_telemetry_send_json(
    coremodel_telemetry_t *telem,
    const char *json
);

/* ========== Rate Limiting ========== */

/**
 * Check if enough time has elapsed for the next telemetry update.
 * Call this in your main loop to throttle telemetry rate.
 *
 * @param telem       Telemetry handle
 * @param rate_hz     Desired update rate in Hz
 * @return            1 if ready to send, 0 if should wait
 */
int coremodel_telemetry_ready(coremodel_telemetry_t *telem, int rate_hz);

/**
 * Mark that a telemetry update was sent (resets the rate limiter).
 *
 * @param telem       Telemetry handle
 */
void coremodel_telemetry_mark_sent(coremodel_telemetry_t *telem);

/* ========== Statistics ========== */

/**
 * Get the number of records successfully sent.
 *
 * @param telem       Telemetry handle
 * @return            Number of records sent
 */
int coremodel_telemetry_get_sent_count(coremodel_telemetry_t *telem);

/**
 * Get the number of errors encountered.
 *
 * @param telem       Telemetry handle
 * @return            Number of errors
 */
int coremodel_telemetry_get_error_count(coremodel_telemetry_t *telem);

/**
 * Check if the connection has been verified (at least one successful send).
 *
 * @param telem       Telemetry handle
 * @return            1 if verified, 0 otherwise
 */
int coremodel_telemetry_is_connected(coremodel_telemetry_t *telem);

/* ========== Cleanup ========== */

/**
 * Close and free a telemetry client.
 * Prints summary statistics before closing.
 *
 * @param telem       Telemetry handle
 */
void coremodel_telemetry_destroy(coremodel_telemetry_t *telem);

/* ========== Replay / Timed Streaming ========== */

/**
 * Set the interval between replay sample sends (default 500ms).
 *
 * @param telem        Telemetry handle
 * @param interval_ms  Milliseconds between samples (min 1)
 */
void coremodel_telemetry_set_replay_interval_ms(coremodel_telemetry_t *telem, uint32_t interval_ms);

/**
 * Drive the replay stream. Call this every loop tick (e.g. every 10ms).
 * Sends the next queued sample when the replay interval has elapsed.
 * The queue is populated automatically by send_json when it receives
 * sample fragments from the device model thread.
 *
 * @param telem  Telemetry handle
 * @return       1 if a sample was sent this tick, 0 otherwise
 */
int coremodel_telemetry_replay_tick(coremodel_telemetry_t *telem);

/**
 * Enable or disable continuous looping of the replay queue.
 * When enabled, the queue automatically rewinds and replays from the
 * beginning each time it empties — no re-enqueuing needed from the caller.
 *
 * Call this after the initial batch of samples has been enqueued.
 *
 * @param telem   Telemetry handle
 * @param enable  1 to enable looping, 0 to disable
 */
void coremodel_telemetry_set_loop(coremodel_telemetry_t *telem, int enable);

#endif /* _COREMODEL_TELEMETRY_H */
