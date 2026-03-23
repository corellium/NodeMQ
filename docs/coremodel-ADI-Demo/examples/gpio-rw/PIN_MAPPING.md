# i.MX93 GPIO Pin Mapping

## CoreModel to Linux GPIO Mapping

On the i.MX93 EVK board:

### CoreModel API

- **Bank name**: `iomuxc`
- **LED pins**:
  - Pin 8 = Middle LED
  - Pin 16 = Right LED  
  - Pin 17 = Left LED

### Linux gpioset/gpioget

- **Chip**: `gpiochip0`
- **LED pins**:
  - signal 4 set the middle LED
  - signal 12 set the right LED
  - signal 13 set the left LED

## Testing LED Control

### Using CoreModel (this tool):

```bash
# Drive GREEN LED (pin 8) at 3.3V
./coremodel-gpio-rw 10.11.61.3:1900 iomuxc:8=3300

# Toggle it with commands:
> set 8 0      # LED off
> set 8 3300   # LED on
```

### Using Linux gpioset:

```bash
# Toggle LED on gpiochip0 pin 4
gpioset gpiochip0 4=1  # LED on
gpioset gpiochip0 4=0  # LED off
```

## Troubleshooting

If the LED doesn't toggle:

1. **Verify the pin is configured as GPIO** (not muxed to another function)
2. **Check pin direction** - must be output mode
3. **Verify voltage level** - i.MX93 uses 3.3V logic (3300 mV)
4. **Check if another process** is controlling the pin

## Finding the Correct Pin

To find which CoreModel pin corresponds to a Linux GPIO:

1. Run the list example to see available pins:

   ```bash
   ./coremodel-list 10.11.61.3:1900
   ```

2. Monitor all pins while toggling from Linux:

   ```bash
   # In terminal 1 (CoreModel):
   ./coremodel-gpio-rw 10.11.61.3:1900 iomuxc 0 1 2 3 4 5 6 7 8 9 10
   
   # In terminal 2 (Linux on VM):
   gpioset gpiochip0 4=1
   gpioset gpiochip0 4=0
   ```

3. Watch which pin shows voltage changes in the CoreModel output
