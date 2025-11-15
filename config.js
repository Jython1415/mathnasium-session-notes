// ==================== CONFIGURATION ====================
// Adjust these values to change app behavior
const CONFIG = {
  // Confidence thresholds for review categorization
  REVIEW_THRESHOLD: 0.4,        // Items below this are "low priority", above are flagged for review
  HIGH_CONFIDENCE: 0.7,          // Items at/above this get auto-expanded and "High Confidence" label
  MEDIUM_CONFIDENCE: 0.4,        // Items between medium and high get "Medium Confidence" label
  // Items below medium get "Low Confidence" label

  // HTTP status code error prefixes
  HTTP_ERROR_PREFIXES: {
    400: 'INVALID_REQUEST',
    403: 'PERMISSION',
    404: 'NOT_FOUND',
    413: 'TOO_LARGE',
    429: 'RATE_LIMIT',
    500: 'SERVER_ERROR',
    529: 'OVERLOADED'
  },

  // Review reason display labels
  REASON_LABELS: {
    'language_issues': 'Language Issues',
    'missing_summary': 'Missing Summary',
    'schoolwork_not_empty': 'Content in Schoolwork',
    'guardian_in_internal': 'Guardian Content Misplaced',
    'name_mismatch': 'Name Mismatch',
    'behavior_no_strategy': 'Behavior Without Strategy',
    'poor_fit_suggestion': 'Poor Fit Suggestion',
    'other': 'Other',
    'none': 'No Issues'
  },

  // Confidence level display styles
  CONFIDENCE_STYLES: {
    high: { label: 'High', color: '#991b1b', bg: '#fef2f2' },
    medium: { label: 'Medium', color: '#ea580c', bg: '#fff7ed' },
    low: { label: 'Low', color: '#65a30d', bg: '#f0fdf4' }
  },

  // Cache settings (Haiku 4.5 requires 4096 tokens minimum)
  CACHE_TTL_MS: 5 * 60 * 1000,  // 5 minutes
  CACHE_MIN_TOKENS: 4096,

  // Parallel processing settings
  BATCH_SIZE: 5,                 // Rows per API request
  INITIAL_CONCURRENCY: 10,       // Starting number of parallel requests
  MAX_CONCURRENCY: 20,           // Maximum parallel requests
  MIN_CONCURRENCY: 2,            // Minimum during rate limiting

  // Retry settings
  MAX_RETRIES: 5,
  RETRY_BACKOFF_BASE: 2,
  RETRY_JITTER_MS: 100,

  // API settings
  MODEL: "claude-haiku-4-5-20251001",  // Claude Haiku 4.5 (released Oct 2025)
  API_ENDPOINT: "api/index.php",  // Relative to session-notes-dev directory

  // Cost tracking (per 1M tokens)
  COSTS: {
    HAIKU_INPUT: 1.00,           // $1 per 1M input tokens
    HAIKU_CACHE_WRITE: 1.25,     // 1.25x base ($1.25 per 1M)
    HAIKU_CACHE_READ: 0.10,      // 0.1x base (90% savings, $0.10 per 1M)
    HAIKU_OUTPUT: 5.00           // $5 per 1M output tokens
  }
};
