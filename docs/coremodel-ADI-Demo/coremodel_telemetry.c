/*
 *  CoreModel Telemetry Library
 *
 *  HTTP-based telemetry streaming for CoreModel device models.
 *
 *  Copyright Corellium 2022-2023
 *  SPDX-License-Identifier: Apache-2.0
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <time.h>
#include <stdint.h>
#include <pthread.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <netinet/in.h>
#include <netdb.h>

#include "coremodel_telemetry.h"

/* ========== Replay Queue ========== */

#define TELEMETRY_QUEUE_SIZE             1024
#define TELEMETRY_DEFAULT_REPLAY_MS      200

typedef struct {
    char payload[TELEMETRY_HTTP_BUFFER_SIZE];
} telemetry_queued_t;

/* ========== Internal Structure ========== */

struct coremodel_telemetry {
    char host[256];
    int port;
    char path[256];
    char sensor_id[128];

    int records_sent;
    int errors;
    int consecutive_errors;
    time_t backoff_until;
    int connection_verified;

    struct timeval last_send_time;

    /* Replay queue — samples enqueued here, drained by replay_tick() */
    telemetry_queued_t *queue;
    int queue_head;
    int queue_tail;
    int queue_count;

    uint32_t replay_interval_ms;
    uint64_t replay_last_ms;

    /* Background drain thread */
    pthread_t       replay_thread;
    pthread_mutex_t replay_mutex;
    int             replay_running;

    /* Loop support — when enabled, queue rewinds to loop_head/loop_size on empty */
    int      loop_enabled;
    int      loop_armed;  /* 1 once the loop window has been snapshotted */
    int      loop_head;   /* queue_head value at start of first drain pass */
    int      loop_size;   /* number of samples in one loop pass */
};

/* ========== Internal Helpers ========== */

