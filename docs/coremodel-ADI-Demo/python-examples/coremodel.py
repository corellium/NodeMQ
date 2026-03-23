# -*- mode: Python -*-
"""
 *  CoreModel Python API
 *
 *  Copyright Corellium 2025
 *  SPDX-License-Identifier: Apache-2.0
 *
 *  Licensed under the Apache License, Version 2.0 (the "License"); you may
 *  not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 *  WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
"""

import os
import sys
import socket
import errno
import fcntl
import time
import select
from collections.abc import Callable
from abc import abstractmethod, ABC

DFLT_PORT = 1900
CONN_QUERY = 0xFFFF

class coremodel:

    class packet:
        #/* packet types for query connection: bflag = Dom0 connection ID */
        QUERY_REQ_LIST =     0x00    #/* list controllers, starting with index hflag */
        QUERY_RSP_LIST =     0x01    #/* list of controllers, starting with index hflag, data: { u16 type, u16 strlen, u32 num, u8 str[] } struct per controller */
        QUERY_REQ_CONN =     0x02    #/* connection request, data: one struct as above to connect to, where num = index of endpoint in controller, hflag: passed to connection type */
        QUERY_RSP_CONN =     0x03    #/* connection response: hflag: connection index (0xFFFF for failure), data: initial credit (uint32, optional) */
        QUERY_REQ_DISC =     0x04    #/* disconnection request, connection index hflag (no response) */

        #/* packet types for UART connection */
        UART_TX        =     0x00    #/* data from VM to host */
        UART_RX        =     0x01    #/* data from host to VM */
        UART_RX_ACK    =     0x02    #/* credits returned to host; hflag: number of credits */
        UART_BRK       =     0x03    #/* break condition received */

        #/* packet types for I2C connection; REQ_CONN hflag[0]: start always ACKs, hflag[1]: write always ACKs */
        I2C_START      =     0x00    #/* bflag[0]: requires DONE; hflag: transaction index */
        I2C_WRITE      =     0x01    #/* bflag[0]: requires DONE; hflag: transaction index; data: write data */
        I2C_READ       =     0x02    #/* bflag: number of bytes, hflag: transaction index */
        I2C_STOP       =     0x03    #/* hflag: transaction index */
        I2C_DONE       =     0x04    #/* bflag[0]: NAK status, hflag: transaction index; data: read data */

        #/* packet types for SPI connection; REQ_CONN hflag[0]: accept bulk data (otherwise byte-by-byte) */
        SPI_CS         =     0x00    #/* bflag[0]: chip select enabled */
        SPI_TX         =     0x01    #/* hflag: transaction index; data: from VM to host */
        SPI_RX         =     0x02    #/* hflag: transaction index; data: from host to VM */

        #/* packet types for GPIO connection */
        GPIO_UPDATE    =     0x00    #/* hflag: new GPIO state in mV */
        GPIO_FORCE     =     0x01    #/* bflag[0]: enable driver; hflag: GPIO state in mV */

        #/* packet types for USB host connection; REQ_CONN hflag[3:0]: connection speed enum */
        USBH_RESET     =     0x00
        USBH_XFR       =     0x01    #/* bflag: transaction index, hflag[3:0]: token, hflag[7:4]: ep, hflag[14:8]: dev, hflag[15]: end, data: write data (OUT/SETUP) or 16-bit length (IN) */
        USBH_DONE      =     0x02    #/* bflag: transaction index, hflag[3:0]: token, hflag[7:4]: ep, hflag[14:8]: dev, hflag[15]: stall, data: 16-bit length (OUT/SETUP), read data (IN) */

        #/* packet types for CAN connection */
        CAN_TX         =     0x00    #/* packet from VM to host; bflag: transaction index, hflag[0]: response expected; data: 64-bit control field followed by packet data */
        CAN_TX_ACK     =     0x01    #/* bflag: transaction index, hflag[0]: NAK */
        CAN_RX         =     0x02    #/* packet from host to VM; bflag: transaction index; data: 64-bit control field followed by packet data */
        CAN_RX_ACK     =     0x03    #/* bflag: transaction index, hflag[0]: NAK */
        CAN_SET_NNAK   =     0x04    #/* set filter of packets that will not auto-NAK */
        CAN_SET_ACK    =     0x05    #/* set filter of packets that will auto-ACK */

        MAX_PKT        =     1024

        def __init__(self, len=0, conn=0, pkt=0, bflag=0, hflag=0, data=None):
            self.len = len     # uint16_t len
            self.conn = conn   # uint16_t conn
            self.pkt = pkt     # uint8_t pkt
            self.bflag = bflag # uint8_t bflag
            self.hflag = hflag # uint16_t hflag
            self.data = data   # uint8_t data[0]
        def to_bytes(self):
            res = bytearray()
            res.extend(self.len.to_bytes(2, 'little'))
            res.extend(self.conn.to_bytes(2, 'little'))
            res.append(self.pkt & 0xFF)
            res.append(self.bflag & 0xFF)
            res.extend(self.hflag.to_bytes(2, 'little'))
            if self.data is not None:
                res.extend(bytearray(self.data))
            return res
        def from_bytes(self, b):
