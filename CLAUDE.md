# Session Notes Reviewer

## Overview

Session notes reviewer web application for Mathnasium Fresh Pond. Reviews session notes exported from Mathnasium Connect and provides feedback using Claude AI.

**Production URL:** https://mathsense.com/session-notes/
**Development URL:** https://mathsense.com/session-notes-dev/
**Status:** Active development, git-based deployment
**GitHub:** https://github.com/Jython1415/mathnasium-session-notes

## Architecture

- Modular design: 6 JS modules + PHP API
- Prompt caching (Claude Haiku 4.5, 5395 tokens, 56% cost savings)
- Parallel batch processing (dynamic concurrency)
- SQLite feedback logging

**Key Files:**
- `app.jsx` - Main React application
- `components.js` - UI components
- `api.js` - API client
- `prompt.js` - Prompt templates with caching
- `config.js` - Configuration
- `api/` - PHP backend
  - `api.php` - Main API endpoint
  - `feedback.php` - Feedback submission

## Git Workflow

**Local repo:** `~/Documents/_programming/mathnasium/session-notes`
**Server repo:** `ssh://c5495zvy@mathsense.com/~/git-repos/session-notes.git` (bare repo)
**GitHub repo:** `git@github.com:Jython1415/mathnasium-session-notes.git`

### Deploy to Development

```bash
git checkout dev
# ... make changes ...
git commit -m "Description"
git push server dev          # Auto-deploys to session-notes-dev/
git push origin dev          # Backup to GitHub
```

### Promote to Production

```bash
git checkout main
git merge dev
git push server main         # Auto-deploys to session-notes/ with backup
git push origin main         # Backup to GitHub
```

### Server Details

**Deployment locations:**
- Production: `~/public_html/session-notes/`
- Development: `~/public_html/session-notes-dev/`

**Backups:** `~/backups/session-notes/` (last 5 kept)
**Rollback:** `git revert <commit>` or restore from backups

**Post-receive hook:** Automatic deployment on push to server remote

## Feedback Database

### Database Queries

Connect to server and query the SQLite database:

```bash
ssh -i ~/.ssh/mathsense_key c5495zvy@mathsense.com

# View all feedback
sqlite3 ~/data/session-notes-feedback.db "SELECT * FROM feedback;"

# Count by type
sqlite3 ~/data/session-notes-feedback.db "SELECT feedback_type, COUNT(*) FROM feedback GROUP BY feedback_type;"

# Recent feedback
sqlite3 ~/data/session-notes-feedback.db "SELECT id, timestamp, feedback_type FROM feedback ORDER BY timestamp DESC LIMIT 10;"

# Export CSV
sqlite3 -header -csv ~/data/session-notes-feedback.db "SELECT * FROM feedback;" > feedback.csv
```

### Schema

```sql
CREATE TABLE feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    feedback_type TEXT NOT NULL,
    student_name TEXT,
    instructor_name TEXT,
    session_date TEXT,
    session_notes TEXT,
    ai_response TEXT,
    user_comment TEXT
);
```

## Local Development

### Setup

```bash
# Store API key
echo "YOUR_API_KEY" > ~/.config/claude_api_key.txt
chmod 600 ~/.config/claude_api_key.txt

# Clone repo
cd ~/Documents/_programming/mathnasium/
git clone ssh://c5495zvy@mathsense.com/~/git-repos/session-notes.git
cd session-notes/

# Start PHP development server
php -S localhost:8000
```

### Testing

Update `app.jsx` to use local endpoints:
- Line 187: API endpoint
- Line 335: Feedback endpoint

Visit http://localhost:8000/

### Development Notes

- Use dev branch for all feature work
- Test locally before pushing to server dev environment
- Monitor feedback database for issues
- Check backups exist before major changes

## Troubleshooting

**Issue:** API not responding
- Check PHP error logs: `ssh c5495zvy@mathsense.com 'tail -50 ~/logs/error_log'`
- Verify API key is configured in server

**Issue:** Feedback not saving
- Check SQLite database permissions
- Verify feedback.php is receiving POST data

**Issue:** Deployment not working
- Check post-receive hook is executable
- Verify server remote is correct: `git remote -v`
- Check deployment logs on server

## Important Notes

- Always test in dev environment first
- Backups are automatic on production deploys
- Feedback database is on server at `~/data/session-notes-feedback.db`
- Production and dev environments are completely separate
