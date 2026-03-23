#!/usr/bin/env python3
# -*- mode: Python -*-
#  * Copyright (C) 2025 Corellium LLC
#  * All rights reserved.

import sys
import os
from coremodel import coremodel
from coremodel_rtc import ds_rtc

class can_func(coremodel.CAN_t):
    def __init__(self):
        super().__init__()
        # Initialize the state of the device to POR values
        self.rtc = ds_rtc()
        self.initialized = False
        self.node_id = 0x13 # // per CANopen max ID == 0x3F

# /* .tx is defined as the function called by the bus on any transmit
# * .rxcomplete is defined as the function called by the bus in response 
# *  to a transmit from this node
    def tx(self, ctrl, data):
        "Called by the bus on any transmit"
        # begin basic packet dump functionality

        # find the length of data portion of the CAN frame
        dlen = self.can_datalen[(ctrl[0] & self.CTRL_DLC_MASK) >> self.CTRL_DLC_SHIFT]
        ID = (ctrl[0] & self.CTRL_ID_MASK) >> self.CTRL_ID_SHIFT # 11 bit ID
        IDE = (ctrl[0] & self.CTRL_IDE) >> 34           # Extended Frame Format Flag
        RTR = (ctrl[0] & self.CTRL_RTR) >> 35           # Remote Transmission Request Flag
        EID = (ctrl[0] & self.CTRL_EID_MASK) >> self.CTRL_EID_SHIFT # 18 bit EID
        CEID = (ID << 18) | EID                         # combined ID and EID as shown by candump
        if(IDE): # if extended ID
            RTR = (ctrl[0] & self.CTRL_ERTR) >> 15      # Extended Remote Transmission Request Flag
            print("ID %08x RTR %x" % (CEID, RTR), end='')
        else:
            print("ID %03x RTR %x" % (ID, RTR), end='')
        # note fields for CAN XL not addressed

        # print raw CTRL and data: 
        if(dlen):
            print(" [%016x %016x] %u, " % (ctrl[0], ctrl[1], dlen), end='')
            for idx in range(dlen):
                print("%02x" % data[idx], end='')
                if((idx % 2) and (idx<(dlen-1))):       # print _ every 4 characters
                    print("_", end='')

            print("")
        else:
            print(" [%016x %016x]" % (ctrl[0], ctrl[1]))

        # end packet dump, begin RTC functionality
        rxctrl = [0, 0]                                 # return control message
        rxdata = []                                     # return data

        if(IDE): # Note the RTC only handles SFF frames, do not send an ACK packet for other transactions
            return self.ACK

        self.rtc.update_alarms()                        # update the clock if RTC command

        # programming manual section 6.3.1
        if((ID == 0x7ff) and (dlen == 0)):              # broadcast initialization
            self.initialized = True
            print("Initialization received.")
            rxctrl[0] |= (0x7fe << self.CTRL_ID_SHIFT)  # set return ID
            rxctrl[0] |= (0x2 << self.CTRL_DLC_SHIFT)   # set return size
            rxdata = [0] * 2                            # return data
            rxdata[0] = self.node_id                    # send the node id 
            rxdata[1] = 0x2                             # set the baud rate to 500 kBaud ignored
            # send the reply
            if(self.can_rx(rxctrl, rxdata)):
                print(f"Rx send failed", file=sys.stderr)
            return self.ACK                             # only handle a single transaction

        # device doesn't listen until initialized
        if(not self.initialized):
            return self.ACK

        # programming manual section 6.3.2
        if(ID == 0x300 + self.node_id):
            if(dlen != 6):                              # RTC set
                print("Incorrect argument count %02x for RTC Set command." % dlen)
            else:
                print("RTC Set.")
                print("Ignoring request to set Day %02x Month %02x Year %02x Hour %02x Minute %02x DOW %02x" %
                      (data[0], data[1], data[2], data[3], data[4], data[5]))
                rxctrl[0] |= ((0x280 + self.node_id) << self.CTRL_ID_SHIFT);    # set return ID
                rxctrl[0] |= (0x6 << self.CTRL_DLC_SHIFT);                      # set return size
                rxdata = [0] * 6                        # return data

                (out_str, rxdata[0]) = self.rtc.time.read_date()
                print(out_str)
                (out_str, rxdata[1]) = self.rtc.time.read_month()
                print(out_str)
                (out_str, rxdata[2]) = self.rtc.time.read_year()
                print(out_str)
                (out_str, rxdata[3]) = self.rtc.time.read_hours()
                print(out_str)
                (out_str, rxdata[4]) = self.rtc.time.read_minutes()
                print(out_str)
                (out_str, rxdata[5]) = self.rtc.time.read_day()
                print(out_str)
                      
                # send the reply
                if(self.can_rx(rxctrl, rxdata)):
                    print(f"Rx send failed", file=sys.stderr)
                return self.ACK                             # only handle a single transaction

        # programming manual section 6.3.3
        if((ID == 0x200 + self.node_id) and (dlen == 0)):   # RTC request
            print("RTC Request.")
            rxctrl[0] |= ((0x180 + self.node_id) << self.CTRL_ID_SHIFT)     # set return ID
            rxctrl[0] |= (0x8 << self.CTRL_DLC_SHIFT)                       # set return size
            rxdata = [0] * 8                            # return data

            (out_str, rxdata[0]) = self.rtc.time.read_date()
            print(out_str)
            (out_str, rxdata[1]) = self.rtc.time.read_month()
            print(out_str)
            (out_str, rxdata[2]) = self.rtc.time.read_year()
            print(out_str)
            (out_str, rxdata[3]) = self.rtc.time.read_hours()
            print(out_str)
            (out_str, rxdata[4]) = self.rtc.time.read_minutes()
            print(out_str)
            (out_str, rxdata[5]) = self.rtc.time.read_seconds()
            print(out_str)
            (out_str, rxdata[6]) = self.rtc.time.read_day()
            print(out_str)
            rxdata[7] = 0x0                             # Battery state sufficient
            print("Battery State Sufficient")
            
            # send the reply
            if(self.can_rx(rxctrl, rxdata)):
                print(f"Rx send failed", file=sys.stderr)
            return self.ACK                             # only handle a single transaction

        # programming manual section 6.3.4
        if(ID == 0x500 + self.node_id):
            if (dlen != 7):                             # Alarm Set
                print("Incorrect argument count %02x for Alarm Set command." % dlen)
            else:
                print("Setting Alarm.")
                rxctrl[0] |= (0x7 << self.CTRL_DLC_SHIFT)   # set return size
                rxdata = [0] * 7                        # return data

                if (data[0] < 7):
                    self.rtc.Alarm1.write_day((((self.rtc.time.day - 1 + data[0]) % 7) + 1) | (0x40 if data[6] == 0x00 else 0))
                rxdata[0] = data[0]
