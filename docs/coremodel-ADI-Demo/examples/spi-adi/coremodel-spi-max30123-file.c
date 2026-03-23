#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
#include <string.h>
#include <unistd.h>
#include <pthread.h>

#include "max30123.h"
#include <coremodel.h>
#include <coremodel_telemetry.h>
#include "coremodel-spi-max30123.h"

/* Warning, this is a simplified model for testing purposes. Writes burst access
 * mode may not be properly handled, register specific access methods are only
 * checked for the first register. No error checking is done to ensure that
 * misaligned burst reads of the FIFO are properly handled as the spec states
 * they must be aligned. Most registers not associated with the FIFO are
 * implemented as simple read write storage. */

static void print_usage(void) {
    printf("usage: coremodel-spi-max30123 <data generator> <address[:port]> <spi> <cs> <telemetry host>\n\n");
    printf("The data generator is the application called to produce sample data\n\n");
//    printf("The call to the data generator will have two arguments, an input file\n");
    printf("The call to the data generator will have no arguments, it assumes an input file\n");
    printf("containing a dump of the max30123 registers in comma delimited format:\n");
    printf("\t\tRegAddr,Value\n");
//    printf("the second being the output file to contain the sample data in the format:\n");
    printf("and produces an output file to contain the sample data in the format:\n");
    printf("\t\tTime,type,min,tag,value,units,byte2,byte1,byte0\n");
    printf("with one sample per line\n\n");
    printf("The file may optionally have a header row.\n\n");
    printf("Time is interpreted as a floating point value in seconds\n");
    printf("Type, Min, Tag, Value, and Units are human readable data for debug and ignored\n");
    printf("Bytes 2, 1, and 0 are the binary encoding with byte 2 being the first byte read\n");
    printf("from the FIFO.\n\n");
    printf("The Address:port defines which SoC max30123 attaches to and the\n");
    printf("spi and cs define which SPI interface and chip select to use.\n");
    printf("The Telemetry Host defaults to \"localhost\", \"NONE\" will disable telemetry.\n");
    return;
}

static void reset_state(max30123_state_t *state) {
    /* Default Register Values */
    memset(state->registers, 0, sizeof(state->registers));

    state->registers[STATUS_1] = 0x01;
    state->registers[FIFO_CONFIGURATION_1] = 0x7f;
    state->registers[FIFO_CONFIGURATION_2] = 0x08;
    state->registers[AUTO_CLK_DIVIDER_MID] = 0x01;
    state->registers[CHRONO_CLK_DIVIDER_HIGH] = 0x01;
    state->registers[SEQUENCE_COUNTER] = 0x01;
    state->registers[WE1_ALARM_HIGH_MSB] = 0xFF;
    state->registers[WE1_ALARM_HIGH_LSB] = 0xFF;
    state->registers[V2I_ALARM_HIGH_MSB] = 0xFF;
    state->registers[V2I_ALARM_HIGH_LSB] = 0xFF;
    state->registers[GPIO_SETUP_1] = 0x40;
    state->registers[GPIO_SETUP_2] = 0x08;
    state->registers[CUSTOMER_REVISION_ID] = 0x10;
    state->registers[PART_ID] = 0x50;

    /* State Machines */
    state->state = STATE_ADDRESS;
    state->cs = 0;

    /* Thread State */
    state->exit_requested = 0;
    state->generate_samples = 0;
    state->reset_samples_file = 0;
    state->load_samples = 0;
    state->fifo_partial = 0;
    /* Telemetry State */
    state->spi_buffer_read = 0;
    state->spi_buffer_write = 0;
    state->report_pointer = 0;

    state->cs_count = 0;
    state->xfr_count = 0;
}

void update_telemetry_spi(max30123_state_t *state, telemetry_channel_t channel, uint8_t addr,
                          unsigned len, uint8_t *sample) {
    state->spi_buffer[state->spi_buffer_write][0] = channel;
    state->spi_buffer[state->spi_buffer_write][1] = addr;
    state->spi_buffer[state->spi_buffer_write][2] = len;
    memcpy(&state->spi_buffer[state->spi_buffer_write][3], sample, usmin(len, 16-3));
    pthread_mutex_lock(&state->max30123_mutex);
    state->spi_buffer_write++;
    pthread_mutex_unlock(&state->max30123_mutex);
}

