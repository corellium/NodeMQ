#!/usr/bin/env python3
# -*- mode: Python -*-
#  * Copyright (C) 2025 Corellium LLC
#  * All rights reserved.

import sys
import os
from coremodel import coremodel

class i2c_func(coremodel.I2C_t):

    def start(self):
        print("START")
        return 1

    def write(self, len, data):
        print("WRITE [%d]:" % len, end='')
        for idx in range(len):
            print("%02x" % data[idx], end='')
        print("")
        return len

    def read(self, len, data):
        data.clear()
        print("READ [%d]" % len)
        for idx in range(len):
            data.append(0xA0 + (idx & 0x3F))
        return len

    def stop(self):
        print("STOP")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: python3 coremodel-i2c.py <address[:port]> <i2c>")
        sys.exit(1)

    cm = coremodel()
    res = cm.connect(sys.argv[1])
    if res != 0:
        print(f"error: failed to connect: {os.strerror(-res)}.", file=sys.stderr)
        sys.exit(1)

    test_i2c_func = i2c_func()
    handle = cm.attach_i2c(sys.argv[2], 0x42, test_i2c_func, 0)
    if (handle == None):
        print(f"error: failed to attach i2c.\n")
        cm.disconnect()
        sys.exit(1)

    cm.mainloop(-1)

    cm.detach(handle)
    cm.disconnect()
    sys.exit(0)