#                print("current %02x and offset %02x = %02x" % (self.rtc.time.day, data[0], self.rtc.Alarm1.day & 0x07))
                print("Days until alarm [0-6] %02x" % rxdata[0])

                if (data[1] < 24):
                    self.rtc.Alarm1.write_hours((self.rtc.time.hours + data[1]) % 24) # Warning bad math
#                print("current %02x and offset %02x = %02x" % (self.rtc.time.hours, data[1], self.rtc.Alarm1.hours))
                rxdata[1] = data[1]
                print("Hours until alarm [00-23] %02x" % rxdata[1])

                if (data[2] < 60):
                    self.rtc.Alarm1.write_minutes((self.rtc.time.minutes + data[2]) % 60) # Warning bad math
                rxdata[2] = data[2]
                print("Minutes until alarm [00-59] %02x" % rxdata[2])

                if (data[3] == data[4] and data[3] < 0x40):
                    self.node_id = data[3]
                    print("Setting NodeID %02x" % data[3])
                rxdata[3] = self.node_id
                rxdata[4] = self.node_id
                rxdata[5] = 0x2                         # Ignore input baud rate
                print("Setting Baud Rate to 500 kBd")
                rxdata[6] = data[6]                     # set as part of day setting
                print("Setting Enabled to %02x" % data[6])
                
                # delay until after potential node_id update 
                rxctrl[0] |= ((0x480 + self.node_id) << self.CTRL_ID_SHIFT) # set return ID

                # send the reply
                if(self.can_rx(rxctrl, rxdata)):
                    print(f"Rx send failed", file=sys.stderr)
                return self.ACK                             # only handle a single transaction

        # programming manual section 6.3.5
        if((ID == 0x400 + self.node_id) and (dlen == 0)):   # RTC request
            print("Request Time to Alarm.")
            rxctrl[0] |= ((0x380 + self.node_id) << self.CTRL_ID_SHIFT) # set return ID
            rxctrl[0] |= (0x7 << self.CTRL_DLC_SHIFT)       # set return size
            rxdata = [0] * 7

            rxdata[0] = (((self.rtc.Alarm1.day & 0x07) + 7 - self.rtc.time.day) % 7)
            print("Days until alarm [0-6] %02x" % rxdata[0])
            rxdata[1] = (self.rtc.Alarm1.hours + 24 - self.rtc.time.hours) % 24 # warning bad math
#            print("alarm %02x and current %02x" % (self.rtc.Alarm1.hours, self.rtc.time.hours))
            print("Hours until alarm [00-23] %02x" % rxdata[1])
            rxdata[2] = (self.rtc.Alarm1.minutes + 60 - self.rtc.time.minutes) % 60 # warning bad math
            print("Minutes until alarm [00-59] %02x" % rxdata[2])   # warning bad math
            rxdata[3] = self.node_id
            rxdata[4] = self.node_id
            print("NodeID %02x" % rxdata[3])
            rxdata[5] = 0x2                                 # constant 500 kBaud ignored
            print("Baud Rate to 500 kBd")
            rxdata[6] = 0x00 if (self.rtc.Alarm1.day & 0x40) else 0xff
            print("Enabled is %02x" % rxdata[6])
            
            # send the reply
            if(self.can_rx(rxctrl, rxdata)):
                print(f"Rx send failed", file=sys.stderr)
            return self.ACK                             # only handle a single transaction
        return self.ACK

    def rxcomplete(self, nak):
        "called by the bus in response to a transmit from this node"
        print(" -> %d" % nak)

#/* 
# * To transmit from this node to the bus call the bus receive function:
#* int coremodel_can_rx(void *can, uint64_t ctrl, uint8_t *data);
# */

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: python3 coremodel-can-cr3020.py <address[:port]> <can>")
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