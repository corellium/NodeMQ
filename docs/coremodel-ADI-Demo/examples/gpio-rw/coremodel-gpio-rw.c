/*
 * Copyright (C) 2025 Corellium LLC
 * All rights reserved.
 */

#include <stdio.h>
#include <errno.h>
#include <string.h>
#include <stdlib.h>
#include <signal.h>
#include <sys/select.h>

#include <coremodel.h>

/* GPIO pin configuration structure */
typedef struct {
    char *bank_name;    // GPIO bank name (e.g., "gpio1")
    unsigned pin_index;      // Pin number within the GPIO bank
    void *handle;            // CoreModel GPIO handle
    int is_output;           // 1 = output (driving), 0 = input (monitoring)
    int voltage_mv;          // Current/target voltage in millivolts
} gpio_config_t;

/* Global state variables */
static volatile int running = 1;

/* Function prototypes */
static void print_usage(const char *prog_name);
static int parse_arguments(int argc, char *argv[], char **vm_addr,
                          gpio_config_t **configs, int *count);
static void gpio_notify_callback(void *priv, int mvolt);
static int setup_gpio_pins(const char *vm_addr,
                           gpio_config_t *configs, int count);
static void cleanup_gpio_pins(gpio_config_t *configs, int count);
static void print_help(void);
static int process_command(const char *cmd,
                          gpio_config_t **configs, int *count);
static void sigint_handler(int sig);
static int main_loop_with_stdin(gpio_config_t *configs, int count);

/* Print usage message */
static void print_usage(const char *prog_name)
{
    printf("usage: %s <address[:port]> <pin_spec> [<pin_spec> ...]\n\n", prog_name);
    printf("Where <pin_spec> is:\n");
    printf("  <[gpio:]pin>          - Monitor pin (input mode)\n");
    printf("  <[gpio:]pin>=<mv>     - Drive pin at specified voltage (output mode)\n");
    printf("The [gpio:] prefix is required for the first pin. For subsequent pins,\n");
    printf("it defaults to the same as the previous pin.\n");
    printf("Voltage range: 0-5000 mV\n");
    printf("\n");
    printf("Examples:\n");
    printf("  %s 10.10.0.3:1900 iomuxc:0 1=3300 2 3=1800\n", prog_name);
    printf("    (Monitor pins 0 and 2, drive pin 1 at 3.3V and pin 3 at 1.8V)\n");
    printf("\n");
    printf("  %s 10.10.0.3:1900 iomuxc:8=3300\n", prog_name);
    printf("    (Drive pin 8 at 3.3V for LED control)\n");
    printf("\n");
    printf("  %s 10.10.0.3:1900 pcal6524:5\n", prog_name);
    printf("    (Monitor pin 5 for button press)\n");
    printf("\n");
    printf("  %s 10.10.0.3:1900 iomuxc:8=3300 16=3300 17=3300 pcal6524:5 6\n", prog_name);
    printf("    (For the iMX93 drive all three LED to 3.3V and Monitor both buttons)\n");
}

