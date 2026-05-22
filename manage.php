<?php
/**
 * Session Notes Checker — Management Endpoint
 *
 * Autonomous operational control for Claude sessions. No SSH needed.
 * Auth: X-Admin-Key header or ?admin_key=... matching LOG_QUERY_KEY in .env
 *
 * Operations (GET or POST ?op=...):
 *   status          → last 5 runs, DB stats, env summary
 *   git-pull        → pull latest code from GitHub (shell or manual fallback)
 *   deploy          → copy log-query.php + manage.php from repo to web root
 *   debug-run       → run daily_check.php --debug (3 records, no email)
 *   full-run        → run daily_check.php (production, sends email)
 *   test-exec       → check whether shell_exec is available
 *
 * Response: always JSON { ok: bool, op: str, output: str|array, ... }
 *
 * Deployed to: public_html/session-notes/manage.php
 * Source:      mathnasium-session-notes/manage.php
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
set_time_limit(180);

// ── Paths ────────────────────────────────────────────────────────────────────
// Use __DIR__ (always correct in web context) not $_SERVER['HOME'] (CLI only).
// manage.php lives at public_html/session-notes/ → two levels up is the home dir.

define('HOME_DIR',    dirname(dirname(__DIR__)));
define('REPO_DIR',    HOME_DIR . '/session-notes-checker');
define('CHECKER_DIR', REPO_DIR . '/cron-checker');
define('WEB_DIR',     __DIR__);
define('DB_PATH',     CHECKER_DIR . '/logs/sessions.sqlite');
define('ENV_PATH',    CHECKER_DIR . '/.env');
define('PHP_BIN',     '/usr/local/bin/ea-php83');

// ── Auth ─────────────────────────────────────────────────────────────────────

foreach (file(ENV_PATH, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
    if (str_starts_with(trim($line), '#') || !str_contains($line, '=')) continue;
    [$k, $v] = explode('=', $line, 2);
    if (!getenv(trim($k))) putenv(trim($k) . '=' . trim($v, " \t\"'"));
}
$expected = getenv('LOG_QUERY_KEY') ?: '';
$provided = $_SERVER['HTTP_X_ADMIN_KEY'] ?? $_GET['admin_key'] ?? $_POST['admin_key'] ?? '';
if (!$expected || !$provided || !hash_equals($expected, $provided)) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'unauthorized']);
    exit;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function can_exec(): bool {
    if (!function_exists('shell_exec')) return false;
    $disabled = array_map('trim', explode(',', ini_get('disable_functions')));
    return !in_array('shell_exec', $disabled, true)
        && !in_array('exec', $disabled, true);
}

function run_shell(string $cmd): array {
    $output = []; $code = 0;
    exec($cmd . ' 2>&1', $output, $code);
    return ['output' => implode("\n", $output), 'exit_code' => $code];
}

function db_query(string $sql): array {
    if (!file_exists(DB_PATH)) return [];
    $db = new SQLite3(DB_PATH, SQLITE3_OPEN_READONLY);
    $db->exec('PRAGMA busy_timeout=3000');
    $result = $db->query($sql);
    $rows = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) $rows[] = $row;
    return $rows;
}

// Manual GitHub-based file fetch (fallback when shell exec is disabled)
function github_fetch(string $repo, string $path): ?string {
    $url = "https://raw.githubusercontent.com/Jython1415/{$repo}/main/{$path}";
    $ctx = stream_context_create(['http' => ['timeout' => 15,
        'header' => "User-Agent: mathsense-manage/1.0\r\n"]]);
    $content = @file_get_contents($url, false, $ctx);
    return $content !== false ? $content : null;
}

function respond(array $data): void {
    echo json_encode($data, JSON_PRETTY_PRINT);
    exit;
}

// ── Operations ────────────────────────────────────────────────────────────────

$op = $_GET['op'] ?? $_POST['op'] ?? 'status';

// ── status ───────────────────────────────────────────────────────────────────
if ($op === 'status') {
    $runs = db_query('SELECT id, date, mode, n_sessions, n_flagged, n_failed,
                             model, prompt_hash, cost_usd, elapsed_s, error
                      FROM runs ORDER BY id DESC LIMIT 5');

    $db_size = file_exists(DB_PATH) ? round(filesize(DB_PATH) / 1024) . 'K' : 'none';

    $total_runs    = db_query('SELECT COUNT(*) AS n FROM runs')[0]['n'] ?? 0;
    $total_reviews = db_query('SELECT COUNT(*) AS n FROM reviews')[0]['n'] ?? 0;
    $total_cost    = db_query('SELECT ROUND(SUM(cost_usd),6) AS c FROM runs')[0]['c'] ?? 0;

    // ── Health synthesis ──────────────────────────────────────────────────────
    // Longest normal gap: Thursday 7:20 PM → Saturday 2:20 PM ≈ 43h.
    // warning if no successful cron run in >50h; critical if >90h.
    $last_cron = db_query(
        "SELECT ts, error, n_failed FROM runs WHERE mode='cron' ORDER BY id DESC LIMIT 1"
    )[0] ?? null;

    $hours_since = $last_cron ? round((time() - $last_cron['ts']) / 3600, 1) : null;
    $health_reasons = [];

    if (!$last_cron) {
        $health = 'warning';
        $health_reasons[] = 'no cron runs recorded yet';
    } elseif ($hours_since > 90) {
        $health = 'critical';
        $health_reasons[] = "last cron run was {$hours_since}h ago (>90h threshold)";
    } elseif ($last_cron['error']) {
        $health = 'warning';
        $health_reasons[] = 'last cron run ended with error: ' . $last_cron['error'];
    } elseif ($last_cron['n_failed'] > 0) {
        $health = 'warning';
        $health_reasons[] = "last cron run had {$last_cron['n_failed']} api_failure(s)";
    } elseif ($hours_since > 50) {
        $health = 'warning';
        $health_reasons[] = "last cron run was {$hours_since}h ago (>50h)";
    } else {
        $health = 'ok';
    }

    // ── Prompt sync check ─────────────────────────────────────────────────────
    $current_prompt_hash = file_exists(CHECKER_DIR . '/review_prompt.txt')
        ? substr(md5_file(CHECKER_DIR . '/review_prompt.txt'), 0, 8)
        : 'missing';
    $last_run_prompt_hash = $runs[0]['prompt_hash'] ?? null;
    $prompt_in_sync = !$last_run_prompt_hash || $last_run_prompt_hash === $current_prompt_hash;

    // ── Git status ────────────────────────────────────────────────────────────
    $git_log = can_exec()
        ? trim(run_shell('git -C ' . REPO_DIR . ' log --oneline -3')['output'])
        : '(shell exec disabled)';

    $model   = getenv('OPENROUTER_MODEL') ?: '?';
    $batch   = getenv('BATCH_SIZE') ?: '?';
    $conf    = getenv('MIN_CONFIDENCE') ?: '?';
    $retain  = getenv('RETAIN_DAYS') ?: '90';

    respond([
        'ok'     => true,
        'op'     => 'status',
        'health' => [
            'status'          => $health,
            'reasons'         => $health_reasons,
            'hours_since_run' => $hours_since,
        ],
        'prompt' => [
            'current_hash'    => $current_prompt_hash,
            'last_run_hash'   => $last_run_prompt_hash,
            'in_sync'         => $prompt_in_sync,
        ],
        'runs'   => $runs,
        'stats'  => [
            'total_runs'     => $total_runs,
            'total_reviews'  => $total_reviews,
            'total_cost_usd' => $total_cost,
            'db_size'        => $db_size,
            'retain_days'    => (int)$retain,
        ],
        'config'     => ['model' => $model, 'batch_size' => $batch, 'min_confidence' => $conf],
        'git_recent' => $git_log,
        'shell_exec' => can_exec(),
        'php_bin'    => PHP_BIN,
        'ts'         => date('Y-m-d H:i:s'),
    ]);
}

// ── test-exec ────────────────────────────────────────────────────────────────
if ($op === 'test-exec') {
    $result = can_exec() ? run_shell('echo OK && php --version | head -1') : null;
    respond([
        'ok'           => true,
        'op'           => 'test-exec',
        'can_exec'     => can_exec(),
        'shell_output' => $result,
    ]);
}

// ── git-pull ─────────────────────────────────────────────────────────────────
if ($op === 'git-pull') {
    if (can_exec()) {
        $r = run_shell('git -C ' . escapeshellarg(REPO_DIR) . ' pull --ff-only 2>&1');
        respond([
            'ok'        => $r['exit_code'] === 0,
            'op'        => 'git-pull',
            'method'    => 'shell',
            'output'    => $r['output'],
            'exit_code' => $r['exit_code'],
        ]);
    }

    // Fallback: fetch individual files from GitHub and write them
    $REPO = 'mathnasium-session-notes';
    $files = [
        'cron-checker/daily_check.php'     => CHECKER_DIR . '/daily_check.php',
        'cron-checker/review_prompt.txt'   => CHECKER_DIR . '/review_prompt.txt',
        'log-query.php'                    => WEB_DIR . '/log-query.php',
        'manage.php'                       => WEB_DIR . '/manage.php',
    ];
    $results = [];
    foreach ($files as $gh_path => $local_path) {
        $content = github_fetch($REPO, $gh_path);
        if ($content === null) {
            $results[$gh_path] = 'FETCH_FAILED';
            continue;
        }
        $written = file_put_contents($local_path, $content);
        $results[$gh_path] = $written !== false ? "OK ({$written}B)" : 'WRITE_FAILED';
    }
    $ok = !in_array('FETCH_FAILED', $results) && !in_array('WRITE_FAILED', $results);
    respond(['ok' => $ok, 'op' => 'git-pull', 'method' => 'github-api-fallback', 'files' => $results]);
}

// ── deploy ───────────────────────────────────────────────────────────────────
if ($op === 'deploy') {
    // Copy web-facing files from repo checkout to public_html
    $copies = [
        REPO_DIR . '/log-query.php'      => WEB_DIR . '/log-query.php',
        REPO_DIR . '/manage.php'         => WEB_DIR . '/manage.php',
        REPO_DIR . '/api/prompt.php'     => WEB_DIR . '/api/prompt.php',
    ];
    $results = [];
    foreach ($copies as $src => $dst) {
        if (!file_exists($src)) { $results[basename($src)] = 'SRC_MISSING'; continue; }
        // Ensure destination directory exists
        $dst_dir = dirname($dst);
        if (!is_dir($dst_dir)) mkdir($dst_dir, 0755, true);
        $results[basename($src)] = copy($src, $dst) ? 'OK' : 'COPY_FAILED';
    }
    respond(['ok' => !in_array('COPY_FAILED', $results), 'op' => 'deploy', 'files' => $results]);
}

// ── debug-run ────────────────────────────────────────────────────────────────
if ($op === 'debug-run') {
    if (!can_exec()) {
        respond(['ok' => false, 'op' => 'debug-run',
            'error' => 'shell_exec disabled — run manually via SSH or cron']);
    }
    $script = CHECKER_DIR . '/daily_check.php';
    $r = run_shell(PHP_BIN . ' ' . escapeshellarg($script) . ' --debug');

    // Fetch latest run from DB for structured summary
    $run = db_query('SELECT * FROM runs ORDER BY id DESC LIMIT 1')[0] ?? null;
    $reviews = $run ? db_query("SELECT student_name, issue, confidence, flagged, justification
                                FROM reviews WHERE run_id={$run['id']}") : [];
    respond([
        'ok'         => $r['exit_code'] === 0,
        'op'         => 'debug-run',
        'exit_code'  => $r['exit_code'],
        'shell_output' => $r['output'],
        'run'        => $run,
        'reviews'    => $reviews,
    ]);
}

// ── full-run ─────────────────────────────────────────────────────────────────
if ($op === 'full-run') {
    if (!can_exec()) {
        respond(['ok' => false, 'op' => 'full-run',
            'error' => 'shell_exec disabled — runs via cron only']);
    }
    $script  = CHECKER_DIR . '/daily_check.php';
    $log_out = CHECKER_DIR . '/logs/cron.log';

    // Run in background to avoid web server timeout (~75s for full batch).
    // Returns immediately — poll ?op=status or log-query.php to see when done.
    $cmd = 'nohup ' . PHP_BIN . ' ' . escapeshellarg($script)
         . ' >> ' . escapeshellarg($log_out) . ' 2>&1 & echo $!';
    $pid = trim(shell_exec($cmd) ?: '');

    // Snapshot current run count so caller can detect when a new row appears
    $run_count_before = db_query('SELECT COUNT(*) AS n FROM runs')[0]['n'] ?? 0;

    respond([
        'ok'                => true,
        'op'                => 'full-run',
        'mode'              => 'background',
        'pid'               => $pid,
        'run_count_before'  => $run_count_before,
        'note'              => 'Script running in background. Poll ?op=status or log-query.php '
                             . 'until runs.count > run_count_before to see results.',
    ]);
}

// ── inspect ──────────────────────────────────────────────────────────────────
// Surface log file contents without SSH. Hardcoded resource list — no path traversal.
if ($op === 'inspect') {
    $resource = $_GET['resource'] ?? $_POST['resource'] ?? '';
    $tail     = min((int)($_GET['lines'] ?? 100), 500);

    $resources = [
        'daily-log' => CHECKER_DIR . '/logs/daily_check.log',
        'cron-log'  => CHECKER_DIR . '/logs/cron.log',
        'env-keys'  => null,   // special: returns .env key names only (no values)
        'db-schema' => null,   // special: returns SQLite schema
        'prompt'    => CHECKER_DIR . '/review_prompt.txt',
    ];

    if (!$resource) {
        respond(['ok' => true, 'op' => 'inspect',
            'available' => array_keys($resources),
            'usage' => '?op=inspect&resource=<name>&lines=<n>']);
    }

    if (!array_key_exists($resource, $resources)) {
        respond(['ok' => false, 'error' => "unknown resource: $resource",
            'available' => array_keys($resources)]);
    }

    // Special resources
    if ($resource === 'env-keys') {
        $keys = [];
        foreach (file(ENV_PATH, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            if (str_starts_with(trim($line), '#') || !str_contains($line, '=')) continue;
            $keys[] = explode('=', $line, 2)[0];
        }
        respond(['ok' => true, 'op' => 'inspect', 'resource' => 'env-keys', 'keys' => $keys]);
    }

    if ($resource === 'db-schema') {
        $schema = db_query("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name");
        respond(['ok' => true, 'op' => 'inspect', 'resource' => 'db-schema', 'tables' => $schema]);
    }

    $path = $resources[$resource];
    if (!file_exists($path)) {
        respond(['ok' => false, 'error' => "resource not found: $resource (path: $path)"]);
    }

    // Tail the file
    $lines_all  = file($path, FILE_IGNORE_NEW_LINES) ?: [];
    $total_lines = count($lines_all);
    $lines_out  = array_slice($lines_all, -$tail);

    respond([
        'ok'          => true,
        'op'          => 'inspect',
        'resource'    => $resource,
        'total_lines' => $total_lines,
        'returned'    => count($lines_out),
        'lines'       => $lines_out,
    ]);
}

// ── unknown op ───────────────────────────────────────────────────────────────
http_response_code(400);
respond(['ok' => false, 'error' => "unknown op: $op",
    'valid_ops' => ['status', 'test-exec', 'git-pull', 'deploy', 'debug-run', 'full-run', 'inspect']]);
