#!/usr/bin/env python3
# -*- mode: Python -*-
#  * Copyright (C) 2025 Corellium LLC
#  * All rights reserved.

import sys
import os
from coremodel import coremodel
from coremodel_rtc import ds_rtc

class spi_func(coremodel.SPI_t):
    def __init__(self):
        super().__init__()
        # Initialize the state of the device to POR values
        self.rtc = ds_rtc()
        self.SRAM_Address = 0
        self.SRAM_Data = [0] * 256

    def cs(self, csel):
        if(csel):
            print("CS Asserted")
            self.rtc.update_alarms()

    def access_reg(self, offset, WRITE, data):
        out_data = data
        if offset == 0: # BCD Seconds
            if (WRITE):
                out_str = self.rtc.time.write_seconds(data)
            else:
                (out_str, out_data) = self.rtc.time.read_seconds()
        elif offset == 1: # BCD Minutes
            if (WRITE):
                out_str = self.rtc.time.write_minutes(data)
            else:
                (out_str, out_data) = self.rtc.time.read_minutes()
        elif offset == 2: # BCD Hours
            if (WRITE):
                out_str = self.rtc.time.write_hours(data)
            else:
                (out_str, out_data) = self.rtc.time.read_hours()
        elif offset == 3: # 1 based day of week
            if (WRITE):
                out_str = self.rtc.time.write_day(data)
            else:
                (out_str, out_data) = self.rtc.time.read_day()
        elif offset == 4: # 1 based day of month
            if (WRITE):
                out_str = self.rtc.time.write_date(data)
            else:
                (out_str, out_data) = self.rtc.time.read_date()
        elif offset == 5: # century + month
            if (WRITE):
                out_str = self.rtc.time.write_month(data)
            else:
                (out_str, out_data) = self.rtc.time.read_month()
        elif offset == 6: # year
            if (WRITE):
                out_str = self.rtc.time.write_year(data)
            else:
                (out_str, out_data) = self.rtc.time.read_year()
        elif offset == 7: # Alarm 1 Seconds
            if (WRITE):
                out_str = self.rtc.Alarm1.write_seconds(data)
            else:
                (out_str, out_data) = self.rtc.Alarm1.read_seconds()
        elif offset == 8: # Alarm 1 Minutes
            if (WRITE):
                out_str = self.rtc.Alarm1.write_minutes(data)
            else:
                (out_str, out_data) = self.rtc.Alarm1.read_minutes()
        elif offset == 9: # Alarm 1 Hours
            if (WRITE):
                out_str = self.rtc.Alarm1.write_hours(data)
            else:
                (out_str, out_data) = self.rtc.Alarm1.read_hours()
        elif offset == 0xA: # Alarm 1 Day Date
            if (WRITE):
                out_str = self.rtc.Alarm1.write_day_date(data)
            else:
                (out_str, out_data) = self.rtc.Alarm1.read_day_date()
        elif offset == 0xB: # Alarm 2 Minutes
            if (WRITE):
                out_str = self.rtc.Alarm2.write_minutes(data)
            else:
                (out_str, out_data) = self.rtc.Alarm2.read_minutes()
        elif offset == 0xC: # Alarm 2 Hours
            if (WRITE):
                out_str = self.rtc.Alarm2.write_hours(data)
            else:
                (out_str, out_data) = self.rtc.Alarm2.read_hours()
        elif offset == 0xD: # Alarm 2 Day Date
            if (WRITE):
                out_str = self.rtc.Alarm2.write_day_date(data)
            else:
                (out_str, out_data) = self.rtc.Alarm2.read_day_date()
        elif offset == 0xE: # Control: EOSC BBSQW CONV RS2 RS1 INTCN A2IE A1IE not implemented
            if (WRITE):
                out_str = self.rtc.write_control(data)
            else:
                (out_str, out_data) = self.rtc.read_control()
        elif offset == 0xF: # Status: OSF 0 0 0 EN32kHz BSY A2F A1F
            if (WRITE):
                out_str = self.rtc.write_status(data)
            else:
                (out_str, out_data) = self.rtc.read_status()
        elif offset == 0x10: # Aging offset has no user effect
            if (WRITE):
                out_str = self.rtc.write_aging(data)
            else:
                (out_str, out_data) = self.rtc.read_aging()
        elif offset == 0x11: # Temperature upper byte not implemented
            if (WRITE):
                out_str = "The Temperature is read only"
            else: # statically return 25C
                (out_str, out_data) = self.rtc.read_temp_upper()
        elif offset == 0x12: # Temperature lower byte not implemented
            if (WRITE):
                out_str = "The Temperature is read only"
            else: # statically return .25C
                (out_str, out_data) = self.rtc.read_temp_lower()
        elif offset == 0x18: # SRAM Address Register
            if (WRITE):
                self.SRAM_Address = data
            else:
                out_data = self.SRAM_Address
            out_str = "SRAM Address = %02d" % data
        elif offset == 0x19: # SRAM Data
            if (WRITE):
                self.SRAM_Data[self.SRAM_Address] = data
            out_data = self.SRAM_Data[self.SRAM_Address]
            out_str = "SRAM Data[%02d] = %02d" % (self.SRAM_Address, out_data)
            self.SRAM_Address = (self.SRAM_Address + 1) % 0xff # & 0xff likely redundant
        print(out_str)
        return out_data

    def xfr(self, len, wrdata, rddata):
        WRITE = wrdata[0] & 0x80
        ADDR = wrdata[0] & 0x7f
        print("RX [%d]" % len, end='')
        for idx in range(len):
            print(" %02x" % wrdata[idx], end='')
        print("")
        rddata.clear()

        if(ADDR < 0x13): # RTC Registers
#            print("RTC Register Access")
            if(not WRITE and len == 1): # special case for read one byte
                rddata.append(self.access_reg(ADDR, WRITE, wrdata[0]))
            else:
                rddata.append(0) # per spec first read byte is always high impedance
            for idx in range(1, len):
                rddata.append(self.access_reg(((ADDR + idx - 1) % 0x13), WRITE, wrdata[idx]))
        elif (ADDR == 0x18): # SRAM Address
#            print("SRAM Address Access")
            if(len == 1):
                if(not WRITE): # Read out the address as a magic first byte
                    rddata.append(self.access_reg(ADDR, WRITE, wrdata[0]))
                else:
                    rddata.append(0) # per spec first read byte is always high impedance
            else: # read or write the address as the second byte
                rddata.append(0) # per spec first read byte is always high impedance
                rddata.append(self.access_reg(ADDR, WRITE, wrdata[1]))
            for idx in range(2, len):
                rddata.append(0) # ignore additional bytes
        elif (ADDR == 0x19): #SRAM Data
#            print("SRAM Data Access")
            if(not WRITE and len == 1): # special case for read one byte
                rddata.append(self.access_reg(ADDR, WRITE, wrdata[0]))
            else:
                rddata.append(0) # per spec first read byte is always high impedance
            for idx in range (1, len):
                rddata.append(self.access_reg(ADDR, WRITE, wrdata[idx]))
#                print("SRAM Address now %02x %02x" % (idx, rddata[-1]))
        else: # undefined per spec, assumed high impedance, implemented as byte count
#            print("Undefined Register Access")
            for idx in range(len):
                rddata.append(ord('0') + (idx & 63))

        if(ADDR < 0x20):
            if(WRITE):
                print("Write")
            else:
                print("Read")

        print("TX [%d]" % len, end='')
        out_str = ''
        for idx in range(len):
            out_str += " %02x" % rddata[idx]
        print(out_str)
        return len

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: coremodel-spi-ds3234 <address[:port]> <spi>")
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