/* Parse command-line arguments and populate GPIO configuration */
static int parse_arguments(int argc, char *argv[], char **vm_addr,
                          gpio_config_t **configs, int *count)
{
    int idx, num_pins;
    gpio_config_t *pin_configs;
    char *pin_bank = NULL;
    char *endptr;

    /* Validate function parameters are not null */
    if (!argv || !vm_addr || !configs || !count) {
        fprintf(stderr, "error: invalid parameters to parse_arguments.\n");
        return -1;
    }

    /* Check minimum arguments: program name, address, and at least one pin */
    if (argc < 3) {
        print_usage(argv[0]);
        return -1;
    }

    /* Validate VM address */
    if (!argv[1] || strlen(argv[1]) == 0) {
        fprintf(stderr, "error: VM address cannot be empty.\n");
        print_usage(argv[0]);
        return -1;
    }
    *vm_addr = argv[1];

    /* Calculate number of pin specifications */
    num_pins = argc - 2;

    /* Allocate configuration array */
    pin_configs = calloc(num_pins, sizeof(gpio_config_t));
    if (!pin_configs) {
        fprintf(stderr, "error: out of memory allocating %d pin configurations.\n", num_pins);
        return -1;
    }

    /* Parse each pin specification */
    for (idx = 0; idx < num_pins; idx++) {
        char *pin_spec = argv[2 + idx];
        char *pin_name;
        char *pin_value;

        pin_name = strchr(pin_spec, ':');

        if (pin_bank == NULL) {
            if (pin_name == NULL) {
                fprintf(stderr, "error: first GPIO bank name cannot be empty.\n");
                print_usage(argv[0]);
                return -1;
            } else {
                pin_bank = pin_spec;
                *pin_name = '\0';  /* End the pin_bank string where the colon was */
                pin_name += 1;  /* Move to the start of the pin number */
                if (strlen(pin_bank) == 0) {
                    fprintf(stderr, "error: first GPIO bank name cannot be empty.\n");
                    print_usage(argv[0]);
                    return -1;
                }
            }
        } else {
            if (pin_name == NULL) { /* No colon found, use previous bank */
                pin_name = pin_spec;
            } else {
                *pin_name = '\0';  /* End the pin_bank string where the colon was */
                pin_name += 1;  /* Move to the start of the pin number */
                if (strlen(pin_spec) != 0) {
                    pin_bank = pin_spec;
                }
            }
        }

        pin_configs[idx].bank_name = pin_bank;
        pin_value = strchr(pin_name, '=');

        if (pin_value) {
            /* Output pin: <pin>=<voltage> */
            *pin_value = '\0';  /* End the pin_name string where the equals sign was */
            pin_value += 1;  /* Move to the start of the voltage value */

            /* Validate pin number part is not empty */
            if (strlen(pin_name) == 0) {
                fprintf(stderr, "error: pin number missing in specification '%s='.\n", pin_name);
                free(pin_configs);
                return -1;
            }

            /* Parse pin number */
            pin_configs[idx].pin_index = strtoul(pin_name, &endptr, 0);
            if (*endptr != '\0') {
                fprintf(stderr, "error: invalid pin number '%s'.\n", pin_name);
                free(pin_configs);
                return -1;
            }

            /* Validate voltage part is not empty */
            if (strlen(pin_value) == 0) {
                fprintf(stderr, "error: voltage value missing in specification '%s='.\n", pin_name);
                free(pin_configs);
                return -1;
            }

            /* Parse voltage */
            pin_configs[idx].voltage_mv = strtol(pin_value, &endptr, 0);
            if (*endptr != '\0') {
                fprintf(stderr, "error: invalid voltage value '%s'.\n", pin_value);
                free(pin_configs);
                return -1;
            }

            /* Validate voltage range */
            if (pin_configs[idx].voltage_mv < 0 || pin_configs[idx].voltage_mv > 5000) {
                fprintf(stderr, "error: voltage %d mV is out of range (valid range: 0-5000).\n",
                       pin_configs[idx].voltage_mv);
                free(pin_configs);
                return -1;
            }

            pin_configs[idx].is_output = 1;
            pin_configs[idx].handle = NULL;

        } else {
            /* Input pin: <pin> */
            pin_configs[idx].pin_index = strtoul(pin_name, &endptr, 0);
            if (*endptr != '\0') {
                fprintf(stderr, "error: invalid pin number '%s'.\n", pin_name);
                free(pin_configs);
                return -1;
            }

            pin_configs[idx].is_output = 0;
            pin_configs[idx].voltage_mv = 0;
            pin_configs[idx].handle = NULL;
        }
    }

    *configs = pin_configs;
    *count = num_pins;

    return 0;
}

/* GPIO notification callback - called when monitored pin voltage changes */
static void gpio_notify_callback(void *priv, int mvolt)
{
    gpio_config_t *pin = (gpio_config_t *)priv;
    printf("GPIO[%s:%u] = %d mV\n", pin->bank_name, pin->pin_index, mvolt);
    pin->voltage_mv = mvolt;  /* Update current voltage */
    fflush(stdout);
}

/* GPIO function table for CoreModel callbacks */
static const coremodel_gpio_func_t gpio_func = {
    .notify = gpio_notify_callback
};

/* Setup GPIO pins - connect to VM and attach all configured pins */
static int setup_gpio_pins(const char *vm_addr,
                          gpio_config_t *configs, int count)
{
    int res, idx;

    /* Validate input parameters */
    if (!vm_addr || !configs || count <= 0) {
        fprintf(stderr, "error: invalid parameters to setup_gpio_pins.\n");
        return -1;
    }

    /* Connect to VM */
    res = coremodel_connect(vm_addr);
    if (res) {
        fprintf(stderr, "error: failed to connect to VM at '%s': %s.\n",
                vm_addr, strerror(-res));
        return -1;
    }

    /* Attach each GPIO pin */
    for (idx = 0; idx < count; idx++) {
        configs[idx].handle = coremodel_attach_gpio(configs[idx].bank_name, configs[idx].pin_index,
                                                     &gpio_func, &configs[idx]);
        if (!configs[idx].handle) {
            fprintf(stderr, "error: failed to attach GPIO pin %u on bank '%s'.\n",
                   configs[idx].pin_index, configs[idx].bank_name);

            /* Cleanup already attached pins before returning */
            for (int j = 0; j < idx; j++) {
                if (configs[j].handle) {
                    coremodel_detach(configs[j].handle);
                    configs[j].handle = NULL;
                }
            }
            coremodel_disconnect();
            return -1;
        }

        /* For output pins, set initial voltage */
        if (configs[idx].is_output) {
            coremodel_gpio_set(configs[idx].handle, 1, configs[idx].voltage_mv);
        }
    }

    return 0;
}

