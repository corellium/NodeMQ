#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
#include <string.h>

#include "max30123.h"
#include <coremodel.h>

enum {
    STATE_ADDRESS,
    STATE_RW_OPCODE,
    STATE_DATA
};

enum {
    RW_TYPE_READ,
    RW_TYPE_WRITE
};

#define FIFO_LEN    3

typedef struct max30123_state {
    unsigned state;
    unsigned addr;
    unsigned cs;
    void (*rw)(struct max30123_state *, uint8_t, unsigned, uint8_t *, uint8_t *);

    /* Registers */
    uint8_t fifo[FIFO_LEN];

    unsigned rp, wp;
} max30123_state_t;

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

    fprintf(stderr, "%s%d %08x [", dir, len, addr);
    for(i=0; i<len; i++)
        fprintf(stderr, " %02x", buf[i]);
    fprintf(stderr," ]\n");
}

static void spi_generate_sample(max30123_state_t *state)
{
    static uint16_t sample = -0x20;

    sample = 0x7000 + ((sample + 0x20) % 0x800);

    state->fifo[state->wp++ % FIFO_LEN] = 0x00;
    state->fifo[state->wp++ % FIFO_LEN] = (sample >> 8);
    state->fifo[state->wp++ % FIFO_LEN] = (sample & 0xff);
}

#define usmin(_a, _b) ((_a) < (_b) ? (_a) : (_b))
static void spi_read(max30123_state_t *state, uint8_t addr, unsigned len, uint8_t *wrdata, uint8_t *rddata)
{
    unsigned sz;

    switch(addr){
    case SERIAL_ID_1 ... SERIAL_ID_5:
        memset(rddata, 0x42, len);
        break;
    case FIFO_COUNTER_1:
        /* Samples are 3 bytes long */
        rddata[0] = 0;
        rddata[1] = (state->wp - state->rp)/3;
        break;
    case FIFO_DATA_REGISTER:
        sz = usmin(len, state->wp - state->rp);
        memcpy(rddata, &state->fifo[state->rp % FIFO_LEN], sz);
        state->rp += sz;

        if( !(state->wp - state->rp) )
            spi_generate_sample(state);
        break;
    default:
        memset(rddata, 0, len);
    }

    spi_rw_debug("r", addr, len, rddata);
}

static void spi_write(max30123_state_t *state, uint8_t addr, unsigned len, uint8_t *wrdata, uint8_t *rddata)
{
    spi_rw_debug("W", addr, len, wrdata);

    switch(addr){
    default:
        memset(rddata, 0, len);
    }
}

static int spi_xfr(void *priv, unsigned len, uint8_t *wrdata, uint8_t *rddata)
{
    max30123_state_t *state = priv;
    unsigned idx;

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

static void spi_reset(max30123_state_t *state)
{
    state->rp = 0;
    state->wp = 0;
    state->state = STATE_ADDRESS;
    state->rw = spi_read;

    spi_generate_sample(state);
}

static const coremodel_spi_func_t spi_func = {
    .cs = spi_cs,
    .xfr = spi_xfr
};

int main(int argc, char *argv[])
{
    int res;
    void *handle;
    void *cm = NULL;
    max30123_state_t *state;

    if(argc != 4) {
        printf("usage: coremodel-spi <address[:port]> <spi> <cs>\n");
        return 1;
    }

    res = coremodel_connect(&cm, argv[1]);
    if(res) {
        fprintf(stderr, "error: failed to connect: %s.\n", strerror(-res));
        return 1;
    }

    state = calloc(1, sizeof(max30123_state_t));
    handle = coremodel_attach_spi(cm, argv[2], atoi(argv[3]), &spi_func, state, COREMODEL_SPI_BLOCK);
    if(!handle) {
        fprintf(stderr, "error: failed to attach SPI.\n");
        coremodel_disconnect(cm);
        return 1;
    }

    spi_reset(state);

    coremodel_mainloop(cm, -1);

    coremodel_detach(handle);
    coremodel_disconnect(cm);

    return 0;
}
