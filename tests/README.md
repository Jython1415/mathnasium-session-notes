# Session Notes Reviewer - Test Suite

## Overview

Automated testing for the production session-notes reviewer application. Tests the complete workflow from file upload through AI review to results validation.

## Setup

### Prerequisites

**For Server (Automated Daily Tests):**
- No dependencies needed - uses curl only
- Script: `scripts/smoke_test_simple.sh`
- Tests: HTTP status, title, files, API endpoint

**For Local (Full E2E Tests):**
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

### Server Smoke Tests (Production, ~2 seconds)

Simple curl-based health checks that run daily on the server:

```bash
# Run on server via SSH
ssh -i ~/.ssh/mathsense_key c5495zvy@mathsense.com \
  'cd ~/public_html/session-notes && ./scripts/smoke_test_simple.sh'

# Or run locally (tests production)
./scripts/smoke_test_simple.sh
```

**What it checks:**
- Site loads (HTTP 200)
- Application title present
- React app file exists
- API endpoint responds

**Alerting:**
- Email sent to joshua.shew.mathnasium@gmail.com on test failures
- Uses Unix `mail` command (same as mc-reporter)
- Only alerts on failures (no spam on success)

**Cost:** Free (no API calls)
**Dependencies:** None (curl and mail only)

### Local Playwright Tests (Optional, ~10 seconds)

Full browser automation tests (only needed for local development):

```bash
# Run directly (requires Playwright installed)
uv run --script tests/test_smoke.py

# Or via wrapper
./scripts/run_smoke_tests.sh
```

**What it checks:**
- Site loads (HTTP 200)
- Application title present
- React app loaded
- File upload input exists (waits for React to mount)

**Cost:** Free (no API calls)
**Dependencies:** Playwright + Chromium

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

### Daily Smoke Tests (Server)

Cron job runs at 8 AM CST daily on production server:

```bash
# On server, edit crontab
ssh -i ~/.ssh/mathsense_key c5495zvy@mathsense.com
crontab -e

# Add this line:
0 8 * * * cd /home2/c5495zvy/public_html/session-notes && /home2/c5495zvy/public_html/session-notes/scripts/smoke_test_simple.sh
```

**Logs:** `~/public_html/session-notes/test-results/smoke-test-YYYYMMDD.log`

**Retention:** Last 30 days kept automatically

**Check logs via SSH:**
```bash
ssh -i ~/.ssh/mathsense_key c5495zvy@mathsense.com \
  'tail -20 ~/public_html/session-notes/test-results/smoke-test-$(date +%Y%m%d).log'
```

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
