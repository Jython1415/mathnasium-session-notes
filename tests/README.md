# Session Notes Reviewer - Test Suite

## Overview

Automated testing for the production session-notes reviewer application. Tests the complete workflow from file upload through AI review to results validation.

## Setup

### Prerequisites

1. Install Playwright and dependencies:
   ```bash
   uv pip install playwright
   playwright install chromium
   ```

2. Add test data:
   ```bash
   # Copy your test XLSX file to:
   cp /path/to/Digital\ Workout\ Plan\ Report.xlsx test-data/
   ```

## Running Tests

### Smoke Tests (Fast, ~10 seconds)

Basic health checks that verify the site is up and functional:

```bash
# Run directly
uv run --script tests/test_smoke.py

# Or via wrapper (same as cron job)
./scripts/run_smoke_tests.sh
```

**What it checks:**
- Site loads (HTTP 200)
- Application title present
- React app loaded
- File upload input exists

**Cost:** Free (no API calls)

### E2E Tests (Slow, ~60 seconds, ~$0.08 API cost)

Full end-to-end test with 55 rows and 12 validated test cases:

```bash
# Run E2E test
uv run --script tests/test_e2e_full.py

# Save results to log
uv run --script tests/test_e2e_full.py > test-results/e2e-$(date +%Y%m%d-%H%M%S).log 2>&1
```

**What it checks:**
- File upload successful
- All 55 rows process
- 7 positive test cases flagged (should flag)
- 5 negative test cases NOT flagged (should not flag)

**Cost:** ~$0.08 per run (Claude API usage)

## Test Data

**Location:** `test-data/Digital Workout Plan Report.xlsx` (gitignored)

**Structure:**
- 55 total rows
- 12 test cases (7 positive, 5 negative)
- 43 organic session notes

**Test Cases:** See `test-data/TEST_CASES.md` for complete documentation

**Success Criteria:**
- All 7 positive cases flagged (confidence ≥ 0.4)
- All 5 negative cases NOT flagged (confidence < 0.4)

## Automated Testing

### Daily Smoke Tests

Cron job runs at 8 AM daily:

```bash
# Edit crontab
crontab -e

# Add this line:
0 8 * * * /Users/Joshua/Documents/_programming/mathnasium/session-notes/scripts/run_smoke_tests.sh
```

**Logs:** `test-results/smoke-test-YYYYMMDD.log`

**Retention:** Last 30 days kept automatically

### Manual E2E Tests

Run manually when needed (weekly recommended):

```bash
uv run --script tests/test_e2e_full.py
```

## Test Results

### Directory Structure

```
test-results/
├── smoke-test-20260109.log   # Daily smoke test logs
├── e2e-20260109-143022.log   # Manual E2E test logs
├── results.png               # E2E test screenshots
└── error.png                 # Error screenshots
```

### Interpreting Results

**Smoke Tests:**
- ✓ All tests passed: Site is healthy
- ✗ Tests failed: Check log for specific failures

**E2E Tests:**
- Currently captures screenshots for manual review
- Future: Automated validation of test cases
- Review screenshots against TEST_CASES.md

## Troubleshooting

### Playwright Not Installed

```bash
uv pip install playwright
playwright install chromium
```

### Test File Not Found

```bash
# Verify file exists
ls -lh test-data/Digital\ Workout\ Plan\ Report.xlsx

# Copy if missing
cp /path/to/file.xlsx test-data/
```

### Timeout Errors

E2E test allows 3 minutes for processing. If timing out:
- Check production site status
- Review error screenshot: `test-results/error.png`
- Check Claude API status

### Permission Errors

```bash
# Make scripts executable
chmod +x scripts/run_smoke_tests.sh
```

## Cost & Performance

**Smoke Tests:**
- Time: ~10 seconds
- Cost: $0 (no API calls)
- Frequency: Daily via cron

**E2E Tests:**
- Time: ~60 seconds
- Cost: ~$0.08 per run (55 rows × ~$0.0015/row)
- Frequency: Manual (weekly recommended)

**Monthly Estimate:**
- Daily smoke: $0
- Weekly E2E: ~$0.32/month

## Development

### Adding New Tests

1. Create test file in `tests/` directory
2. Use PEP 723 inline dependencies:
   ```python
   # /// script
   # dependencies = ["playwright"]
   # ///
   ```
3. Run with `uv run --script tests/your_test.py`

### Modifying Test Cases

Edit `test-data/Digital Workout Plan Report.xlsx` to update test cases.
Document changes in `test-data/TEST_CASES.md`.

## Files

### Tracked in Git

- `tests/test_smoke.py` - Smoke tests
- `tests/test_e2e_full.py` - E2E tests
- `tests/README.md` - This file
- `test-data/TEST_CASES.md` - Test case documentation
- `scripts/run_smoke_tests.sh` - Cron wrapper

### Gitignored

- `test-data/*.xlsx` - Test data files
- `test-results/*.log` - Test logs
- `test-results/*.png` - Screenshots