static void spi_cs(void *priv, unsigned csel)
{
    max30123_state_t *state = priv;

    if(csel != state->cs){
        if(!csel)
            switch(state->state){
            case STATE_ADDRESS:
                state->state = STATE_RW_OPCODE;
                break;
            case STATE_RW_OPCODE:
                state->state = STATE_DATA;
                break;
            case STATE_DATA:
                state->state = STATE_ADDRESS;
                break;
            }
        state->cs ^= 1;
    }
}

static void spi_rw_debug(char *dir, uint8_t addr, unsigned len, uint8_t *buf)
{
    unsigned i;

    fprintf(stdout, "%s%d %06x [", dir, len, addr);
    for(i=0; i<len; i++)
        fprintf(stdout, " %02x", buf[i]);
    fprintf(stdout," ]\n");
    fflush(stdout);
}

static void load_fifo_from_samples(max30123_state_t *state) {
    pthread_mutex_lock(&state->max30123_mutex);
    state->load_fifo = 1;
    pthread_mutex_unlock(&state->max30123_mutex);
}

static void generate_samples(max30123_state_t *state)
{
    pthread_mutex_lock(&state->max30123_mutex);
    state->generate_samples = 1;
    pthread_mutex_unlock(&state->max30123_mutex);
}

static void reset_samples_file(max30123_state_t *state)
{
    pthread_mutex_lock(&state->max30123_mutex);
    state->reset_samples_file = 1;
    pthread_mutex_unlock(&state->max30123_mutex);
}

static void load_samples_from_file(max30123_state_t *state)
{
    pthread_mutex_lock(&state->max30123_mutex);
    state->load_samples = 1;
    pthread_mutex_unlock(&state->max30123_mutex);
}

static void spi_read(max30123_state_t *state, uint8_t addr, unsigned len, uint8_t *wrdata, uint8_t *rddata)
{
    unsigned rd_ptr;
    unsigned partial;

    /*printf("SPI READ addr %02x len %d\n", addr, len);*/
    /* Warning, burst mode access may be incorrect as reads to the FIFO must be aligned. */
    switch(addr){
    case SERIAL_ID_1 ... SERIAL_ID_5:
        memset(rddata, 0x42, len);
        break;
    case FIFO_DATA_REGISTER:
        if (len < 3) {
            /* Partial read */
            memcpy(rddata, &state->samples[state->read_pointer].bytes[state->fifo_partial], len);
            spi_rw_debug("r", addr, len, rddata);
            state->fifo_partial += len;
            /* only update the FIFO state at the end of a complete read */
            /* WARNING VISOR HACK also only update SPI Telemetry at end of complete read */
            if (state->fifo_partial == 3) {
                state->fifo_partial = 0;
                update_telemetry_spi(state, SPI_READ, addr, 3, state->samples[state->read_pointer].bytes);
                printf("FIFO POP: %06x\n", state->samples[state->read_pointer].sample_value);
                state->read_pointer++;
                state->registers[FIFO_READ_POINTER] += 1;
                state->registers[FIFO_COUNTER_2] -= 1;
                state->registers[FIFO_COUNTER_1] = 0; /* clear overflow counter */
                if(state->registers[FIFO_COUNTER_2] < (FIFO_LEN/2))
                    load_fifo_from_samples(state);
            }
            return;
        } else {
            for (rd_ptr = 0; rd_ptr < (len - 2); rd_ptr += 3) {
                state->fifo_partial = 0; /* clear partial pointer on aligned read, not VISOR HACK */
                memcpy(&rddata[rd_ptr], state->samples[state->read_pointer].bytes, 3);
                printf("FIFO POP: %06x\n", state->samples[state->read_pointer].sample_value);
                if(state->read_pointer < state->sample_count) {
                    state->read_pointer++;
                    state->registers[FIFO_READ_POINTER] += 1;
                    state->registers[FIFO_COUNTER_2] -= 1;
                    state->registers[FIFO_COUNTER_1] = 0; /* clear overflow counter */
                }
            }
            partial = len - rd_ptr;
            if (partial) {
                /* Partial read */
                /* when 3 or more bytes follows a partial read, ignore partial */
                memcpy(&rddata[rd_ptr], state->samples[state->read_pointer].bytes, partial);
                state->fifo_partial += partial;
            }
            if(state->registers[FIFO_COUNTER_2] < (FIFO_LEN/2))
                load_fifo_from_samples(state);
        }
        break;
    case STATUS_1:
        memcpy(rddata, &state->registers[addr], len);
        state->registers[STATUS_1] = 0x00; /* Clear all flags after read */
        break;
    case FIFO_COUNTER_1:
        load_fifo_from_samples(state);
    default:
        memcpy(rddata, &state->registers[addr], len);
    }

    spi_rw_debug("r", addr, len, rddata);
    update_telemetry_spi(state, SPI_READ, addr, len, rddata);
}

