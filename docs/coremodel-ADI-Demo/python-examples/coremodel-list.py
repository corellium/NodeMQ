#!/usr/bin/env python3
# -*- mode: Python -*-
#  * Copyright (C) 2025 Corellium LLC
#  * All rights reserved.

import sys
import os
from coremodel import coremodel

type_string = {
    coremodel.UART: "uart",
    coremodel.I2C:  "i2c",
    coremodel.SPI:  "spi",
    coremodel.GPIO: "gpio",
    coremodel.USBH: "usbh",
    coremodel.CAN: "can" 
}
    
if __name__ == "__main__":

    if len(sys.argv) != 2:
        print("usage: python3 coremodel-list.py <address[:port]>")
        sys.exit(1)

    cm = coremodel()
    res = cm.connect(sys.argv[1])
    if res != 0:
        print(f"error: failed to connect: {os.strerror(-res)}.", file=sys.stderr)
        sys.exit(1)

    list = cm.list()

    cm.disconnect()

    if list is None:
        print("error: failed to list devices.", file=sys.stderr)
        sys.exit(1)

    for idx, device in enumerate(list):
        print("%2d %-7s %-11s %d" % (idx, type_string[device.type], device.name.decode('utf-8'), device.num))

    sys.exit(0)