# CoreModel Python Examples

The CoreModel python-examples provide skeletons for devices to be attached to a VMs virtual interfaces. These examples are ports of the C based examples in the examples directory. These use a port of the CoreModel library from C to Python which is also included in this directory. There are independent examples for the CoreModel API usage for list, UART, I2C, SPI, CAN, GPIO, and USBH. Not every VM type currently supports CoreModel API, the IMX93, IMX8, and RPI4B can be used to test connecting to the virtual interfaces. While the STM32 also provides CoreModel interfaces it does not include firmware suitable for easy testing of I/O interfaces.

## Connecting

There are several different ways to connect your CoreModel example to a VM depending on how you access Corellium products. If you access a Corellium product in the public cloud or in a virtual private cloud then you cannot directly access the VMs directly and instead will neither either a VPN or SSH tunnel to the virtual network. If you are running a Corellium product locally, on a server or desktop appliance, then the default is that VMs will be directly accessible on your network, though your IT department may have configured an isolated network with an SSH jump server, while possible it is uncommon for IT departments to setup VPN configurations for isolated networks. The following procedure will walk you through determining how to connect to the CoreModel interface.

### Determining VM IP Addresses

Each VM will have at lest two IP addresses (more if the device had more than one network connection enabled) that are documented on the connections tab once the device is booted. Scrolling to the bottom of the page will reveal the *LAN* and *Services IP* addresses. When accessing Corellium in a public or managed cloud configuration these will generally be of the form `10.11.0.x` for the *LAN* ip address and `10.11.1.x` for the *Services IP*. When accessing Corellium on a local appliance the addresses are likely to be sequentially assigned by your DHCP server. You can check if these addresses are accessible by trying to `ssh` to the addresses. If your VM is running a linux link operating system an ssh connection to the `LAN` ip will result in a login prompt if the address is accessible or a very long time out if not accessible. An ssh connection to the `Services IP` will similarly result in an almost immediate "Connection refused" error or very long time out. In either case make note of both addresses which will be referred to as `<lan ip>` and `<services ip>` in the next steps. In most cases the `<lan ip>` and `<services ip>` will not be directly accessible.

### Option VPN Connection

