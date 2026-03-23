#!/usr/bin/env python3
# -*- mode: Python -*-
#  * Copyright (C) 2025 Corellium LLC
#  * All rights reserved.

from time import time, localtime

# Convert a binary value into 7 bit BCD
def format_7bit_bcd(binary_value: int) -> int:
    return (((int(binary_value / 10) << 4) + binary_value % 10) & 0x7f)
# Convert a binary value into 5 bit BCD
def format_6bit_bcd(binary_value: int) -> int:
    return (format_7bit_bcd(binary_value) & 0x3f)
# Convert a binary value into 4 bit BCD
def format_5bit_bcd(binary_value: int) -> int:
    return (format_7bit_bcd(binary_value) & 0x1f)

# Convert Alarm Enabled Flag to string based on the high bit of the value
def print_enabled(value):
    if ((value & 0x80) > 0):
        return "Alarm Enabled"
    else:
        return "Alarm Disabled"

class bcd_time():
    '''
    A simple implementation of a BCD time register as defined in various DS RTC
    documentation such as for the DS3231 and 3234. Does not range check other
    than to bit length.
    '''
    def __init__(self, is_alarm, name = ""):
        # Initialize the state of the device to POR values
        self.gmt_time = localtime(time()); # time struct;
        self.index = 0
        self.seconds = 0
        self.minutes = 0
        self.hours = 0
        self.day = 1
        self.date = 1
        self.month = 1
        self.year = 0
        self.is_alarm = is_alarm
        self.name = name

    def get_clock(self):
        local_time = localtime(time())
        self.seconds = format_7bit_bcd(int(local_time.tm_sec))
        self.minutes = format_7bit_bcd(local_time.tm_min)
        if self.hours & 40:
            if local_time.tm_hour > 11:
                self.hours = format_5bit_bcd(local_time.tm_hour - 12) + 0b01100000
            else:
                self.hours = format_5bit_bcd(local_time.tm_hour) + 0b01000000
        else:
            self.hours = format_6bit_bcd(local_time.tm_hour)
        self.day = (local_time.tm_wday + 2) % 7 # convert from 0 == Monday to 1 == Sunday
        self.date = format_6bit_bcd(local_time.tm_mday)
        self.month = ((int(local_time.tm_year / 100) - 19) << 7) + format_5bit_bcd(local_time.tm_mon)
        self.year = (int((local_time.tm_year % 100) / 10) << 4) + local_time.tm_year % 10

    def write_seconds(self, data): # input 7bit BCD format seconds
        self.seconds = data
        return "Setting %sSeconds [00-59]: %02x %s" % (self.name,
                                                       (data & 0x7f),
                                                       print_enabled(data) if self.is_alarm else "")

    def read_seconds(self): # returns (output string, seconds in 7bit BCD)
        return ("%sSeconds [00-59]: %02x %s" % (self.name, 
                                                (self.seconds & 0x7f),
                                                print_enabled(self.seconds) if self.is_alarm else ""), 
                                                self.seconds)

    def write_minutes(self, data): # input 7bit BCD format minutes
        self.minutes = data
        return "Setting %sMinutes [00-59]: %02x %s" % (self.name,
                                                       (data & 0x7f),
                                                       print_enabled(data) if self.is_alarm else "")

    def read_minutes(self): # returns (output string, minutes in 7bit BCD)
        return ("%sMinutes [00-59]: %02x %s" % (self.name,
                                                (self.minutes & 0x7f),
                                                print_enabled(self.minutes) if self.is_alarm else ""), self.minutes)

    # Convert an Hour representation to a string
    def hours_str(self):
        if self.hours & 0x40: # 12 hour mode
            output = "%sHours [01-12]: %02x %s %s" % (self.name,
                                                    (self.hours & 0x1f), (self.hours & 0x20),
                                                    print_enabled(self.hours) if self.is_alarm else "")
        else:
            output = "%sHours [00-23]: %02x %s" % (self.name,
                                                 (self.hours & 0x1f),
                                                 print_enabled(self.hours) if self.is_alarm else "")
        return output

    def write_hours(self, data): # input 4 or 5 bit hours with 2 or 1 flag bits
        self.hours = data
        if (data & 0x40) and ((data & 0x1f) == 0): # if 12 hour mode and 0 PM or 0 AM
            self.hours = data ^ 0x21 # flip AM/PM and add 1 preserving flags
        return "Setting %s" % self.hours_str()

    def read_hours(self): #  returns (output string, hours in flags + 4/5 bit BCD)
        return (self.hours_str(), self.hours)

    def hours_24(self):
        if self.hours & 0x40: # convert from 12 hour mode
            return ((self.hours & 0x1f) + 12 if (self.hours & 0x20) else 0) % 24
        else:
            return self.hours & 0x3f

    def write_day(self, data): # input 3 bit 1 based day of week
        self.day = data & 0xc7 # drop always zero bits
        return "Setting Day of Week [1-7]: %02x %s" % ((self.day & 0x7),
                                                       print_enabled(self.day) if self.is_alarm else "")

    def read_day(self): # returns (output string, day)
        return ("Day of Week [1-7]: %02x %s" % ((self.day & 0x7),
                                               print_enabled(self.day) if self.is_alarm else ""), int(self.day))

    def write_date(self, data): # input 6 bit BCD format 1 based day of month
        self.date = data & 0xbf # drop always zero bits
        return "Setting %sDay of Month [1-31]: %02x %s" % (self.name,
                                                            (self.date & 0x3f),
                                                            print_enabled(self.date) if self.is_alarm else "")

    def read_date(self): # returns (output string, 6bit BCD day of month)
        return ("%sDay of Month [1-31]: %02x %s" % (self.name,
                                                    (self.date & 0x3f),
                                                     print_enabled(self.date) if self.is_alarm else ""), int(self.date))

    def write_day_date(self, data):
        if data & 0x40:
            self.write_date(0)
            return self.write_day(data)
        else:
            self.write_day(0)
            return self.write_date(data)

    def read_day_date(self):
        if self.day & 0x40:
            return self.read_day()
        else:
            return self.read_date()

    def write_month(self, data): # input 1 bit century + 5 bit BCD format month
        self.month = data & 0x9f # drop always zero bits
        return "Setting Month [1-12]: %02x + [Century] %02x" % ((self.month & 0x1f), self.month >> 7)

    def read_month(self): # returns (output string, century + 5 bit BCD month)
