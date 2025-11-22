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

// Try local development path first, then server path
$local_key_path = getenv('HOME') . '/.config/claude_api_key.txt';
$server_key_path = '/home3/c5495zvy/config/claude_api_key.txt';
$key_path = file_exists($local_key_path) ? $local_key_path : $server_key_path;

if (!file_exists($key_path)) {
    http_response_code(500);
    echo json_encode(['error' => 'API key file not found. Please set up your API key at ~/.config/claude_api_key.txt']);
    exit;
}

$api_key = trim(file_get_contents($key_path));
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
