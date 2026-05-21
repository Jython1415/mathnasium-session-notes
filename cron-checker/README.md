# Session Notes Daily Check

Automated daily review of Mathnasium Fresh Pond session notes. Pulls today's DWP
records directly from Radius, reviews them with an AI model via OpenRouter, and
emails flagged items to the center director.

**Runs:** Mon–Thu at 7:20 PM ET, Sat–Sun at 2:20 PM ET. No run on Friday.

**Independent of:** Claude.ai plan, Ganymede being on, or any manual export step.

---

## Files

```
daily_check.php     Main cron script
review_prompt.txt   AI review system prompt (extracted from web tool)
.env                Secrets (create from .env.example, never commit)
.env.example        Template
logs/               Auto-created on first run
```

---

## Setup

### 1. Upload files to mathsense.com

Upload to a path outside the web root (recommended) or inside it if you want
web-triggered runs. Suggested path: `~/session-notes-checker/`

If you can git pull on the server, add this directory to the repo. Otherwise
upload via cPanel File Manager or SFTP.

### 2. Configure .env

```bash
cp .env.example .env
chmod 600 .env
nano .env   # fill in credentials
```

Required:
- `RADIUS_USERNAME` / `RADIUS_PASSWORD` — your Radius login (Joshua.Shew2)
- `OPENROUTER_API_KEY` — from openrouter.ai (sign up → Settings → Keys)

Optional but recommended for reliable email delivery:
- `SMTP_*` fields — Gmail App Password (see .env.example for setup)
  Without SMTP, falls back to PHP `mail()` which may land in spam.

### 3. First run — verify Radius fields

Run once with `--probe` to confirm all field names from the live API:

```bash
php ~/session-notes-checker/daily_check.php --probe
```

Check `logs/daily_check.log`. Look for `PROBE — Raw field names` section.
If any of these fields are missing or named differently, update the
`format_row_as_markdown()` function in `daily_check.php`:

- `SchoolworkDescription` → Schoolwork Description
- `StudentNotes` → Student Notes
- `InternalNotes` → Internal Notes
- `LPAssignment` → LP Assignment

These names are inferred from the Python types.py — verify on first run.

### 4. Test run

```bash
php ~/session-notes-checker/daily_check.php
```

Check `logs/daily_check.log` and your inbox at joshua.shew.mathnasium@gmail.com.

### 5. Set up cron job

In cPanel → Cron Jobs, add two entries:

**Mon–Thu at 7:20 PM** (adjust minute/hour if server is UTC — see note below):
```
20 19 * * 1-4   /usr/bin/php /home/YOUR_CPANEL_USER/session-notes-checker/daily_check.php >> /home/YOUR_CPANEL_USER/session-notes-checker/logs/cron.log 2>&1
```

**Sat–Sun at 2:20 PM**:
```
20 14 * * 0,6   /usr/bin/php /home/YOUR_CPANEL_USER/session-notes-checker/daily_check.php >> /home/YOUR_CPANEL_USER/session-notes-checker/logs/cron.log 2>&1
```

**Timezone note:** cPanel cron runs in the server's timezone. To check:
```bash
date
```
If the server is UTC (common), add 4 hours for ET (5 hours during standard time):
- 7:20 PM ET = 23:20 UTC  →  `20 23 * * 1-4`
- 2:20 PM ET = 18:20 UTC  →  `20 18 * * 0,6`

To find the PHP binary path:
```bash
which php   # usually /usr/bin/php or /usr/local/bin/php
```

Replace `YOUR_CPANEL_USER` with your actual cPanel username.

---

## OpenRouter Setup

1. Go to https://openrouter.ai and create an account
2. Settings → Keys → Create key
3. Add credit ($5–10 will last months at these volumes)
4. Paste key into `.env` as `OPENROUTER_API_KEY`

Cost estimate at default model (`openai/gpt-4o-mini`):
- ~50 sessions/day × 12 reviews/week × 52 weeks = ~600 reviews/year
- Each review: ~8,000 input tokens + ~2,000 output tokens
- Annual cost: < $2

---

## Email reliability

**If email lands in spam:** configure SMTP in `.env` using a Gmail App Password.
This routes through Gmail's servers directly and is reliable.

App Password setup:
1. https://myaccount.google.com → Security → 2-Step Verification → App passwords
2. Create password for "Mail" / "Other" 
3. Paste the 16-char password (spaces OK) into `SMTP_PASS`

---

## Updating the AI prompt

The review criteria live in `review_prompt.txt`. To update:
1. Edit `review_prompt.txt` directly on the server
2. Changes take effect on the next run — no restart needed

The web tool at mathsense.com/session-notes/ uses `prompt.js` (the JS version
of the same prompt). If you update the prompt there, sync it here too.

---

## Logs

All activity is logged to `logs/daily_check.log`. Cron stdout goes to
`logs/cron.log`. Rotate periodically; logs are append-only and will grow.

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| "Login failed — no auth cookie" | Radius credentials in .env; try logging into radius.mathnasium.com manually to verify |
| "CSRF token not found" | Radius may have updated their HTML — run `--probe` and look at login page source |
| "OpenRouter error HTTP 401" | API key invalid or not yet activated |
| "OpenRouter error HTTP 402" | OpenRouter account needs credit |
| Email not arriving | Check spam; configure SMTP (see above) |
| No records pulled | Sessions may not yet be finalized by run time; verify at https://radius.mathnasium.com |