#            print("from_bytes: ", end = '')
#            for byte in b:
#                print("%02x " % byte, end = '')
            self.len = int.from_bytes(b[0:2], 'little')
            self.conn = int.from_bytes(b[2:4], 'little')
            self.pkt = b[4]
            self.bflag = b[5]
            self.hflag = int.from_bytes(b[6:8], 'little')
            self.data = b[8:self.len]
#            print(" %s" % self.__dict__)
            return self.len

    #/* device types */
    UART =          0
    I2C =           1
    SPI =           2
    GPIO =          3
    USBH =          4
    CAN =           5
    INVALID =       (-1)

    class dev_list:
        def __init__(self):
            self.type = 0  # uint16_t type; /* one of COREMODEL_* constants */
            self.strlen = 0 # uint16_t strlen; /* length of name */
            self.num = 0   # uint32_t num; /* number of chip selects (SPI) or pins (GPIO) */
            self.name = "" # char *name; /* name used to attach to the device */
        def to_bytes(self):
            res = bytearray()
            res.extend(self.type.to_bytes(2, 'little'))
            res.extend(self.strlen.to_bytes(2, 'little'))
            res.extend(self.num.to_bytes(4, 'little'))
            res.extend(bytearray(self.name, 'utf-8'))
            return res
        def from_bytes(self, b):
            self.type = int.from_bytes(b[0:2], 'little')
            self.strlen = int.from_bytes(b[2:4], 'little')
            self.num = int.from_bytes(b[4:8], 'little')
            self.name = b[8:8+self.strlen]
            return 8 + self.strlen

    class cif(ABC):
        def __init__(self, type):#, bus_if):
            self.conn = 0     # uint16_t conn, trnidx;
            self.trnidx = 0
            self.type = type     # unsigned type;
            self.cred = 0     # unsigned cred, busy;
            self.busy = False
            self.ebusy = 0    # uint64_t ebusy; used in CAN and USBH, bit vector of some sort
            self.rdbuf = []     # uint8_t rdbuf[512];
            self.rxbufs = []  # list of received packets for this interface

    txflag = 0
    query_active = False
    RX_BUF = 4096
    device_list = []
    txbufs = bytearray()
    rxbufs = bytearray() # Global list of received packets
    sock = None
    ifs = []
    conn_if = None

# Connection functions
    def connect(self, target):
        """
        *  Connect to a VM.
        *  target      string like "10.10.0.3:1900"
        *  Returns error flag.
        """

        if target == None:
            target = os.getenv("COREMODEL_VM")
        if target == None:
            print(f"[coremodel]  Set environment variable COREMODEL_VM to the address:port of the Corellium VM and try again.", file=sys.stderr)
            return -errno.EINVAL

        strp, port = target.split(":")
        if port == "" or port == None:
            portn = DFLT_PORT
        else:
            portn = int(port)

        try:
            hent = socket.gethostbyname(strp)
        except Exception as e:
            print(f"[coremodel] Failed to resolve host %s: %s." % (strp, e), file=sys.stderr)
            return -errno.ENOENT

        try:
          self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM, 0)
        except Exception as e:
            print(f"[coremodel] Failed to create socket {e}", file=sys.stderr)
            return -1

        try:
          self.sock.connect((strp, portn))
        except Exception as e:
            print(f"[coremodel] Failed to connect to %s:%d: %s." % (strp, portn, e), file=sys.stderr)
            self.sock.close()
            self.sock = None
            return -errno.ECONNREFUSED

        try:
            fcntl.fcntl(self.sock, fcntl.F_SETFL, fcntl.fcntl(self.sock, fcntl.F_GETFL, 0) | os.O_NONBLOCK)
        except Exception as e:
            print(f"[coremodel] Failed to set non-blocking {e}", file=sys.stderr)
            self.sock.close()
            self.sock = None
            return -1

        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        return 0

    def push_packet(self, pkt, data):
#        print("push_packet:  pkt=%s data=%s" % (pkt.__dict__, data))
#        print("push_packet:  len=%s dlen=%s" % (pkt.len, (pkt.len + 3) & ~3))
        if data is not None:
            pkt.data = data
        data = None
