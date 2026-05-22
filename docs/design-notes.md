# Design Notes

Why things are the way they are. For future maintainers and Claude sessions.

---

## Why PHP instead of Python

mathsense.com is cPanel shared hosting. PHP is guaranteed available and cURL is
built-in. Python requires a venv and pip install; the `mc_reporter.py` cron job
works but needed explicit venv setup. For a script that's just HTTP calls and JSON
parsing, PHP with cURL avoids that dependency management overhead entirely.

---

## Why OpenRouter instead of direct Anthropic API

The system was originally designed assuming it would run through Claude.ai
scheduled tasks. Joshua uses a Claude Max plan with a 5-hour monthly limit. A
scheduled task running daily that hits the Anthropic API directly would consume
plan quota and stop working when the limit is reached.

OpenRouter routes to the same underlying models (including Claude Haiku) but bills
separately at OpenAI-API-compatible rates, completely independent of any Claude.ai
plan. A full year of daily runs costs ~$2.

The model default is `openai/gpt-4o-mini` — not Claude — because the system prompt
contains enough structure that any capable model follows it, and gpt-4o-mini is
the most cost/quality efficient option for structured classification.

---

## Why SQLite and not flat log files

The Mindbody integration demonstrated that flat log files are opaque to Claude
sessions — you need SSH to read them. SQLite with a `log-query.php` endpoint
means any Claude session can run `SELECT * FROM log_lines WHERE run_id=N` and
see the complete run history, flagged items, costs, and errors without any
infrastructure access.

SQLite also enables queries that flat logs don't: "how often does Sumedha get
flagged?", "what's the average confidence over the last 30 runs?", "which students
have had missing_summary issues more than once?"

---

## Why `nohup` for full-run

PHP executed via web request is subject to the web server's response timeout
(typically 30–60s via Cloudflare). A full batch of 36 sessions takes ~60s of
inference time. Running synchronously → 504 gateway timeout every time.

`nohup ... &` detaches the PHP process from the web request. The manage.php
endpoint returns immediately with the PID; the caller polls the DB until a new
row with `elapsed_s > 0` appears in the `runs` table. This is the same pattern
used for long-running jobs in background task systems.

`debug-run` (3 records, ~8s) runs synchronously since it fits well within timeout.

---

## Why the cron uses `ea-php83` instead of `php`

cPanel hosts often have multiple PHP versions installed. `ea-php83` is the
explicitly-versioned EasyApache PHP 8.3 binary guaranteed to be the same version
used by the web server. `/usr/local/bin/php` is a symlink that may point to a
different version or be absent. Using `ea-php83` directly matches what the
existing Mindbody cron jobs do and avoids version ambiguity.

---

## Why the Anthropic sandbox can't reach Radius directly

Mathnasium's AWS ALB (Application Load Balancer) blocks Anthropic sandbox egress
IPs. This was discovered during development when every direct request to
`radius.mathnasium.com` returned a 503 TLS error from the sandbox. The error is
a TLS negotiation failure caused by the ALB rejecting the connection before
handshake.

mathsense.com (cPanel shared hosting) has different IPs and connects to
radius.mathnasium.com without any proxy — verified during the initial probe run.

---

## Prompt single source of truth

Prior to v1.2.0, the review criteria existed in two places:
- `cron-checker/review_prompt.txt` — used by daily_check.php
- `app.jsx` / `prompt.js` — used by the web tool at mathsense.com/session-notes/

`api/prompt.php` was added so the web tool fetches from `review_prompt.txt` at
runtime. The `prompt_hash` column in `runs` and `reviews` records which version
of the prompt was used for each batch, enabling quality comparison across prompt
versions.

`prompt.js` is no longer the source of truth for the web tool but remains in the
repo for reference and as a fallback if `api/prompt.php` is unavailable.

---

## Center hardcoding (center_id = 2460)

The cron is currently hardcoded to Fresh Pond (center_id=2460) via `RADIUS_CENTER_ID`
in `.env`. Joshua manages multiple Mathnasium centers via the MA franchise group.
If this system is extended to other centers, `RADIUS_CENTER_ID` would become a
comma-separated list and the batch processing would run per-center.

The Joshua.Shew2 Radius login defaults to Fresh Pond. The `SetGlobalSingleCenterOrVc`
call in the login flow explicitly sets this — so even if the default changes,
the center_id in `.env` controls which center's data is fetched.