/* Cleanup GPIO pins - detach all pins and disconnect from VM */
static void cleanup_gpio_pins(gpio_config_t *configs, int count)
{
    int idx;

    /* Detach all GPIO pin interfaces */
    if (configs && count > 0) {
        for (idx = 0; idx < count; idx++) {
            if (configs[idx].handle) {
                coremodel_detach(configs[idx].handle);
                configs[idx].handle = NULL;  /* Prevent double-free */
            }
        }

        /* Free configuration array */
        free(configs);
    }

    /* Disconnect from VM - safe to call even if not connected */
    coremodel_disconnect();
}

/* Print help message showing available runtime commands */
static void print_help(void)
{
    printf("\nAvailable commands:\n");
    printf("  set <pin> <voltage>       - Drive pin at specified voltage (mV)\n");
    printf("  input <pin>               - Switch pin to input/monitoring mode\n");
    printf("  output <pin> <voltage>    - Switch pin to output mode at voltage (mV)\n");
    printf("  add <gpio> <bank> <pin>   - Add a new GPIO pin configuration\n");
    printf("  status                    - Display current configuration of all pins\n");
    printf("  help                      - Display this command reference\n");
    printf("  quit                      - Exit application\n");
    printf("\n");
}

/* Find GPIO configuration by pin index */
static gpio_config_t* find_pin_config(gpio_config_t *configs, int count, unsigned pin_index)
{
    int idx;
    for (idx = 0; idx < count; idx++) {
        if (configs[idx].pin_index == pin_index) {
            return &configs[idx];
        }
    }
    return NULL;
}