#        print("push_packet2: pkt=%s data=%s" % (pkt.__dict__, data))
        self.txbufs.extend(pkt.to_bytes())
        dlen = ((pkt.len + 3) & ~3) - pkt.len
        if dlen > 0:
            self.txbufs.extend(bytearray(dlen))
        self.txflag = 1
        return 0

    def list(self):
        """
        * Enumerates devices available in VM.
        * Returns array of device structs.
        """
        pkt= self.packet(len = 8, conn = CONN_QUERY, pkt = self.packet.QUERY_REQ_LIST)

        if self.query_active:
            return None
        if self.push_packet(pkt, None):
            return None
        self.query_active = True

        if self.mainloop_int(-1, 1) != 0:
            self.device_list = []
            self.query_active = False

        res = self.device_list
        self.device_list = []
        return res

    def process_list_response(self, pkt):
        """
         Process a list response packet.
          pkt         received packet
         Returns error flag.
        """
        npkt = self.packet(len=8, conn = CONN_QUERY, pkt = self.packet.QUERY_REQ_LIST)

        if(pkt.len == 8):
            self.query_active = False
            return 0

        base = pkt.hflag

        while(len(pkt.data) > 0):
            device = self.dev_list()
            consumed = (device.from_bytes(pkt.data) + 3 ) & ~3 # align to 4 bytes
            pkt.data = pkt.data[consumed:]
            base += 1
            self.device_list.append(device)

        npkt.hflag = base
        return self.push_packet(npkt, None)

    def process_conn_response(self, pkt):
        """
         Process a connection response packet.
          pkt         received packet
         Returns error flag.
        """
        if(self.conn_if is not None):
            self.conn_if.conn = pkt.hflag
            if(pkt.len >= 12):
                self.conn_if.cred = int.from_bytes(pkt.data[0:4], 'little')
            if(pkt.hflag != CONN_QUERY):
                self.ifs.append(self.conn_if)
            self.query_active = False
        return 0

    def _attach_int(self, name: str, addr, bus_if, flags):
        nlen = len(name)

        if(self.query_active):
            return None

        pkt = self.packet(len = 16 + nlen, conn = CONN_QUERY, pkt = self.packet.QUERY_REQ_CONN, hflag = flags)
        pkt.data = bytearray()
        pkt.data.extend(bus_if.type.to_bytes(2, 'little'))
        pkt.data.extend(nlen.to_bytes(2, 'little'))
        pkt.data.extend(addr.to_bytes(4, 'little'))
        pkt.data.extend(name.encode('utf-8'))
        self.push_packet(pkt, None)

        bus_if.conn = CONN_QUERY
        bus_if.push_packet = self.push_packet
        self.conn_if = bus_if
        self.query_active = True

        if self.mainloop_int(-1, 1) != 0:
            self.query_active = False
            self.conn_if = None
            return None

        if(self.conn_if == CONN_QUERY):
            self.conn_if = None
            return None

#        print("Connected to %s, conn %s" % (name, self.conn_if))
        self.conn_if = None
        return bus_if

# /* Attached functions */
    def advance_if(self, cif):
        while len(cif.rxbufs) > 0:
            packet = cif.rxbufs[0]
#            print("advancing packet", packet.__dict__, packet)
            res = cif.advance_if(pkt = packet)
#            print("  advance_if returned", res)
            if(res > 0):    # stop processing the interface
                break   
            if(res == 0):   # continue to next packet
                cif.rxbufs.remove(packet)
                continue
            if(res == -2):  # retry the same packet
                # USB only
                continue
            # if unhandled packet, remove it from the queue
            cif.rxbufs.remove(packet)

    def process_packet(self, pkt):
        """
         Process a received packet.
          pkt         received packet
         Returns error flag.
        """
#        print("process_packet: pkt=%s" % pkt.__dict__)
        if(pkt.conn == CONN_QUERY):
            if(self.query_active):
                if(pkt.pkt == self.packet.QUERY_RSP_LIST):
                    return self.process_list_response(pkt)
                elif(pkt.pkt == self.packet.QUERY_RSP_CONN):
                    return self.process_conn_response(pkt)
            return 0

        for interface in self.ifs:
            if interface.conn == pkt.conn:
                interface.rxbufs.append(pkt)
                self.advance_if(interface)
                return 0
        return 0

    def process_rxq(self):
        """
        # Converts received buffer into a series of packets
        """
        local_len = len(self.rxbufs)
        while(local_len >= 8):
            pkt = self.packet()
#            print("process_rxq: rxbufs=%d" % len(self.rxbufs))
            pkt.from_bytes(self.rxbufs)
            dlen = ((pkt.len + 3) & ~3)
            self.rxbufs = self.rxbufs[dlen:]
#            print("process_rxq2: rxbufs=%d" % len(self.rxbufs))
            local_len = len(self.rxbufs)

            #drop if longer than max packet size
            if(pkt.len > self.packet.MAX_PKT):
                continue

            if(self.process_packet(pkt) != 0):
#                print("processing packet", pkt, "failed")
                break

    def preparefds(self, readfds, writefds):
        """
        /* Prepare fd_sets for select(2).
         *  readfds     readfds to update
         *  writefds    writefds to update
         */
        """
        if(len(self.rxbufs) < self.RX_BUF):
            readfds.append(self.sock)

        if len(self.txbufs) > 0 and self.txflag:
            writefds.append(self.sock)

        self.txflag = 0

        return 0

    def processfds(self, readfds, writefds):
        """
        /* Process fd_sets after select(2).
         *  readfds     readfds to process
         *  writefds    writefds to process
         * Returns error flag.
         */
        """
        if self.sock is None:
            return -errno.ENOTCONN

        if self.sock in readfds:
            while True:
                step = self.RX_BUF - len(self.rxbufs)
                if step == 0:
                    break
                try:
                    res = self.sock.recv(step)
                except BlockingIOError:
                    break
                except ConnectionResetError:
                    self.sock.close()
                    self.sock = None
                    return -errno.ECONNRESET
                except Exception as e:
                    print(f"[coremodel] Read error: {e}", file=sys.stderr)
                    self.sock.close()
                    self.sock = None
                    return -errno.EIO

                if len(res) == 0:
                    self.sock.close()
                    self.sock = None
                    return -errno.ECONNRESET

