<?php
/**
 * Session Notes Daily Check
 *
 * Pulls today's Mathnasium Fresh Pond DWP session notes from Radius,
 * reviews them for quality issues via OpenRouter (configurable model),
 * and emails a report to the center director.
 *
 * Intended for cron. Schedule:
 *   Mon–Thu  7:20 PM ET  →  20 19 * * 1-4    (server timezone; adjust if server is UTC)
 *   Sat–Sun  2:20 PM ET  →  20 14 * * 0,6
 *   (Friday: no run)
 *
 * Setup:
 *   1. Copy .env.example → .env and fill in values
 *   2. chmod 600 .env
 *   3. Add cron entries (see above)
 *   4. First run: php daily_check.php --probe  (logs raw Radius field names)
 *
 * Dependencies: PHP 7.4+, php-curl, php-json (standard on most cPanel hosts)
 */

// ─── Bootstrap ────────────────────────────────────────────────────────────────

define('SCRIPT_DIR', __DIR__);
define('LOG_FILE',   SCRIPT_DIR . '/logs/daily_check.log');
define('DB_FILE',    SCRIPT_DIR . '/logs/sessions.sqlite');
define('PROBE_MODE', in_array('--probe', $argv ?? []));
define('DEBUG_MODE', in_array('--debug', $argv ?? []));

// Parse optional --date=YYYY-MM-DD for historical reruns
$_date_arg = null;
foreach ($argv ?? [] as $_a) {
    if (preg_match('/^--date=(\d{4}-\d{2}-\d{2})$/', $_a, $_m)) {
        $_date_arg = $_m[1];
        break;
    }
}
define('DATE_ARG', $_date_arg);
define('IS_RERUN', $_date_arg !== null);

// Ensure log directory exists
if (!is_dir(SCRIPT_DIR . '/logs')) {
    mkdir(SCRIPT_DIR . '/logs', 0755, true);
}

// ─── SQLite logging ───────────────────────────────────────────────────────────
// All run data is written to sessions.sqlite so Claude sessions can query it
// directly via the log-query.php endpoint without needing SSH/filesystem access.

$GLOBALS['_db']     = null;   // SQLite3 instance
$GLOBALS['_run_id'] = null;   // current run's PK
$GLOBALS['_usage']  = ['input_tokens' => 0, 'output_tokens' => 0, 'cost_usd' => 0.0];

