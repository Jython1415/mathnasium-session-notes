#!/bin/bash
# Runs daily smoke tests and logs results

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/test-results"
LOG_FILE="$LOG_DIR/smoke-test-$(date +%Y%m%d).log"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Run smoke tests
echo "========================================" >> "$LOG_FILE"
echo "Smoke Test Run: $(date)" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"

cd "$PROJECT_DIR"
uv run --script tests/test_smoke.py >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "✓ All smoke tests passed" >> "$LOG_FILE"
else
  echo "✗ Smoke tests failed (exit code: $EXIT_CODE)" >> "$LOG_FILE"
fi

echo "" >> "$LOG_FILE"

# Keep only last 30 days of logs
find "$LOG_DIR" -name "smoke-test-*.log" -mtime +30 -delete

exit $EXIT_CODE
