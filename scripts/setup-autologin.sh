#!/bin/bash

# Auto-login Configuration Script
# Configures Ubuntu 24.04 to automatically login as user "user"
# Supports GDM3 and LightDM display managers

set -e

USERNAME="user"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored messages
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Function to detect the display manager
detect_display_manager() {
    print_info "Detecting display manager..."
    
    # Check for GDM3
    if systemctl status gdm3 &>/dev/null || systemctl status gdm &>/dev/null; then
        echo "gdm3"
        return 0
    fi
    
    # Check for LightDM
    if systemctl status lightdm &>/dev/null; then
        echo "lightdm"
        return 0
    fi
    
    # Check default display manager file
    if [ -f /etc/X11/default-display-manager ]; then
        local dm_path=$(cat /etc/X11/default-display-manager)
        if [[ "$dm_path" == *"gdm"* ]]; then
            echo "gdm3"
            return 0
        elif [[ "$dm_path" == *"lightdm"* ]]; then
            echo "lightdm"
            return 0
        fi
    fi
    
    echo "unknown"
    return 1
}

# Function to configure GDM3 for auto-login
configure_gdm3() {
    local config_file="/etc/gdm3/custom.conf"
    
    print_info "Configuring GDM3 for auto-login..."
    
    # Check if config file exists
    if [ ! -f "$config_file" ]; then
        print_error "GDM3 configuration file not found: $config_file"
        return 1
    fi
    
    # Backup the original configuration
    if [ ! -f "${config_file}.backup" ]; then
        print_info "Creating backup of GDM3 configuration..."
        cp "$config_file" "${config_file}.backup"
    fi
    
    # Check if [daemon] section exists
    if grep -q "^\[daemon\]" "$config_file"; then
        # Section exists, check if auto-login is already configured
        if grep -q "^AutomaticLoginEnable" "$config_file"; then
            # Update existing settings
            sed -i "s/^AutomaticLoginEnable=.*/AutomaticLoginEnable=true/" "$config_file"
            sed -i "s/^AutomaticLogin=.*/AutomaticLogin=$USERNAME/" "$config_file"
        else
            # Add auto-login settings under [daemon] section
            sed -i "/^\[daemon\]/a AutomaticLoginEnable=true\nAutomaticLogin=$USERNAME" "$config_file"
        fi
    else
        # Add [daemon] section with auto-login settings
        echo -e "\n[daemon]\nAutomaticLoginEnable=true\nAutomaticLogin=$USERNAME" >> "$config_file"
    fi
    
    print_info "GDM3 configured successfully for user: $USERNAME"
    return 0
}

# Function to configure LightDM for auto-login
configure_lightdm() {
    local config_file="/etc/lightdm/lightdm.conf"
    
    print_info "Configuring LightDM for auto-login..."
    
    # Check if config file exists, create if it doesn't
    if [ ! -f "$config_file" ]; then
        print_warning "LightDM configuration file not found, creating: $config_file"
        mkdir -p /etc/lightdm
        touch "$config_file"
    fi
    
    # Backup the original configuration
    if [ ! -f "${config_file}.backup" ]; then
        print_info "Creating backup of LightDM configuration..."
        cp "$config_file" "${config_file}.backup"
    fi
    
    # Check if [Seat:*] section exists
    if grep -q "^\[Seat:\*\]" "$config_file"; then
        # Section exists, check if auto-login is already configured
        if grep -q "^autologin-user" "$config_file"; then
            # Update existing settings
            sed -i "s/^autologin-user=.*/autologin-user=$USERNAME/" "$config_file"
            sed -i "s/^autologin-user-timeout=.*/autologin-user-timeout=0/" "$config_file"
        else
            # Add auto-login settings under [Seat:*] section
            sed -i "/^\[Seat:\*\]/a autologin-user=$USERNAME\nautologin-user-timeout=0" "$config_file"
        fi
    else
        # Add [Seat:*] section with auto-login settings
        echo -e "\n[Seat:*]\nautologin-user=$USERNAME\nautologin-user-timeout=0" >> "$config_file"
    fi
    
    print_info "LightDM configured successfully for user: $USERNAME"
    return 0
}

# Main execution
main() {
    print_info "Starting auto-login configuration..."
    
    # Check if running as root
    if [ "$EUID" -ne 0 ]; then
        print_error "This script must be run as root (use sudo)"
        exit 1
    fi
    
    # Detect display manager
    display_manager=$(detect_display_manager)
    
    if [ "$display_manager" == "unknown" ]; then
        print_error "Unsupported or unknown display manager detected"
        print_error "This script supports GDM3 and LightDM only"
        print_error ""
        print_error "Manual configuration required:"
        print_error "For GDM3: Edit /etc/gdm3/custom.conf and add:"
        print_error "  [daemon]"
        print_error "  AutomaticLoginEnable=true"
        print_error "  AutomaticLogin=$USERNAME"
        print_error ""
        print_error "For LightDM: Edit /etc/lightdm/lightdm.conf and add:"
        print_error "  [Seat:*]"
        print_error "  autologin-user=$USERNAME"
        print_error "  autologin-user-timeout=0"
        exit 1
    fi
    
    print_info "Detected display manager: $display_manager"
    
    # Configure based on detected display manager
    case "$display_manager" in
        gdm3)
            if configure_gdm3; then
                print_info "Auto-login configuration completed successfully!"
                print_info "Please reboot the system for changes to take effect."
                exit 0
            else
                print_error "Failed to configure GDM3"
                exit 1
            fi
            ;;
        lightdm)
            if configure_lightdm; then
                print_info "Auto-login configuration completed successfully!"
                print_info "Please reboot the system for changes to take effect."
                exit 0
            else
                print_error "Failed to configure LightDM"
                exit 1
            fi
            ;;
        *)
            print_error "Unexpected error: Unknown display manager"
            exit 1
            ;;
    esac
}

# Run main function
main "$@"

