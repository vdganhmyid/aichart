<?php
header('Content-Type: application/json');
header('Cache-Control: no-store, no-cache');

// ── CONFIGURATION ────────────────────────────────────────────────────────────
// Stored values are password hashes generated with password_hash().
// Keep actual secret keys out of the source file if possible.
define('PERMANENT_KEY_HASH', '$2y$12$ppaS0KQFANYQSthcZRUVbOjKFrt6tPIRk8c0/7pL4sjgxtmMy0TrW');
define('LIMIT_KEY_HASH',     '$2y$12$52h5FQMg/1t.3uFNaD0seOqyWudDXwpJvXDUM2Sp7w37FB8uEyBNy');
define('LIMIT_WINDOW',       86400); // 24 hours in seconds
define('DATA_FILE',          __DIR__ . '/data/device_limits.json');

// ── ENSURE DATA DIRECTORY EXISTS ─────────────────────────────────────────────
if (!is_dir(__DIR__ . '/data')) {
    mkdir(__DIR__ . '/data', 0755, true);
    // Block web access to data directory
    file_put_contents(__DIR__ . '/data/.htaccess', "Order deny,allow\nDeny from all\n");
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function getDeviceId(): string {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $ua = $_SERVER['HTTP_USER_AGENT'] ?? 'unknown';
    return md5($ip . '||' . $ua);
}

function loadData(): array {
    if (!file_exists(DATA_FILE)) return [];
    $raw = file_get_contents(DATA_FILE);
    return json_decode($raw, true) ?: [];
}

function saveData(array $data): void {
    file_put_contents(DATA_FILE, json_encode($data, JSON_PRETTY_PRINT));
}

function purgeExpired(array &$data): void {
    $now = time();
    foreach ($data as $id => $entry) {
        if ($now >= $entry['expires_at']) {
            unset($data[$id]);
        }
    }
}

// ── ROUTING ───────────────────────────────────────────────────────────────────
$action = $_POST['action'] ?? $_GET['action'] ?? '';

switch ($action) {

    // ── Check if this device is currently rate-limited ────────────────────────
    case 'check_device':
        $id   = getDeviceId();
        $data = loadData();
        purgeExpired($data);
        saveData($data);

        if (isset($data[$id])) {
            $remaining = $data[$id]['expires_at'] - time();
            echo json_encode([
                'limited'           => true,
                'remaining_seconds' => max(0, $remaining),
                'expires_at'        => $data[$id]['expires_at'],
            ]);
        } else {
            echo json_encode(['limited' => false]);
        }
        break;

    // ── Validate submitted key ────────────────────────────────────────────────
    case 'validate':
        $key = trim($_POST['key'] ?? '');

        if (password_verify($key, PERMANENT_KEY_HASH)) {
            // PERMANENT KEY: Remove device from lock file (unlock device)
            $id   = getDeviceId();
            $data = loadData();
            unset($data[$id]);  // Remove this device from lock list
            saveData($data);
            
            echo json_encode(['success' => true, 'type' => 'permanent']);
            break;
        }

        if (password_verify($key, LIMIT_KEY_HASH)) {
            $id   = getDeviceId();
            $data = loadData();
            purgeExpired($data);

            if (isset($data[$id])) {
                $remaining = $data[$id]['expires_at'] - time();
                echo json_encode([
                    'success'           => false,
                    'type'              => 'limited',
                    'remaining_seconds' => max(0, $remaining),
                    'expires_at'        => $data[$id]['expires_at'],
                ]);
            } else {
                // First use today – grant access and record device
                $expiresAt = time() + LIMIT_WINDOW;
                $data[$id] = [
                    'used_at'    => time(),
                    'expires_at' => $expiresAt,
                    'ip'         => $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0',
                ];
                saveData($data);
                echo json_encode([
                    'success'    => true,
                    'type'       => 'limit',
                    'expires_at' => $expiresAt,
                ]);
            }
            break;
        }

        // Unknown key
        echo json_encode(['success' => false, 'type' => 'invalid']);
        break;

    default:
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid action']);
}
