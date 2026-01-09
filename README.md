# Session Notes Reviewer

AI-powered quality assurance system for educational session notes using Claude API.

## Overview

Web application that reviews session records from educational management systems and flags notes that may need manual review. Uses Claude Haiku 4.5 with prompt caching for 56% cost savings.

**Live Demo**: https://mathsense.com/session-notes/

## Quick Start

```bash
# Clone and setup
git clone https://github.com/Jython1415/mathnasium-session-notes.git
cd mathnasium-session-notes

# Store API key
mkdir -p config
echo "your-api-key" > config/api_key.txt

# Start server
php -S localhost:8000
```

Open http://localhost:8000/ and upload an XLSX file to review session notes.

## Tech Stack

- **Frontend**: React 18 (via CDN), vanilla JavaScript
- **Backend**: PHP 7.4+ with curl and PDO
- **AI**: Claude Haiku 4.5 (Anthropic API)
- **Database**: SQLite for feedback logging
- **Excel parsing**: SheetJS

## Features

- Prompt caching (5395 tokens) for cost efficiency
- Parallel batch processing with dynamic concurrency
- Real-time progress tracking
- Feedback system for continuous improvement
- Configurable confidence thresholds

## Configuration

Environment variables (optional):
- `CLAUDE_API_KEY_PATH` - Path to API key file (default: `config/api_key.txt`)
- `FEEDBACK_DB_PATH` - Path to SQLite database (default: `data/feedback.db`)

See `.env.example` for details.

## License

MIT License

## Acknowledgments

Built with [React](https://react.dev/), [Claude AI](https://www.anthropic.com/claude), [SheetJS](https://sheetjs.com/), and [SQLite](https://www.sqlite.org/).
