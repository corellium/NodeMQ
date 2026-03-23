#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
#include <string.h>
#include <unistd.h>
#include <sys/time.h>
#include <pthread.h>
#include <inttypes.h>

#include "max30123.h"
#include <coremodel.h>
#include <coremodel_telemetry.h>
#include "coremodel-spi-max30123.h"

/* should thread_telemetry* printf for this channel? */
static const int channel_debug[] = {
    0, 0, 1, 0, 1, 1
};
static const char *telemetry_channel_names[] = {
    "debugString",
    "fifoPush",
    "fifoPop",
    "generate",
    "spiRead",
    "spiWrite"
};
#define DEBUG_FIFO_PUSH 0
#define DEBUG_SAMPLES 0
#define DEBUG_FIFO_FILL 0

/* This is a worker/consumer thread in a producer/consumer threading model
 * to support coremodel-spi-max30123.file .
 * The main thread connects to the CoreModel APIs and replied to SPI transactions
 * without blocking so that timings sensitive operations do not time out.
 * this thread polls mutex protected flags for work and then performs operations. */

static void thread_print_sample(char *prefix, sample_line_t *sample)
{
    if (!(DEBUG_SAMPLES)) {
        return;
    }
    printf("%s Sample: time %.3f type %s min %d tag %d value %.3f units %s bytes \"%02x\" \"%02x\" \"%02x\" \"0x%06x\"\n",
           prefix,
           sample->timestamp,
           sample->type,
           sample->min,
           sample->tag,
           sample->value,
           sample->units,
           sample->bytes[0],
           sample->bytes[1],
           sample->bytes[2],
           sample->sample_value);
    fflush(stdout);
}

static void thread_reset_samples(max30123_state_t *state)
{
    int i;
    int length = state->sample_count;
    state->sample_count = 0;
    state->fill_pointer = 0;
    state->read_pointer = 0; /* This is the only write to this variable from the thread */
    if (state->samples != NULL) {
        for (i = 0; i < length; i++) {
            free(state->samples[i].type);
            free(state->samples[i].units);
        }
        free(state->samples);
        state->samples = NULL;
    }
    state->last_FIFO_load_time = 0;
}

static uint64_t time_now_ms()
{
    struct timeval now;
    gettimeofday(&now, NULL);
    return (uint64_t)now.tv_sec * 1000 + now.tv_usec / 1000;
}

static void thread_telemetry_sample(max30123_state_t *state, telemetry_channel_t ch_num, sample_line_t *sample) {
    const char *channel = telemetry_channel_names[ch_num];
    char buffer[TELEMETRY_HTTP_BUFFER_SIZE];

    snprintf(buffer, sizeof(buffer),
        "\"sensorType\":\"%s\",\"value\":{"
        "\"type\":\"%s\","
        "\"measurement\":%f,"
        "\"units\":\"%s\","
        "\"timestamp\":%f,"
        "\"min\":\"%02x\","
        "\"tag\":\"%02x\","
        "\"bytes\":[\"%02x\",\"%02x\",\"%02x\"]"
        "}",
        channel,
        sample->type,
        sample->value, /* float value */
        sample->units,
        sample->timestamp, /* timestamp in ms */
        (int)sample->min,
        (int)sample->tag,
        (int)sample->bytes[0], (int)sample->bytes[1], (int)sample->bytes[2]
        );

    if (channel_debug[ch_num]) {
        printf("Telemetry Sample: %s\n", buffer);
        fflush(stdout);
    }
    if (!state->telemetry_enabled || !state->telemetry) {
        return;
    }
    coremodel_telemetry_send_json(state->telemetry, buffer);
}