#                print("Received %d bytes %s" % (len(res), res))
                self.rxbufs.extend(res)

        self.process_rxq()
        tx_flag = len(self.txbufs) != 0 and not self.txflag

        if self.sock in writefds or tx_flag:
            while self.txbufs:
                try:
                    res = self.sock.send(self.txbufs)
#                    print(f"Sent {res} bytes ", end='')
#                    for d in self.txbufs[:res]:
#                       print("%02x " % d, end = '')
#                   print("")
                except BlockingIOError:
                    break
                except ConnectionResetError:
                    self.sock.close()
                    self.sock = None
                    return -errno.ECONNRESET
                except Exception as e:
                    print(f"[coremodel] Write error: {e}", file=sys.stderr)
                    self.sock.close()
                    self.sock = None
                    return -errno.EIO

                self.txbufs = self.txbufs[res:]
                if len(self.txbufs) == 0:
                    self.txbufs = bytearray()
                    tx_flag = False
                    break

        return 0

    def get_microtime(self):
        return (time.clock_gettime(time.CLOCK_MONOTONIC) * 1000000)

    def mainloop_int(self, usec, query):
        now_us = self.get_microtime()
        end_us = now_us + usec
        readfds = []
        writefds = []

        while((usec < 0 or end_us >= now_us) and (not query or self.query_active)):
            if(usec >= 0):
                sec = (end_us - now_us) / 1000000
            else:
                sec = 0
            writefds = []
            readfds = []
            self.preparefds(readfds, writefds)
            (readfds,writefds,temp) = select.select(readfds, writefds, [], sec)
            res = self.processfds(readfds, writefds)
            if(res):
                return res
            now_us = self.get_microtime()

        return 0

    def mainloop(self, usec):
        """
        /* Simple implementation of a main loop.
         *  usec        time to spend in loop, in microseconds; negative means forever
         * Returns error flag.
         */
        """
        try:
            return self.mainloop_int(usec, 0)
        except KeyboardInterrupt:
            return 0

    def detach(self, cif):
        """
        # /* Detach any interface.
        #  *  cif      handle of UART/I2C/SPI/GPIO interface */
        """
        self.ifs.remove(cif)
        pkt = self.packet(len = 8, conn = CONN_QUERY, pkt = self.packet.QUERY_REQ_DISC, hflag = cif.conn)
        self.push_packet(pkt, None)

    # /* Close connection to a VM. */
    def disconnect(self):
        self.query_active = False
        self.device_list = []
        self.txbufs = bytearray()
        self.rxbufs = bytearray()
        for cif in self.ifs:
            self.detach(cif)
        if self.sock is not None:
            self.sock.close()
        self.sock = None
        self.ifs = []
        self.conn_if = None

# /* Interface Classes */
# /* UART */
    class UART_t(cif):
        def __init__(self):
            super().__init__(coremodel.UART)

        @abstractmethod
        def tx(self, len: int, data: bytearray) -> int:
            """ Called by CoreModel to transmit bytes. Return a >0 number to accept as
             * many bytes, or 0 to stall Tx interface (it will have to be un-stalled
             * with coremodel_uart_txrdy). """
            pass
        @abstractmethod
        def brk(self) -> None:
            """ Called by CoreModel to signal a BREAK condition on UART line. """
            pass
        @abstractmethod
        def rxrdy(self) -> None:
            """ Called by CoreModel to unstall Rx interface. """
            pass

        def advance_if(self, pkt):
#            print("advance_if: pkt=%s" % pkt.__dict__)
            if pkt.pkt == coremodel.packet.UART_TX:
                if(self.busy):
                    return 1
                res = self.tx((pkt.len - 8), pkt.data)
                if res == 0:
                    self.busy = 1
                    return 1
                if(res < pkt.len - 8):
                    pkt.data = pkt.data[res:]
                    return 1
                return 0

            elif pkt.pkt == coremodel.packet.UART_RX_ACK:
                if(self.cred == 0):
                    self.cred += pkt.hflag
                    self.rxrdy()
                else:
                    self.cred += pkt.hflag
                return 0

            elif pkt.pkt == coremodel.packet.UART_BRK:
                self.brk()
                return 0

            return 0

    def attach_uart(self, name: str, uart_obj):
        """
        # /* Attach to a virtual UART.
        #  *  name        name of the UART interface, depends on the VM
        #  *  func        set of function callbacks to attach
        #  * Returns handle of UART, or NULL on failure. */
        """
        return self._attach_int(name, 0, uart_obj, 0)