/* Process runtime command from user input */
static int process_command(const char *cmd,
                          gpio_config_t **config_handle, int *counts)
{
    char cmd_buf[256];
    char *token;
    char *saveptr;
    gpio_config_t *configs = *config_handle;
    gpio_config_t *pin;
    unsigned pin_num;
    int voltage;
    int count = *counts;
    char *endptr;

    /* Copy command to buffer for tokenization */
    strncpy(cmd_buf, cmd, sizeof(cmd_buf) - 1);
    cmd_buf[sizeof(cmd_buf) - 1] = '\0';

    /* Remove trailing newline if present */
    size_t len = strlen(cmd_buf);
    if (len > 0 && cmd_buf[len - 1] == '\n') {
        cmd_buf[len - 1] = '\0';
    }

    /* Get first token (command name) */
    token = strtok_r(cmd_buf, " \t", &saveptr);
    if (!token || strlen(token) == 0) {
        return 0;  /* Empty command, continue */
    }

    /* Handle 'quit' command */
    if (strcmp(token, "quit") == 0 || strcmp(token, "exit") == 0) {
        return -1;  /* Signal to exit */
    }

    /* Handle 'help' command */
    if (strcmp(token, "help") == 0) {
        print_help();
        return 0;
    }

    /* Handle 'status' command */
    if (strcmp(token, "status") == 0) {
        int idx;
        printf("\nCurrent GPIO configuration:\n");
        printf("Bank     Pin  Mode    Voltage\n");
        printf("-------- ---  ------  -------\n");
        for (idx = 0; idx < count; idx++) {
            printf("%-8s  %-3u  %-6s  %d mV\n",
                   configs[idx].bank_name,
                   configs[idx].pin_index,
                   configs[idx].is_output ? "output" : "input",
                   configs[idx].voltage_mv);
        }
        printf("\n");
        return 0;
    }

    /* Handle 'set' command: set <pin> <voltage> */
    if (strcmp(token, "set") == 0) {
        /* Get pin number */
        token = strtok_r(NULL, " \t", &saveptr);
        if (!token) {
            fprintf(stderr, "error: 'set' command requires pin number and voltage.\n");
            return 0;
        }

        pin_num = strtoul(token, &endptr, 0);
        if (*endptr != '\0') {
            fprintf(stderr, "error: invalid pin number '%s'.\n", token);
            return 0;
        }

        /* Get voltage */
        token = strtok_r(NULL, " \t", &saveptr);
        if (!token) {
            fprintf(stderr, "error: 'set' command requires voltage value.\n");
            return 0;
        }

        voltage = strtol(token, &endptr, 0);
        if (*endptr != '\0') {
            fprintf(stderr, "error: invalid voltage value '%s'.\n", token);
            return 0;
        }

        /* Validate voltage range */
        if (voltage < 0 || voltage > 5000) {
            fprintf(stderr, "error: voltage %d mV is out of range (valid range: 0-5000 mV).\n", voltage);
            return 0;
        }

        /* Find pin configuration */
        pin = find_pin_config(configs, count, pin_num);
        if (!pin) {
            fprintf(stderr, "error: pin %u is not configured.\n", pin_num);
            return 0;
        }

        /* Update pin voltage */
        pin->voltage_mv = voltage;
        if (!pin->is_output) {
            /* Switch to output mode if currently input */
            pin->is_output = 1;
        }
        coremodel_gpio_set(pin->handle, 1, voltage);
        printf("Pin %u set to %d mV (output mode)\n", pin_num, voltage);

        return 0;
    }

    /* Handle 'input' command: input <pin> */
    if (strcmp(token, "input") == 0) {
        /* Get pin number */
        token = strtok_r(NULL, " \t", &saveptr);
        if (!token) {
            fprintf(stderr, "error: 'input' command requires pin number.\n");
            return 0;
        }

        pin_num = strtoul(token, &endptr, 0);
        if (*endptr != '\0') {
            fprintf(stderr, "error: invalid pin number '%s'.\n", token);
            return 0;
        }

        /* Find pin configuration */
        pin = find_pin_config(configs, count, pin_num);
        if (!pin) {
            fprintf(stderr, "error: pin %u is not configured.\n", pin_num);
            return 0;
        }

        /* Switch to input mode */
        pin->is_output = 0;
        pin->voltage_mv = 0;
        coremodel_gpio_set(pin->handle, 0, 0);
        printf("Pin %u switched to input/monitoring mode\n", pin_num);

        return 0;
    }

    /* Handle 'output' command: output <pin> <voltage> */
    if (strcmp(token, "output") == 0) {
        /* Get pin number */
        token = strtok_r(NULL, " \t", &saveptr);
        if (!token) {
            fprintf(stderr, "error: 'output' command requires pin number and voltage.\n");
            return 0;
        }

        pin_num = strtoul(token, &endptr, 0);
        if (*endptr != '\0') {
            fprintf(stderr, "error: invalid pin number '%s'.\n", token);
            return 0;
        }

        /* Get voltage */
        token = strtok_r(NULL, " \t", &saveptr);
        if (!token) {
            fprintf(stderr, "error: 'output' command requires voltage value.\n");
            return 0;
        }

        voltage = strtol(token, &endptr, 0);
        if (*endptr != '\0') {
            fprintf(stderr, "error: invalid voltage value '%s'.\n", token);
            return 0;
        }

        /* Validate voltage range */
        if (voltage < 0 || voltage > 5000) {
            fprintf(stderr, "error: voltage %d mV is out of range (valid range: 0-5000 mV).\n", voltage);
            return 0;
        }

        /* Find pin configuration */
        pin = find_pin_config(configs, count, pin_num);
        if (!pin) {
            fprintf(stderr, "error: pin %u is not configured.\n", pin_num);
            return 0;
        }

        /* Switch to output mode */
        pin->is_output = 1;
        pin->voltage_mv = voltage;
        coremodel_gpio_set(pin->handle, 1, voltage);
        printf("Pin %u switched to output mode at %d mV\n", pin_num, voltage);

        return 0;
    }

    /* Handle 'add' command: add <GPIO> <pin> */
    if (strcmp(token, "add") == 0) {
        char *pin_bank = NULL;
        /* Get GPIO bank */
        token = strtok_r(NULL, " \t", &saveptr);
        if (!token) {
            fprintf(stderr, "error: 'add' command requires gpio bank and pin number.\n");
            return 0;
        }

        pin_bank = token;

        /* Get voltage */
        token = strtok_r(NULL, " \t", &saveptr);
        if (!token) {
            fprintf(stderr, "error: 'add' command requires pin number.\n");
            return 0;
        }

        pin_num = strtoul(token, &endptr, 0);
        if (*endptr != '\0') {
            fprintf(stderr, "error: invalid pin number '%s'.\n", token);
            return 0;
        }

        /* Allocate configuration array */
        pin = realloc(configs, sizeof(gpio_config_t) * (count + 1));
        if (!pin) {
            fprintf(stderr, "error: out of memory allocating new pin.\n");
            return 0;
        }
        configs = pin;
        pin = &configs[count];
        pin->bank_name = calloc(strlen(pin_bank) + 1, sizeof(char));
        memcpy(pin->bank_name, pin_bank, strlen(pin_bank));
        pin->pin_index = pin_num;
        pin->is_output = 0;
        pin->voltage_mv = 0;
        pin->handle = coremodel_attach_gpio(pin->bank_name, pin->pin_index,
                                                     &gpio_func, pin);
        if (!pin->handle) {
            fprintf(stderr, "error: failed to attach GPIO pin %u on bank '%s'.\n",
                   pin->pin_index, pin->bank_name);
            return -1;
        }

        *config_handle = configs;
        *counts = count + 1;
        return 0;
    }

    /* Unknown command */
    fprintf(stderr, "error: unknown command '%s'. Type 'help' for available commands.\n", token);
    return 0;
}