static void thread_telemetry_spi(max30123_state_t *state) {
    pthread_mutex_lock(&state->max30123_mutex);
    int rd_ptr = state->spi_buffer_read;
    pthread_mutex_unlock(&state->max30123_mutex);

    char bytes_buf[128];
    char buffer[TELEMETRY_HTTP_BUFFER_SIZE];
    int pos = 0;
    unsigned int i;

    for (i = 0; i < state->spi_buffer[rd_ptr][2]; i++)
        pos += snprintf(bytes_buf + pos, 
                        sizeof(bytes_buf) - pos,
                        "%s\"%02x\"", (i > 0 ? "," : ""),
                        (int)state->spi_buffer[rd_ptr][3+i]);

    snprintf(buffer, sizeof(buffer),
        "\"sensorType\":\"%s\",\"value\":{"
        "\"type\":\"SPI\","
        "\"address\":\"%02x\","
        "\"timestamp\":%" PRIu64 "," /* timestamp in whole ms */
        "\"bytes\":[%s]"
        "}",
        (state->spi_buffer[rd_ptr][0] == SPI_WRITE) ? "spiWrite" : "spiRead",
        state->spi_buffer[rd_ptr][1],
        time_now_ms() - state->sample_read_time, /* timestamp in ms since samples were read, to approximate time since device started */
        bytes_buf
        );

    if (channel_debug[state->spi_buffer[rd_ptr][0]]) {
        printf("Telemetry SPI: %s\n", buffer);
        fflush(stdout);
    }
    pthread_mutex_lock(&state->max30123_mutex);
    state->spi_buffer_read++;
    pthread_mutex_unlock(&state->max30123_mutex);

    if (!state->telemetry_enabled || !state->telemetry) {
        return;
    }
    coremodel_telemetry_send_json(state->telemetry, buffer);
}

static void thread_telemetry_string(max30123_state_t *state, const char *str) {
    char buffer[TELEMETRY_HTTP_BUFFER_SIZE];
    snprintf(buffer, sizeof(buffer),
            "\"sensorType\":\"debugString\",\"value\":{\"string\":\"%s\"}",
            str);
    if (channel_debug[NONE]) {
        printf("Telemetry String: %s\n", buffer);
        fflush(stdout);
    }
    if (!state->telemetry_enabled || !state->telemetry) {
        return;
    }
    coremodel_telemetry_send_json(state->telemetry, buffer);
}

/* Update FIFO control registers in the device as if it were being filled by an ADC
 * Note that the data is never stored in a FIFO register */
static void thread_load_fifo_from_samples(max30123_state_t *state)
{
    uint64_t now = time_now_ms();
    state->last_FIFO_load_time = now - state->sample_read_time;
    unsigned starting_pointer = state->fill_pointer;
    if (DEBUG_FIFO_PUSH) {
        printf("Loading FIFO from samples, fill pointer %d, sample count %d at time %" PRIu64 "\n",
            state->fill_pointer, state->sample_count, now - state->sample_read_time);
    }
    fflush(stdout);
    while((state->samples[state->fill_pointer].timestamp <= (now - state->sample_read_time))
          && (state->fill_pointer < state->sample_count)) {
        sample_line_t *current_sample = &state->samples[state->fill_pointer];
        thread_print_sample("Pushed", current_sample);
        thread_telemetry_sample(state, FIFO_PUSH, current_sample);
        state->fill_pointer++;
        state->registers[FIFO_WRITE_POINTER] += 1;
        state->registers[FIFO_COUNTER_2] += 1;
        if(state->registers[FIFO_COUNTER_2] > FIFO_LEN - state->registers[FIFO_CONFIGURATION_1]) {
            state->registers[STATUS_1] |= 0x80; /* Set overflow flag */
        }
    }
    if (state->fill_pointer == state->sample_count) {
        printf("All samples loaded into FIFO\n");
    }
    if (state->read_pointer == state->sample_count) {
        printf("Out of samples, wrapping to the past\n");
        state->read_pointer = 0;
    }
    if((state->fill_pointer - starting_pointer) && DEBUG_FIFO_FILL) {
        printf("FIFO loaded, fill pointer %d, sample count %d, net %d samples\n",
            state->fill_pointer, state->sample_count, state->fill_pointer - starting_pointer);
    }
    fflush(stdout);
}