# /* Try to push data into the virtual UART.
#  *  uart        handle of UART
#  *  len         number of bytes to send to the Rx interface
#  *  data        data to send
#  * Returns a >0 number when this many bytes were accepted, or 0 to signal stall
#  * of the Rx interface (CoreModel will call func->rxrdy to un-stall it). */
    # int coremodel_uart_rx(void *uart, unsigned len, uint8_t *data);

# /* Unstall a stalled Tx interface (signal that CoreModel can once again call
#  * func->tx to push data).
#  *  uart        handle of UART
#  */
    # void coremodel_uart_txrdy(void *uart);

# /* I2C */
    class I2C_t(cif):
        def __init__(self):
            super().__init__(coremodel.I2C)
            self.rdbuf = bytearray()
        # return codes for I2C callbacks
        START_ACK   = 0x0001  #/* device must ACK all starts */
        WRITE_ACK   = 0x0002  #/* device must ACK all writes */

        @abstractmethod
        def start(self) -> int:
            """ Called by CoreModel to notify of a START to a device; return -1 to NAK,
             * 0 to stall, 1 to accept. A stalled interface will have to be un-stalled
             * with coremodel_i2c_ready. """
            pass
        @abstractmethod
        def write(self, len: int, data: bytearray) -> int:
            """ Called by CoreModel to WRITE bytes. Return a >0 number to accept as
             * many bytes, -1 to NAK, or 0 to stall interface (it will have to be
             * un-stalled with coremodel_i2c_ready). """
            pass
        @abstractmethod
        def read(self, len: int, data: bytearray) -> int:
            """ Called by CoreModel to READ bytes. Return a >0 number to produce as
             * many bytes, or 0 to stall interface (it will have to be un-stalled
             * with coremodel_i2c_ready). """
            pass
        @abstractmethod
        def stop(self) -> None:
            """ Called by CoreModel to notify of a STOP to a device. """
            pass

        def advance_if(self, pkt):
            npkt = coremodel.packet(len = 8, conn = self.conn, pkt = coremodel.packet.I2C_DONE, hflag = pkt.hflag)
#            print("advance_if: pkt=%s" % pkt.__dict__)

            if(self.busy):
                return 1

            self.trnidx = pkt.hflag

            if pkt.pkt == coremodel.packet.I2C_START:
                res = self.start()
                if res == 0:
                    self.busy = True
                    return 1
                if(pkt.bflag & 1):
                    npkt.bflag = 1 if res < 0 else 0
                    self.push_packet(npkt, None)
                return 0

            elif pkt.pkt == coremodel.packet.I2C_WRITE:
                res = self.write((pkt.len - 8), pkt.data)
                if res == 0:
                    self.busy = True
                    return 1
                if res < 0:
                    if(pkt.bflag & 1):
                        npkt.bflag = 1
                        self.push_packet(npkt, None)
                    return 0
                if(res < pkt.len - 8):
                    pkt.data = pkt.data[res:]
                    return 1
                if(pkt.bflag & 1):
                    self.push_packet(npkt, None)
                return 0

            elif pkt.pkt == coremodel.packet.I2C_READ:
                res = self.read(pkt.bflag, self.rdbuf)
                if res == 0:
                    self.busy = True
                    return 1
                if(res < pkt.bflag):
                    self.rdbuf = self.rdbuf[res:]
                    return 1
                npkt.len = 8 + pkt.bflag
                self.push_packet(npkt, self.rdbuf)
                self.rdbuf = bytearray()
                return 0

            elif pkt.pkt == coremodel.packet.I2C_STOP:
                self.stop()
                return 0
            return 0

    def attach_i2c(self, name: str, addr, i2c_obj, flags):
        """
        # /* Attach to a virtual I2C bus.
        #  *  name        name of the I2C bus, depends on the VM
        #  *  addr        7-bit address to attach
        #  *  i2c_obj        set of function callbacks to attach
        #  *  flags       behavior flags of device
        #  * Returns handle of I2C interface, or NULL on failure. */
        """
        return self._attach_int(name, addr, i2c_obj, flags)

# /* Push unsolicited I2C READ data. Used to lower access latency.
#  *  i2c         handle of I2C interface
#  *  len         number of bytes to send to the Rx interface
#  *  data        data to send
#  * Returns number of bytes accepted. */
    # int coremodel_i2c_push_read(void *i2c, unsigned len, uint8_t *data);

# /* Unstall a stalled interface (signal that CoreModel can once again call
#  * func->start/write/read).
#  *  i2c         handle of I2C interface
#  */
    # void coremodel_i2c_ready(void *i2c);

# /* SPI */
    class SPI_t(cif):
        def __init__(self):
            super().__init__(coremodel.SPI)
            self.rdbuf = bytearray()
        SPI_BLOCK    = 0x0001  #/* device must handle >1 byte transfers */

        @abstractmethod
        def cs(self, csel: int) -> None:
            """ Called by CoreModel to notify of a CS pin change. """
            pass
        @abstractmethod
        def xfr(self, len: int, wrdata: bytearray, rddata: bytearray) -> int:
            """ Called by CoreModel to write and read bytes. Return a >0 number to
             * accept (and produce) as many bytes, or 0 to stall interface (it will
             * have to be un-stalled with coremodel_spi_ready). """
            pass

        def advance_if(self, pkt):
            npkt = coremodel.packet(len = pkt.len, conn = self.conn, pkt = coremodel.packet.SPI_RX, hflag = pkt.hflag)
