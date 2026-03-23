# CoreModel GPIO Bidirectional Example

This example demonstrates bidirectional GPIO functionality using the CoreModel API. Unlike the basic `coremodel-gpio` example which only monitors GPIO pins (read-only), this enhanced version supports both reading GPIO pin states and actively driving GPIO pins with configurable voltage levels.

## Features

- **Input Mode**: Monitor GPIO pins for voltage changes in real-time
- **Output Mode**: Drive GPIO pins with specific voltage levels (0-5000 mV)
- **Runtime Control**: Dynamically switch pin modes and voltages without restarting
- **Multiple Pins**: Configure and control multiple GPIO pins simultaneously
- **Interactive Commands**: Command-line interface for runtime pin manipulation

## Requirements

### VM Compatibility

This example works with Corellium virtual machines:
- i.MX93
- i.MX8
- Raspberry Pi 4B

### Connection Requirements

- Network connectivity to the Corellium VM
- VM address and port (default port: 1900)
- Valid GPIO bank name (e.g., `gpio1`, `gpio2`)
- GPIO pins available on the target VM

## Building

```bash
cd coremodel/examples/gpio-rw
make
```

The Makefile will automatically builds the CoreModel library and links it with the example.

## Command-Line Syntax

```bash
./coremodel-gpio-rw <address[:port]> <pin_spec> [<pin_spec> ...]
```

### Parameters

- `<address[:port]>`: VM IP address and optional port (default: 1900)
- `<pin_spec>`: Pin specification in one of two formats:
  - `<[gpio:]pin>` - Monitor pin in input mode
  - `<[gpio:]pin>=<voltage>` - Drive pin at specified voltage in output mode
- The `[gpio:]` prefix is required for the first pin. For subsequent pins, it defaults to the same as the previous pin.

### Voltage Range

Valid voltage range: **0-5000 mV** (0V to 5V)

## Usage Examples

### Example 1: LED Control

Drive GPIO pin 8, 16, and 17 to 3.3V to simulate turning on 3 LEDs:

```bash
./coremodel-gpio-rw 10.10.0.3:1900 iomuxc:8=3300 16=3300 17=3300
```

Once running, you can toggle the LED:
```bash
> set 8 0      # Turn LED off (0V)
> set 8 3300   # Turn LED on (3.3V)
```

### Example 2: Button Monitoring

Monitor GPIO pin 5 and 6 for button press events:

```bash
./coremodel-gpio-rw 10.10.0.3:1900 pcal6524:5 6
```

The application will display voltage changes when the button is pressed or released in the VM.

### Example 3: Bidirectional Communication

Configure pin 0 as output (send signal) and pin 1 as input (receive response):

```bash
./coremodel-gpio-rw 10.10.0.3:1900 gpio1:0=3300 1
```

Send a pulse and observe the response:
```bash
> set 0 0      # Pull signal low
> set 0 3300   # Pull signal high
# Watch for pin 1 notifications
```

### Example 4: Mixed Configuration

Drive GPIO pin 8, 16, and 17 to 3.3V to simulate turning on 3 LEDs and monitor GPIO pin 5 and 6 for button press events:

```bash
./coremodel-gpio-rw 10.10.0.3:1900 iomuxc:8=3300 16=3300 17=3300 pcal6524:5 6
```

This configures:

- iomux    Pin  8: Output at 3.3V
- iomux    Pin 16: Output at 3.3V
- iomux    Pin 17: Output at 3.3V
- pcal6524 Pin  5: Input (monitoring)
- pcal6524 Pin  6: Input (monitoring)

## Runtime Commands

Once the application is running, you can enter commands interactively:

### `set <pin> <voltage>`

Drive a pin at the specified voltage (switches to output mode if needed).

```bash
> set 5 3300
Pin 5 set to 3300 mV (output mode)
```

### `input <pin>`

Switch a pin to input/monitoring mode (high-impedance state).

```bash
> input 5
Pin 5 switched to input/monitoring mode
```

### `output <pin> <voltage>`