static uint64_t telemetry_now_ms(void)
{
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (uint64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
}

static int http_connect(const char *host, int port)
{
    struct hostent *server;
    struct sockaddr_in server_addr;
    int sockfd;
    struct timeval timeout;

    sockfd = socket(AF_INET, SOCK_STREAM, 0);
    if (sockfd < 0) return -1;

    timeout.tv_sec = TELEMETRY_HTTP_TIMEOUT_SEC;
    timeout.tv_usec = 0;
    setsockopt(sockfd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(sockfd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));

    server = gethostbyname(host);
    if (!server) { close(sockfd); return -1; }

    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    memcpy(&server_addr.sin_addr.s_addr, server->h_addr, server->h_length);
    server_addr.sin_port = htons(port);

    if (connect(sockfd, (struct sockaddr *)&server_addr, sizeof(server_addr)) < 0) {
        close(sockfd);
        return -1;
    }
    return sockfd;
}

static int http_post(const char *host, int port, const char *path, const char *json_payload)
{
    int sockfd;
    char request[TELEMETRY_HTTP_BUFFER_SIZE];
    char response[1024];
    int content_length;
    int bytes_sent, bytes_received;
    int status_code = 0;
    static int debug_count = 0;

    sockfd = http_connect(host, port);
    if (sockfd < 0) return -1;

    content_length = strlen(json_payload);
    snprintf(request, sizeof(request),
             "POST %s HTTP/1.1\r\n"
             "Host: %s:%d\r\n"
             "Content-Type: application/json\r\n"
             "Content-Length: %d\r\n"
             "Connection: close\r\n"
             "\r\n"
             "%s",
             path, host, port, content_length, json_payload);

    bytes_sent = send(sockfd, request, strlen(request), 0);
    if (bytes_sent < 0) { close(sockfd); return -1; }

    bytes_received = recv(sockfd, response, sizeof(response) - 1, 0);
    if (bytes_received > 0) {
        response[bytes_received] = '\0';
        if (sscanf(response, "HTTP/%*d.%*d %d", &status_code) != 1)
            status_code = 0;
        if (debug_count < 3 && (status_code < 200 || status_code >= 300)) {
            fprintf(stderr, "HTTP Debug: POST %s returned %d\n", path, status_code);
            fprintf(stderr, "HTTP Debug: Payload: %s\n", json_payload);
            fprintf(stderr, "HTTP Debug: Response: %.300s\n", response);
            debug_count++;
        }
    }
    close(sockfd);
    return (status_code >= 200 && status_code < 300) ? 0 : -1;
}

static int telemetry_send_payload(coremodel_telemetry_t *telem, const char *payload)
{
    int result;
    time_t now_sec;

    if (!telem) return -1;

    time(&now_sec);
    if (telem->backoff_until > now_sec) return -1;

    result = http_post(telem->host, telem->port, telem->path, payload);

    if (result == 0) {
        telem->records_sent++;
        telem->consecutive_errors = 0;
        if (!telem->connection_verified) {
            telem->connection_verified = 1;
            printf("Telemetry: Connection verified, streaming data...\n");
        }
        if (telem->records_sent % 100 == 0)
            printf("Telemetry: Sent %d records\n", telem->records_sent);
    } else {
        telem->errors++;
        telem->consecutive_errors++;
        if (telem->consecutive_errors >= TELEMETRY_MAX_ERRORS) {
            telem->backoff_until = now_sec + TELEMETRY_BACKOFF_SEC;
            fprintf(stderr, "Telemetry: Too many errors, backing off for %d seconds\n",
                    TELEMETRY_BACKOFF_SEC);
            fprintf(stderr, "Telemetry: Check server at http://%s:%d%s\n",
                    telem->host, telem->port, telem->path);
            telem->consecutive_errors = 0;
        }
    }
    return result;
}

/* ========== send_json helpers ========== */

/* Extract a quoted string value for a given key from a JSON fragment.
 * Writes into out (max out_len). Returns 1 on success, 0 if not found. */
static int extract_str(const char *json, const char *key, char *out, int out_len)
{
    const char *p;
    const char *start;
    int len = 0;

    p = strstr(json, key);
    if (!p) return 0;
    p += strlen(key);
    /* skip whitespace and colon */
    while (*p == ' ' || *p == ':') p++;
    if (*p != '"') return 0;
    p++; /* skip opening quote */
    start = p;
    while (*p && *p != '"') { p++; len++; }
    if (len <= 0 || len >= out_len) return 0;
    memcpy(out, start, len);
    out[len] = '\0';
    return 1;
}

/* ========== Background replay drain thread ========== */

static void *telemetry_replay_thread(void *arg)
{
    coremodel_telemetry_t *telem = (coremodel_telemetry_t *)arg;

    while (telem->replay_running) {
        usleep(10000); /* 10ms tick */
        pthread_mutex_lock(&telem->replay_mutex);
        coremodel_telemetry_replay_tick(telem);
        pthread_mutex_unlock(&telem->replay_mutex);
    }
    return NULL;
}

/* ========== Public API ========== */

coremodel_telemetry_t *coremodel_telemetry_create(
    const char *sensor_id,
    const char *host,
    int port,
    const char *path)
{
    coremodel_telemetry_t *telem;

    if (!sensor_id || !host || !path) return NULL;

    telem = calloc(1, sizeof(coremodel_telemetry_t));
    if (!telem) return NULL;

    strncpy(telem->host, host, sizeof(telem->host) - 1);
    telem->port = port;
    strncpy(telem->path, path, sizeof(telem->path) - 1);
    strncpy(telem->sensor_id, sensor_id, sizeof(telem->sensor_id) - 1);

    gettimeofday(&telem->last_send_time, NULL);

    telem->queue = calloc(TELEMETRY_QUEUE_SIZE, sizeof(telemetry_queued_t));
    if (!telem->queue) { free(telem); return NULL; }

    telem->replay_interval_ms = TELEMETRY_DEFAULT_REPLAY_MS;
    telem->replay_last_ms     = 0;
    telem->loop_enabled       = 1; /* loop by default — rewinds when queue empties */

    pthread_mutex_init(&telem->replay_mutex, NULL);
    telem->replay_running = 1;
    pthread_create(&telem->replay_thread, NULL, telemetry_replay_thread, telem);

    printf("Telemetry: Initialized for sensor '%s'\n", sensor_id);
    printf("Telemetry: Endpoint: http://%s:%d%s\n", host, port, path);

    return telem;
}

coremodel_telemetry_t *coremodel_telemetry_create_default(const char *sensor_id)
{
    return coremodel_telemetry_create(sensor_id,
        TELEMETRY_DEFAULT_HOST, TELEMETRY_DEFAULT_PORT, TELEMETRY_DEFAULT_PATH);
}

int coremodel_telemetry_test(coremodel_telemetry_t *telem)
{
    int sockfd;
    if (!telem) return -1;

    printf("Telemetry: Testing connection to http://%s:%d...\n", telem->host, telem->port);
    sockfd = http_connect(telem->host, telem->port);
    if (sockfd < 0) {
        fprintf(stderr, "Telemetry: Cannot connect to %s:%d\n", telem->host, telem->port);
        return -1;
    }
    close(sockfd);
    printf("Telemetry: Connection test successful\n");
    return 0;
}

int coremodel_telemetry_send_int(coremodel_telemetry_t *telem,
                                  const char *sensor_type, int32_t value)
{
    char payload[TELEMETRY_HTTP_BUFFER_SIZE];
    if (!telem || !sensor_type) return -1;
    snprintf(payload, sizeof(payload),
             "{\"sensorId\":\"%s\",\"sensorType\":\"%s\",\"value\":%d,\"sourceModelId\":\"%s\"}",
             telem->sensor_id, sensor_type, value, telem->sensor_id);
    return telemetry_send_payload(telem, payload);
}

int coremodel_telemetry_send_float(coremodel_telemetry_t *telem,
                                    const char *sensor_type, double value)
{
    char payload[TELEMETRY_HTTP_BUFFER_SIZE];
    if (!telem || !sensor_type) return -1;
    snprintf(payload, sizeof(payload),
             "{\"sensorId\":\"%s\",\"sensorType\":\"%s\",\"value\":%.6f,\"sourceModelId\":\"%s\"}",
             telem->sensor_id, sensor_type, value, telem->sensor_id);
    return telemetry_send_payload(telem, payload);
}

/*
 * send_json wraps a pre-formed JSON fragment from the thread into a full payload.
 *
 * The thread already sends correct, well-formed JSON fragments, e.g.:
 *   "sensorType":"PSTAT","value":{"measurement":...,"timeStamp":...,...}
 *
 * For SPI and debug sensorTypes: send immediately (real-time events).
 * For all other sensorTypes (sample data): enqueue for paced replay.
 *
 * No rebuilding or parsing of the fragment is needed — just wrap and route.
 */
int coremodel_telemetry_send_json(coremodel_telemetry_t *telem, const char *json)
{
    char payload[TELEMETRY_HTTP_BUFFER_SIZE];
    char sensor_type[128] = {0};
    int success = 0;

    if (!telem || !json) return -1;

    /* Detect the sensorType in the fragment */
    success = extract_str(json, "\"sensorType\"", sensor_type, sizeof(sensor_type));

    /* Build the full payload by wrapping the fragment */
    snprintf(payload, sizeof(payload),
             "{\"sensorId\":\"%s\",%s,\"sourceModelId\":\"%s\"}",
             telem->sensor_id, json, telem->sensor_id);

    /* SPI and debug and array: send immediately — these are real-time events */
    if (strcmp(sensor_type, "debug") == 0 ||
        success == 0) {
        return telemetry_send_payload(telem, payload);
    }

    /* All other types (PSTAT, CHRONO A, CHRONO B, AP, etc.): enqueue for paced replay */
    pthread_mutex_lock(&telem->replay_mutex);
    if (telem->queue_count >= TELEMETRY_QUEUE_SIZE) {
        /* Drop oldest entry to make room */
        telem->queue_head = (telem->queue_head + 1) % TELEMETRY_QUEUE_SIZE;
        telem->queue_count--;
    }
    strncpy(telem->queue[telem->queue_tail].payload, payload,
            TELEMETRY_HTTP_BUFFER_SIZE - 1);
    telem->queue_tail = (telem->queue_tail + 1) % TELEMETRY_QUEUE_SIZE;
    telem->queue_count++;
    pthread_mutex_unlock(&telem->replay_mutex);
    return 0;
}

void coremodel_telemetry_set_replay_interval_ms(coremodel_telemetry_t *telem,
                                                  uint32_t interval_ms)
{
    if (telem && interval_ms >= 1)
        telem->replay_interval_ms = interval_ms;
}

int coremodel_telemetry_replay_tick(coremodel_telemetry_t *telem)
{
    uint64_t now_ms;

    if (!telem || telem->queue_count == 0) return 0;

    now_ms = telemetry_now_ms();
    if (telem->replay_last_ms != 0 &&
        (now_ms - telem->replay_last_ms) < (uint64_t)telem->replay_interval_ms)
        return 0;

    /* Snapshot the loop window on the very first dequeue */
    if (telem->loop_enabled && !telem->loop_armed) {
        telem->loop_head  = telem->queue_head;
        telem->loop_size  = telem->queue_count;
        telem->loop_armed = 1;
        printf("Telemetry: Loop armed — %d samples will repeat\n", telem->loop_size);
    }

    telemetry_send_payload(telem, telem->queue[telem->queue_head].payload);
    telem->queue_head = (telem->queue_head + 1) % TELEMETRY_QUEUE_SIZE;
    telem->queue_count--;
    telem->replay_last_ms = now_ms;

    /* Queue just emptied — rewind to replay the same samples */
    if (telem->queue_count == 0 && telem->loop_enabled && telem->loop_armed) {
        printf("Telemetry: Queue empty, looping %d samples\n", telem->loop_size);
        telem->queue_head  = telem->loop_head;
        telem->queue_tail  = (telem->loop_head + telem->loop_size) % TELEMETRY_QUEUE_SIZE;
        telem->queue_count = telem->loop_size;
    }

    return 1;
}

void coremodel_telemetry_set_loop(coremodel_telemetry_t *telem, int enable)
{
    if (!telem) return;
    pthread_mutex_lock(&telem->replay_mutex);
    telem->loop_enabled = enable;
    if (!enable) {
        telem->loop_armed = 0;
        telem->loop_size  = 0;
    }
    pthread_mutex_unlock(&telem->replay_mutex);
}

int coremodel_telemetry_ready(coremodel_telemetry_t *telem, int rate_hz)
{
    struct timeval now;
    long elapsed_us, interval_us;

    if (!telem || rate_hz <= 0) return 0;
    interval_us = 1000000 / rate_hz;
    gettimeofday(&now, NULL);
    elapsed_us = (now.tv_sec  - telem->last_send_time.tv_sec)  * 1000000 +
                 (now.tv_usec - telem->last_send_time.tv_usec);
    return elapsed_us >= interval_us;
}

void coremodel_telemetry_mark_sent(coremodel_telemetry_t *telem)
{
    if (telem) gettimeofday(&telem->last_send_time, NULL);
}

int coremodel_telemetry_get_sent_count(coremodel_telemetry_t *telem)
{
    return telem ? telem->records_sent : 0;
}

int coremodel_telemetry_get_error_count(coremodel_telemetry_t *telem)
{
    return telem ? telem->errors : 0;
}

int coremodel_telemetry_is_connected(coremodel_telemetry_t *telem)
{
    return telem ? telem->connection_verified : 0;
}

void coremodel_telemetry_destroy(coremodel_telemetry_t *telem)
{
    if (!telem) return;
    printf("Telemetry: Closed (sent %d records, %d errors)\n",
           telem->records_sent, telem->errors);
    telem->replay_running = 0;
    pthread_join(telem->replay_thread, NULL);
    pthread_mutex_destroy(&telem->replay_mutex);
    free(telem->queue);
    free(telem);
}
