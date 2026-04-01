#ifndef _COREMODEL_MAX30123_H
#define _COREMODEL_MAX30123_H

#include <stdlib.h>
#include <pthread.h>
#include <coremodel_telemetry.h>

/* Warning, this is a simplified model for testing purposes. Writes burst access
 * mode may not be properly handled, register specific access methods are only
 * checked for the first register. No error checking is done to ensure that
 * misaligned burst reads of the FIFO are properly handled as the spec states
 * they must be aligned. Most registers not associated with the FIFO are
 * implemented as simple read write storage. */

enum {
    STATE_ADDRESS,
    STATE_RW_OPCODE,
    STATE_DATA
};

enum {
    RW_TYPE_READ,
    RW_TYPE_WRITE
};

typedef enum {
    NONE,
    FIFO_PUSH,
    FIFO_POP,
    GENERATE,
    SPI_READ,
    SPI_WRITE
} telemetry_channel_t;

#define FIFO_LEN    8192
#define REG_COUNT   256

#define usmin(_a, _b) ((_a) < (_b) ? (_a) : (_b))
#define usmax(_a, _b) ((_a) > (_b) ? (_a) : (_b))

typedef struct sample_line {
    float timestamp;
    char *type;
    uint8_t min;
    uint8_t tag;
    float value;
    char *units;
    uint8_t bytes[3];
    int sample_value;
} sample_line_t;

typedef struct max30123_state {
    unsigned state;
    unsigned addr;
    unsigned cs;
    void (*rw)(struct max30123_state *, uint8_t, unsigned, uint8_t *, uint8_t *);
    char *data_generator_path;
    char *cwd_path;

    /* Registers */
    uint8_t registers[REG_COUNT];
    /* Emulate the fifo by reading through the samples array */
    uint8_t fifo_partial; /* pointer to continue partial fifo reads */

    /* Telemetry */
    coremodel_telemetry_t *telemetry;
    int telemetry_enabled;
    uint8_t spi_buffer[FIFO_LEN][16];
    uint32_t spi_buffer_write;
    uint32_t spi_buffer_read;
    unsigned report_pointer;

    /* Threading Controls */
    pthread_mutex_t max30123_mutex;
    int exit_requested;
    int generate_samples;
    int reset_samples_file;
    int load_samples;
    int load_fifo;

    /* Sample lines from the generator */
    sample_line_t *samples;
    unsigned sample_count;
    unsigned fill_pointer;
    unsigned read_pointer;
    uint64_t sample_read_time; /* time in ms */

    /* Thread Scheduling */
    uint64_t last_FIFO_load_time;

    /* debug */
    int cs_count;
    int xfr_count;
} max30123_state_t;

void* max30123_async_thread(void *priv);

#endif /* _COREMODEL_MAX30123_H */
