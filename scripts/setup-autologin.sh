#!/bin/bash

# Auto-login Configuration Script
# Configures serial console auto-login and startup script for user "user"

set -e

USERNAME="user"
USER_HOME="/home/$USERNAME"
# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

# Main execution
main() {
    print_info "Starting auto-login configuration for serial console..."
    
    # Check if running as root
    if [ "$EUID" -ne 0 ]; then
        print_error "This script must be run as root (use sudo)"
        exit 1
    fi
    
    # Check if user exists
    if ! id "$USERNAME" &>/dev/null; then
        print_error "User '$USERNAME' does not exist"
        exit 1
    fi
    
    # Configure serial console auto-login
    print_info "Configuring serial console auto-login for ttyAMA0..."
    mkdir -p /etc/systemd/system/serial-getty@ttyAMA0.service.d/
    tee /etc/systemd/system/serial-getty@ttyAMA0.service.d/autologin.conf > /dev/null << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $USERNAME --noclear %I \$TERM
EOF
    
    print_info "Systemd configuration created"
    
    # Copy start-coremodel.sh to user home directory
    print_info "Copying start-coremodel.sh to $USER_HOME..."
    print_info "Script directory: $SCRIPT_DIR"
    print_info "Looking for: $SCRIPT_DIR/start-coremodel.sh"
    
    if [ ! -f "$SCRIPT_DIR/start-coremodel.sh" ]; then
        print_error "start-coremodel.sh NOT FOUND at $SCRIPT_DIR/start-coremodel.sh"
        print_error "Directory contents:"
        ls -la "$SCRIPT_DIR/" | head -20
        print_warning "Skipping start-coremodel.sh copy - you'll need to place it manually"
    else
        print_info "✓ Found start-coremodel.sh"
        cp "$SCRIPT_DIR/start-coremodel.sh" "$USER_HOME/"
        chmod +x "$USER_HOME/start-coremodel.sh"
        chown $USERNAME:$USERNAME "$USER_HOME/start-coremodel.sh"
        print_info "✅ start-coremodel.sh copied to $USER_HOME/"
    fi
    
    # Setup .bash_profile with auto-start loop
    print_info "Configuring .bash_profile for auto-start..."
    sudo tee "$USER_HOME/.bash_profile" > /dev/null << 'EOF'
# Auto-start coremodel on login
while true; do
    /home/user/start-coremodel.sh
done
EOF
    
    chown $USERNAME:$USERNAME "$USER_HOME/.bash_profile"
    chmod 644 "$USER_HOME/.bash_profile"
    
    print_info "✅ Auto-login configuration completed successfully!"
    print_info ""
    print_info "Configuration summary:"
    print_info "  - Serial console (ttyAMA0) will auto-login as '$USERNAME'"
    print_info "  - start-coremodel.sh copied to $USER_HOME/"
    print_info "  - .bash_profile configured to run start-coremodel.sh in a loop"
    print_info ""
    print_info "Reloading systemd and restarting serial console service..."
    systemctl daemon-reload
    systemctl restart serial-getty@ttyAMA0 || true
    print_info "The script will start automatically on next login to serial console"
}

# Run main function
main "$@"