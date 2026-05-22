# Session Notes Checker — Changelog

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