When connecting to a public or managed cloud Corellium instance the *Connections* tab will include a *Connect via VPN* section that provides a button to down load an OpenVPN configuration file and provides pointers documentation for setting up a connection. Once connected you should be able to directly connect to the `<lan ip>` and `<services ip>` addresses. For more details see the [VPN section of the product documentation](https://support.avh.corellium.com/features/connect/vpn).

### Option Quick Connect

When connecting to a public or managed cloud Corellium instance, and using a VM with a linux like operating system, the *Connections* tab may show a *Quick Connect* section that provides an example *SSH* command of the form `ssh -J <UUID>@proxy.app.avh.corellium.com root@<lan ip>`. The `<UUID>` uniquely identifies your project to the proxy, jump server in SSH documentation. To use this proxy your ssh id_ed25519.pub key must be added to the *Project* by a project admin as documented in the [Quick Connect section of the product documentation](https://support.avh.corellium.com/features/connect/quick-connect). If your device does not have a *Quick Connect* section the `<UUID>` can be found by querying the project node in the REST API, or more easily by instantiating a device that does have a quick connect section; such as the i.MX8m, i.MX93, or RaspberryPI 4; in the same project.

### Option Corporate Connection

While it is impossible to document how ever customer's IT department will have configured your corporate network, in most cases they will have setup an SSH Jump Server, or proxy server. They will generally then tell you to connect to your appliance via a command similar to `ssh -J <user>@<proxy> <appliance IP>` or `ssh -J <user>@<proxy> -L 443:<appliance IP>:443 -fN`. You will not be using this `<appliance ip>` for CoreModel but may need it to access the Corellium user interface.

### Recommendation SSH Port Forwarding

Now matter how you access `<lan ip>` and `<services ip>` addresses we recommend setting up port forwarding from the local host to the `<services ip>` so that the command used in testing your CoreModel example can always use `127.0.0.1:1900` as the `<address:port>` to access the VM. This becomes especially important when testing the same example against multiple VMs where the testing sequence can become quite complex. It is much simpler to change the port forward than to rewrite dozens of commands for the test case.

If you have direct access to the `<services ip>` the most simple port forward command is

```bash
ssh -L 1900:<services ip>:1900 -N
```

which forwards any connection from port 1900 on the local host to port 1900 on the `<services ip>`. The `-N` tells ssh not to run any command on the remote end and simply wait for you to kill the connection with `<ctrl>-c`. Optionally you can add a `-f` to the command line to put `ssh` in the background to keep the prompt active for other uses. More often when testing a CoreModel example you will want a connection to the VM command line so the combined `ssh` command

```bash
ssh -L 1900:<services ip>:1900 <user>@<lan>
```

is more useful as you end up with a shell on the VM. Adding your `~/.ssh/id_ed25519.pub` to `~/.ssh/authorized_keys` on the VM will make this command much more efficient.

If you need to use a proxy to access the `<services ip>` these commands become

```bash
ssh <user>@<proxy> -L 1900:<services ip>:1900 -N
```

and

```bash
ssh -J <user>@<proxy> <user>@<lan>
```

where in the case of public or managed cloud `<user>` is the UUID for the project. Note the addition of the `-J` when connecting to the VM prompt. Note also that the "obvious" combination of proxy/jump server, port forwarding, and console connection

```bash
ssh -J <user>@<proxy> -L 1900:<services ip>:1900 <user>@<lan>
```

**Does NOT work** as rather than asking the proxy/jump sever to perform the port forwarding it asks the OS running on the VM to perform the port forwarding which can cause a race condition. Use the two commands in separate terminals.

## List

The list example shows how to properly use the list APIs and enumerate all of the available virtual interfaces on a VM. The list example can be run be command line by providing the `<ip:port>`. This and all following examples assume you are using a port forwarding connection.

```bash
python3 coremodel-list.py 127.0.0.1:1900
```

Below is the enumeration of an IMX93 VM interfaces. For interfaces like UART it will only return UARTs that do not have devices on them.

```bash
 0 gpio    iomuxc      108
 1 uart    lpuart1     1
 2 uart    lpuart2     1
 3 uart    lpuart3     1
 4 uart    lpuart4     1
 5 uart    lpuart6     1
 6 uart    lpuart7     1
 7 uart    lpuart8     1
 8 spi     lpspi0      2
 9 spi     lpspi1      2
10 spi     lpspi2      2
11 spi     lpspi3      3
12 spi     lpspi4      2
13 spi     lpspi5      2
14 spi     lpspi6      2
15 spi     lpspi7      2
16 i2c     lpi2c1      128
17 i2c     lpi2c2      128
18 i2c     lpi2c3      128
19 i2c     lpi2c4      128
20 i2c     lpi2c5      128
21 i2c     lpi2c6      128
22 i2c     lpi2c7      128
23 i2c     lpi2c8      128
24 can     can0        1
25 can     can1        1
26 gpio    pcal6524    24
```

## UART

The UART example shows how to properly attach to a virtual UART interface with the necessary functions to provide RX/TX between the VM and attached device. To attach to a UART `<ip:port>` and `<name>` of the UART interface needs to be provided.

```bash
python3 coremodel-uart.py 127.0.0.1:1900 lpuart1
```

The example will print anything that has been sent from the VM to `/dev/ttyLP0` or `/dev/console` which will also show in the console tab of the Web UI. Note that by default on the IMX93 only lpuart1 is available for testing, lpuart5 is not available via CoreModel as it is connected to the bluetooth system while the other lpuarts are not enabled in the default device tree.

## I2C

The I2C example provides an I2C dummy device that will attach to a virtual I2C interface. The I2C address 0x42 is statically defined in the example. If attaching to an address that is already used it will overwrite the device at that address. Attaching the dummy device to the I2C address provide `<ip:port>` and `<name>` of the I2C interface.

```bash
python3 coremodel-i2c.py 127.0.0.1:1900 lpi2c0
```

The example will print anything that has been sent from the VM to `stdout`. The VM will be provided dummy data on reads.

### I2C DS3231

The DS3231 example extends the base I2C dummy device to model the DS3231 I2C connected Real Time Clock. See the Readme accompanying the C version in ../i2c-ds3231-rtc for additional details.

## SPI

The SPI example shows the basic way to connect to a virtual SPI bus and attaches a dummy device. The chip select is statically assigned to index 0. Attaching the dummy device to the SPI address provide `<ip:port>` and `<name>` of the SPI interface.

```bash
python3 coremodel-spi 127.0.0.1:1900 lpspi0
```

The example will print anything that has been sent from the VM to `stdout`. The VM will be provided dummy data on reads.

### SPI DS3234

The DS3234 example extends the base SPI dummy device to model the DS3234 SPI connected Real Time Clock. See the Readme accompanying the C version in ../spi-ds3234-rtc for additional details.

## CAN

The CAN example shows the basic way to connect to a virtual CAN bus and attaches a dummy device. Attaching the dummy device to the CAN address provide `<ip:port>` and `<name>` of the CAN interface.

```bash
python3 coremodel-can 127.0.0.1:1900 can0
```

The example will print anything that has been sent from the VM to `stdout`. The VM will be provided only `<ctrl>` of `0x8ac7ffff00` on reads.

### CAN CR3020

The CR3020 example extends the base CAN dummy device to model the CR3020 CAN connected Real Time Clock. See the Readme accompanying the C version in ../can-cr3020-rtc for additional details.

## GPIO

The GPIO example shows how to attach to the virtual GPIO interface and monitor GPIO pins. To attach and monitor GPIO pins provide `<ip:port>` and `<name>` of the GPIO interface followed by the `<index>` of the GPIO pins to be monitored.

```bash
./python3 coremodel-gpio.py 127.0.0.1:1900 iomuxc 0 8 16 17
```

The `coremodel-gpio` will print the voltage values in millivolts to `stdout` when the values change. On the IMX93 the LEDs shown on the UI are, from left to right, at indexes 17, 8, and 16.

```bash
GPIO[0] = 3300 mV
GPIO[8] = 0 mV
GPIO[16] = 0 mV
GPIO[17] = 0 mV
```

## USBH

The USBH example shows how to attach to the virtual USBH interface. To attach USBH dummy provide `<ip:port>` and `<name>` of the USBH interface followed by the `<port>` of the USBH bus. Note that USBH should be tested with Raspberry Pi 4 rather than i.MX93.

```bash
./coremodel-usbh 127.0.0.1:1900 xhci 0
```

The example will print the data sent to the device on `USB_TKN_OUT`, `USB_TKN_IN`, and `USB_TKN_SETUP` to `stdout`. The IMX93 does not have an exposed USBH to CoreModel the following is from RPI4B.

```bash
RESET
XFR 00 EP0 SETUP [8]: 80 06 00 01 00 00 40 00 -> 8
XFR 00 EP0 IN [64] -> 12 01 00 02 00 00 00 08 6b 1d 04 01 01 01 01 02 00 01
XFR 00 EP0 OUT [0]: -> 0
RESET
RESET
XFR 03 EP0 SETUP [8]: 80 06 00 01 00 00 12 00 -> 8
XFR 03 EP0 IN [18] -> 12 01 00 02 00 00 00 08 6b 1d 04 01 01 01 01 02 00 01
XFR 03 EP0 OUT [0]: -> 0
XFR 03 EP0 SETUP [8]: 80 06 00 06 00 00 0a 00 -> -2
XFR 03 EP0 IN [10] -> 12 01 00 02 00 00 00 08 6b 1d
XFR 03 EP0 OUT [0]: -> 0
XFR 03 EP0 SETUP [8]: 80 06 00 06 00 00 0a 00 -> -2
XFR 03 EP0 IN [10] -> 12 01 00 02 00 00 00 08 6b 1d
XFR 03 EP0 OUT [0]: -> 0
XFR 03 EP0 SETUP [8]: 80 06 00 06 00 00 0a 00 -> -2
XFR 03 EP0 IN [10] -> 12 01 00 02 00 00 00 08 6b 1d
XFR 03 EP0 OUT [0]: -> 0
XFR 03 EP0 SETUP [8]: 80 06 00 02 00 00 09 00 -> 8
XFR 03 EP0 IN [9] -> 09 02 22 00 01 01 03 a0 00
XFR 03 EP0 OUT [0]: -> 0
XFR 03 EP0 SETUP [8]: 80 06 00 02 00 00 22 00 -> 8
XFR 03 EP0 IN [34] -> 09 02 22 00 01 01 03 a0 00 09 04 00 00 01 03 01 01 04 09 21 11 01 21 01 22 3f 00 07 05 81 03 08 00 02
XFR 03 EP0 OUT [0]: -> 0
XFR 03 EP0 SETUP [8]: 80 06 00 03 00 00 ff 00 -> 8
XFR 03 EP0 IN [255] -> 04 03 09 04
XFR 03 EP0 OUT [0]: -> 0
XFR 03 EP0 SETUP [8]: 80 06 02 03 09 04 ff 00 -> 8
XFR 03 EP0 IN [255] -> 12 03 4b 00 65 00 79 00 62 00 6f 00 61 00 72 00 64 00
XFR 03 EP0 OUT [0]: -> 0
XFR 03 EP0 SETUP [8]: 80 06 01 03 09 04 ff 00 -> 8
XFR 03 EP0 IN [255] -> 14 03 43 00 6f 00 72 00 65 00 6c 00 6c 00 69 00 75 00 6d 00
XFR 03 EP0 OUT [0]: -> 0
XFR 03 EP0 SETUP [8]: 00 09 01 00 00 00 00 00 -> 8
XFR 03 EP0 IN [0] -> 0
XFR 03 EP0 SETUP [8]: 80 06 03 03 09 04 ff 00 -> 8
XFR 03 EP0 IN [255] -> 12 03 4b 00 65 00 79 00 62 00 6f 00 61 00 72 00 64 00
XFR 03 EP0 OUT [0]: -> 0
XFR 03 EP0 SETUP [8]: 80 06 04 03 09 04 ff 00 -> 8
XFR 03 EP0 IN [255] -> 16 03 48 00 49 00 44 00 20 00 44 00 65 00 76 00 69 00 63 00 65 00
XFR 03 EP0 OUT [0]: -> 0
XFR 03 EP0 SETUP [8]: 21 0a 00 00 00 00 00 00 -> 8
XFR 03 EP0 IN [0] -> -2
XFR 03 EP0 SETUP [8]: 81 06 00 22 00 00 3f 00 -> 8
XFR 03 EP0 IN [63] -> 05 01 09 06 a1 01 05 07 19 e0 29 e7 15 00 25 01 75 01 95 08 81 02 95 01 75 08 81 01 95 05 75 01 05 08 19 01 29 05 91 02 95 01 75 03 91 01 95 06 75 08 15 00 25 65 05 07 19 00 29 65 81 00 c0
XFR 03 EP0 OUT [0]: -> 0
XFR 03 EP0 SETUP [8]: 21 09 00 02 00 00 01 00 -> 8
XFR 03 EP0 OUT [1]: 00 -> 1
XFR 03 EP1 IN [8] -> -1
XFR 03 EP0 IN [0] -> -2
```