#            print("advance_if: pkt=%s" % pkt.__dict__)

            if pkt.pkt == coremodel.packet.SPI_CS:
                self.cs(pkt.bflag & 1)
                return 0
            elif pkt.pkt == coremodel.packet.SPI_TX:
                if(self.busy):
                    return 1
                self.trnidx = pkt.hflag
                res = (pkt.len - 8)
                if(res > 256):
                    res = 256
                res = self.xfr(res, pkt.data, self.rdbuf)
                if res == 0:
                    self.busy = True
                    return 1
                if(res < pkt.len - 8):
                    return 1
                self.push_packet(npkt, self.rdbuf)
                return 0
            return 0

    def attach_spi(self, name: str, csel, spi_obj, flags):
        """
        # /* Attach to a virtual SPI bus.
        #  *  name        name of the SPI bus, depends on the VM
        #  *  csel        chip select index
        #  *  spi_obj     set of function callbacks to attach
        #  *  flags       behavior flags of device
        #  * Returns handle of SPI interface, or NULL on failure. */
        """
        return self._attach_int(name, csel, spi_obj, flags)

# /* Unstall a stalled interface (signal that CoreModel can once again call
#  * func->xfr).
#  *  spi         handle of SPI interface
#  */
    # void coremodel_spi_ready(void *spi);

# /* GPIO */
    class GPIO_t(cif):
        def __init__(self):
            super().__init__(coremodel.GPIO)

        @abstractmethod
        def notify(self, mvolt: int) -> None:
            """ Called by CoreModel to update voltage on a GPIO pin. """
            pass

        def advance_if(self,pkt):
#            print("advance_if: pkt=%s" % pkt.__dict__)
            if pkt.pkt == coremodel.packet.GPIO_UPDATE:
                self.notify(int(pkt.hflag))
                return 0
            return 0

    def attach_gpio(self, name: str, pin: int, gpio_obj):
        """
        # /* Attach to a virtual GPIO pin.
        #  *  name        name of the GPIO bank, depends on the VM
        #  *  pin         pin index within bank
        #  *  gpio_obj    set of function callbacks to attach
        #  * Returns handle of GPIO interface, or NULL on failure. */
        """
        return self._attach_int(name, pin, gpio_obj, 0)

# /* Set a tri-state driver on a GPIO pin.
#  *  pin         handle of GPIO interface
#  *  drven       driver enable
#  *  mvolt       voltage to drive (if enabled) in mV */
    # void coremodel_gpio_set(void *pin, unsigned drven, int mvolt);

# /* USB Host (connect a local USB Device to a Host inside VM) */
    class USBH_t(cif):
        def __init__(self):
            super().__init__(coremodel.USBH)
            self.rebuf = bytearray()
        USB_SPEED_LOW       = 0
        USB_SPEED_FULL      = 1
        USB_SPEED_HIGH      = 2
        USB_SPEED_SUPER     = 3

        # Transaction Types 
        TKN_OUT             = 0
        TKN_IN              = 1
        TKN_SETUP           = 2
        XFR_NAK             = (-1)
        XFR_STALL           = (-2)
        tkn_names = {
            TKN_IN: "IN",
            TKN_OUT: "OUT",
            TKN_SETUP: "SETUP",
        }
        # Control Request Recipient / Type / Direction
        CTRL_RCPT_DEV    = 0x00
        CTRL_RCPT_IF     = 0x01
        CTRL_RCPT_EP     = 0x02
        CTRL_RCPT_OTHER  = 0x03

        CTRL_TYPE_STD    = 0x00
        CTRL_TYPE_CLASS  = 0x20
        CTRL_TYPE_VEND   = 0x40

        CTRL_DIR_OUT     = 0x00
        CTRL_DIR_IN      = 0x80

        # Standard Requests
        REQ_GET_STATUS   = 0x00
        REQ_CLR_FEATURE  = 0x01
        REQ_SET_FEATURE  = 0x03
        REQ_SET_ADDRESS  = 0x05
        REQ_GET_DESCR    = 0x06
        REQ_SET_DESCR    = 0x07
        REQ_GET_CONFIG   = 0x08
        REQ_SET_CONFIG   = 0x09
        REQ_GET_IF       = 0x0A
        REQ_SET_IF       = 0x0B
        REQ_SYNCH_FRAME  = 0x0C

        # Descriptor Types
        DT_DEVICE        = 0x01
        DT_CONFIG        = 0x02
        DT_STRING        = 0x03
        DT_IF            = 0x04
        DT_EP            = 0x05
        DT_DEVQUAL       = 0x06
        DT_OTHER_SPEED   = 0x07
        DT_IF_POWER      = 0x08
        DT_HID           = 0x21
        DT_HID_REPORT    = 0x22

        DD_SIZE          = 18   # Device Descriptor size
        CD_SIZE          = 9    # Configuration Descriptor size
        ID_SIZE          = 9    # Interface Descriptor size
        ED_SIZE          = 7    # Endpoint Descriptor size
        HIDD_SIZE        = 9    # HID Descriptor size

        @abstractmethod
        def rst(self) -> None:
            """ Called by CoreModel on USB bus reset. """
            pass
        @abstractmethod
        def xfr(self, dev: int, ep: int, tkn: int, buf: bytearray, end: int) -> int:
            """ Called by CoreModel to perform a USB transfer. Return a >0 number to
             * accept / produce as many bytes, or USBH_t.XFR_NAK to pause interface, or
             * USBH_t.XFR_STALL to stall interface (create error condition). A paused
             * interface will have to be un-paused with coremodel_usbh_ready. """
            pass

        def advance_if(self, pkt):
            npkt = coremodel.packet(conn = self.conn,pkt = coremodel.packet.USBH_DONE, bflag = pkt.bflag)
