#!/usr/bin/env python3
# -*- mode: Python -*-
#  * Copyright (C) 2025 Corellium LLC
#  * All rights reserved.

import sys
import os
from coremodel import coremodel

class gpio_func(coremodel.GPIO_t):
    def __init__(self, pin: int):
        super().__init__()
        self.pin = pin

    def notify(self, mvolt: int):
        print("GPIO[%d] = %d mV"% (self.pin, mvolt))

if __name__ == "__main__":

    if len(sys.argv) < 3:
        print("usage: python3 coremodel-gpio.py <address[:port]> <gpio0> [...]")
        sys.exit(1)


    cm = coremodel()
    res = cm.connect(sys.argv[1])
    if res != 0:
        print(f"error: failed to connect: {os.strerror(-res)}", file=sys.stderr)
        sys.exit(1)

    for gpio in sys.argv[3:]:
        test_gpio_func = gpio_func(int(gpio))
        handle = cm.attach_gpio(sys.argv[2], int(gpio), test_gpio_func)
        if (handle == None):
            print(f"error: failed to attach gpio {gpio}.\n")
            cm.disconnect()
            sys.exit(1)

    cm.mainloop(-1)

    cm.detach(handle)
    cm.disconnect()
    sys.exit(0)
