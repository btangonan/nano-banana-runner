#!/usr/bin/env bash

# ============================================================================
# Bulletproof Startup Script for NN Image Analyzer
# ============================================================================
# This script ensures clean startup by:
# - Killing ALL old instances (no more stale servers!)
# - Clearing caches and temporary files
# - Starting fresh servers with health checks
# - Providing clear status and logging
# ============================================================================

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${SCRIPT_DIR}"
PROXY_DIR="${PROJECT_ROOT}/apps/nn/proxy"
GUI_DIR="${PROJECT_ROOT}/apps/nn/apps/gui"
PROXY_PORT=8787
GUI_PORT=5174
VITE_HMR_PORT=24678
LOG_DIR="${PROJECT_ROOT}/logs"
PID_FILE="${PROJECT_ROOT}/.nn-servers.pid"
LOCK_FILE="${PROJECT_ROOT}/.nn-startup.lock"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# Utility Functions
# ============================================================================

log() {
    echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
    exit 1
}

# Check if a port is in use
is_port_in_use() {
    lsof -i :$1 >/dev/null 2>&1
}

# Kill processes on a specific port
kill_port() {
    local port=$1
    local name=$2
    
    if is_port_in_use $port; then
        log "Killing processes on port $port ($name)..."
        
        # Get PIDs listening on the port
        local pids=$(lsof -ti :$port 2>/dev/null || true)
        
        if [ -n "$pids" ]; then
            for pid in $pids; do
                log "  Killing PID $pid..."
                kill -TERM $pid 2>/dev/null || true
                sleep 0.5
                # Force kill if still running
                if kill -0 $pid 2>/dev/null; then
                    kill -KILL $pid 2>/dev/null || true
                fi
            done
        fi
    fi
}

# Wait for port to be available
wait_for_port_free() {
    local port=$1
    local max_wait=10
    local waited=0
    
    while is_port_in_use $port && [ $waited -lt $max_wait ]; do
        sleep 1
        waited=$((waited + 1))
    done
    
    if is_port_in_use $port; then
        error "Port $port still in use after ${max_wait}s"
    fi
}

# Wait for service to be healthy
wait_for_service() {
    local url=$1
    local name=$2
    local max_wait=30
    local waited=0
    
    log "Waiting for $name to be ready..."
    
    while [ $waited -lt $max_wait ]; do
        if curl -s -o /dev/null -w "%{http_code}" "$url" | grep -q "200\|302\|304"; then
            success "$name is ready!"
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
        echo -n "."
    done
    echo ""
    
    error "$name failed to start after ${max_wait}s"
}

# ============================================================================
# Cleanup Functions
# ============================================================================

cleanup_all() {
    log "Starting comprehensive cleanup..."
    
    # Kill processes by port
    kill_port $PROXY_PORT "Proxy Server"
    # Note: GUI_PORT and VITE_HMR_PORT are kept for backward compatibility
    # in case old processes are still running
    kill_port $GUI_PORT "Old GUI Server (if any)"
    kill_port $VITE_HMR_PORT "Old Vite HMR (if any)"
    
    # Kill all pnpm dev processes in our directories
    log "Killing all pnpm dev processes..."
    pkill -f "pnpm.*dev.*gemini.*image.*analyzer" 2>/dev/null || true
    pkill -f "node.*proxy.*8787" 2>/dev/null || true
    pkill -f "node.*vite.*5174" 2>/dev/null || true
    
    # Kill any node processes running our code
    log "Killing stray node processes..."
    pkill -f "node.*nn-batch-relay" 2>/dev/null || true
    pkill -f "node.*nn.*gui" 2>/dev/null || true
    
    # Clean up PID file
    if [ -f "$PID_FILE" ]; then
        log "Cleaning up PID file..."
        if [ -r "$PID_FILE" ]; then
            while IFS= read -r pid; do
                if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                    kill -TERM "$pid" 2>/dev/null || true
                fi
            done < "$PID_FILE"
        fi
        rm -f "$PID_FILE"
    fi
    
    # Wait for ports to be free
    wait_for_port_free $PROXY_PORT
    # Also clean old ports if they were in use
    wait_for_port_free $GUI_PORT
    wait_for_port_free $VITE_HMR_PORT
    
    success "Cleanup complete!"
}

clear_caches() {
    log "Clearing caches..."
    
    # Clear Vite cache
    if [ -d "${GUI_DIR}/node_modules/.vite" ]; then
        rm -rf "${GUI_DIR}/node_modules/.vite"
        log "  Cleared Vite cache"
    fi
    
    # Clear .cache directories
    find "$PROJECT_ROOT" -type d -name ".cache" -exec rm -rf {} + 2>/dev/null || true
    
    # Clear temp files
    find "$PROJECT_ROOT" -name "*.tmp" -delete 2>/dev/null || true
    find "$PROJECT_ROOT" -name ".DS_Store" -delete 2>/dev/null || true
    
    success "Caches cleared!"
}

# ============================================================================
# Startup Functions
# ============================================================================

start_proxy() {
    log "Starting proxy server..."
    
    cd "$PROXY_DIR"
    
    # Create log directory
    mkdir -p "$LOG_DIR"
    
    # Start proxy in background
    nohup pnpm dev > "${LOG_DIR}/proxy.log" 2>&1 &
    local pid=$!
    echo $pid >> "$PID_FILE"
    
    log "  Proxy started with PID $pid"
    
    # Wait for it to be ready
    wait_for_service "http://127.0.0.1:${PROXY_PORT}/healthz" "Proxy"
}