#        npkt = coremodel.packet(len = 8, , , )

            #print("advance_if: pkt=%s dlen=%s" % (pkt.__dict__, len(pkt.data)))

            if pkt.pkt == coremodel.packet.USBH_RESET:
                #print("USBH_RESET")
                if(not self.busy):
                    self.busy = True
                    return -2
                self.busy = False
                self.ebusy = 0
                self.rst()
                return 0

            elif pkt.pkt == coremodel.packet.USBH_XFR:
                #print("USBH_XFR")
                if(self.busy):
                    return 0
                ep = (pkt.hflag >> 4) & 0xf
                tkn = pkt.hflag & 0xf
                if(tkn == self.TKN_SETUP):
                    self.ebusy &= ~(1 << (ep * 4 + tkn))
                if(self.ebusy & (1 << (ep * 4 + tkn))):
                    return -1
                dev = (pkt.hflag >> 8) & 0x7f
                end = pkt.hflag >> 0xf
                if(tkn == self.TKN_IN):
                    if(pkt.len < 10):
                        return 0
                    size = int.from_bytes(pkt.data[0:2], 'little')
                    res = self.xfr(dev, ep, tkn, self.rdbuf, size, end)
                else:
                    res = self.xfr(dev, ep, tkn, pkt.data, pkt.len - 8, end)
                if(tkn == self.TKN_SETUP):
                    return 0
                if(res == self.XFR_NAK):
                    self.ebusy |= 1 << (ep * 4 + tkn)
                    return -1
                npkt.hflag = tkn | (ep << 4) | (dev << 8)
                if(res < 0):
                    npkt.len = 8 if (tkn == self.TKN_IN) else 10
                    npkt.hflag |= 0x8000
                    self.push_packet(npkt, bytearray(2))
                else:
                    if(tkn == self.TKN_IN):
                        npkt.len = 8 + res
                        self.push_packet(npkt, self.rdbuf)
                    else:
                        npkt.len = 10
                        self.push_packet(npkt, bytearray(res.to_bytes(2, 'little')))
                return 0
            return 0

    def attach_usbh(self, name: str, port: int, usbh_obj, speed: int):
        """
        # /* Attach to a virtual USB host.
        #  *  name        name of the USB host, depends on the VM
        #  *  port        USB port index
        #  *  usbh_obj    set of function callbacks to attach
        #  *  speed       requested connection speed
        #  * Returns handle of USB interface, or NULL on failure. */
        """
        return self._attach_int(name, port, usbh_obj, speed)

