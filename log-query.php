<?php
/**
 * Session Notes Checker — Log Query Endpoint
 *
 * Read-only SQL access to the session-notes SQLite database for autonomous
 * diagnostic visibility. Mirrors the pattern from /api/mindbody/query.php.
 *
 * Auth: X-Admin-Key header or ?admin_key=... must match LOG_QUERY_KEY in .env.
 * Only SELECT statements are permitted.
 *
 * DB path: ~/session-notes-checker/cron-checker/logs/sessions.sqlite
 * This file deploys to: public_html/session-notes/log-query.php
 *
 * Usage examples:
 *   SELECT * FROM runs ORDER BY ts DESC LIMIT 10
 *   SELECT * FROM log_lines WHERE run_id=(SELECT MAX(id) FROM runs) ORDER BY id
 *   SELECT * FROM reviews WHERE run_id=(SELECT MAX(id) FROM runs) AND flagged=1
 *   SELECT * FROM reviews WHERE issue='api_failure' ORDER BY run_id DESC LIMIT 20
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// ── Auth ─────────────────────────────────────────────────────────────────────

$env_file = __DIR__ . '/../../session-notes-checker/cron-checker/.env';
if (file_exists($env_file)) {
    foreach (file($env_file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (str_starts_with(trim($line), '#') || !str_contains($line, '=')) continue;
        [$k, $v] = explode('=', $line, 2);
        if (!getenv(trim($k))) putenv(trim($k) . '=' . trim($v, " \t\"'"));
    }
}

$expected = getenv('LOG_QUERY_KEY') ?: '';
$provided = $_SERVER['HTTP_X_ADMIN_KEY'] ?? $_GET['admin_key'] ?? '';

if (!$expected || !$provided || !hash_equals($expected, $provided)) {
    http_response_code(401);
    echo json_encode(['error' => 'unauthorized — X-Admin-Key required']);
    exit;
}

// ── SQL ───────────────────────────────────────────────────────────────────────

$sql = trim($_GET['sql'] ?? $_POST['sql'] ?? '');
if (!$sql) {
    echo json_encode(['error' => 'sql param required',
        'tables' => ['runs', 'reviews', 'log_lines'],
        'example' => 'SELECT * FROM runs ORDER BY ts DESC LIMIT 5']);
    exit;
}

if (!preg_match('/^\s*SELECT\b/i', $sql)) {
    http_response_code(403);
    echo json_encode(['error' => 'only SELECT statements permitted']);
    exit;
}

// ── DB ────────────────────────────────────────────────────────────────────────

$db_path = __DIR__ . '/../../session-notes-checker/cron-checker/logs/sessions.sqlite';
if (!file_exists($db_path)) {
    http_response_code(404);
    echo json_encode(['error' => 'database not yet created — no runs have completed']);
    exit;
}

try {
    $db = new SQLite3($db_path, SQLITE3_OPEN_READONLY);
    $db->enableExceptions(true);
    $db->exec('PRAGMA busy_timeout=3000');

    $result = $db->query($sql);
    $rows = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $rows[] = $row;
    }
    echo json_encode(['rows' => $rows, 'count' => count($rows)], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