#        print("Month [1-12] %02x + [Century] %02x = %02x" % (self.month & 0x1f, self.month >> 7, self.month))
#        print("value %x" % self.month)
        return ("Month [1-12] %02x + [Century] %02x = %02x" % (self.month & 0x1f, self.month >> 7, self.month), self.month)

    def write_year(self, data): # input 8 bit BCD format year
        self.year = data
        return "Year since 1900 [0-99]: %02x " % self.year

    def read_year(self): # returns (output string, 8bit BCD year)
        return ("Year since 1900 [0-99]: %02x " % self.year, self.year)

class ds_rtc():
    """
    A simple implementation of a RTC based on the operation of several DS RTC devices including
    the DS3231 and DS3234.
    """
    def __init__(self):
        self.time = bcd_time(False)
        self.Alarm1 = bcd_time(True, "Alarm 1 ")
        self.Alarm2 = bcd_time(True, "Alarm 2 ")
        self.control = 0b00011100
        self.status = 0b10001000
        self.aging = 0
        # Temp not represented as static

    def update_alarms(self):
        """
        note this code does not check if an alarm should have gone off
        rather it checks if an alarm should be going off now
        """
        # read the system time
        self.time.get_clock()

        # Calculate Alarm 1
        if (self.Alarm1.seconds & 0x80) and ((self.Alarm1.seconds & 0x7f) != (self.time.seconds & 0x7f)):
            self.status |= 0b1 # Every Second alarm
        elif (self.Alarm1.minutes & 0x80) and ((self.Alarm1.seconds & 0x7f) == (self.time.seconds & 0x7f)):
            self.status |= 0b1 # Seconds match
        elif ((self.Alarm1.hours & 0x80) and
              ((self.Alarm1.minutes & 0x7f) == (self.time.minutes & 0x7f)) and
              ((self.Alarm1.seconds & 0x7f) == (self.time.seconds & 0x7f))):
            self.status |= 0b1 # Seconds and Minutes match
        elif (((self.Alarm1.day & 0x80) or (self.Alarm1.date & 0x80)) and
              (self.Alarm1.hours_24() == self.time.hours_24()) and
              ((self.Alarm1.minutes & 0x7f) == (self.time.minutes & 0x7f)) and
              ((self.Alarm1.seconds & 0x7f) == (self.time.seconds & 0x7f))):
                self.status |= 0b1 # Seconds, Minutes, and Hours match
        elif ((self.Alarm1.day & 0x40) and
              ((self.Alarm1.day & 0x7) == (self.time.day & 0x7)) and
              (self.Alarm1.hours_24() == self.time.hours_24()) and
              ((self.Alarm1.minutes & 0x7f) == (self.time.minutes & 0x7f)) and
              ((self.Alarm1.seconds & 0x7f) == (self.time.seconds & 0x7f))):
                self.status |= 0b1 # Seconds, Minutes, Hours, and Day match
        elif (((self.Alarm1.date & 0x3f) == (self.time.date & 0x3f)) and
              (self.Alarm1.hours_24() == self.time.hours_24()) and
              ((self.Alarm1.minutes & 0x7f) == (self.time.minutes & 0x7f)) and
              ((self.Alarm1.seconds & 0x7f) == (self.time.seconds & 0x7f))):
                self.status |= 0b1 # Seconds, Minutes, Hours, and Date match

        # Calculate Alarm 2
        if (self.Alarm2.minutes & 0x80) and ((self.Alarm2.minutes & 0x7f) != (self.time.minutes & 0x7f)):
            self.status |= 0b10 # Every Minute alarm
        elif ((self.Alarm2.hours & 0x80) and
              ((self.Alarm2.minutes & 0x7f) == (self.time.minutes & 0x7f))):
            self.status |= 0b10 # Minutes match
        elif (((self.Alarm2.day & 0x80) or (self.Alarm2.date & 0x80)) and
              (self.Alarm2.hours_24() == self.time.hours_24()) and
              ((self.Alarm2.minutes & 0x7f) == (self.time.minutes & 0x7f))):
                self.status |= 0b10 # Minutes, and Hours match
        elif ((self.Alarm2.day & 0x40) and
              ((self.Alarm2.day & 0x7) == (self.time.day & 0x7)) and
              (self.Alarm2.hours_24() == self.time.hours_24()) and
              ((self.Alarm2.minutes & 0x7f) == (self.time.minutes & 0x7f))):
                self.status |= 0b10 # Minutes, Hours, and Day match
        elif (((self.Alarm2.date & 0x3f) == (self.time.date & 0x3f)) and
              (self.Alarm2.hours_24() == self.time.hours_24()) and
              ((self.Alarm2.minutes & 0x7f) == (self.time.minutes & 0x7f))):
                self.status |= 0b10 # Minutes, Hours, and Date match

    def write_control(self, data):
        """
        EOSC - Oscillator Control - Always enabled === 0
        BBSQW - Battery-Backed Square-Wave - Always Disabled === 0
        CONV - Convert Temp - Always finishes immediately === 0
        RS2 RS1 - Rate Select - reporting only
        INTCN - Interrupt Control - reporting only
        A2IE A1IE - Alarm Interrupt Enable - Reporting only
        """
        self.control = data & 0x1f
        return "Setting %s" % self.control_string()

    def read_control(self):
        return (self.control_str(), self.control)

    def control_str(self):
        output = ("Oscillator Enabled, " +
                  "Square-Wave Disabled, " +
                  "Temp Conversion Finished, ")
        if ((self.control >> 3) & 0b11) == 0b00:
            output += "Frequency 1Hz, "
        elif ((self.control >> 3) & 0b11) == 0b01:
            output += "Frequency 1.024kHz, "
        elif ((self.control >> 3) & 0b11) == 0b10:
            output += "Frequency 4.096kHz, "
        elif ((self.control >> 3) & 0b11) == 0b11:
            output += "Frequency 8.192kHz, "
        output += "Interrupt Mode, " if (self.control & 0b100) else "Oscillator Mode, "
        output += "Alarm 2 Enabled, " if (self.control & 0b10) else "Alarm 2 Disabled, "
        output += "Alarm 1 Enabled" if (self.control & 0b1) else "Alarm 1 Disabled"
        return output

    def write_status(self, data):
        """
        OSF - Oscillator Stop Flag - Clears on write 0
        0 0 0 - 3 zero bits
        EN32kHz - Enable 32kHZ output - reporting only
        BSY - Device busy from temp conversion - always 0
        A2F A1F - Alarm 2 and 1 asserted flags, clear on write 0
        """
        self.status = (self.status & (data & 0x83)) + (data & 0x4)
        return self.status_str()
    
    def read_status(self):
        return (self.status_str(), self.status)

    def status_str(self):
        output = "Oscillator Stop " if (self.status & 0x80) else "Oscillator Valid "
        output += "32kHz Output Enabled, " if (self.status & 0b1000) else "32kHz Output Disabled, "
        output += "Temp Conversion Finished, " #0b0100
        output += "Alarm 2 Active, " if (self.status & 0b10) else "Alarm 2 Inactive, "
        output += "Alarm 1 Active" if (self.status & 0b1) else "Alarm 1 Inactive"
        return output
    
    def write_aging(self, data):
        self.aging = data
        return "Aging offset %02x" % self.aging
    
    def read_aging(self):
        return ("Aging offset %02x" % self.aging, self.aging)
    
    def write_temp(self, data):
        return "The Temperature is read only"
    
    def read_temp_upper(self):
        "statically return 25 C"
        return ("Temperature Upper: 25 C ", 0b00011001)

    def read_temp_lower(self):
        "statically return .25 C"
        return ("Temperature Lower: .25 C ", 0x40)