static void spi_write(max30123_state_t *state, uint8_t addr, unsigned len, uint8_t *wrdata, uint8_t *rddata)
{
    spi_rw_debug("W", addr, len, wrdata);
    update_telemetry_spi(state, SPI_WRITE, addr, len, wrdata);

    /* Warning, burst mode access may be incorrect as writes that aren't aligned to read-only registers are not properly handled. */
    switch(addr){
        case STATUS_1:               /* Read only */
        case STATUS_2:               /* Read only */
        case FIFO_WRITE_POINTER:     /* Read only */
        case FIFO_READ_POINTER:      /* Read only */
        case FIFO_COUNTER_1:         /* Read only */
        case FIFO_COUNTER_2:         /* Read only */
        case FIFO_DATA_REGISTER:     /* Read only */
        case CLK_V_SPI_COUNT_LSB:    /* Read only */
        case WE1_CURRENT_OFFSET_MSB: /* Read only */
        case WE1_CURRENT_OFFSET_LSB: /* Read only */
        case SERIAL_ID_1 ... SERIAL_ID_5: /* Read only */
        case PART_ID:                /* Read only */
            break;
        case CONVERT_MODE:
            if (wrdata[0] & 0x01) {
                generate_samples(state);
                load_samples_from_file(state);
            }
            if (wrdata[0] & 0x18) {
                reset_samples_file(state);
                load_samples_from_file(state);
            }
    default:
        memcpy(&state->registers[addr], wrdata, len);
        break;
    }
    memset(rddata, 0, len);
}

static int spi_xfr(void *priv, unsigned len, uint8_t *wrdata, uint8_t *rddata)
{
    max30123_state_t *state = priv;
    unsigned idx;

    /*
    state->xfr_count++;
    if (state->xfr_count > 10000)
        exit(21);
    */

    for(idx=0; idx<len; idx++){
        switch(state->state){
        case STATE_ADDRESS:
            state->addr = wrdata[idx];
            rddata[idx] = 0xff;
            break;
        case STATE_RW_OPCODE:
            state->rw = (wrdata[0] == 0x80) ? spi_read : spi_write;
            rddata[idx] = 0xff;
            break;
        case STATE_DATA:
            state->rw(state, state->addr, len - idx, &wrdata[idx], &rddata[idx]);
            idx = len;
            break;
        }
    }

    return len;
}

static const coremodel_spi_func_t spi_func = {
    .cs = spi_cs,
    .xfr = spi_xfr
};

