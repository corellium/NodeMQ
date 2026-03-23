#!/usr/bin/env python3
# -*- mode: Python -*-
#  * Copyright (C) 2025 Corellium LLC
#  * All rights reserved.

import sys
import os
from coremodel import coremodel
from coremodel_rtc import ds_rtc

class i2c_func(coremodel.I2C_t):
    def __init__(self):
        super().__init__()
        # Initialize the state of the device to POR values
        self.rtc = ds_rtc()
        self.started = False

    def start(self):
        print("START")
        self.rtc.update_alarms()
        self.started = True
        return 1

    def write(self, len, data):
        idx = 0
        offset = 0
        if (self.started):
            print("WRITE Addr [%d]: %02x" % (len, data[idx]))
            self.index = data[0]
            idx = 1
            self.started = False
            if (len == 1):
                return len

        print("WRITE [%d]:" % len, end='')
        out_str = ""
        for idx in range(idx, len):
            offset = (idx + self.index) % 0x13
            if offset == 0: # BCD Seconds
                out_str += self.rtc.time.write_seconds(data[idx])
            elif offset == 1: # BCD Minutes
                out_str += self.rtc.time.write_minutes(data[idx])
            elif offset == 2: # BCD Hours
                out_str += self.rtc.time.write_hours(data[idx])
            elif offset == 3: # 1 based day of week
                out_str += self.rtc.time.write_day(data[idx])
            elif offset == 4: # 1 based day of month
                out_str += self.rtc.time.write_date(data[idx])
            elif offset == 5: # century + month
                out_str += self.rtc.time.write_month(data[idx])
            elif offset == 6: # year
                out_str += self.rtc.time.write_year(data[idx])
            elif offset == 7: # Alarm 1 Seconds
                out_str += self.rtc.Alarm1.write_seconds(data[idx])
            elif offset == 8: # Alarm 1 Minutes
                out_str += self.rtc.Alarm1.write_minutes(data[idx])
            elif offset == 9: # Alarm 1 Hours
                out_str += self.rtc.Alarm1.write_hours(data[idx])
            elif offset == 0xA: # Alarm 1 Day Date
                out_str += self.rtc.Alarm1.write_day_date(data[idx])
            elif offset == 0xB: # Alarm 2 Minutes
                out_str += self.rtc.Alarm2.write_minutes(data[idx])
            elif offset == 0xC: # Alarm 2 Hours
                out_str += self.rtc.Alarm2.write_hours(data[idx])
            elif offset == 0xD: # Alarm 2 Day Date
                out_str += self.rtc.Alarm1.write_day_date(data[idx])
            elif offset == 0xE: # Control: EOSC BBSQW CONV RS2 RS1 INTCN A2IE A1IE not implemented
                out_str += self.rtc.write_control(data[idx])
            elif offset == 0xF: # Status: OSF 0 0 0 EN32kHz BSY A2F A1F
                out_str += self.rtc.write_status(data[idx])
            elif offset == 0x10: # Aging offset has no user effect
                out_str += self.rtc.write_aging(data[idx])
            elif offset == 0x11: # Temperature upper byte not implemented
                out_str += "The Temperature is read only"
            elif offset == 0x12: # Temperature lower byte not implemented
                out_str += "The Temperature is read only"
            else:
                out_str += " %02x", data[idx]
        print(out_str)
        self.index = (offset + 1) % 0x13
        return len

    def read(self, len, data):
        data.clear()
        idx = 0
        offset = 0

        print("READ [%d]: " % len, end='')
        output = ""
        for idx in range(idx, len):
            offset = (idx + self.index) % 0x13
            if offset == 0: # BCD Seconds
                (out_str, out_data) = self.rtc.time.read_seconds()
            elif offset == 1: # BCD Minutes
                (out_str, out_data) = self.rtc.time.read_minutes()
            elif offset == 2: # BCD Hours
                (out_str, out_data) = self.rtc.time.read_hours()
            elif offset == 3: # 1 based day of week
                (out_str, out_data) = self.rtc.time.read_day()
            elif offset == 4: # 1 based day of month
                (out_str, out_data) = self.rtc.time.read_date()
            elif offset == 5: # century + month
                (out_str, out_data) = self.rtc.time.read_month()
            elif offset == 6: # year
                (out_str, out_data) = self.rtc.time.read_year()
            elif offset == 7: # Alarm 1 Seconds
                (out_str, out_data) = self.rtc.Alarm1.read_seconds()
            elif offset == 8: # Alarm 1 Minutes
                (out_str, out_data) = self.rtc.Alarm1.read_minutes()
            elif offset == 9: # Alarm 1 Hours
                (out_str, out_data) = self.rtc.Alarm1.read_hours()
            elif offset == 0xA: # Alarm 1 Day Date
                (out_str, out_data) = self.rtc.Alarm1.read_day_date()
            elif offset == 0xB: # Alarm 2 Minutes
                (out_str, out_data) = self.rtc.Alarm2.read_minutes()
            elif offset == 0xC: # Alarm 2 Hours
                (out_str, out_data) = self.rtc.Alarm2.read_hours()
            elif offset == 0xD: # Alarm 2 Day Date
                (out_str, out_data) = self.rtc.Alarm2.read_day_date()
            elif offset == 0xE: # Control: EOSC BBSQW CONV RS2 RS1 INTCN A2IE A1IE not implemented
                (out_str, out_data) = self.rtc.read_control()
            elif offset == 0xF: # Status: OSF 0 0 0 EN32kHz BSY A2F A1F
                (out_str, out_data) = self.rtc.read_status()
            elif offset == 0x10: # Aging offset has no user effect
                (out_str, out_data) = self.rtc.read_aging()
            elif offset == 0x11: # Temperature upper byte not implemented
                (out_str, out_data) = self.rtc.read_temp_upper()
            elif offset == 0x12: # Temperature lower byte not implemented
                (out_str, out_data) = self.rtc.read_temp_lower()
            output += out_str
            data.append(out_data)
        print(output)
        self.index = (offset + 1) % 0x13
        return len

    def stop(self):
        print("STOP")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: python3 coremodel-i2c-ds3231 <address[:port]> <i2c>")
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