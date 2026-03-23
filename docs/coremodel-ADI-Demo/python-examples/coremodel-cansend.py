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

        if(self.can_rx(rxctrl, None)):
            print(f"Rx send failed", file=sys.stderr)

        return self.ACK

    def rxcomplete(self, nak):
        print(" -> %d\n" % nak)

if __name__ == "__main__":
    if len(sys.argv) != 4 or len(sys.argv[3]) < 4 or sys.argv[3][3] != '#' or len(sys.argv[3]) > 20:
        print("usage: python3 coremodel-cansend.py <address[:port]> <can> <data>")
        print("data is 3 hex character address followed by the # character")
        print("payload is up to 16 hex characters (8 bytes)")
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

    input_str = sys.argv[3]
    input_len = len(input_str)
    data_length = input_len - 4                 # remove address length
    character = '0'
    if(data_length % 2):
        dln = int((data_length - 1)/2)               # drop an extra char
    else:
        dln = int(data_length/2)                    # convert to bytes

    # process the address argument
    addr = 0                                    # address to send to
#    for i in range (3):
    try:
        addr = int(input_str[:3], 16)
    except:
        print("error: invalid address.\n", file=sys.stderr)
        sys.exit(1)

    rxctrl = [ 0, 0 ]                           # return control message, 2 64bit words
    rxctrl[0] |= (addr << test_can_func.CTRL_ID_SHIFT)   # set ID
    rxctrl[0] |= (dln << test_can_func.CTRL_DLC_SHIFT)   # set size
    txdata = []
    if(dln > 0):
        txdata = [0] * dln

    # process the data argument
    for i in range(dln):
        try:
            txdata[i] = int(input_str[(2*i) + 4], 16) << 4
            txdata[i] += int(input_str[(2*i) + 5], 16)
            i += 1
        except:
            pass
    #     character = input_str[(2*i) + 4];  # first nibble
    #     if(character <= '9' and character >= '0'):
    #         txdata[i] = (character - '0') << 4
    #     elif(character <= 'F' and character >= 'A'):
    #         txdata[i] = (character - 'A' + 0xa) << 4
    #     elif(character <= 'f' and character >= 'a'):
    #         txdata[i] = (character - 'a' + 0xa) << 4

    #     character = input_str[(2*i) + 4 + 1]; # second nibble
    #     if(character <= '9' and character >= '0'):
    #         txdata[i] += (character - '0')
    #     elif(character <= 'F' and character >= 'A'):
    #         txdata[i] += (character - 'A' + 0xa)
    #     elif(character <= 'f' and character >= 'a'):
    #         txdata[i] += (character - 'a' + 0xa)

    # send the frame
    if(test_can_func.can_rx(rxctrl, txdata)):
        print(f"Rx send failed", file=sys.stderr)

    cm.mainloop(1)

    cm.detach(handle)
    cm.disconnect()
    sys.exit(0)
