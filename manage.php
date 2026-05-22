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

define('REPO_DIR',    $_SERVER['HOME'] . '/session-notes-checker');
define('CHECKER_DIR', REPO_DIR . '/cron-checker');
define('WEB_DIR',     $_SERVER['HOME'] . '/public_html/session-notes');
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
                             model, cost_usd, elapsed_s, error
                      FROM runs ORDER BY id DESC LIMIT 5');

    $db_size = file_exists(DB_PATH) ? round(filesize(DB_PATH) / 1024) . 'K' : 'none';

    $total_runs    = db_query('SELECT COUNT(*) AS n FROM runs')[0]['n'] ?? 0;
    $total_reviews = db_query('SELECT COUNT(*) AS n FROM reviews')[0]['n'] ?? 0;
    $total_cost    = db_query('SELECT ROUND(SUM(cost_usd),6) AS c FROM runs')[0]['c'] ?? 0;

    // Git status
    $git_log = can_exec()
        ? trim(run_shell('git -C ' . REPO_DIR . ' log --oneline -3')['output'])
        : '(shell exec disabled)';

    // Env summary (no secrets)
    $model    = getenv('OPENROUTER_MODEL') ?: '?';
    $batch    = getenv('BATCH_SIZE') ?: '?';
    $conf     = getenv('MIN_CONFIDENCE') ?: '?';

    respond([
        'ok'    => true,
        'op'    => 'status',
        'runs'  => $runs,
        'stats' => [
            'total_runs'    => $total_runs,
            'total_reviews' => $total_reviews,
            'total_cost_usd'=> $total_cost,
            'db_size'       => $db_size,
        ],
        'config' => ['model' => $model, 'batch_size' => $batch, 'min_confidence' => $conf],
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
        REPO_DIR . '/log-query.php' => WEB_DIR . '/log-query.php',
        REPO_DIR . '/manage.php'    => WEB_DIR . '/manage.php',
    ];
    $results = [];
    foreach ($copies as $src => $dst) {
        if (!file_exists($src)) { $results[$src] = 'SRC_MISSING'; continue; }
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
    $script = CHECKER_DIR . '/daily_check.php';
    $r = run_shell(PHP_BIN . ' ' . escapeshellarg($script));
    $run = db_query('SELECT * FROM runs ORDER BY id DESC LIMIT 1')[0] ?? null;
    respond([
        'ok'           => $r['exit_code'] === 0,
        'op'           => 'full-run',
        'exit_code'    => $r['exit_code'],
        'shell_output' => $r['output'],
        'run'          => $run,
    ]);
}

// ── unknown op ───────────────────────────────────────────────────────────────
http_response_code(400);
respond(['ok' => false, 'error' => "unknown op: $op",
    'valid_ops' => ['status', 'test-exec', 'git-pull', 'deploy', 'debug-run', 'full-run']]);