function db_open(): ?SQLite3 {
    if ($GLOBALS['_db'] !== null) return $GLOBALS['_db'];
    if (!class_exists('SQLite3')) return null;
    try {
        $db = new SQLite3(DB_FILE, SQLITE3_OPEN_READWRITE | SQLITE3_OPEN_CREATE);
        $db->enableExceptions(true);
        $db->exec('PRAGMA journal_mode=WAL');
        $db->exec('PRAGMA synchronous=NORMAL');
        $db->exec('PRAGMA busy_timeout=5000');
        $db->exec('
            CREATE TABLE IF NOT EXISTS runs (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                ts            INTEGER NOT NULL,
                date          TEXT    NOT NULL,
                mode          TEXT    NOT NULL DEFAULT "cron",
                n_sessions    INTEGER DEFAULT 0,
                n_flagged     INTEGER DEFAULT 0,
                n_failed      INTEGER DEFAULT 0,
                model         TEXT,
                prompt_hash   TEXT,
                cost_usd      REAL    DEFAULT 0,
                input_tokens  INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                elapsed_s     REAL    DEFAULT 0,
                error         TEXT
            )
        ');
        // Migrate: add prompt_hash if missing (idempotent)
        try { $db->exec('ALTER TABLE runs ADD COLUMN prompt_hash TEXT'); } catch (Exception $e) {}

        $db->exec('
            CREATE TABLE IF NOT EXISTS reviews (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id        INTEGER NOT NULL,
                unique_id     TEXT,
                student_name  TEXT,
                instructor    TEXT,
                session_date  TEXT,
                issue         TEXT,
                confidence    REAL    DEFAULT 0,
                flagged       INTEGER DEFAULT 0,
                prompt_hash   TEXT,
                session_notes TEXT,
                schoolwork    TEXT,
                justification TEXT
            )
        ');
        // Migrate: add prompt_hash if missing (idempotent)
        try { $db->exec('ALTER TABLE reviews ADD COLUMN prompt_hash TEXT'); } catch (Exception $e) {}
        $db->exec('CREATE INDEX IF NOT EXISTS idx_reviews_run ON reviews(run_id)');
        $db->exec('
            CREATE TABLE IF NOT EXISTS log_lines (
                id     INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER,
                ts     INTEGER NOT NULL,
                level  TEXT    NOT NULL,
                msg    TEXT    NOT NULL
            )
        ');
        $db->exec('CREATE INDEX IF NOT EXISTS idx_log_run ON log_lines(run_id)');
        $GLOBALS['_db'] = $db;
        return $db;
    } catch (Exception $e) {
        // SQLite failure is non-fatal — flat log still works
        error_log('sessions.sqlite open failed: ' . $e->getMessage());
        return null;
    }
}

function db_start_run(string $mode = 'cron'): void {
    $db = db_open();
    if (!$db) return;
    $stmt = $db->prepare('INSERT INTO runs (ts, date, mode, prompt_hash) VALUES (:ts, :date, :mode, :ph)');
    $stmt->bindValue(':ts',   time(),              SQLITE3_INTEGER);
    $stmt->bindValue(':date', date('Y-m-d'),       SQLITE3_TEXT);
    $stmt->bindValue(':mode', $mode,               SQLITE3_TEXT);
    $stmt->bindValue(':ph',   compute_prompt_hash(), SQLITE3_TEXT);
    $stmt->execute();
    $GLOBALS['_run_id'] = $db->lastInsertRowID();
}

function db_finish_run(array $stats): void {
    $db = db_open();
    $rid = $GLOBALS['_run_id'];
    if (!$db || !$rid) return;
    $stmt = $db->prepare('
        UPDATE runs SET
            n_sessions=:ns, n_flagged=:nf, n_failed=:nx,
            model=:model, cost_usd=:cost,
            input_tokens=:in, output_tokens=:out,
            elapsed_s=:el, error=:err
        WHERE id=:id
    ');
    $stmt->bindValue(':ns',    $stats['n_sessions']    ?? 0,    SQLITE3_INTEGER);
    $stmt->bindValue(':nf',    $stats['n_flagged']     ?? 0,    SQLITE3_INTEGER);
    $stmt->bindValue(':nx',    $stats['n_failed']      ?? 0,    SQLITE3_INTEGER);
    $stmt->bindValue(':model', $stats['model']         ?? '',   SQLITE3_TEXT);
    $stmt->bindValue(':cost',  $stats['cost_usd']      ?? 0.0,  SQLITE3_FLOAT);
    $stmt->bindValue(':in',    $stats['input_tokens']  ?? 0,    SQLITE3_INTEGER);
    $stmt->bindValue(':out',   $stats['output_tokens'] ?? 0,    SQLITE3_INTEGER);
    $stmt->bindValue(':el',    $stats['elapsed_s']     ?? 0.0,  SQLITE3_FLOAT);
    $stmt->bindValue(':err',   $stats['error']         ?? null, SQLITE3_TEXT);
    $stmt->bindValue(':id',    $rid,                            SQLITE3_INTEGER);
    $stmt->execute();
}

function db_retain(int $days): void {
    $db = db_open();
    if (!$db) return;
    $cutoff = time() - ($days * 86400);
    // Delete old runs and cascade via run_id
    $old_run_ids = [];
    $r = $db->query("SELECT id FROM runs WHERE ts < $cutoff AND mode='cron'");
    while ($row = $r->fetchArray(SQLITE3_NUM)) $old_run_ids[] = $row[0];
    if (empty($old_run_ids)) return;
    $ids = implode(',', $old_run_ids);
    $db->exec("DELETE FROM log_lines WHERE run_id IN ($ids)");
    $db->exec("DELETE FROM reviews   WHERE run_id IN ($ids)");
    $db->exec("DELETE FROM runs      WHERE id      IN ($ids)");
    log_info('Retention: removed ' . count($old_run_ids) . " runs older than {$days} days");
}

function compute_prompt_hash(): string {
    $prompt_file = SCRIPT_DIR . '/review_prompt.txt';
    if (!file_exists($prompt_file)) return 'missing';
    return substr(md5_file($prompt_file), 0, 8);
}

function db_insert_review(array $review, array $raw): void {
    $db = db_open();
    $rid = $GLOBALS['_run_id'];
    if (!$db || !$rid) return;
    $stmt = $db->prepare('
        INSERT INTO reviews
            (run_id, unique_id, student_name, instructor, session_date,
             issue, confidence, flagged, prompt_hash, session_notes, schoolwork, justification)
        VALUES
            (:run, :uid, :name, :instr, :date,
             :issue, :conf, :flag, :phash, :notes, :school, :just)
    ');
    $stmt->bindValue(':run',    $rid,                                 SQLITE3_INTEGER);
    $stmt->bindValue(':uid',    $review['unique_id']     ?? '',       SQLITE3_TEXT);
    $stmt->bindValue(':name',   $review['student_name']  ?? '',       SQLITE3_TEXT);
    $stmt->bindValue(':instr',  $review['instructor']    ?? '',       SQLITE3_TEXT);
    $stmt->bindValue(':date',   $raw['AttendanceDateStr'] ?? '',      SQLITE3_TEXT);
    $stmt->bindValue(':issue',  $review['reason']        ?? '',       SQLITE3_TEXT);
    $stmt->bindValue(':conf',   (float)($review['confidence'] ?? 0), SQLITE3_FLOAT);
    $stmt->bindValue(':flag',   (int)($review['needs_review']
                                      ?? ($review['confidence'] ?? 0) >= 0.4
                                      && ($review['reason'] ?? 'none') !== 'none'), SQLITE3_INTEGER);
    $stmt->bindValue(':phash',  compute_prompt_hash(),                SQLITE3_TEXT);
    $stmt->bindValue(':notes',  substr($raw['SessionNotes']          ?? '', 0, 2000), SQLITE3_TEXT);
    $stmt->bindValue(':school', substr($raw['SchoolworkDescription'] ?? '', 0, 500),  SQLITE3_TEXT);
    $stmt->bindValue(':just',   $review['justification'] ?? '',       SQLITE3_TEXT);
    $stmt->execute();
}

function db_log(string $level, string $msg): void {
    $db = db_open();
    if (!$db) return;
    $stmt = $db->prepare('INSERT INTO log_lines (run_id, ts, level, msg) VALUES (:r, :t, :l, :m)');
    $stmt->bindValue(':r', $GLOBALS['_run_id'], SQLITE3_INTEGER);
    $stmt->bindValue(':t', time(),              SQLITE3_INTEGER);
    $stmt->bindValue(':l', $level,              SQLITE3_TEXT);
    $stmt->bindValue(':m', $msg,                SQLITE3_TEXT);
    $stmt->execute();
}

function log_msg(string $level, string $msg): void {
    $line = '[' . date('Y-m-d H:i:s') . '] [' . $level . '] ' . $msg . PHP_EOL;
    file_put_contents(LOG_FILE, $line, FILE_APPEND | LOCK_EX);
    echo $line;
    db_log($level, $msg);   // mirror to SQLite
}

function log_info(string $msg):  void { log_msg('INFO',  $msg); }
function log_warn(string $msg):  void { log_msg('WARN',  $msg); }
function log_error(string $msg): void { log_msg('ERROR', $msg); }

// ─── Config ───────────────────────────────────────────────────────────────────

function load_env(string $path): void {
    if (!file_exists($path)) {
        log_error(".env file not found at: $path");
        exit(1);
    }
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (str_starts_with(trim($line), '#') || !str_contains($line, '=')) continue;
        [$key, $val] = explode('=', $line, 2);
        $_ENV[trim($key)] = trim($val, " \t\"'");
    }
}

load_env(SCRIPT_DIR . '/.env');

$cfg = [
    'radius_username'   => $_ENV['RADIUS_USERNAME']     ?? '',
    'radius_password'   => $_ENV['RADIUS_PASSWORD']     ?? '',
    'openrouter_key'    => $_ENV['OPENROUTER_API_KEY']  ?? '',
    'openrouter_model'  => $_ENV['OPENROUTER_MODEL']    ?? 'openai/gpt-4o-mini',
    'to_email'          => $_ENV['TO_EMAIL']            ?? 'joshua.shew.mathnasium@gmail.com',
    'from_email'        => $_ENV['FROM_EMAIL']          ?? 'noreply@mathsense.com',
    'from_name'         => $_ENV['FROM_NAME']           ?? 'Mathnasium Fresh Pond',
    'center_id'         => (int)($_ENV['RADIUS_CENTER_ID'] ?? 2460),
    'smtp_host'         => $_ENV['SMTP_HOST']           ?? '',
    'smtp_port'         => (int)($_ENV['SMTP_PORT']     ?? 587),
    'smtp_user'         => $_ENV['SMTP_USER']           ?? '',
    'smtp_pass'         => $_ENV['SMTP_PASS']           ?? '',
    'min_confidence'    => (float)($_ENV['MIN_CONFIDENCE'] ?? 0.4),
    'batch_size'        => (int)($_ENV['BATCH_SIZE']    ?? 50),
    'log_query_key'     => $_ENV['LOG_QUERY_KEY']       ?? '',
    'retain_days'       => (int)($_ENV['RETAIN_DAYS']    ?? 90),
];

foreach (['radius_username', 'radius_password', 'openrouter_key'] as $req) {
    if (empty($cfg[$req])) {
        log_error("Missing required config: $req");
        exit(1);
    }
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

class HttpClient {
    private $ch;
    private array $cookies = [];

    public function __construct() {
        $this->ch = curl_init();
        curl_setopt_array($this->ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_USERAGENT      => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_COOKIEFILE     => '',   // enable cookie jar in memory
            CURLOPT_COOKIEJAR      => '',
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_HEADER         => true,
        ]);
    }

    public function get(string $url, array $extra_headers = []): array {
        curl_setopt($this->ch, CURLOPT_HTTPGET, true);
        curl_setopt($this->ch, CURLOPT_URL, $url);
        curl_setopt($this->ch, CURLOPT_HTTPHEADER, $extra_headers);
        return $this->exec($url);
    }

    public function post_form(string $url, array $data, array $extra_headers = []): array {
        curl_setopt($this->ch, CURLOPT_POST, true);
        curl_setopt($this->ch, CURLOPT_URL, $url);
        curl_setopt($this->ch, CURLOPT_POSTFIELDS, http_build_query($data));
        curl_setopt($this->ch, CURLOPT_HTTPHEADER, array_merge(
            ['Content-Type: application/x-www-form-urlencoded'],
            $extra_headers
        ));
        return $this->exec($url);
    }

    public function post_json(string $url, array $data, array $headers = [], int $timeout = 30): array {
        $body = json_encode($data);
        curl_setopt($this->ch, CURLOPT_POST, true);
        curl_setopt($this->ch, CURLOPT_URL, $url);
        curl_setopt($this->ch, CURLOPT_POSTFIELDS, $body);
        curl_setopt($this->ch, CURLOPT_TIMEOUT, $timeout);
        curl_setopt($this->ch, CURLOPT_HTTPHEADER, array_merge(
            ['Content-Type: application/json', 'Content-Length: ' . strlen($body)],
            $headers
        ));
        return $this->exec($url);
    }

    private function exec(string $url): array {
        $raw   = curl_exec($this->ch);
        $info  = curl_getinfo($this->ch);
        $errno = curl_errno($this->ch);

        if ($errno) {
            throw new RuntimeException("cURL error $errno: " . curl_error($this->ch) . " → $url");
        }

        $header_size = $info['header_size'];
        $headers_raw = substr($raw, 0, $header_size);
        $body        = substr($raw, $header_size);

        return [
            'status'  => $info['http_code'],
            'headers' => $headers_raw,
            'body'    => $body,
            'url'     => $info['effective_url'],
        ];
    }

    public function __destruct() {
        if ($this->ch) curl_close($this->ch);
    }
}

// ─── Radius client ────────────────────────────────────────────────────────────

const RADIUS_BASE = 'https://radius.mathnasium.com';

class RadiusSession {
    private HttpClient $http;
    private int $center_id;
    private array $csrf_cache = [];

    public function __construct(HttpClient $http, int $center_id) {
        $this->http      = $http;
        $this->center_id = $center_id;
    }

    public static function login(string $username, string $password, int $center_id = 2460): self {
        $http = new HttpClient();

        // Step 1: Get login page + CSRF token
        log_info('Fetching Radius login page');
        $resp = $http->get(RADIUS_BASE . '/Account/Login');
        if ($resp['status'] !== 200) {
            throw new RuntimeException("Login page returned HTTP {$resp['status']}");
        }
        $csrf = self::extract_csrf($resp['body']);

        // Step 2: POST credentials
        log_info("Logging in as $username");
        $resp = $http->post_form(RADIUS_BASE . '/Account/Login?ReturnUrl=%2F', [
            '__RequestVerificationToken' => $csrf,
            'UserName'                   => $username,
            'Password'                   => $password,
        ]);
        // Check for auth cookie in response headers
        if (!str_contains($resp['headers'], '.AspNet.ApplicationCookie')) {
            throw new RuntimeException('Login failed — no auth cookie in response. Check credentials.');
        }
        log_info('Login successful');

        // Step 3: Fetch home page + set center
        $resp = $http->get(RADIUS_BASE . '/');
        $home_csrf = self::extract_csrf($resp['body']);

        log_info("Setting center to Fresh Pond (center_id=$center_id)");
        $resp = $http->post_form(
            RADIUS_BASE . '/Base/SetGlobalSingleCenterOrVc',
            [
                'center'                     => (string)$center_id,
                'IsVirtual'                  => 'false',
                '__RequestVerificationToken' => $home_csrf,
            ],
            ['X-Requested-With: XMLHttpRequest']
        );
        $data = json_decode($resp['body'], true);
        if (empty($data['Success'])) {
            throw new RuntimeException('SetCenter failed: ' . json_encode($data));
        }
        log_info("Center set: {$data['ctrName']}");

        $session = new self($http, $center_id);
        $session->csrf_cache[RADIUS_BASE . '/'] = $home_csrf;
        return $session;
    }

    public function get_notes_for_date(?string $ymd = null): array {
        // ymd format: 'YYYY-MM-DD'. Defaults to today.
        $fetch_date = $ymd
            ? date('n/j/Y', strtotime($ymd))
            : date('n/j/Y');

        // Fetch CSRF token from the DWP Report page
        $csrf_page_url = RADIUS_BASE . '/DigitalWorkoutPlan/Report';
        if (!isset($this->csrf_cache[$csrf_page_url])) {
            log_info('Fetching CSRF token from DWP Report page');
            $resp = $this->http->get($csrf_page_url);
            $this->csrf_cache[$csrf_page_url] = self::extract_csrf($resp['body']);
        }
        $csrf = $this->csrf_cache[$csrf_page_url];

        $all_rows = [];
        $page     = 1;
        $total    = null;

        log_info("Fetching DWP notes for $fetch_date (center_id={$this->center_id})");

        do {
            $resp = $this->http->post_form(
                RADIUS_BASE . '/DigitalWorkoutPlan/ReportData_Read',
                [
                    'FromDate'         => $fetch_date . ' 12:00:00 AM',
                    'ToDate'           => $fetch_date . ' 12:00:00 AM',
                    'CenterIds'        => (string)$this->center_id,
                    'VirtualCenterIds' => '',
                    'StudentId'        => '',
                    'InstructorId'     => '',
                    'DeliveryMethod'   => '',
                    'AttendanceStatus' => '',
                    'DwpStatus'        => '',
                    'sort'             => '',
                    'page'             => (string)$page,
                    'pageSize'         => '500',
                    'group'            => '',
                    'filter'           => '',
                ],
                ['__RequestVerificationToken: ' . $csrf]
            );

            if ($resp['status'] !== 200) {
                throw new RuntimeException("DWP fetch failed HTTP {$resp['status']}");
            }

            $data = json_decode($resp['body'], true);
            if ($data === null) {
                throw new RuntimeException('DWP response is not valid JSON: ' . substr($resp['body'], 0, 200));
            }

            if ($total === null) {
                $total = (int)($data['Total'] ?? 0);
                log_info("DWP Total for $fetch_date: $total records");
            }

            $rows = $data['Data'] ?? [];
            $all_rows = array_merge($all_rows, $rows);
            $page++;

        } while (count($all_rows) < $total && count($rows) > 0);

        log_info('Fetched ' . count($all_rows) . ' DWP records');
        return $all_rows;
    }

    // Kept for backwards compat
    public function get_today_notes(): array {
        return $this->get_notes_for_date();
    }

    private static function extract_csrf(string $html): string {
        // Match: <input name="__RequestVerificationToken" type="hidden" value="TOKEN" />
        // Radius uses multiple attribute orderings — try all common patterns
        $patterns = [
            '/__RequestVerificationToken[^>]+value="([^"]+)"/',
            '/name="__RequestVerificationToken"[^>]*value="([^"]+)"/',
            '/value="([^"]+)"[^>]*name="__RequestVerificationToken"/',
        ];
        foreach ($patterns as $pat) {
            if (preg_match($pat, $html, $m)) {
                return $m[1];
            }
        }
        throw new RuntimeException('CSRF token not found in HTML response');
    }
}

// ─── Data formatting ──────────────────────────────────────────────────────────

/**
 * Map raw Radius API fields to the field names the review prompt expects.
 *
 * Field names confirmed from types.py + XLSX export observation.
 * Run with --probe on first deploy to log all available raw keys.
 */
function format_row_as_markdown(array $row, string $unique_id): string {
    // Confirmed field names from Python types.py + DWP export
    $date        = $row['AttendanceDateStr']     ?? ($row['AttendanceDate'] ?? '');
    $student     = $row['StudentName']           ?? '';
    $start       = $row['SessionStartTimeExport'] ?? ($row['SessionStartTime'] ?? '');
    $end         = $row['SessionEndTimeExport']   ?? ($row['SessionEndTime']   ?? '');
    $instructor  = $row['InstructorsExport']      ?? ($row['Instructors']     ?? '');
    $schoolwork  = $row['SchoolworkDescription']  ?? '';   // MUST always be empty
    $session_notes   = $row['SessionNotes']       ?? '';   // sent to guardians
    $student_notes   = $row['StudentNotes']       ?? '';   // instructor context
    $internal_notes  = $row['InternalNotes']      ?? '';   // staff only
    $cd_notes        = $row['CDNotes']            ?? '';   // center director
    $lp_assignment   = $row['LPAssignment']       ?? ($row['DwpLPAssignment'] ?? '');

    $pages_completed = (string)($row['NumberOfPagesCompleted'] ?? ($row['PagesCompleted'] ?? ''));
    $page_goal       = (string)($row['SessionPageGoal']        ?? ($row['PageGoal']       ?? ''));

    return implode("\n", [
        "--- Row ID: $unique_id ---",
        "Date: $date",
        "Student Name: $student",
        "Session Start: $start",
        "Session End: $end",
        "Instructors: $instructor",
        "Pages Completed: $pages_completed",
        "Session Goal (pages): $page_goal",
        "Schoolwork Description: $schoolwork",
        "Session Summary Notes: $session_notes",
        "Student Notes: $student_notes",
        "Internal Notes: $internal_notes",
        "Notes from Center Director: $cd_notes",
        "LP Assignment: $lp_assignment",
    ]);
}

function assign_ids(array $rows): array {
    $chars  = '0123456789abcdefghijklmnopqrstuvwxyz';
    $used   = [];
    $result = [];
    foreach ($rows as $idx => $row) {
        do {
            $id = '';
            for ($i = 0; $i < 5; $i++) {
                $id .= $chars[random_int(0, strlen($chars) - 1)];
            }
        } while (in_array($id, $used));
        $used[] = $id;
        $result[] = ['id' => $id, 'data' => $row, 'original_idx' => $idx];
    }
    return $result;
}

// ─── OpenRouter API call ──────────────────────────────────────────────────────

function call_openrouter(string $api_key, string $model, string $system_prompt, string $user_content): array {
    $http = new HttpClient();

    // System prompt goes in the messages array (standard OpenAI-compatible format).
    // Top-level "system" is Anthropic-specific and is silently dropped by some providers.
    $body = [
        'model'      => $model,
        'max_tokens' => 16000,
        'messages'   => [
            ['role' => 'system', 'content' => $system_prompt],
            ['role' => 'user',   'content' => $user_content],
        ],
    ];

    // 120s timeout: large system prompt + 50 sessions can take 30-60s for inference
    $resp = $http->post_json(
        'https://openrouter.ai/api/v1/chat/completions',
        $body,
        [
            'Authorization: Bearer ' . $api_key,
            'HTTP-Referer: https://mathsense.com',
            'X-Title: Mathnasium Session Notes Checker',
        ],
        120
    );

    if ($resp['status'] !== 200) {
        throw new RuntimeException("OpenRouter HTTP {$resp['status']}: " . substr($resp['body'], 0, 800));
    }

    $data = json_decode($resp['body'], true);
    if ($data === null) {
        throw new RuntimeException("OpenRouter response not valid JSON: " . substr($resp['body'], 0, 400));
    }

    $content = $data['choices'][0]['message']['content'] ?? '';

    if (DEBUG_MODE) {
        log_info('RAW API RESPONSE: ' . substr($resp['body'], 0, 2000));
        log_info('RAW CONTENT: ' . substr($content, 0, 1000));
    }

    // Strip all markdown fence variants
    $content = preg_replace('/^```[a-z]*\s*/m', '', $content);
    $content = preg_replace('/^```\s*$/m', '', $content);
    $content = trim($content);

    $parsed = json_decode($content, true);

    // Handle both {"reviews":[...]} and bare [...] array responses
    if ($parsed === null) {
        throw new RuntimeException("Model returned non-JSON. Content: " . substr($content, 0, 600));
    }
    if (is_array($parsed) && isset($parsed[0])) {
        // Bare array — wrap it
        $reviews = $parsed;
    } elseif (isset($parsed['reviews'])) {
        $reviews = $parsed['reviews'];
    } else {
        throw new RuntimeException("Unexpected JSON shape (no 'reviews' key, not bare array). Content: " . substr($content, 0, 400));
    }

    $usage = $data['usage'] ?? [];
    $GLOBALS['_usage']['input_tokens']  += (int)($usage['prompt_tokens']     ?? 0);
    $GLOBALS['_usage']['output_tokens'] += (int)($usage['completion_tokens'] ?? 0);
    $GLOBALS['_usage']['cost_usd']      += (float)($usage['cost']            ?? 0);
    log_info(sprintf(
        'OpenRouter usage — model: %s, input: %d tokens, output: %d tokens, cost: $%.6f',
        $model,
        $usage['prompt_tokens'] ?? 0,
        $usage['completion_tokens'] ?? 0,
        $usage['cost'] ?? 0
    ));

    return $reviews;
}

// ─── Batch processing ─────────────────────────────────────────────────────────

function process_in_batches(array $enriched_rows, string $api_key, string $model, string $system_prompt, int $batch_size): array {
    $all_reviews = [];
    $batches     = array_chunk($enriched_rows, $batch_size);
    $total       = count($enriched_rows);

    log_info("Processing $total records in " . count($batches) . " batch(es) of up to $batch_size");

    foreach ($batches as $batch_num => $batch) {
        $batch_label = ($batch_num + 1) . '/' . count($batches);
        log_info("Batch $batch_label — " . count($batch) . " records");

        // Build markdown KV block
        $blocks = array_map(
            fn($r) => format_row_as_markdown($r['data'], $r['id']),
            $batch
        );
        $user_content = "Analyze these session records:\n\n<session_data>\n"
            . implode("\n\n", $blocks)
            . "\n</session_data>";

        $max_retries = 3;
        $attempt     = 0;

        while ($attempt < $max_retries) {
            try {
                $reviews = call_openrouter($api_key, $model, $system_prompt, $user_content);
                // Map reviews back to original indices
                $id_to_row = [];
                foreach ($batch as $r) {
                    $id_to_row[$r['id']] = $r;
                }
                foreach ($reviews as &$review) {
                    $uid = $review['unique_id'] ?? '';
                    if (isset($id_to_row[$uid])) {
                        $review['original_idx'] = $id_to_row[$uid]['original_idx'];
                        $review['raw_data']     = $id_to_row[$uid]['data'];
                    }
                }
                $all_reviews = array_merge($all_reviews, $reviews);
                log_info("Batch $batch_label complete — " . count($reviews) . " reviews");
                break;
            } catch (Exception $e) {
                $attempt++;
                if ($attempt >= $max_retries) {
                    log_error("Batch $batch_label failed after $max_retries attempts: " . $e->getMessage());
                    // Add failure placeholders
                    foreach ($batch as $r) {
                        $all_reviews[] = [
                            'unique_id'     => $r['id'],
                            'student_name'  => $r['data']['StudentName'] ?? 'Unknown',
                            'student_id'    => preg_replace('/.*\[(\d+)\].*/', '$1', $r['data']['StudentName'] ?? ''),
                            'instructor'    => $r['data']['InstructorsExport'] ?? '',
                            'confidence'    => 1.0,
                            'needs_review'  => true,
                            'reason'        => 'api_failure',
                            'justification' => 'AI review failed — requires manual inspection.',
                            'original_idx'  => $r['original_idx'],
                            'raw_data'      => $r['data'],
                        ];
                    }
                } else {
                    $wait = pow(2, $attempt);
                    log_warn("Batch $batch_label attempt $attempt failed, retrying in {$wait}s: " . $e->getMessage());
                    sleep($wait);
                }
            }
        }
    }

    return $all_reviews;
}

// ─── Email report ─────────────────────────────────────────────────────────────

function build_email_html(array $flagged, array $all_reviews, string $date_str, string $model): string {
    $total   = count($all_reviews);
    $n_flag  = count($flagged);
    $n_clean = $total - $n_flag;
    $ts      = date('g:i A');

    $reason_labels = [
        'language_issues'     => 'Language Issues',
        'missing_summary'     => 'Missing Summary',
        'schoolwork_not_empty'=> 'Content in Schoolwork',
        'guardian_in_internal'=> 'Guardian Content Misplaced',
        'name_mismatch'       => 'Name Mismatch',
        'behavior_no_strategy'=> 'Behavior Without Strategy',
        'poor_fit_suggestion' => 'Poor Fit Suggestion',
        'api_failure'         => 'Review Failed',
        'other'               => 'Other',
        'none'                => 'No Issues',
    ];

    $confidence_color = function(float $c): string {
        if ($c >= 0.7) return '#991b1b';  // red — high
        if ($c >= 0.4) return '#ea580c';  // orange — medium
        return '#65a30d';                  // green — low
    };

    // Sort flagged: high confidence first
    usort($flagged, fn($a, $b) => ($b['confidence'] ?? 0) <=> ($a['confidence'] ?? 0));

    $rows_html = '';
    if ($n_flag === 0) {
        $rows_html = '<p style="color:#166534;background:#dcfce7;padding:12px 16px;border-radius:6px;margin:0">
            ✓ No issues found in today\'s ' . $total . ' session notes.
        </p>';
    } else {
        foreach ($flagged as $r) {
            $conf  = (float)($r['confidence'] ?? 0);
            $color = $confidence_color($conf);
            $pct   = round($conf * 100);
            $label = $reason_labels[$r['reason'] ?? ''] ?? ($r['reason'] ?? '');
            $name  = htmlspecialchars($r['student_name'] ?? 'Unknown');
            $instr = htmlspecialchars($r['instructor']   ?? '');
            $just  = htmlspecialchars($r['justification'] ?? '');

            // Show the actual session notes for context — no arbitrary truncation.
            // Safety cap at 1500 chars with ellipsis in case of genuinely abnormal data.
            $raw    = $r['raw_data'] ?? [];
            $raw_notes  = $raw['SessionNotes']  ?? '';
            $raw_intern = $raw['InternalNotes'] ?? '';
            $notes  = htmlspecialchars(strlen($raw_notes)  > 1500 ? substr($raw_notes,  0, 1500) . '…' : $raw_notes);
            $school = htmlspecialchars($raw['SchoolworkDescription'] ?? '');
            $intern = htmlspecialchars(strlen($raw_intern) > 1500 ? substr($raw_intern, 0, 1500) . '…' : $raw_intern);
            $date   = htmlspecialchars($raw['AttendanceDateStr']     ?? '');

            $rows_html .= "
            <tr style='border-bottom:1px solid #e5e7eb'>
              <td style='padding:12px 8px;vertical-align:top'>
                <div style='font-weight:600;font-size:14px'>{$name}</div>
                <div style='font-size:12px;color:#6b7280;margin-top:2px'>{$instr}</div>
                <div style='font-size:11px;color:#9ca3af;margin-top:2px'>{$date}</div>
              </td>
              <td style='padding:12px 8px;vertical-align:top'>
                <span style='display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;background:{$color}1a;color:{$color}'>{$label}</span>
              </td>
              <td style='padding:12px 8px;vertical-align:top;font-size:12px;color:{$color};font-weight:700'>{$pct}%</td>
              <td style='padding:12px 8px;vertical-align:top;font-size:13px;color:#374151'>
                <div>{$just}</div>";

            if ($notes) {
                $rows_html .= "<div style='margin-top:6px;padding:6px 10px;background:#f9fafb;border-left:3px solid #d1d5db;font-size:12px;color:#6b7280;font-style:italic'>{$notes}</div>";
            }
            if ($school) {
                $rows_html .= "<div style='margin-top:4px;padding:4px 8px;background:#fef3c7;border-left:3px solid #f59e0b;font-size:12px;color:#92400e'>Schoolwork field: {$school}</div>";
            }
            if ($intern) {
                $rows_html .= "<div style='margin-top:4px;padding:4px 8px;background:#fdf4ff;border-left:3px solid #a855f7;font-size:12px;color:#6b21a8'>Internal notes: {$intern}</div>";
            }

            $rows_html .= "      </td>
            </tr>";
        }
    }

    $table_html = $n_flag > 0 ? "
    <table style='width:100%;border-collapse:collapse;margin-top:16px;font-family:system-ui,sans-serif'>
      <thead>
        <tr style='background:#f3f4f6'>
          <th style='padding:10px 8px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em'>Student</th>
          <th style='padding:10px 8px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em'>Issue</th>
          <th style='padding:10px 8px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em'>Confidence</th>
          <th style='padding:10px 8px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em'>Detail</th>
        </tr>
      </thead>
      <tbody>{$rows_html}</tbody>
    </table>" : $rows_html;

    $flag_badge = $n_flag > 0
        ? "<span style='background:#fef2f2;color:#991b1b;border:1px solid #fecaca;border-radius:9999px;padding:4px 12px;font-size:14px;font-weight:700'>{$n_flag} need review</span>"
        : "<span style='background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:9999px;padding:4px 12px;font-size:14px;font-weight:700'>All clear</span>";

    return "<!DOCTYPE html><html><head><meta charset='utf-8'></head><body style='margin:0;padding:0;background:#f9fafb;font-family:system-ui,sans-serif'>
<div style='max-width:700px;margin:24px auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden'>

  <div style='background:#1a2332;padding:20px 24px'>
    <div style='color:#f1faee;font-size:18px;font-weight:700'>Session Notes Review</div>
    <div style='color:#a8dadc;font-size:13px;margin-top:4px'>Mathnasium Fresh Pond · {$date_str} · {$ts}</div>
  </div>

  <div style='padding:20px 24px'>
    <div style='display:flex;align-items:center;gap:16px;flex-wrap:wrap'>
      {$flag_badge}
      <span style='font-size:13px;color:#6b7280'>{$total} total sessions reviewed · {$n_clean} clean</span>
    </div>

    {$table_html}

    <div style='margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af'>
      Automated review via <a href='https://mathsense.com/session-notes/' style='color:#2d8b8b'>mathsense.com/session-notes</a> ·
      Model: {$model} · Confidence threshold: ≥40%
    </div>
  </div>
</div>
</body></html>";
}

function send_email(string $to, string $from_addr, string $from_name, string $subject, string $html, array $smtp_cfg): bool {
    // If SMTP credentials are configured, use SMTP; otherwise fall back to PHP mail()
    if (!empty($smtp_cfg['host']) && !empty($smtp_cfg['user'])) {
        return send_via_smtp($to, $from_addr, $from_name, $subject, $html, $smtp_cfg);
    }
    return send_via_phpmail($to, $from_addr, $from_name, $subject, $html);
}

function send_via_phpmail(string $to, string $from, string $from_name, string $subject, string $html): bool {
    $boundary = 'MP_' . md5(time());
    $headers  = implode("\r\n", [
        "From: $from_name <$from>",
        "Reply-To: $from",
        "MIME-Version: 1.0",
        "Content-Type: multipart/alternative; boundary=\"$boundary\"",
        "X-Mailer: Mathnasium-SessionCheck/1.0",
    ]);
    $text   = 'Please view this email in an HTML-capable client.';
    $body   = "--$boundary\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n$text\r\n"
            . "--$boundary\r\nContent-Type: text/html; charset=utf-8\r\n\r\n$html\r\n"
            . "--$boundary--";
    $result = mail($to, $subject, $body, $headers);
    if ($result) {
        log_info("Email sent via mail() to $to");
    } else {
        log_error("mail() returned false");
    }
    return $result;
}

function send_via_smtp(string $to, string $from, string $from_name, string $subject, string $html, array $cfg): bool {
    // Minimal SMTP implementation using sockets (no external libraries required)
    $host = $cfg['host'];
    $port = $cfg['port'];
    $user = $cfg['user'];
    $pass = $cfg['pass'];

    $sock = @fsockopen(($port === 465 ? 'ssl://' : '') . $host, $port, $errno, $errstr, 15);
    if (!$sock) {
        log_error("SMTP connect failed: $errstr ($errno)");
        return false;
    }

    $read = function() use ($sock): string {
        $resp = '';
        while ($line = fgets($sock, 515)) {
            $resp .= $line;
            if ($line[3] === ' ') break;
        }
        return $resp;
    };

    $cmd = function(string $c) use ($sock, $read): string {
        fwrite($sock, $c . "\r\n");
        return $read();
    };

    try {
        $read(); // greeting
        $r = $cmd("EHLO mathsense.com");

        if ($port === 587) {
            $cmd("STARTTLS");
            stream_socket_enable_crypto($sock, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
            $cmd("EHLO mathsense.com");
        }

        $cmd("AUTH LOGIN");
        $cmd(base64_encode($user));
        $r = $cmd(base64_encode($pass));
        if (!str_starts_with($r, '2')) {
            throw new RuntimeException("SMTP AUTH failed: $r");
        }

        $cmd("MAIL FROM:<$from>");
        $cmd("RCPT TO:<$to>");
        $cmd("DATA");

        $boundary = 'MP_' . md5(time());
        $msg = "From: $from_name <$from>\r\n"
             . "To: $to\r\n"
             . "Subject: $subject\r\n"
             . "MIME-Version: 1.0\r\n"
             . "Content-Type: multipart/alternative; boundary=\"$boundary\"\r\n"
             . "\r\n"
             . "--$boundary\r\n"
             . "Content-Type: text/plain; charset=utf-8\r\n\r\n"
             . "Please view this email in an HTML-capable client.\r\n"
             . "--$boundary\r\n"
             . "Content-Type: text/html; charset=utf-8\r\n\r\n"
             . $html . "\r\n"
             . "--$boundary--\r\n";

        fwrite($sock, $msg . "\r\n.\r\n");
        $r = $read();
        if (!str_starts_with($r, '2')) {
            throw new RuntimeException("SMTP DATA rejected: $r");
        }

        $cmd("QUIT");
        fclose($sock);
        log_info("Email sent via SMTP to $to");
        return true;

    } catch (Exception $e) {
        log_error("SMTP error: " . $e->getMessage());
        @fclose($sock);
        return false;
    }
}

// ─── System prompt (loaded from file or inline) ───────────────────────────────

function load_system_prompt(): string {
    $file = SCRIPT_DIR . '/review_prompt.txt';
    if (file_exists($file)) {
        return trim(file_get_contents($file));
    }
    // Fallback: minimal inline prompt if the file is missing
    // (should not happen in production — the full prompt is in review_prompt.txt)
    return 'You are a quality assurance system for Mathnasium session notes. '
         . 'Review the records and return a JSON object with a "reviews" array. '
         . 'Each review must have: unique_id, student_name, student_id, instructor, '
         . 'confidence (0-1), needs_review (bool), reason (see categories below), '
         . 'justification. Categories: language_issues, missing_summary, '
         . 'schoolwork_not_empty, guardian_in_internal, name_mismatch, '
         . 'behavior_no_strategy, poor_fit_suggestion, none, other. '
         . 'Return ONLY valid JSON.';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

$start_time = microtime(true);
$mode = IS_RERUN ? 'rerun' : (PROBE_MODE ? 'probe' : (DEBUG_MODE ? 'debug' : 'cron'));
$run_date = IS_RERUN ? DATE_ARG : date('Y-m-d');

db_start_run($mode);
log_info('=== Session Notes Daily Check starting ===');
log_info('Date: ' . $run_date . ' | Model: ' . $cfg['openrouter_model']
    . ' | Mode: ' . $mode . ' | Prompt: ' . compute_prompt_hash());

// Retention: prune old data on cron runs only
if ($mode === 'cron' && $cfg['retain_days'] > 0) {
    db_retain($cfg['retain_days']);
}

try {
    // 1. Login to Radius
    $radius = RadiusSession::login(
        $cfg['radius_username'],
        $cfg['radius_password'],
        $cfg['center_id']
    );

    // 2. Fetch DWP notes (today, or historical date for reruns)
    $raw_rows = $radius->get_notes_for_date(DATE_ARG ?: null);

    if (PROBE_MODE) {
        // Log all raw field names from first record for verification
        if (!empty($raw_rows)) {
            $keys = array_keys($raw_rows[0]);
            sort($keys);
            log_info('PROBE — Raw field names from first record:');
            foreach ($keys as $k) {
                $val = $raw_rows[0][$k];
                $preview = is_string($val) ? substr($val, 0, 80) : json_encode($val);
                log_info("  $k: $preview");
            }
        }
    }

    if (empty($raw_rows)) {
        log_info('No DWP records for today — nothing to review');
        // Optionally send a brief "all clear" email
        if (($_ENV['SEND_EMPTY_REPORT'] ?? 'false') === 'true') {
            $date_str = date('l, F j');
            $html = build_email_html([], [], $date_str, $cfg['openrouter_model']);
            $subject = "Session Notes — No sessions today ($date_str)";
            send_email($cfg['to_email'], $cfg['from_email'], $cfg['from_name'], $subject, $html, [
                'host' => $cfg['smtp_host'], 'port' => $cfg['smtp_port'],
                'user' => $cfg['smtp_user'], 'pass' => $cfg['smtp_pass'],
            ]);
        }
        exit(0);
    }

    // 3. Assign unique IDs and format
    $enriched = assign_ids($raw_rows);
    log_info('Assigned IDs to ' . count($enriched) . ' records');

    // Debug mode: truncate to 3 records to test the API call cheaply
    if (DEBUG_MODE) {
        $enriched = array_slice($enriched, 0, 3);
        log_info('DEBUG MODE: truncated to ' . count($enriched) . ' records');
    }

    // 4. Load system prompt
    $system_prompt = load_system_prompt();
    log_info('System prompt loaded (' . strlen($system_prompt) . ' chars)');

    // 5. Process via OpenRouter
    $all_reviews = process_in_batches(
        $enriched,
        $cfg['openrouter_key'],
        $cfg['openrouter_model'],
        $system_prompt,
        $cfg['batch_size']
    );

    // 6. Filter to flagged items
    $flagged = array_values(array_filter(
        $all_reviews,
        fn($r) => ($r['confidence'] ?? 0) >= $cfg['min_confidence']
                  && ($r['reason'] ?? 'none') !== 'none'
    ));

    log_info('Review complete — ' . count($all_reviews) . ' total, ' . count($flagged) . ' flagged');

    // Write all reviews to SQLite
    $n_failed = 0;
    foreach ($all_reviews as $review) {
        $raw = $review['raw_data'] ?? [];
        db_insert_review($review, $raw);
        if (($review['reason'] ?? '') === 'api_failure') $n_failed++;
    }

    // 7. Build and send email
    $date_str  = IS_RERUN
        ? date('l, F j', strtotime(DATE_ARG))
        : date('l, F j');
    $n_flag    = count($flagged);
    $prefix    = IS_RERUN ? '[RERUN ' . DATE_ARG . '] ' : '';
    $subject   = $n_flag > 0
        ? "{$prefix}Session Notes — {$n_flag} item(s) need review ($date_str)"
        : "{$prefix}Session Notes — All clear ($date_str)";

    $html = build_email_html($flagged, $all_reviews, $date_str, $cfg['openrouter_model']);

    if (DEBUG_MODE) {
        log_info('DEBUG MODE: skipping email send. Review results above.');
        log_info("Would send: $subject");
        $elapsed = round(microtime(true) - $start_time, 1);
        db_finish_run(['n_sessions' => count($all_reviews), 'n_flagged' => count($flagged),
                       'n_failed' => $n_failed, 'model' => $cfg['openrouter_model'],
                       'cost_usd' => $GLOBALS['_usage']['cost_usd'],
                       'input_tokens' => $GLOBALS['_usage']['input_tokens'],
                       'output_tokens' => $GLOBALS['_usage']['output_tokens'],
                       'elapsed_s' => $elapsed]);
        log_info("Done in {$elapsed}s.");
        exit(0);
    }

    $sent = send_email(
        $cfg['to_email'],
        $cfg['from_email'],
        $cfg['from_name'],
        $subject,
        $html,
        [
            'host' => $cfg['smtp_host'],
            'port' => $cfg['smtp_port'],
            'user' => $cfg['smtp_user'],
            'pass' => $cfg['smtp_pass'],
        ]
    );

    $elapsed = round(microtime(true) - $start_time, 1);
    db_finish_run([
        'n_sessions'    => count($all_reviews),
        'n_flagged'     => count($flagged),
        'n_failed'      => $n_failed,
        'model'         => $cfg['openrouter_model'],
        'cost_usd'      => $GLOBALS['_usage']['cost_usd'],
        'input_tokens'  => $GLOBALS['_usage']['input_tokens'],
        'output_tokens' => $GLOBALS['_usage']['output_tokens'],
        'elapsed_s'     => $elapsed,
    ]);
    log_info("Done in {$elapsed}s. Sent: " . ($sent ? 'yes' : 'no'));

} catch (Exception $e) {
    log_error('Fatal: ' . $e->getMessage());
    log_error($e->getTraceAsString());

    $elapsed = round(microtime(true) - $start_time, 1);
    db_finish_run(['elapsed_s' => $elapsed, 'error' => $e->getMessage(),
                   'model' => $cfg['openrouter_model'] ?? '']);

    // Send error notification
    $err_subject = 'Session Notes Check FAILED — ' . date('Y-m-d');
    $err_html    = "<p>The automated session notes check failed.</p><pre>" . htmlspecialchars($e->getMessage()) . "</pre>";
    send_email(
        $cfg['to_email'],
        $cfg['from_email'],
        $cfg['from_name'],
        $err_subject,
        $err_html,
        ['host' => $cfg['smtp_host'], 'port' => $cfg['smtp_port'],
         'user' => $cfg['smtp_user'], 'pass' => $cfg['smtp_pass']]
    );
    exit(1);
}