Explicitly switch a pin to output mode at the specified voltage.

```bash
> output 5 1800
Pin 5 switched to output mode at 1800 mV
```

### `add <gpio> <pin>`

Adds a pin in the input/monitoring mode (high-impedance state).

```bash
> add pcal6524 3
GPIO[pcal6524:3] = 3300 mV
```

### `status`

Display the current configuration of all pins.

```bash
> status

Current GPIO configuration:
Bank   Pin Mode  Voltage
-------- --- ------ -------
iomuxc  0  input  3300 mV
iomuxc  8  input  0 mV
iomuxc  16  input  0 mV
iomuxc  17  input  3300 mV
pcal6524 5  input  3300 mV
pcal6524 6  input  3300 mV
pcal6524 3  input  3300 mV
```

### `help`

Display the command reference.

```bash
> help

Available commands:
  set <pin> <voltage>       - Drive pin at specified voltage (mV)
  input <pin>               - Switch pin to input/monitoring mode
  output <pin> <voltage>    - Switch pin to output mode at voltage (mV)
  add <gpio> <pin>          - Add a new GPIO pin configuration
  status                    - Display current configuration of all pins
  help                      - Display this command reference
  quit                      - Exit application
```

### `quit`

Exit the application gracefully.

```bash
> quit
```

You can also press `Ctrl+C` or `Ctrl+D` to exit.

## Pin Notifications

When a monitored pin's voltage changes, the application displays a notification:

```bash
GPIO[gpio1:10] = 3300 mV
GPIO[gpio1:10] = 0 mV
```

Format: `GPIO[<bank>:<pin>] = <voltage> mV`

## Error Handling

The application handles various error conditions gracefully:

### Connection Errors

```bash
error: failed to connect to VM at '10.10.0.3:1900': Connection refused.
```

**Solution**: Verify the VM is running and the address/port are correct.

### Invalid GPIO Bank

```bash
error: failed to attach GPIO pin 5 on bank 'gpio9'.
```

**Solution**: Use a valid GPIO bank name for your VM (e.g., `gpio1`, `gpio2`).

### Voltage Out of Range

```bash
error: voltage 6000 mV is out of range (valid range: 0-5000 mV).
```

**Solution**: Use voltage values between 0 and 5000 mV.

### Invalid Pin Number

```bash
error: pin 99 is not configured.
```

**Solution**: Only use pin numbers that were specified on the command line.

### Invalid Command

```bash
error: unknown command 'foo'. Type 'help' for available commands.
```

**Solution**: Type `help` to see available commands.

## Technical Details

### GPIO Modes

- **Input Mode** (Driver Disabled): Pin is in high-impedance state, monitoring voltage changes from the VM
- **Output Mode** (Driver Enabled): Pin actively drives the specified voltage level

### API Functions Used

- `coremodel_connect()`: Establish connection to VM
- `coremodel_attach_gpio()`: Attach to GPIO pin interface
- `coremodel_gpio_set()`: Set pin driver state and voltage
- `coremodel_detach()`: Detach from GPIO pin interface
- `coremodel_disconnect()`: Close VM connection
- `coremodel_preparefds()`: Prepare file descriptors for select()
- `coremodel_processfds()`: Process CoreModel events

### Event Loop

The application uses a custom event loop that integrates:

- CoreModel's select-based event handling
- Standard input (stdin) for interactive commands
- Signal handling for graceful shutdown (SIGINT)

## Comparison with Basic GPIO Example

| Feature | coremodel-gpio | coremodel-gpio-rw |
|---------|----------------|-------------------|
| Monitor pins | ✓ | ✓ |
| Drive pins | ✗ | ✓ |
| Runtime control | ✗ | ✓ |
| Interactive commands | ✗ | ✓ |
| Mode switching | ✗ | ✓ |

## See Also

- `coremodel/examples/gpio/` - Basic GPIO monitoring example
- `coremodel/coremodel.h` - Complete CoreModel API reference
- `coremodel/README.md` - CoreModel library documentation
