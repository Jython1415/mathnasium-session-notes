# Session Notes Checker — Changelog

## v1.3.0 — 2026-05-22
- **Model**: Changed default to `google/gemini-2.0-flash-001` (8× faster, $0.10/1M, better calibration than gpt-4o-mini)
- **Prompt**: Removed Session Goal field entirely — only Pages Completed used, with thresholds: 0–3 potentially low, 4+ acceptable, 5+ solid
- **Prompt**: Added `missing_math_detail` and `sentiment_mismatch` categories (from v1.2.0 rerun work)
- **Prompt**: Added concrete `none` examples (Examples 15+16) to anchor Alina Joseph and Aria Maggio as false positives
- **Prompt**: Updated sentiment_mismatch guidance — depth-explains-pages, mastery-check exception, 4+ not low
- **Schema**: `reviews.reasons` TEXT column (JSON array) — supports multiple reasons per record
- **Email**: Multi-reason badges; all category labels now human-readable
- **API**: `?op=rerun&date=YYYY-MM-DD&model=<slug>` — model override parameter
- **API**: `?op=cleanup-stale` — marks abandoned runs with error so health check is accurate
- **Fix**: `--model=` command-line arg working (sanitized without shell quoting issue)
- **Fix**: `db_start_run` passes run_date so reruns record correct date
- **Fix**: OpenRouter timeout increased 120s→180s; `CURLOPT_CONNECTTIMEOUT=15` prevents indefinite hangs
- **Fix**: Session notes no longer truncated at 300 chars in email (was the original bug)
- **Calibration**: Verified on 2026-05-21 data — 3 legitimate flags, 0 false positives

## v1.2.0 — 2026-05-22
- **Observability**: Added SQLite-backed logging (`sessions.sqlite`) with `runs`, `reviews`, and `log_lines` tables
- **Observability**: Added `log-query.php` — read-only SQL endpoint accessible via credential proxy (`session_notes_query` service)
- **Observability**: Added `manage.php` — autonomous ops endpoint (`status`, `git-pull`, `deploy`, `debug-run`, `full-run`, `inspect`)
- **Health**: `?op=status` now returns structured `health.status` = ok / warning / critical, with `hours_since_run` and threshold-based reasoning
- **Health**: `?op=status` reports `prompt.in_sync` — detects if review_prompt.txt has changed since last run
- **Prompt**: Added `api/prompt.php` — serves review_prompt.txt as the canonical system prompt for the web tool (single source of truth)
- **Schema**: `prompt_hash` column added to `runs` and `reviews` tables — tracks which prompt version produced each result
- **Retention**: `db_retain()` function prunes data older than `RETAIN_DAYS` (default 90) on each cron run
- **Inspect**: `?op=inspect&resource=daily-log|cron-log|prompt|env-keys|db-schema` surfaces file contents without SSH
- **Docs**: Added `CHANGELOG.md`, `docs/runbook.md`, `docs/review-categories.md`, `docs/design-notes.md`
- **Module**: Added `modules/session-notes-checker/MODULE.md` to claude-workspace

## v1.1.0 — 2026-05-21 (evening)
- **Fix**: OpenRouter API call was using Anthropic-specific top-level `system` param; moved to messages array (standard OpenAI-compatible format) — this was the root cause of all-api_failure runs
- **Fix**: cURL timeout increased from 30s to 120s for large batch inference
- **Fix**: JSON parsing now handles bare array responses in addition to `{"reviews":[...]}` wrapper
- **Feature**: Added `--debug` mode (3 records, no email, logs raw API response)
- **Feature**: Added `--probe` mode (logs all raw Radius field names for first-run verification)
- **Fix**: `cost_usd` was recorded as 0 in debug mode; now correctly accumulates `$GLOBALS['_usage']`
- **Feature**: `full-run` in manage.php uses `nohup` background execution to avoid web server 504 timeout; returns immediately, caller polls DB

## v1.0.0 — 2026-05-21 (initial deployment)
- PHP cron script: logs into Radius directly (bypassing Anthropic sandbox IP block), fetches Fresh Pond DWP session notes
- OpenRouter integration (`openai/gpt-4o-mini` default) — independent of Claude.ai plan
- Email report via PHP `mail()` to `joshua.shew.mathnasium@gmail.com`
- Cron: Mon–Thu 18:20 CDT, Sat–Sun 13:20 CDT (no Friday)
- Retry logic: 3 attempts per batch with exponential backoff
- Registered `openrouter` as credential-store service in credential proxy
