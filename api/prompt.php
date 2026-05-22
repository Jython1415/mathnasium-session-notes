<?php
/**
 * api/prompt.php — Serve review_prompt.txt as the canonical system prompt.
 *
 * The web tool (app.jsx) and the cron checker (daily_check.php) both use the
 * same review criteria. This endpoint makes review_prompt.txt the single source
 * of truth: the web tool fetches from here instead of using its bundled prompt.js.
 *
 * No auth required — the prompt contains no secrets. Cached for 1 hour on the
 * client side; the content changes infrequently.
 *
 * Response: plain text (the prompt), or JSON error.
 *
 * Deployed to: public_html/session-notes/api/prompt.php
 */

header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=3600');

$prompt_path = __DIR__ . '/../../session-notes-checker/cron-checker/review_prompt.txt';

if (!file_exists($prompt_path)) {
    header('Content-Type: application/json');
    http_response_code(404);
    echo json_encode(['error' => 'review_prompt.txt not found on server']);
    exit;
}

header('Content-Type: text/plain; charset=utf-8');
header('X-Prompt-Hash: ' . substr(md5_file($prompt_path), 0, 8));
readfile($prompt_path);
