<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit(0);
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// Try to load API key from multiple sources (in priority order)
$api_key = null;

// 1. Check for .env file in project root
$env_path = __DIR__ . '/../.env';
if (file_exists($env_path)) {
    $env_contents = file_get_contents($env_path);
    // Simple .env parser - look for CLAUDE_API_KEY=value
    foreach (explode("\n", $env_contents) as $line) {
        $line = trim($line);
        // Skip comments and empty lines
        if (empty($line) || $line[0] === '#') continue;
        if (strpos($line, 'CLAUDE_API_KEY=') === 0) {
            $api_key = trim(substr($line, strlen('CLAUDE_API_KEY=')));
            break;
        }
    }
}

// 2. Check local development path (~/.config/claude_api_key.txt)
if (!$api_key) {
    $local_key_path = getenv('HOME') . '/.config/claude_api_key.txt';
    if (file_exists($local_key_path)) {
        $api_key = trim(file_get_contents($local_key_path));
    }
}

// 3. Check server path
if (!$api_key) {
    $server_key_path = '/home3/c5495zvy/config/claude_api_key.txt';
    if (file_exists($server_key_path)) {
        $api_key = trim(file_get_contents($server_key_path));
    }
}

// If no API key found anywhere, return error
if (!$api_key) {
    http_response_code(500);
    echo json_encode(['error' => 'API key not found. Please create a .env file with CLAUDE_API_KEY=your_key or set up ~/.config/claude_api_key.txt']);
    exit;
}
$request_body = file_get_contents('php://input');

if (empty($request_body)) {
    http_response_code(400);
    echo json_encode(['error' => 'Empty request']);
    exit;
}

$ch = curl_init('https://api.anthropic.com/v1/messages');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $request_body,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'x-api-key: ' . $api_key,
        'anthropic-version: 2023-06-01',
    ],
]);

$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

http_response_code($http_code);
echo $response;
?>
