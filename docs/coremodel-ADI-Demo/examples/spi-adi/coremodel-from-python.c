#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
#include <string.h>

#include <coremodel.h>

typedef struct spi_adi_state {
    int initialized;
    int counter;
    int r_start;
    int r_end;
    uint8_t received_bytes[1024];
} spi_adi_state_t;

static void test_spi_cs(void *priv, unsigned csel)
{
    // cast the void * into the "this" pointer
    //spi_adi_state_t *state = priv;
    if(csel)
        printf("CS Asserted\n");
    else
        printf("CS Deasserted\n");
}

static int test_spi_xfr(void *priv, unsigned len, uint8_t *wrdata, uint8_t *rddata)
{
    // cast the void * into the "this" pointer
    spi_adi_state_t *state = priv;
    unsigned idx, to_send = len;

    printf("[%d]", len);
    for(idx=0; idx<len; idx++)
        printf(" %02x", wrdata[idx]);
    printf("\n");
    fflush(stdout);
    for(idx=0; idx<len; idx++) {
        state->received_bytes[(state->r_end++)%1024] = wrdata[idx]; // copy received bytes to alignment buffer
    }
    idx = 0;
    while(state->initialized == 0 && state->r_end - state->r_start >= 3) { // while scanning at least 3 bytes available
        // Scan for initialization command
        if((state->received_bytes[(state->r_start+1)%1024] == 0x00 && // write command
            ((state->received_bytes[(state->r_start)%1024] != 0xFF || 
              state->received_bytes[(state->r_start+2)%1024] != 0xFF))) ||
           ((state->received_bytes[(state->r_start+1)%1024] == 0xFF) && // read command
            (state->received_bytes[(state->r_start+2)%1024] == 0xFF))){ // null reply
                // Assume this is a valid write command if we have 0x00 at byte 1 and either other byte is not 0xFF
                // or assume this is a valid read command if we have 0xFF at byte 1 and 2
                state->initialized = 1;
        } else {
            if (state->r_end - state->r_start <= len) {
                rddata[idx++] = state->received_bytes[state->r_start%1024]; // default to simple echo
                to_send--;
            }
            state->r_start++; // pop one byte
        }
        printf("Device initialized\n");
        if(state->r_start > 1024) {
            state->r_start = state->r_start % 1024;
            state->r_end = state->r_end % 1024;
        }
    }

    if(state->initialized == 1) { // r_start points to the beginning of a command
        while (state->r_end - state->r_start >= 3) { // while at least one command available
            if(state->r_end - state->r_start >= to_send) { // send the first byte?
                rddata[idx++] = state->received_bytes[(state->r_start)%1024]; // echo the address
                to_send--;
            }
            if(state->r_end - state->r_start + 1 >= to_send) { // send the second byte?
                rddata[idx++] = state->received_bytes[(state->r_start+1)%1024]; // echo the command
                to_send--;
            }
            if (state->received_bytes[(state->r_start + 1) % 1024] == 0x00) { // write command
                state->counter = state->received_bytes[(state->r_start+2)%1024]; // store the value
                rddata[idx++] = state->received_bytes[(state->r_start+2)%1024]; // echo the value
                printf("Write command: ");
            } else { // write command
                rddata[idx++] = state->received_bytes[(state->r_start+2)%1024]; // return the stored value
                printf("Read command: ");
            }
            to_send--; // third byte is always new or it would have send the previous call
            printf("Addr 0x%02x Cmd 0x%02x Data 0x%02x\n", state->received_bytes[(state->r_start)%1024],
                    state->received_bytes[(state->r_start+1)%1024], state->received_bytes[(state->r_start+2)%1024]);
            state->r_start += 3; // pop the command
            if(state->r_start > 1024) {
                state->r_start = state->r_start % 1024;
                state->r_end = state->r_end % 1024;
            }
        }
    } else {
        printf("Device not initialized. ");
    }

    if (to_send > 0) {
        printf("Extra bytes ");
        for(; idx<len; idx++) {
            rddata[idx] = state->received_bytes[(state->r_start)%1024]; // default to simple echo
            printf("0x%02x ", state->received_bytes[(state->r_start)%1024]);
            to_send--;
        }
    }
    return len;
}

static const coremodel_spi_func_t test_spi_func = {
    .cs = test_spi_cs,
    .xfr = test_spi_xfr };
 
int main(int argc, char *argv[])
{
    int res;
    void *handle;
    spi_adi_state_t *state;

    if(argc != 3) {
        printf("usage: coremodel-spi <address[:port]> <spi>\n");
        return 1;
    }

    res = coremodel_connect(argv[1]);
    if(res) {
        fprintf(stderr, "error: failed to connect: %s.\n", strerror(-res));
        return 1;
    }

    state = malloc(sizeof(spi_adi_state_t));
    state->initialized = 0;
    state->counter = 0;
    state->r_start = 0;
    state->r_end = 0;
    handle = coremodel_attach_spi(argv[2], 0, &test_spi_func, state, COREMODEL_SPI_BLOCK);
    if(!handle) {
        fprintf(stderr, "error: failed to attach SPI.\n");
        coremodel_disconnect();
        return 1;
    }

    coremodel_mainloop(-1);

    coremodel_detach(handle);
    coremodel_disconnect();

    return 0;
}