static void thread_load_samples_from_file(max30123_state_t *state)
{
    FILE *fptr;
    int ret;
    unsigned file_size = 0;
    unsigned line_len = 0;
    unsigned max_line_len = 0;
    unsigned line_count = 0;
    unsigned i;
    unsigned type_count = 0;
    char *test_line;
    char channel_names[TELEMETRY_HTTP_BUFFER_SIZE];
    char *sensor_types[128];
    int pos = 0;

    printf("Loading samples\n");
    thread_telemetry_string(state, "loadSamplesFromFile");

    uint64_t now = time_now_ms();
    int len_path = strlen(state->cwd_path);
    int len_infile = len_path + 2 + strlen("max30123_FIFO_data.csv");

    char *in_file_name = calloc(1, len_infile);
    sprintf(in_file_name, "%s/max30123_FIFO_data.csv", state->cwd_path);

    thread_reset_samples(state);
    state->sample_read_time = now;
    /* read in the output of the generator script */
    fptr = fopen(in_file_name, "r"); // Opens the text file "filename.txt" for reading
    if (fptr == NULL) {
        perror("Error opening file!");
        exit(1);
    }
    /* fid the size of the output */
    for (i = getc(fptr); i != EOF; i = getc(fptr)) {
        line_len++;
        max_line_len = usmax(max_line_len, line_len);
        if (i == '\n') {
            line_count++;
            line_len = 0;
        }
    }
    // Get the current position, which is the file size in bytes
    file_size = ftell(fptr);
    // Rewind the file pointer to the beginning
    rewind(fptr);
    test_line = calloc(max_line_len + 1, sizeof(char));
    state->samples = calloc(line_count+10, sizeof(sample_line_t));

    printf("File size: %d bytes, line count: %d, max line length: %d\n", file_size, line_count, max_line_len);

    while(ftell(fptr) < file_size) {
        sample_line_t *current_sample = &state->samples[state->sample_count];
        char *line = fgets(test_line, max_line_len + 1, fptr);
        if (line == NULL) {
            printf("End of file reached or error reading file\n");
            break; // End of file or error
        }
        current_sample->type = calloc(1, (max_line_len>>1) + 1);
        if(current_sample->type == NULL) {
            fprintf(stderr, "Memory allocation failed for sample type\n");
            exit(1);
        }
        current_sample->units = calloc(1, (max_line_len>>1) + 1);
        if(current_sample->type == NULL) {
            fprintf(stderr, "Memory allocation failed for sample units\n");
            exit(1);
        }
        /* parse the line */
        ret = sscanf(line, "%f,%[^,],%hhx,%hhx,%f,%[^,],%hhx,%hhx,%hhx",
                     &current_sample->timestamp,
                     current_sample->type,
                     &current_sample->min,
                     &current_sample->tag,
                     &current_sample->value,
                     current_sample->units,
                     &current_sample->bytes[0],
                     &current_sample->bytes[1],
                     &current_sample->bytes[2]);
        if (ret == 9) { /* now keeping time in ms globally */
            current_sample->sample_value = (current_sample->bytes[0] << 16) |
                                            (current_sample->bytes[1] << 8) |
                                            (current_sample->bytes[2]);
            thread_print_sample("Loaded", current_sample);
            state->sample_count++;
            for (i = 0; i < type_count; i++) {
                if (strcmp(sensor_types[i], current_sample->type) == 0) {
                    break;
                }
            }
            if (i == type_count) {
                sensor_types[type_count] = current_sample->type;
                type_count++;
            }
        } else {
            printf("Skipping %d tokens: %s\n", ret, line);
            free(current_sample->type);
            free(current_sample->units);
            current_sample->type = NULL;
            current_sample->units = NULL;
        }
    }
    printf("Finished loading %d samples from %d lines\n", state->sample_count, line_count);

    pos = snprintf(channel_names, sizeof(channel_names),
        "\"sensorType\":[\"%s\",\"%s\",\"%s\",\"%s\",\"%s\",\"%s\"],\"type\":[\"SPI\"",
        telemetry_channel_names[0],
        telemetry_channel_names[1],
        telemetry_channel_names[2],
        telemetry_channel_names[3],
        telemetry_channel_names[4],
        telemetry_channel_names[5]
    );
    for (i = 0; i < type_count; i++) {
        pos += snprintf(channel_names + pos, sizeof(channel_names) - pos,
                        ",\"%s\"", sensor_types[i]);
    }
    pos += snprintf(channel_names + pos, sizeof(channel_names) - pos, "]");
    printf("Telemetry String: %s\n", channel_names);
    fflush(stdout);
    if (state->telemetry_enabled && state->telemetry) {
        coremodel_telemetry_send_json(state->telemetry, channel_names);
    }

    for (i = 0; i < state->sample_count; i++) {
        sample_line_t *current_sample = &state->samples[i];
        thread_telemetry_sample(state, GENERATE, current_sample);
    }

    fclose(fptr);
    free(test_line);
    free(in_file_name);
    thread_telemetry_string(state, "dataLoaded");
/*
    pthread_mutex_lock(&state->max30123_mutex);
    pthread_mutex_unlock(&state->max30123_mutex);
*/

    /* load samples into the FIFO */
    thread_load_fifo_from_samples(state);
}

