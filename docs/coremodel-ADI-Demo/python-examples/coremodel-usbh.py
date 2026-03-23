#!/usr/bin/env python3
# -*- mode: Python -*-
#  * Copyright (C) 2025 Corellium LLC
#  * All rights reserved.

import sys
import os
from coremodel import coremodel

def imin32(a: int, b: int) -> int:
    return a if a < b else b

class vkb_class:
    class vkb_state:
        # 8 bit fields
        bAddr = 0
        in_setup = False
        bmReqType = 0
        bRequest = 0
        has_report = False
        # 16 bit fields
        wValue = 0
        wIndex = 0
        wLength = 0
        # byte arrays
        ep0buf = bytearray(256)
        ep0ptr = 0
        last_report = None # 8 bytes

    dev_desc = bytearray([
        coremodel.USBH_t.DD_SIZE, coremodel.USBH_t.DT_DEVICE,
        0x00, 0x02, #/* bcdUSB */
        0, 0, 0,    #/* class, subclass, protocol */
        8,          #/* ep0 maxpkt */
        0x6b, 0x1d, 0x04, 0x01, #/* idVendor, idProduct */
        0x01, 0x01, #/* bcdDevice */
        1, 2, 0,    #/* iManufacturer, iProduct, iSerial */
        1           # /* bNumConfigurations */
    ])

    conf_desc = bytearray([
        coremodel.USBH_t.CD_SIZE, coremodel.USBH_t.DT_CONFIG,
        0, 0,       #/* wTotalLength - will patch when reading */
        1,          #/* bNumInterfaces */
        0x01,       #/* bConfigurationValue */
        3,          #/* iConfiguration */
        0xa0,       #/* bmAttributes */
        0x00,       #/* bMaxPower */

        coremodel.USBH_t.ID_SIZE, coremodel.USBH_t.DT_IF,
        0x00,       #/* bInterfaceNumber */
        0x00,       #/* bAlternateSetting */
        1,          #/* bNumEndpoints */
        3, 1, 1,    #/* class, subclass, protocol */
        4,          #/* iInterface */

        coremodel.USBH_t.HIDD_SIZE, coremodel.USBH_t.DT_HID,
        0x11, 0x01, #/* bcdHID */
        0x21,       #/* bCountryCode = US */
        0x01,       #/* bNumDescriptors */
        coremodel.USBH_t.DT_HID_REPORT, #/* bDescriptorType */
        0x3F, 0x00, #/* wDescriptorLength */

        coremodel.USBH_t.ED_SIZE, coremodel.USBH_t.DT_EP,
        0x81,       #/* address (in) */
        0x03,       #/* interrupt */
        0x08, 0x00, #/* pkt size */
        2 ])        #/* poll interval */

    str_desc_00 = bytearray([0, coremodel.USBH_t.DT_STRING, 0x09, 0x04])
    str_desc_01 = bytearray('Corellium', 'utf-16')
    str_desc_02 = bytearray('Keyboard', 'utf-16')
    str_desc_03 = bytearray('Keyboard', 'utf-16')
    str_desc_04 = bytearray('HID Device', 'utf-16')

    str_desc_tbl = [
        { 'data':str_desc_00, 'size':len(str_desc_00) },
        { 'data':str_desc_01, 'size':len(str_desc_01) },
        { 'data':str_desc_02, 'size':len(str_desc_02) },
        { 'data':str_desc_03, 'size':len(str_desc_03) },
        { 'data':str_desc_04, 'size':len(str_desc_04) } ]

    for x in range(len(str_desc_tbl)):
        str_desc_tbl[x]['data'][0] = 0
        str_desc_tbl[x]['data'][1] = coremodel.USBH_t.DT_STRING

    hid_report_desc = bytearray([
        0x05, 0x01,        #/* Usage Page (Generic Desktop Ctrls) */
        0x09, 0x06,        #/* Usage (Keyboard) */
        0xA1, 0x01,        #/* Collection (Application) */
        0x05, 0x07,        #/*   Usage Page (Kbrd/Keypad) */
        0x19, 0xE0,        #/*   Usage Minimum (0xE0) */
        0x29, 0xE7,        #/*   Usage Maximum (0xE7) */
        0x15, 0x00,        #/*   Logical Minimum (0) */
        0x25, 0x01,        #/*   Logical Maximum (1) */
        0x75, 0x01,        #/*   Report Size (1) */
        0x95, 0x08,        #/*   Report Count (8) */
        0x81, 0x02,        #/*   Input (Data,Var,Abs,No Wrap,Linear,Preferred State,No Null Position) */
        0x95, 0x01,        #/*   Report Count (1) */
        0x75, 0x08,        #/*   Report Size (8) */
        0x81, 0x01,        #/*   Input (Const,Array,Abs,No Wrap,Linear,Preferred State,No Null Position) */
        0x95, 0x05,        #/*   Report Count (5) */
        0x75, 0x01,        #/*   Report Size (1) */
        0x05, 0x08,        #/*   Usage Page (LEDs) */
        0x19, 0x01,        #/*   Usage Minimum (Num Lock) */
        0x29, 0x05,        #/*   Usage Maximum (Kana) */
        0x91, 0x02,        #/*   Output (Data,Var,Abs,No Wrap,Linear,Preferred State,No Null Position,Non-volatile) */
        0x95, 0x01,        #/*   Report Count (1) */
        0x75, 0x03,        #/*   Report Size (3) */
        0x91, 0x01,        #/*   Output (Const,Array,Abs,No Wrap,Linear,Preferred State,No Null Position,Non-volatile) */
        0x95, 0x06,        #/*   Report Count (6) */
        0x75, 0x08,        #/*   Report Size (8) */
        0x15, 0x00,        #/*   Logical Minimum (0) */
        0x25, 0x65,        #/*   Logical Maximum (101) */
        0x05, 0x07,        #/*   Usage Page (Kbrd/Keypad) */
        0x19, 0x00,        #/*   Usage Minimum (0x00) */
        0x29, 0x65,        #/*   Usage Maximum (0x65) */
        0x81, 0x00,        #/*   Input (Data,Array,Abs,No Wrap,Linear,Preferred State,No Null Position) */
        0xC0 ])            #/* End Collection */

    def __init__(self):
        self.state = self.vkb_state()
        # allocate byte arrays


