#!/usr/bin/env python3
# -*- mode: Python -*-
#  * Copyright (C) 2025 Corellium LLC
#  * All rights reserved.

import sys
import os
from coremodel import coremodel

class uart_func(coremodel.UART_t):

    def tx(self, len: int, data: bytearray) -> int:
        print(data.decode('utf-8'), end='')
        return len

    def brk(self):
        pass

    def rxrdy(self):
        pass

if __name__ == "__main__":

    if len(sys.argv) != 3:
        print("usage: python3 coremodel-uart.py <address[:port]> <uart>")
        sys.exit(1)

    cm = coremodel()
    res = cm.connect(sys.argv[1])
    if res != 0:
        print(f"error: failed to connect: {os.strerror(-res)}", file=sys.stderr)
        sys.exit(1)

    test_uart_func = uart_func()
    handle = cm.attach_uart(sys.argv[2], test_uart_func)
    if (handle == None):
        print(f"error: failed to attach UART.\n")
        cm.disconnect()
        sys.exit(1)

    cm.mainloop(-1)

    cm.detach(handle)
    cm.disconnect()
    sys.exit(0)
