#!/usr/bin/env python3
# -*- mode: Python -*-
#  * Copyright (C) 2025 Corellium LLC
#  * All rights reserved.

import sys
import os
from coremodel import coremodel

gw_connection_enabled = True
gw_test = False

class spi_func(coremodel.SPI_t):

    def cs(self, csel):
        pass

    def __init__(self):
        super().__init__()
        # Initialize the state of the device to POR values
        self.received_bytes = bytearray()
        self.initialized = False

    def xfr(self, length, wrdata, rddata):
        if gw_test:
            global gw_byte_test
            wrdata = [0x15, gw_byte_test, 0x22]
            gw_byte_test = not gw_byte_test

        rddata.clear()
        self.received_bytes.extend(wrdata)
        to_send = length

        # scan available bytes a command
        while not self.initialized and len(self.received_bytes) >= 3:
            if (((self.received_bytes[1] == 0x00) and # write command
                ((self.received_bytes[0] != 0xFF) or (self.received_bytes[2] == 0xFF))) or
                (self.received_bytes[1] == 0xFF) and (self.received_bytes[2] == 0xFF)): # read command and null reply
                # Assume a valid write command if we have 0x00 at byte 1 and at least one of byte 0 or 2 is not 0xFF
                # or probably a valid read command if we have 0xFF at byte 1 and 2
                self.initialized = True
                break
            else: # first three bytes are not a command
                if(len(self.received_bytes) <= length): # if the first byte was in this transfer
                    rddata.extend(self.received_bytes[0]) # echo garbage byte
                    to_send -= 1
                # drop garbage byte
                self.received_bytes.pop(0)

        # is there a command at the beginning of the received_bytes
        if self.initialized:
            if gw_connection_enabled:
                local_bytes = bytearray()
#                ws = websocket.WebSocket()
#                ws.connect(uri_sdc)
                while len(self.received_bytes) >= 3:
                    local_bytes.clear()
                    local_bytes.extend(self.received_bytes[:3])
#                    message = self.mosi_data_to_json(local_bytes)

 #                   ws.send(message)
#                    local_bytes.clear()
#                    response = ws.recv()

#                    self.miso_json_to_data(response, local_bytes)

                    rddata.extend(local_bytes[-min(3, to_send):])
                    to_send -= min(3, to_send)
                    for x in range(3):
                        self.received_bytes.pop(0)
#                ws.close()
                rddata.extend(self.received_bytes[:to_send])
                return length

        # either not i
        print("[%d]" % length, end='')
        for idx in range(length):
            print(" %02x" % wrdata[idx], end='')
        print("")
        rddata.extend(wrdata)
        return length

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: python3 coremodel-spi.py <address[:port]> <spi>")
        sys.exit(1)

    cm = coremodel()
    res = cm.connect(sys.argv[1])
    if res != 0:
        print(f"error: failed to connect: {os.strerror(-res)}.", file=sys.stderr)
        sys.exit(1)

    test_spi_func = spi_func()
    handle = cm.attach_spi(sys.argv[2], 0, test_spi_func, test_spi_func.SPI_BLOCK)
    if (handle == None):
        print(f"error: failed to attach SPI.\n")
        cm.disconnect()
        sys.exit(1)

    cm.mainloop(-1)

    cm.detach(handle)
    cm.disconnect()
    sys.exit(0)