static void thread_generate_samples(max30123_state_t *state)
{
    FILE *fptr;
    int ret;
    unsigned i;

    int len_path = strlen(state->cwd_path);
    int len_generator = strlen(state->data_generator_path);
    int len_outfile = len_path + 1 + strlen("Sequencer_InFile.csv");

    char *out_file_name = calloc(1, len_outfile);
    sprintf(out_file_name, "%s/Sequencer_InFile.csv", state->cwd_path);
    char *full_command = calloc(1, len_generator + strlen("python3  "));
    sprintf(full_command, "python3 %s ", state->data_generator_path);

    fptr = fopen(out_file_name, "w");
    if (fptr == NULL) {
        fprintf(stderr, "Error opening file!");
        exit(1);
    }
    /* dump the registers */
    fprintf(fptr, "RegAddr,Data\n");
    for (i=0; i<REG_COUNT; i++) {
        fprintf(fptr, "%02X,%02X\n", i, state->registers[i]);
    }

    fflush(fptr);
    fsync(fileno(fptr));
    fclose(fptr);

    /* Call external script to generate sample values */
    ret = system(full_command);
    if (ret == -1) {
        perror("Error executing data generator command!\n");
        exit(1);
    }
    thread_telemetry_string(state, "dataGeneratorComplete");

    free(out_file_name);
    free(full_command);
}

static void thread_reset_samples_file(max30123_state_t *state)
{
    int ret;

    int len_path = strlen(state->cwd_path);
    int len_infile = len_path + 2 + strlen("reset.csv");
    char *in_file_name = calloc(1, len_infile);
    sprintf(in_file_name, "%s/reset.csv", state->cwd_path);

    int len_outfile = len_path + 2 + strlen("max30123_FIFO_data.csv");
    char *out_file_name = calloc(1, len_outfile);
    sprintf(out_file_name, "%s/max30123_FIFO_data.csv", state->cwd_path);

    char *full_command = calloc(1, len_infile + len_outfile + strlen("cp ") + 2);
    sprintf(full_command, "cp %s %s", in_file_name, out_file_name);

    /* Call external script to generate sample values */
    ret = system(full_command);
    if (ret == -1) {
        perror("Error resetting samples file!\n");
        exit(1);
    }
    free(full_command);
    free(in_file_name);
    free(out_file_name);
    thread_telemetry_string(state, "samplesFileResetComplete");
}

//main
void* max30123_async_thread(void *priv)
{
    max30123_state_t *state = priv;
    
    if (state->telemetry_enabled && state->telemetry)
        while(coremodel_telemetry_is_connected(state->telemetry) == 0)
            usleep(100);
    thread_telemetry_string(state, "threadStarted");

    state->sample_count = 0;
    thread_reset_samples(state);
    thread_load_samples_from_file(state);

    while (state->exit_requested == 0) {
        while(state->spi_buffer_read != state->spi_buffer_write)
            thread_telemetry_spi(state);
        while(state->report_pointer < state->read_pointer) {
            sample_line_t *sample = &state->samples[state->report_pointer];
            thread_telemetry_sample(state, FIFO_POP, sample);
            state->report_pointer++;
        }

        if(state->generate_samples == 1) {
            thread_generate_samples(state);
            pthread_mutex_lock(&state->max30123_mutex);
            state->generate_samples = 0;
            pthread_mutex_unlock(&state->max30123_mutex);
        }
        if(state->reset_samples_file == 1) {
            thread_reset_samples_file(state);
            pthread_mutex_lock(&state->max30123_mutex);
            state->reset_samples_file = 0;
            pthread_mutex_unlock(&state->max30123_mutex);
        }
        if(state->load_samples == 1) {
            thread_load_samples_from_file(state);
            pthread_mutex_lock(&state->max30123_mutex);
            state->load_samples = 0;
            pthread_mutex_unlock(&state->max30123_mutex);
        }
        /* load FIFO if requested or every second */
        if(((state->load_fifo == 1) ||
              (state->last_FIFO_load_time + 1000 < (time_now_ms() - state->sample_read_time))) &&
             state->fill_pointer < state->sample_count) { 
            thread_load_fifo_from_samples(state);
            pthread_mutex_lock(&state->max30123_mutex);
            state->load_fifo = 0;
            pthread_mutex_unlock(&state->max30123_mutex);
        }
        usleep(10); /* Sleep to prevent busy waiting */
    }
    return 0;
}