/* SIGINT handler for graceful shutdown */
static void sigint_handler(int sig)
{
    (void)sig;  /* Unused parameter */
    running = 0;
}

/* Custom main loop with stdin integration */
static int main_loop_with_stdin(gpio_config_t *configs, int count)
{
    fd_set readfds, writefds;
    int nfds, res;
    char cmd_buf[256];
    struct timeval timeout;

    /* Validate input parameters */
    if (!configs || count <= 0) {
        fprintf(stderr, "error: invalid parameters to main_loop_with_stdin.\n");
        return -1;
    }

    printf("\nGPIO bidirectional example running. Type 'help' for commands.\n");
    printf("> ");
    fflush(stdout);

    while (running) {
        /* Initialize fd_sets */
        FD_ZERO(&readfds);
        FD_ZERO(&writefds);

        /* Add stdin to read set */
        FD_SET(0, &readfds);
        nfds = 1;

        /* Prepare CoreModel file descriptors */
        nfds = coremodel_preparefds(nfds, &readfds, &writefds);
        if (nfds < 0) {
            fprintf(stderr, "error: coremodel_preparefds() failed.\n");
            return -1;
        }

        /* Set timeout for select (100ms) */
        timeout.tv_sec = 0;
        timeout.tv_usec = 100000;

        /* Wait for activity on file descriptors */
        res = select(nfds, &readfds, &writefds, NULL, &timeout);

        if (res < 0) {
            if (errno == EINTR) {
                /* Interrupted by signal, check running flag */
                continue;
            }
            fprintf(stderr, "error: select() failed: %s.\n", strerror(errno));
            return -1;
        }

        /* Process CoreModel events */
        if (res > 0) {
            res = coremodel_processfds(&readfds, &writefds);
            if (res) {
                fprintf(stderr, "error: coremodel_processfds() failed: %s.\n", strerror(-res));
                return -1;
            }
        }

        /* Check if stdin has data */
        if (FD_ISSET(0, &readfds)) {
            if (fgets(cmd_buf, sizeof(cmd_buf), stdin)) {
                /* Process command */
                res = process_command(cmd_buf, &configs, &count);
                if (res < 0) {
                    /* Quit command received */
                    break;
                }

                /* Print prompt for next command */
                printf("> ");
                fflush(stdout);
            } else {
                /* EOF on stdin (Ctrl+D) or read error */
                if (ferror(stdin)) {
                    fprintf(stderr, "error: failed to read from stdin.\n");
                    return -1;
                }
                printf("\n");
                break;
            }
        }
    }

    return 0;
}

int main(int argc, char *argv[])
{
    char *vm_addr = NULL;
    gpio_config_t *configs = NULL;
    int count = 0;
    int res;

    /* Register SIGINT handler for graceful shutdown */
    if (signal(SIGINT, sigint_handler) == SIG_ERR) {
        fprintf(stderr, "error: failed to register SIGINT handler.\n");
        return 1;
    }

    /* Parse command-line arguments */
    res = parse_arguments(argc, argv, &vm_addr, &configs, &count);
    if (res < 0) {
        /* parse_arguments handles its own cleanup and error messages */
        return 1;
    }

    /* Setup GPIO pins and connect to VM */
    res = setup_gpio_pins(vm_addr, configs, count);
    if (res < 0) {
        /* setup_gpio_pins handles partial cleanup, but we need to free configs */
        if (configs) {
            free(configs);
        }
        return 1;
    }

    /* Enter main loop with stdin integration */
    res = main_loop_with_stdin(configs, count);

    /* Cleanup on exit - cleanup_gpio_pins handles NULL configs safely */
    cleanup_gpio_pins(configs, count);

    if (res < 0) {
        return 1;
    }

    return 0;
}
