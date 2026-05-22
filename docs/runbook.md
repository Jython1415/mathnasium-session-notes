# Runbook

Operational procedures for the session notes checker. Written for both human
center directors and Claude sessions handling autonomous debugging.

---

## Checking system health (Claude)

```python
create_session(["session_notes_query", "session_notes_manage"])
GET /proxy/session_notes_manage/manage.php?op=status
```

The response includes `health.status`: `ok`, `warning`, or `critical`.
- **ok**: system running normally
- **warning**: last run had failures, or >50h since last run, or prompt out of sync
- **critical**: no run in >90h, or last run had a fatal error

---

## Emails have stopped arriving

**Step 1** — Check health status (above). Note `health.hours_since_run`.

**Step 2** — Read the last run's log:
```
GET /proxy/session_notes_query/log-query.php?sql=
  SELECT level,msg FROM log_lines
  WHERE run_id=(SELECT MAX(id) FROM runs WHERE mode='cron')
  ORDER BY id
```

**Step 3** — Common causes and fixes:

| Symptom in log | Cause | Fix |
|----------------|-------|-----|
| "Login failed — no auth cookie" | Radius password changed | Update `RADIUS_PASSWORD` in `.env` on server, redeploy |
| "CSRF token not found" | Radius HTML structure changed | Check radius.mathnasium.com login page; update `extract_csrf()` regex in daily_check.php |
| "OpenRouter HTTP 401" | API key invalid | Verify key at openrouter.ai, update `OPENROUTER_API_KEY` in `.env` |
| "OpenRouter HTTP 402" | OpenRouter account out of credit | Add credit at openrouter.ai |
| "cURL error 28: timeout" | OpenRouter slow / model unavailable | Will retry; if persistent, switch `OPENROUTER_MODEL` to `google/gemini-2.0-flash-001` |
| "No DWP records for today" | Center was closed, or run time too early | Not an error — check center schedule |
| Log is empty for expected run time | Cron not firing | Check cPanel cron jobs; verify `ea-php83` binary path |

---

## All reviews show `api_failure`

The AI call succeeded (Radius data was fetched) but OpenRouter returned something
unparseable. Check the log for `ERROR` lines with the raw API response.

Most likely causes:
1. Model returned non-JSON prose → try a different model
2. Response truncated (output token limit hit) → reduce `BATCH_SIZE` from 50 to 25
3. Rate limit → will retry; if persistent, check openrouter.ai usage dashboard

---

## Email lands in spam

Configure Gmail SMTP in `.env`:
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=joshua.shew.mathnasium@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx   # Gmail App Password
```
App Password: myaccount.google.com → Security → 2-Step Verification → App passwords.

---

## Updating the review prompt

The canonical prompt is `review_prompt.txt` in `cron-checker/`.
The web tool at `mathsense.com/session-notes/` fetches it via `api/prompt.php`.

1. Edit `review_prompt.txt` on the server (or update in GitHub and `?op=git-pull`)
2. Deploy: `?op=deploy` via manage.php
3. The next cron run will pick up the new prompt and record a new `prompt_hash`
4. Verify: `?op=status` → `prompt.in_sync` should be `true`

**Do not edit `prompt.js`** — it is no longer the source of truth for the web tool.
It remains in the repo for reference only.

---

## Deploying a code change (Claude)

```python
# 1. Push change to GitHub (via github_api)
# 2. Pull and redeploy
GET /proxy/session_notes_manage/manage.php?op=git-pull
GET /proxy/session_notes_manage/manage.php?op=deploy
# 3. Test
GET /proxy/session_notes_manage/manage.php?op=debug-run
# 4. Inspect results
GET /proxy/session_notes_query/log-query.php?sql=SELECT * FROM runs ORDER BY id DESC LIMIT 3
```

---

## Changing the model

Edit `.env` on the server:
```
OPENROUTER_MODEL=google/gemini-2.5-flash-lite
```
Then `?op=debug-run` to verify. Model options and current pricing at openrouter.ai/models.

Cheapest viable alternatives to `openai/gpt-4o-mini` ($0.15/M):
- `google/gemini-2.5-flash-lite` ($0.10/M) — fastest, good schema adherence
- `google/gemini-2.0-flash-lite-001` ($0.075/M) — cheapest viable option

---

## Database maintenance

The DB auto-prunes on each cron run (default: keep 90 days). To adjust:
```
RETAIN_DAYS=60   # in .env
```

To manually inspect or repair:
```
GET /proxy/session_notes_query/log-query.php?sql=SELECT * FROM sqlite_master WHERE type='table'
GET /proxy/session_notes_manage/manage.php?op=inspect&resource=db-schema
```

---

## Cron schedule reference

| Day | Time (CDT) | Time (ET) | Time (UTC) |
|-----|-----------|-----------|-----------|
| Mon–Thu | 18:20 | 19:20 | 23:20 |
| Sat–Sun | 13:20 | 14:20 | 18:20 |
| Friday | — | — | — |

Server timezone: CDT (UTC-5). CDT → ET: add 1 hour.
To verify: `?op=inspect&resource=cron-log` — check timestamps on recent entries.
