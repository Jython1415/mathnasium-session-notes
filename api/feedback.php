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

// Database path (outside web root for security)
$db_path = 'data/feedback.db';
$db_dir = dirname($db_path);

// Create directory if it doesn't exist
if (!is_dir($db_dir)) {
    mkdir($db_dir, 0700, true);
}

try {
    // Connect to SQLite database
    $db = new PDO('sqlite:' . $db_path);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // Create table if it doesn't exist
    $db->exec("CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        row_json TEXT NOT NULL,
        claude_response_json TEXT NOT NULL,
        feedback_type TEXT NOT NULL
    )");

    // Get POST data
    $input = file_get_contents('php://input');
    $data = json_decode($input, true);

    if (!$data) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid JSON']);
        exit;
    }

    // Validate required fields
    if (!isset($data['row_json']) || !isset($data['claude_response_json']) || !isset($data['feedback_type'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing required fields: row_json, claude_response_json, feedback_type']);
        exit;
    }

    // Insert feedback
    $stmt = $db->prepare("INSERT INTO feedback (row_json, claude_response_json, feedback_type) VALUES (?, ?, ?)");
    $stmt->execute([
        json_encode($data['row_json']),
        json_encode($data['claude_response_json']),
        $data['feedback_type']
    ]);

    echo json_encode([
        'success' => true,
        'id' => $db->lastInsertId()
    ]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database error: ' . $e->getMessage()]);
}
?>
