#!/usr/bin/env python3
# -*- mode: Python -*-
#  * Copyright (C) 2025 Corellium LLC
#  * All rights reserved.

import sys
import os
from coremodel import coremodel

class can_func(coremodel.CAN_t):

    def tx(self, ctrl, data):
        dlen = self.can_datalen[(ctrl[0] & self.CTRL_DLC_MASK) >> self.CTRL_DLC_SHIFT]
        rxctrl = [(self.CTRL_ERTR | (0x3FFFF << self.CTRL_EID_SHIFT) | (0x456 << self.CTRL_ID_SHIFT)),
                  0]

        if(dlen):
            print("[%016x %016x] %u, " % (ctrl[0], ctrl[1], dlen), end='')
            for idx in range(dlen):
                print("%02x" % data[idx], end='')
            print("")
        else:
            print("[%016x %016x]" % (ctrl[0], ctrl[1]))

#        print("[%016x %016x]" % (rxctrl[0], rxctrl[1]))
        if(self.can_rx(rxctrl, None)):
            print(f"Rx send failed", file=sys.stderr)

        return self.ACK

    def rxcomplete(self, nak):
        print(" -> %d" % nak)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: python3 coremodel-can.py <address[:port]> <can>")
        sys.exit(1)

    cm = coremodel()
    res = cm.connect(sys.argv[1])
    if res != 0:
        print(f"error: failed to connect: {os.strerror(-res)}.", file=sys.stderr)
        sys.exit(1)

    test_can_func = can_func()
    handle = cm.attach_can(sys.argv[2], test_can_func)
    if (handle == None):
        print(f"error: failed to attach CAN.\n")
        cm.disconnect()
        sys.exit(1)

    cm.mainloop(-1)

    cm.detach(handle)
    cm.disconnect()
    sys.exit(0)