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

// Load API key from environment or default path
$api_key_path = getenv('CLAUDE_API_KEY_PATH');
if (!$api_key_path) {
    // Default to relative path for local development
    $api_key_path = __DIR__ . '/../config/api_key.txt';
}

if (!file_exists($api_key_path)) {
    http_response_code(500);
    echo json_encode(['error' => 'API key not configured. See .env.example for setup instructions.']);
    exit;
}

$api_key = trim(file_get_contents($api_key_path));
if (empty($api_key)) {
    http_response_code(500);
    echo json_encode(['error' => 'API key file is empty']);
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