int main(int argc, char *argv[])
{
    int res, len_path;
    void *handle = NULL;
    void *cm = NULL;
    char *temp_path;
    FILE *fp;
    max30123_state_t *state;
    pthread_t pt;
    char test_string[] = "\"sensorType\":\"debugString\",\"value\":{\"string\":\"hello world\"}";

    if(argc != 5 && argc != 6) {
        printf("Usage: %s <data_generator_path> <bus_name> <device_id> <chip select> <telemetry host>\n", argv[0]);
        printf("got %d arguments\n", argc);
        print_usage();
        return 1;
    }

    // Check for both existence (F_OK) and execute permission (X_OK)
    if (access(argv[1], F_OK | X_OK) != 0) {
        // Check errno to determine the specific reason for failure
        if (errno == ENOENT) {
            printf("The data generator '%s' does not exist.\n\n", argv[1]);
        } else if (errno == EACCES) {
            printf("The data generator '%s' exists, but execute permission is denied.\n\n", argv[1]);
        } else {
            printf("Error checking data generator '%s': %s\n\n", argv[1], strerror(errno));
        }
        print_usage();
        return 1;
    }

    res = coremodel_connect(&cm, argv[2]);
    if(res) {
        fprintf(stderr, "error: failed to connect: %s.\n", strerror(-res));
        return 1;
    }

    state = calloc(1, sizeof(max30123_state_t));
    state->data_generator_path = argv[1];
    state->rw = spi_read;
    reset_state(state);
    if ((state->cwd_path = getcwd(NULL, 0)) == NULL) {
        fprintf(stderr, "getcwd error\n");
        return 1;
    }

    if(pthread_mutex_init(&state->max30123_mutex, NULL)) {
        fprintf(stderr, "error: Failed to initialize mutex: %s.\n", strerror(errno));
        return 1;
    }

    len_path = strlen(state->cwd_path);
    temp_path = calloc(1, len_path + 12);
    snprintf(temp_path, len_path + 12, "%s/write_test", state->cwd_path);
    fp = fopen(temp_path, "w"); // Try to open for writing
    if (fp != NULL) {
        fclose(fp);
        remove(temp_path); // Clean up the temporary file
    } else {
        fprintf(stderr, "error: current directory is not writable.\n");
        return 1;
    }

    /* Create sensor ID from bus info */
    char sensor_id[256];
    snprintf(sensor_id, sizeof(sensor_id), "max30123-%s", argv[3]);

    if(argc == 6) {
        if(strcmp(argv[5], "NONE") != 0) {
            /* Initialize telemetry client */
            state->telemetry = coremodel_telemetry_create(
                sensor_id,           /* Unique sensor identifier */
                argv[5],             /* Server host */
                3000,                /* Server port */
                "/ingest"            /* HTTP endpoint path */
            );
        } else {
            state->telemetry_enabled = 0;
            state->telemetry = NULL;
        }
    } else {
        /* Initialize telemetry client */
        state->telemetry = coremodel_telemetry_create(
            sensor_id,           /* Unique sensor identifier */
            "localhost",         /* Server host */
            3000,                /* Server port */
            "/ingest"            /* HTTP endpoint path */
        );
    }

    if (state->telemetry) {
        /* Optional: test connection before enabling */
        if (coremodel_telemetry_test(state->telemetry) == 0) {
            state->telemetry_enabled = 1;
        } else {
            state->telemetry_enabled = 0;
        }
    }

    handle = coremodel_attach_spi(cm, argv[3], atoi(argv[4]), &spi_func, state, COREMODEL_SPI_BLOCK);
    if(!handle) {
        fprintf(stderr, "error: failed to attach SPI.\n");
        coremodel_disconnect(cm);
        free(state->cwd_path);
        state->cwd_path = NULL;
        return 1;
    }

    if (state->telemetry_enabled && state->telemetry)
        while(coremodel_telemetry_is_connected(state->telemetry) == 0) {
            coremodel_telemetry_send_json(state->telemetry, test_string);
            usleep(5000);
        }
    pthread_create(&pt, NULL, max30123_async_thread, state);
    printf("thread created\n");
    coremodel_mainloop(cm, -1);

    pthread_mutex_destroy(&state->max30123_mutex);
    coremodel_detach(handle);
    coremodel_disconnect(cm);
    if (state->telemetry) {
        coremodel_telemetry_destroy(state->telemetry);
    }
    free(state->cwd_path);
    state->cwd_path = NULL;

    return 0;
}
