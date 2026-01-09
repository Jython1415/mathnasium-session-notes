# Session Notes Reviewer

AI-powered quality assurance system for educational session notes using Claude API.

## Overview

This web application reviews session records from educational management systems and identifies notes that may need manual review. Built with React (via CDN), PHP backend, and SQLite feedback logging.

**Key Features**:
- Prompt caching (Claude Haiku 4.5) for 56% cost savings
- Parallel batch processing with dynamic concurrency
- Real-time progress tracking
- Comprehensive feedback system
- Excel file upload and parsing (XLSX format)
- Configurable confidence thresholds

## Architecture

**Frontend** (Modular JavaScript):
- `app.jsx` - Main React application
- `components.js` - UI components
- `api.js` - API client with retry logic
- `prompt.js` - AI prompt templates with caching
- `config.js` - Application configuration
- `index.html` - Application loader

**Backend** (PHP):
- `api/index.php` - Claude API proxy with authentication
- `api/feedback.php` - Feedback submission endpoint

**Data Storage**:
- SQLite database for user feedback
- Configurable via environment variables

## Quick Start

### Prerequisites

- PHP 7.4+ with curl and PDO extensions
- Claude API key from [Anthropic](https://console.anthropic.com/)
- Modern web browser with JavaScript enabled

### Setup

1. **Clone repository**:
```bash
git clone https://github.com/Jython1415/mathnasium-session-notes.git
cd mathnasium-session-notes
```

2. **Configure environment** (optional):
```bash
cp .env.example .env
# Edit .env if you want custom paths
```

3. **Store API key**:
```bash
mkdir -p config
echo "your-api-key-here" > config/api_key.txt
chmod 600 config/api_key.txt
```

4. **Create data directory**:
```bash
mkdir -p data
```

5. **Start development server**:
```bash
php -S localhost:8000
```

6. **Open browser**: Navigate to http://localhost:8000/

### Production Deployment

For production deployment, set environment variables to use absolute paths:

```bash
export CLAUDE_API_KEY_PATH=/secure/path/to/api_key.txt
export FEEDBACK_DB_PATH=/data/path/to/feedback.db
```

Or configure your web server (Apache/Nginx) to set these environment variables.

## Usage

1. **Export session data** from your management system as Excel (XLSX format)
2. **Drag and drop** the file into the upload area or click to browse
3. **Review results** - the system categorizes notes by confidence level:
   - **High confidence (0.7-1.0)**: Likely needs review
   - **Medium confidence (0.4-0.7)**: May need review
   - **Low confidence (0.0-0.4)**: Probably fine
4. **Provide feedback** using thumbs up/down to help improve the system
5. **Export results** - Download reviewed notes with AI assessments

### Expected Excel Format

The XLSX file should contain session records with these columns:
- Date
- Student Name (with 4-digit ID in parentheses)
- Session Start/End times
- Instructors
- Schoolwork Description
- Session Summary Notes
- Student Notes
- Internal Notes
- Notes from Center Director
- LP Assignment

## Configuration

### Environment Variables

- `CLAUDE_API_KEY_PATH`: Path to file containing API key (default: `config/api_key.txt`)
- `FEEDBACK_DB_PATH`: Path to SQLite feedback database (default: `data/feedback.db`)

### Application Settings

Edit `config.js` to customize:

- **Confidence thresholds**: Adjust what's considered high/medium/low risk
- **Batch size**: Number of notes to process concurrently (default: 5)
- **Concurrency**: Max parallel API requests (default: 3)
- **Retry behavior**: Failed request retry logic
- **Cost tracking**: Monitor API usage and costs

## Prompt Engineering

The system uses sophisticated prompt engineering to evaluate session notes across multiple categories:

### Evaluation Categories

- `language_issues`: Negative language about students without constructive framing
- `behavior_no_strategy`: Describes behavior issues without mentioning management strategies
- `poor_fit_suggestion`: Suggests program/plan isn't working for the student
- `missing_summary`: Required session summary field is empty
- `schoolwork_not_empty`: Policy violation - schoolwork field must be empty
- `guardian_in_internal`: Guardian-appropriate content in staff-only notes
- `name_mismatch`: Name in notes doesn't match student record
- `other`: Issues not fitting above categories
- `none`: No issues detected

### Confidence Scoring

- **HIGH (0.8-1.0)**: Clear policy violations or obvious issues
- **MEDIUM (0.4-0.7)**: Ambiguous phrasing that may need review
- **LOW (0.0-0.3)**: Appropriate notes with constructive framing

See `prompt.js` for the complete 5000+ token prompt template with 12 detailed examples.

## Cost Optimization

The application uses Claude's prompt caching to reduce API costs significantly:

- **System prompt**: 5395 tokens cached for 5 minutes
- **Cache hit savings**: ~56% cost reduction on typical workloads
- **Estimated cost**: ~$0.15 per 100 session notes reviewed

### Cost Breakdown (Claude Haiku 4.5)

- Cached prompt tokens: Free after first use (5 minute TTL)
- Input tokens: $0.003 per 1000 tokens
- Output tokens: $0.015 per 1000 tokens

## Feedback Database

User feedback is stored in SQLite for continuous improvement:

### Schema

```sql
CREATE TABLE feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    row_json TEXT NOT NULL,
    claude_response_json TEXT NOT NULL,
    feedback_type TEXT NOT NULL
);
```

### Query Examples

```bash
# View all feedback
sqlite3 data/feedback.db "SELECT * FROM feedback;"

# Count by type
sqlite3 data/feedback.db "SELECT feedback_type, COUNT(*) FROM feedback GROUP BY feedback_type;"

# Recent feedback
sqlite3 data/feedback.db "SELECT id, timestamp, feedback_type FROM feedback ORDER BY timestamp DESC LIMIT 10;"

# Export to CSV
sqlite3 -header -csv data/feedback.db "SELECT * FROM feedback;" > feedback.csv
```

## Development

### Local Development Setup

1. Follow Quick Start instructions above
2. Make changes to JS/PHP files
3. Refresh browser to see changes (no build step required)

### Project Structure

```
session-notes/
├── index.html           # Main HTML file
├── config.js            # App configuration
├── prompt.js            # AI prompt template
├── api.js               # API client
├── components.js        # React components
├── app.jsx              # Main React app
├── .env.example         # Environment template
├── .gitignore           # Git exclusions
├── config/              # Local configuration (gitignored)
│   ├── .gitkeep
│   └── api_key.txt      # API key (gitignored)
├── data/                # Local data storage (gitignored)
│   ├── .gitkeep
│   └── feedback.db      # SQLite database (gitignored)
└── api/
    ├── index.php        # Claude API proxy
    └── feedback.php     # Feedback endpoint
```

### Testing

The application includes:
- Real-time progress tracking during batch processing
- Error handling with automatic retries
- Cost estimation and tracking
- Feedback submission for quality improvement

To test locally:
1. Start PHP server: `php -S localhost:8000`
2. Open http://localhost:8000/
3. Upload a sample XLSX file
4. Review results and test feedback submission

## Troubleshooting

### API not responding

- **Check API key**: Verify `config/api_key.txt` contains valid key
- **Check PHP extensions**: Ensure curl and PDO are installed
  ```bash
  php -m | grep -E "curl|pdo"
  ```
- **Check error logs**: Look for PHP errors
  ```bash
  tail -f /path/to/php_error.log
  ```

### Feedback not saving

- **Check directory permissions**: Ensure `data/` directory is writable
- **Check SQLite**: Verify SQLite PDO extension is installed
  ```bash
  php -m | grep pdo_sqlite
  ```
- **Check database path**: Verify `FEEDBACK_DB_PATH` is correct

### File upload issues

- **File size limits**: Check `php.ini` settings:
  - `upload_max_filesize`
  - `post_max_size`
  - `memory_limit`
- **File format**: Ensure file is XLSX format, not XLS or CSV
- **Browser console**: Check for JavaScript errors in browser dev tools

### Performance issues

- **Reduce batch size**: Lower concurrent processing in `config.js`
- **Reduce concurrency**: Limit parallel API requests
- **Check API rate limits**: Verify you're not exceeding Anthropic's limits
- **Clear cache**: Force refresh to clear browser cache

## License

MIT License - see LICENSE file for details

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Acknowledgments

Built with:
- [React 18](https://react.dev/) - UI framework (loaded via CDN)
- [Claude AI](https://www.anthropic.com/claude) - Haiku 4.5 model for analysis
- [SheetJS](https://sheetjs.com/) - Excel file parsing
- [SQLite](https://www.sqlite.org/) - Feedback database

## Support

For issues, questions, or suggestions:
- Open an issue on GitHub
- Check existing issues for solutions
- Review troubleshooting section above

## Roadmap

Future enhancements under consideration:
- CSV export of reviewed notes
- Customizable evaluation categories
- Multi-language support
- Integration with popular LMS platforms
- Bulk processing improvements
- Analytics dashboard for feedback trends