# /* Unstall a stalled interface (signal that CoreModel can once again call
#  * func->xfr).
#  *  usb         handle of USB interface
#  *  ep          endpoint to signal as ready
#  *  tkn         token to signal as ready
#  */
# void coremodel_usbh_ready(void *usb, uint8_t ep, uint8_t tkn);

    class CAN_t(cif):
        def __init__(self):
            super().__init__(coremodel.CAN)
            self.type = coremodel.CAN
            self.rdbuf = bytearray()

        """/* CAN bus interface callbacks. */"""
        # /* Control field bits */
        CTRL1_SEC         =  (1 << 59)
        CTRL1_SDT_SHIFT   =   51
        CTRL1_SDT_MASK    =  (0xFF << CTRL1_SDT_SHIFT)
        CTRL1_VCID_SHIFT  =   43
        CTRL1_VCID_MASK   =  (0xFF << CTRL1_VCID_SHIFT)
        CTRL1_PRIO_SHIFT  =   32
        CTRL1_PRIO_MASK   =  (0x7FF << CTRL1_PRIO_SHIFT)
        CTRL1_AF_SHIFT    =   0
        CTRL1_AF_MASK     =  (0xFFFFFFFF << CTRL1_AF_SHIFT)

        CTRL_XLF          =  (1 << 49)
        CTRL_FDF          =  (1 << 48)
        CTRL_ID_SHIFT     =   36
        CTRL_ID_MASK      =  (0x7FF << CTRL_ID_SHIFT)
        CTRL_RTR          =  (1 << 35)
        CTRL_IDE          =  (1 << 34)
        CTRL_EID_SHIFT    =   16
        CTRL_EID_MASK     =  (0x3FFFF << CTRL_EID_SHIFT)
        CTRL_ERTR         =  (1 << 15)
        CTRL_EDL          =  (1 << 14)
        CTRL_BRS          =  (1 << 12)
        CTRL_ESI          =  (1 << 11)
        CTRL_DLC_SHIFT    =   0
        CTRL_DLC_MASK     =  (0x7FF << CTRL_DLC_SHIFT)

        # /* Data length lookup table */
        can_datalen = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64 ]

        # return codes for tx callback
        ACK                =  0
        NAK                =  1
        STALL              = (-1)
        @abstractmethod
        def tx(self, ctrl, data) -> int:
            """/* Called by CoreModel to transmit a CAN packet. Return one of
             * CAN_t.ACK, CAN_t.NAK, CAN_t.STALL. A stalled interface will have to be
             * un-stalled with coremodel_can_ready. */
            """
            pass
        @abstractmethod
        def rxcomplete(self, nak):
            """/* Called by CoreModel to signal completion of a CAN packet
             * transmission (after receiving ACK/NAK from bus). */
            """
            pass

        # /* Send a packet to CAN bus.
        def can_rx(self, ctrl, data):
            """
            # /* Send a packet to CAN bus.
            #  *  ctrl        control word, array of 2 uint64_t values
            #  *  data        optional data (if ctrl.DLC != 0)
            #  * Returns 0 on success, 1 if bus is not available because previous packet hasn't been completed yet. */
            """
#            print("can_rx: ctrl=%016x, %016x, data=%s" % (ctrl[0], ctrl[1], data))
            dlc = (ctrl[0] & self.CTRL_DLC_MASK) >> self.CTRL_DLC_SHIFT
            dlen = self.can_datalen[dlc] if (dlc < 16) else dlc + 1
#            print("  can_rx: dlc=%d dlen=%d ebusy=%d" % (dlc, dlen, self.ebusy))
            if(self.ebusy or (dlen > 0 and data is None)):
                return 1

            self.trnidx = (self.trnidx + 1) & 255
            edata = bytearray()
            edata.extend(ctrl[0].to_bytes(8, 'little'))
            edata.extend(ctrl[1].to_bytes(8, 'little'))
            if dlen:
                edata.extend(data[0:dlen])

            pkt = coremodel.packet(len = 8 + len(edata), conn = self.conn,
                                   pkt = coremodel.packet.CAN_RX,
                                   bflag = self.trnidx, hflag = 0)
#            print("  can_rx: RX trnidx=%x pkt=%s" % (self.trnidx, pkt.__dict__))#, end='')
#            print("  can_rx: edata=", end='')
#            for x in edata:
#                print("%x" % x, end=' ')
#            print("")

            self.push_packet(pkt, edata)

            self.ebusy = 1
            return 0
        
# /* Unstall a stalled interface (signal that CoreModel can once again call func->tx).
#  *  can         handle of CAN interface
#  */
    # void coremodel_can_ready(void *can);
#{
#    coremodel_ready_int(can);
#}

        def advance_if(self, pkt):
            npkt = coremodel.packet(len = 8, conn = self.conn, pkt = coremodel.packet.CAN_TX_ACK, bflag = pkt.bflag)
#            print("advance_if: pkt=%s dlen=%s" % (pkt.__dict__, len(pkt.data)))

            if pkt.pkt == coremodel.packet.CAN_TX:
                if(self.busy):
                    return 1
                if(pkt.len < 16):
                    return 0

                data_header = int.from_bytes(pkt.data[0:8], 'little')
                dlc = (data_header & coremodel.CAN_t.CTRL_DLC_MASK) >> coremodel.CAN_t.CTRL_DLC_SHIFT
                dlen = coremodel.CAN_t.can_datalen[dlc] if (dlc < 16) else dlc + 1
                if pkt.len < (16 + dlen):
                    return 0
                res = self.tx((data_header, int.from_bytes(pkt.data[8:16], 'little')), pkt.data[16:])
                if (res == coremodel.CAN_t.STALL):
                    self.busy = True
                    return 1
                npkt.hflag = 0 if (res == 0) else 1
#                print("  can_tx: tx returned %d, hflag=%d" % (res, npkt.hflag))
#                print("  can_tx: npkt=%s" % npkt.__dict__)
                self.push_packet(npkt, None)
                return 0
            elif pkt.pkt == coremodel.packet.CAN_RX_ACK:
                if(pkt.bflag == self.trnidx):
                    self.ebusy = 0
                    self.rxcomplete(pkt.hflag)
                return 0
            return 0

    def attach_can(self, name: str, can_obj):
        """
        # /* Attach to a virtual CAN bus.
        #  *  name               name of the CAN bus, depends on the VM
        #  *  can_obj  a class derived from coremodel.CAN_t to define function callbacks to attach
        #  * Returns handle of CAN interface, or NULL on failure. */
        """
        return self._attach_int(name, 0, can_obj, 0)