class usbh_func(coremodel.USBH_t):
    def __init__(self):
        super().__init__()
        self.vkb = vkb_class()

    def usbh_xfr_int(self, dev: int, ep: int, tkn: int, buf: bytearray, size: int, end: int) -> int:
        vkb = self.vkb
#        print(f"XFR {dev:02x} EP{ep:d} {self.tkn_names[tkn]} size: [{size:d}] end: {end:d}")
#        print(f"buf: {buf}")

        if(ep == 0 and tkn == self.TKN_SETUP): # /* control EP - SETUP */
            vkb.state.bmReqType = buf[0]
            vkb.state.bRequest = buf[1]
            vkb.state.wValue = buf[2] | (buf[3] << 8)
            vkb.state.wIndex = buf[4] | (buf[5] << 8)
            vkb.state.wLength = buf[6] | (buf[7] << 8)
            vkb.state.in_setup = True
            vkb.state.ep0ptr = 0

#            print(f"SETUP ReqType {vkb.state.bmReqType:02x} Request {vkb.state.bRequest:02x} Value {vkb.state.wValue:04x} Index {vkb.state.wIndex:04x} Length {vkb.state.wLength:04x}")

            if((vkb.state.bmReqType & self.CTRL_DIR_IN) == 0):
                return size

            # /* device->host setup requests are handled here */
            if vkb.state.bmReqType == (self.CTRL_RCPT_DEV | self.CTRL_TYPE_STD | self.CTRL_DIR_IN):
                if vkb.state.bRequest == self.REQ_GET_DESCR:
                    if (vkb.state.wValue >> 8) == self.DT_DEVICE:
                        vkb.state.wLength = imin32(len(vkb.dev_desc), vkb.state.wLength)
                        vkb.state.ep0buf[:vkb.state.wLength] = vkb.dev_desc[:vkb.state.wLength]
                        return size
                    elif (vkb.state.wValue >> 8) == self.DT_CONFIG:
                        vkb.state.wLength = imin32(len(vkb.conf_desc), vkb.state.wLength)
                        vkb.state.ep0buf[:vkb.state.wLength] = vkb.conf_desc[:vkb.state.wLength]
                        vkb.state.ep0buf[2] = vkb.state.wLength & 0xFF
                        vkb.state.ep0buf[3] = vkb.state.wLength >> 8
                        return size
                    elif (vkb.state.wValue >> 8) == self.DT_STRING:
                        i = vkb.state.wValue & 0xFF
                        if i < len(vkb.str_desc_tbl):
                            vkb.state.wLength = imin32(vkb.str_desc_tbl[i]['size'], vkb.state.wLength)
                            vkb.state.ep0buf[:vkb.state.wLength] = vkb.str_desc_tbl[i]['data'][:vkb.state.wLength]
                            vkb.state.ep0buf[0] = vkb.state.wLength & 0xFF
                            return size
            elif vkb.state.bmReqType == (self.CTRL_RCPT_IF | self.CTRL_TYPE_STD | self.CTRL_DIR_IN):
                if vkb.state.bRequest == self.REQ_GET_DESCR:
                    if (vkb.state.wValue >> 8) == self.DT_HID_REPORT:
                        vkb.state.wLength = imin32(len(vkb.hid_report_desc), vkb.state.wLength)
                        vkb.state.ep0buf[:vkb.state.wLength] = vkb.hid_report_desc[:vkb.state.wLength]
                        return size
            return self.XFR_STALL

        elif (ep == 0 and tkn == self.TKN_OUT): # /* control EP - OUT */
            if(not vkb.state.in_setup):
                return self.XFR_STALL

            if(vkb.state.bmReqType & self.CTRL_DIR_IN):
                "/* acknowledge ZLP */"
                vkb.state.in_setup = False
                return size

            step = vkb.state.wLength - vkb.state.ep0ptr
            if(step > size):
                step = size
            vkb.state.ep0buf[vkb.state.ep0ptr:vkb.state.ep0ptr+step] = buf[:step]
            vkb.state.ep0ptr += step
            return step

        elif (ep == 0 and tkn == self.TKN_IN): # /* control EP - IN */
            if(not vkb.state.in_setup):
                return self.XFR_STALL

            if(not(vkb.state.bmReqType & self.CTRL_DIR_IN)):
                # /* acknowledge ZLP */
                vkb.state.in_setup = False
                #/* host->device setup requests are handled here */
                if vkb.state.bmReqType == self.CTRL_RCPT_DEV | self.CTRL_TYPE_STD | self.CTRL_DIR_OUT:
                    if vkb.state.bRequest == self.REQ_SET_ADDRESS:
                        vkb.state.bAddr = vkb.state.wValue
                        return size
                    elif vkb.state.bRequest == self.REQ_SET_CONFIG:
                        return size
                elif vkb.state.bmReqType == self.CTRL_RCPT_EP | self.CTRL_TYPE_STD | self.CTRL_DIR_OUT:
                    if vkb.state.bRequest == self.REQ_CLR_FEATURE:
                        #/* only legal option is ENDPOINT_HALT, which clears a STALL */
                        return size
                return self.XFR_STALL

            step = vkb.state.wLength - vkb.state.ep0ptr
            if(step > size):
                step = size
            buf[:step] = vkb.state.ep0buf[vkb.state.ep0ptr:vkb.state.ep0ptr+step]
            vkb.state.ep0ptr += step
            return step

        elif (ep == 1 and tkn == self.TKN_IN): # /* interrupt EP - IN */

            if(vkb.state.has_report):
                vkb.state.has_report = False
                step = imin32(8, size)
                buf = vkb.state.last_report[:step]
                return step

        return self.XFR_NAK

    def rst(self):
        print("RESET")

    def xfr(self, dev: int, ep: int, tkn: int, buf: bytearray, size: int, end: int) -> int:
        print(f"XFR {dev:02x} EP{ep:d} {self.tkn_names[tkn]} [{size:d}]", end="")
        if(tkn == self.TKN_OUT or tkn == self.TKN_SETUP):
            print(":", end="")
            for idx in range(size):
                print(" %02x" % buf[idx], end="")

        res = self.usbh_xfr_int(dev, ep, tkn, buf, size, end)
#        print(f"buf: {buf}")

        if(tkn == self.TKN_IN and res > 0):
            print(" ->", end="")
            for idx in range(res):
                print(" %02x"% buf[idx], end="")
            print("")
        else:
            print(f" -> {res}")

        return res

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("usage: python3 coremodel-usbh.py <address[:port]> <usbh> <usbh-port>")
        sys.exit(1)

    cm = coremodel()
    res = cm.connect(sys.argv[1])
    if res != 0:
        print(f"error: failed to connect: {os.strerror(-res)}", file=sys.stderr)
        sys.exit(1)

    test_usbh_func = usbh_func()
    handle = cm.attach_usbh(sys.argv[2], int(sys.argv[3]), test_usbh_func, test_usbh_func.USB_SPEED_FULL)
    if (handle == None):
        print(f"error: failed to attach USB host {sys.argv[3]}.\n")
        cm.disconnect()
        sys.exit(1)

    cm.mainloop(-1)

    cm.detach(handle)
    cm.disconnect()
    sys.exit(0)
