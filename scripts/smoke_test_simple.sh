#!/bin/bash
# Simple smoke test for session-notes using only curl (no dependencies)
# Designed to run on production server via cron

set -euo pipefail

PRODUCTION_URL="https://mathsense.com/session-notes/"

# Detect if running on server or locally
if [[ -d "${HOME}/public_html/session-notes" ]]; then
    # Running on server
    LOG_DIR="${HOME}/public_html/session-notes/test-results"
else
    # Running locally - use relative path
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    LOG_DIR="$(dirname "$SCRIPT_DIR")/test-results"
fi

LOG_FILE="${LOG_DIR}/smoke-test-$(date +%Y%m%d).log"

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Main test function
run_tests() {
    log "========================================"
    log "Session Notes Smoke Test"
    log "========================================"

    FAILED=0

    # Test 1: Site loads (HTTP 200)
    log "Test 1: Checking site accessibility..."
    if curl -f -s -o /dev/null -w "%{http_code}" "$PRODUCTION_URL" | grep -q "200"; then
        log "   ✓ Site loads (HTTP 200)"
    else
        log "   ✗ Site failed to load"
        FAILED=$((FAILED + 1))
    fi

    # Test 2: Application title present
    log "Test 2: Checking application title..."
    if curl -s "$PRODUCTION_URL" | grep -q "Session Notes Reviewer"; then
        log "   ✓ Application title found"
    else
        log "   ✗ Application title not found"
        FAILED=$((FAILED + 1))
    fi

    # Test 3: React app.jsx loads
    log "Test 3: Checking React application..."
    if curl -f -s -o /dev/null "${PRODUCTION_URL}app.jsx"; then
        log "   ✓ React app file exists"
    else
        log "   ✗ React app file missing"
        FAILED=$((FAILED + 1))
    fi

    # Test 4: API endpoint responds (even to empty POST)
    log "Test 4: Checking API endpoint..."
    API_RESPONSE=$(curl -s -X POST "${PRODUCTION_URL}api/index.php" \
        -H "Content-Type: application/json" \
        -d '{}' -w "%{http_code}" -o /dev/null)

    # API should return 400 (bad request) or 200, not 500 (server error) or 404
    if [[ "$API_RESPONSE" == "200" ]] || [[ "$API_RESPONSE" == "400" ]]; then
        log "   ✓ API endpoint responds (HTTP $API_RESPONSE)"
    else
        log "   ✗ API endpoint error (HTTP $API_RESPONSE)"
        FAILED=$((FAILED + 1))
    fi

    log "========================================"
    if [ $FAILED -eq 0 ]; then
        log "✓ All 4 tests PASSED"
        return 0
    else
        log "✗ $FAILED/4 tests FAILED"
        return 1
    fi
}

# Run tests and capture output to log file
{
    if run_tests; then
        exit 0
    else
        exit 1
    fi
} 2>&1 | tee -a "$LOG_FILE"

# Cleanup: Keep only last 30 days of logs
find "$LOG_DIR" -name "smoke-test-*.log" -type f -mtime +30 -delete 2>/dev/null || true
