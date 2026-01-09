# Session Notes Reviewer

AI-powered quality assurance system for educational session notes using Claude API.

**Live Demo**: https://mathsense.com/session-notes/

## Quick Start

```bash
git clone https://github.com/Jython1415/mathnasium-session-notes.git
cd mathnasium-session-notes

mkdir -p config data
echo "your-api-key" > config/api_key.txt
chmod 600 config/api_key.txt

php -S localhost:8000
```

Then open http://localhost:8000/

## Setup

1. Get API key from [Anthropic console](https://console.anthropic.com/)
2. Store in `config/api_key.txt`
3. (Optional) Set `CLAUDE_API_KEY_PATH` and `FEEDBACK_DB_PATH` env vars for production

## Usage

Upload session notes as XLSX file. The app:
- Reviews notes for policy violations and quality issues
- Flags by confidence level (high/medium/low)
- Logs feedback to SQLite database
- Uses prompt caching for 56% cost savings

## Tech Stack

React 18 (CDN) • PHP 7.4+ • SQLite • Claude Haiku 4.5

## Requirements

- PHP 7.4+ (curl, PDO, pdo_sqlite extensions)
- Modern web browser
- Claude API key

## License

MIT
