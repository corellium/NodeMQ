#!/usr/bin/env python3
# -*- mode: Python -*-
#  * Copyright (C) 2025 Corellium LLC
#  * All rights reserved.

import sys
import os
from coremodel import coremodel

class spi_func(coremodel.SPI_t):

    def cs(self, csel):
        pass

    def xfr(self, len, wrdata, rddata):
        print("[%d]" % len, end='')
        for idx in range(len):
            print(" %02x" % wrdata[idx], end='')
        print("")
        rddata.clear()
        for idx in range(len):
            rddata.append(ord('A') + (idx & 63))
        return len

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