build_gui_if_needed() {
    log "Checking if GUI needs to be built..."
    
    if [ ! -d "${GUI_DIR}/dist" ]; then
        log "GUI dist not found, building..."
        cd "$GUI_DIR"
        pnpm build
        success "GUI built successfully!"
    else
        log "GUI dist exists, skipping build"
    fi
}

verify_services() {
    log "Verifying services..."
    
    # Check proxy
    if curl -s "http://127.0.0.1:${PROXY_PORT}/healthz" | grep -q "ok"; then
        success "Proxy health check passed"
    else
        error "Proxy health check failed"
    fi
    
    # Check if batch routes are registered
    if curl -I "http://127.0.0.1:${PROXY_PORT}/batch/submit" 2>/dev/null | head -1 | grep -v "404"; then
        success "Batch routes registered correctly"
    else
        warning "Batch routes may not be registered"
    fi
    
    # Check GUI (served statically by proxy)
    if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PROXY_PORT}/app/" | grep -q "200\|304"; then
        success "GUI is accessible at /app/"
    else
        error "GUI is not accessible at /app/"
    fi
}

# ============================================================================
# Command Functions
# ============================================================================

cmd_start() {
    log "Starting NN Image Analyzer service..."
    
    # Check for lock file
    if [ -f "$LOCK_FILE" ]; then
        error "Another instance is already starting. Remove $LOCK_FILE if this is an error."
    fi
    
    # Create lock file
    touch "$LOCK_FILE"
    trap "rm -f $LOCK_FILE" EXIT
    
    # Cleanup first
    cleanup_all
    
    # Clear caches if requested
    if [[ "${1:-}" == "--clear-cache" ]]; then
        clear_caches
    fi
    
    # Build GUI if needed
    build_gui_if_needed
    
    # Start proxy server (serves both API and GUI)
    start_proxy
    sleep 2  # Give proxy time to fully initialize
    
    # Verify everything is working
    verify_services
    
    # Remove lock file
    rm -f "$LOCK_FILE"
    
    echo ""
    success "Service started successfully!"
    echo ""
    echo "  🚀 Proxy API: http://127.0.0.1:${PROXY_PORT}"
    echo "  🎨 GUI: http://127.0.0.1:${PROXY_PORT}/app/"
    echo ""
    echo "  📝 Logs: ${LOG_DIR}/"
    echo "  🔧 PID file: ${PID_FILE}"
    echo ""
    echo "  To stop: $0 stop"
    echo "  To check status: $0 status"
}

cmd_stop() {
    log "Stopping NN Image Analyzer services..."
    cleanup_all
    success "All services stopped!"
}

cmd_restart() {
    log "Restarting NN Image Analyzer services..."
    cmd_stop
    sleep 2
    cmd_start "$@"
}

cmd_status() {
    echo "NN Image Analyzer Service Status"
    echo "================================"
    echo ""
    
    # Check proxy (serves both API and GUI)
    if is_port_in_use $PROXY_PORT; then
        success "Proxy Server: Running on port $PROXY_PORT"
        echo "  PIDs: $(lsof -ti :$PROXY_PORT | tr '\n' ' ')"
        echo "  API: http://127.0.0.1:${PROXY_PORT}"
        echo "  GUI: http://127.0.0.1:${PROXY_PORT}/app/"
    else
        warning "Proxy Server: Not running"
    fi
    
    # Check for stray processes
    echo ""
    echo "Checking for stray processes..."
    local stray_count=$(pgrep -f "pnpm.*dev.*gemini.*image.*analyzer" | wc -l | tr -d ' ')
    if [ "$stray_count" -gt "0" ]; then
        warning "Found $stray_count stray pnpm processes"
        echo "  Run '$0 cleanup' to remove them"
    else
        success "No stray processes found"
    fi
}

cmd_cleanup() {
    log "Performing aggressive cleanup..."
    cleanup_all
    clear_caches
    success "Aggressive cleanup complete!"
}

cmd_logs() {
    if [ ! -d "$LOG_DIR" ]; then
        error "No logs found at $LOG_DIR"
    fi
    
    echo "Showing recent logs..."
    echo ""
    echo "=== PROXY SERVER LOGS (includes API and GUI) ==="
    tail -n 30 "${LOG_DIR}/proxy.log" 2>/dev/null || echo "No proxy logs"
}

# ============================================================================
# Main
# ============================================================================

main() {
    # Ensure we're in the right directory
    if [ ! -f "${PROJECT_ROOT}/package.json" ]; then
        error "Not in project root directory. Please run from: ${PROJECT_ROOT}"
    fi
    
    # Parse command
    case "${1:-start}" in
        start)
            cmd_start "${@:2}"
            ;;
        stop)
            cmd_stop
            ;;
        restart)
            cmd_restart "${@:2}"
            ;;
        status)
            cmd_status
            ;;
        cleanup)
            cmd_cleanup
            ;;
        logs)
            cmd_logs
            ;;
        *)
            echo "Usage: $0 {start|stop|restart|status|cleanup|logs} [options]"
            echo ""
            echo "Commands:"
            echo "  start [--clear-cache]  Start all services (with optional cache clear)"
            echo "  stop                   Stop all services"
            echo "  restart                Restart all services"
            echo "  status                 Show service status"
            echo "  cleanup                Aggressive cleanup of all processes and caches"
            echo "  logs                   Show recent logs"
            exit 1
            ;;
    esac
}

# Run main function
main "$@"