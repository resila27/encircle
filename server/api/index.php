<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond(array $payload, int $status = 200): never {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function body(): array {
    $decoded = json_decode((string) file_get_contents('php://input'), true);
    return is_array($decoded) ? $decoded : [];
}

function app_config(): array {
    static $config;
    if (is_array($config)) return $config;
    $path = dirname(__DIR__, 2) . '/gridlock-config.php';
    if (!is_file($path)) throw new RuntimeException('Server configuration is unavailable.');
    $loaded = require $path;
    if (!is_array($loaded)) throw new RuntimeException('Server configuration is invalid.');
    return $config = $loaded;
}

function app_host_fallback_from_address(): string {
    $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? 'playencircle.com'));
    $host = preg_replace('/:\d+$/', '', $host);
    if (!preg_match('/^[a-z0-9.-]+\.[a-z]{2,}$/', $host)) $host = 'playencircle.com';
    return "noreply@{$host}";
}

function app_mail_from(): string {
    $configured = (string) (app_config()['mail_from'] ?? '');
    $configured = trim(preg_replace('/\R/', ' ', $configured));
    $fallbackAddress = app_host_fallback_from_address();

    if ($configured === '') return "ENCIRCLE <{$fallbackAddress}>";
    if (str_contains($configured, '<') && str_contains($configured, '>')) {
        if (preg_match('/<\s*([^<>\s]+)\s*>$/', $configured, $match) && filter_var($match[1], FILTER_VALIDATE_EMAIL)) {
            return $configured;
        }
    }
    if (filter_var($configured, FILTER_VALIDATE_EMAIL)) return "ENCIRCLE <{$configured}>";
    return "ENCIRCLE <{$fallbackAddress}>";
}

function app_mail_from_address(string $fromHeader): string {
    if (preg_match('/<\s*([^<>\s]+)\s*>$/', $fromHeader, $match)) return $match[1];
    return '';
}

function app_send_code_email(string $recipient, string $code): bool {
    $subject = 'Your ENCIRCLE login code';
    $message = "Your ENCIRCLE code is {$code}.\n\nIt expires in 10 minutes. If you did not request it, you can ignore this email.";
    $from = app_mail_from();
    $fromAddress = app_mail_from_address($from);
    $headers = "From: {$from}\r\nContent-Type: text/plain; charset=UTF-8";
    if ($fromAddress === '') return mail($recipient, $subject, $message, $headers);
    $result = @mail($recipient, $subject, $message, $headers, "-f {$fromAddress}");
    if (!$result) {
        error_log("ENCIRCLE API: failed to send via envelope sender; trying default sender for {$recipient}");
        return @mail($recipient, $subject, $message, $headers);
    }
    return true;
}

function db(): PDO {
    static $pdo;
    if ($pdo instanceof PDO) return $pdo;
    $config = app_config();
    $pdo = new PDO('sqlite:' . $config['db_path'], null, null, [
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA busy_timeout = 5000');
    return $pdo;
}

function current_user(): ?array {
    $token = $_COOKIE['gridlock_session'] ?? '';
    if (!is_string($token) || strlen($token) < 32) return null;
    $statement = db()->prepare(
        'SELECT users.id, users.email FROM sessions JOIN users ON users.id = sessions.user_id '
        . 'WHERE sessions.token_hash = ? AND sessions.expires_at > ? LIMIT 1'
    );
    $statement->execute([hash('sha256', $token), gmdate('Y-m-d H:i:s')]);
    $user = $statement->fetch();
    return $user ?: null;
}

function require_user(): array {
    $user = current_user();
    if (!$user) respond(['error' => 'Please log in first.'], 401);
    return $user;
}

function empty_stats(): array {
    return [
        'completed' => 0, 'wins' => 0, 'losses' => 0, 'ties' => 0, 'streak' => 0,
        'longestWord' => '', 'bestMargin' => 0,
        'byDifficulty' => [
            'relaxed' => ['completed' => 0, 'wins' => 0],
            'clever' => ['completed' => 0, 'wins' => 0],
            'fierce' => ['completed' => 0, 'wins' => 0],
        ],
    ];
}

function stats_for_user(int $userId): array {
    $statement = db()->prepare(
        'SELECT difficulty, result, state_json FROM games WHERE user_id = ? AND completed_at IS NOT NULL ORDER BY completed_at DESC'
    );
    $statement->execute([$userId]);
    $stats = empty_stats();
    $dailyDates = [];
    foreach ($statement->fetchAll() as $row) {
        $stats['completed']++;
        $result = (string) ($row['result'] ?? '');
        if ($result === 'win') $stats['wins']++;
        elseif ($result === 'loss') $stats['losses']++;
        else $stats['ties']++;
        $difficulty = (string) ($row['difficulty'] ?? '');
        if (isset($stats['byDifficulty'][$difficulty])) {
            $stats['byDifficulty'][$difficulty]['completed']++;
            if ($result === 'win') $stats['byDifficulty'][$difficulty]['wins']++;
        }
        $game = json_decode((string) ($row['state_json'] ?? ''), true);
        if (!is_array($game)) continue;
        foreach (($game['played'] ?? []) as $play) {
            $word = is_array($play) ? (string) ($play['word'] ?? '') : '';
            if (is_array($play) && ($play['owner'] ?? null) === 1 && strlen($word) > strlen($stats['longestWord'])) $stats['longestWord'] = $word;
        }
        $owners = $game['owners'] ?? [];
        if (is_array($owners)) {
            $margin = count(array_filter($owners, static fn ($owner) => $owner === 1)) - count(array_filter($owners, static fn ($owner) => $owner === 2));
            $stats['bestMargin'] = max($stats['bestMargin'], $margin);
        }
        if (($game['mode'] ?? '') === 'daily' && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($game['dailyDate'] ?? ''))) {
            $dailyDates[(string) $game['dailyDate']] = true;
        }
    }
    $dates = array_keys($dailyDates);
    rsort($dates);
    if ($dates) {
        $cursor = new DateTimeImmutable('today', new DateTimeZone('America/Los_Angeles'));
        $latest = new DateTimeImmutable($dates[0], new DateTimeZone('America/Los_Angeles'));
        if ($latest < $cursor) $cursor = $cursor->modify('-1 day');
        foreach ($dates as $date) {
            if ($date !== $cursor->format('Y-m-d')) break;
            $stats['streak']++;
            $cursor = $cursor->modify('-1 day');
        }
    }
    return $stats;
}

function daily_standing(string $date, int $margin): ?array {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) return null;
    $statement = db()->prepare('SELECT state_json FROM games WHERE completed_at IS NOT NULL');
    $statement->execute();
    $scores = [];
    foreach ($statement->fetchAll() as $row) {
        $game = json_decode((string) ($row['state_json'] ?? ''), true);
        if (!is_array($game) || ($game['mode'] ?? '') !== 'daily' || ($game['dailyDate'] ?? '') !== $date) continue;
        $owners = $game['owners'] ?? [];
        if (!is_array($owners)) continue;
        $scores[] = count(array_filter($owners, static fn ($owner) => $owner === 1)) - count(array_filter($owners, static fn ($owner) => $owner === 2));
    }
    if (!$scores) return null;
    rsort($scores);
    $rank = 1 + count(array_filter($scores, static fn ($score) => $score > $margin));
    $total = count($scores);
    return ['rank' => $rank, 'total' => $total, 'percentile' => max(1, (int) ceil(($rank / $total) * 100))];
}

function latest_game(int $userId): ?array {
    $statement = db()->prepare(
        'SELECT state_json FROM games WHERE user_id = ? AND completed_at IS NULL ORDER BY updated_at DESC LIMIT 1'
    );
    $statement->execute([$userId]);
    $row = $statement->fetch();
    if (!$row) return null;
    $game = json_decode((string) $row['state_json'], true);
    return is_array($game) && ($game['boardVersion'] ?? '') === '5x6-v2' ? $game : null;
}

function word_set(): array {
    static $words;
    if (is_array($words)) return $words;
    $decoded = json_decode((string) file_get_contents(__DIR__ . '/data/words.json'), true);
    if (!is_array($decoded)) throw new RuntimeException('Dictionary is unavailable.');
    return $words = array_fill_keys($decoded, true);
}

function inflection_roots(string $word): array {
    $roots = [];
    $add = static function (string ...$values) use (&$roots): void {
        foreach ($values as $value) if (strlen($value) >= 2) $roots[$value] = true;
    };
    if (str_ends_with($word, 'ies')) $add(substr($word, 0, -3) . 'y');
    if (str_ends_with($word, 'es')) $add(substr($word, 0, -2), substr($word, 0, -1));
    if (str_ends_with($word, 's')) $add(substr($word, 0, -1));
    if (str_ends_with($word, 'ied')) $add(substr($word, 0, -3) . 'y');
    if (str_ends_with($word, 'ed')) {
        $stem = substr($word, 0, -2); $add($stem, $stem . 'e');
        if (strlen($stem) > 1 && $stem[-1] === $stem[-2]) $add(substr($stem, 0, -1));
    }
    if (str_ends_with($word, 'ying')) $add(substr($word, 0, -4) . 'ie');
    if (str_ends_with($word, 'ing')) {
        $stem = substr($word, 0, -3); $add($stem, $stem . 'e');
        if (strlen($stem) > 1 && $stem[-1] === $stem[-2]) $add(substr($stem, 0, -1));
    }
    if (str_ends_with($word, 'er')) $add(substr($word, 0, -2), substr($word, 0, -1) . 'e');
    if (str_ends_with($word, 'est')) $add(substr($word, 0, -3), substr($word, 0, -2) . 'e');
    if (str_ends_with($word, 'ly')) $add(substr($word, 0, -2), substr($word, 0, -3) . 'y');
    if (str_ends_with($word, 'ness')) $add(substr($word, 0, -4), substr($word, 0, -5) . 'y');
    if (str_ends_with($word, 'ments')) $add(substr($word, 0, -5));
    if (str_ends_with($word, 'ment')) $add(substr($word, 0, -4));
    $irregularEndings = [
        'people' => 'person', 'children' => 'child', 'women' => 'woman', 'men' => 'man',
        'teeth' => 'tooth', 'geese' => 'goose', 'mice' => 'mouse', 'feet' => 'foot',
    ];
    foreach ($irregularEndings as $plural => $singular) {
        if (str_ends_with($word, $plural)) $add(substr($word, 0, -strlen($plural)) . $singular);
    }
    return array_keys($roots);
}

function valid_word(string $word): bool {
    if (!preg_match('/^[a-z]{2,30}$/', $word)) return false;
    $dictionary = word_set();
    if (isset($dictionary[$word])) return true;
    foreach (inflection_roots($word) as $root) if (isset($dictionary[$root])) return true;
    return false;
}

function validated_game(array $input): array {
    $gameId = (string) ($input['gameId'] ?? '');
    $boardVersion = (string) ($input['boardVersion'] ?? '');
    $difficulty = (string) ($input['difficulty'] ?? '');
    $letters = $input['letters'] ?? null;
    $owners = $input['owners'] ?? null;
    $played = $input['played'] ?? null;
    $turn = (string) ($input['turn'] ?? '');
    $message = trim((string) ($input['message'] ?? ''));
    $result = $input['result'] ?? null;
    $mode = (string) ($input['mode'] ?? 'classic');
    $dailyDate = $input['dailyDate'] ?? null;

    if (!preg_match('/^[A-Za-z0-9-]{8,64}$/', $gameId)) respond(['error' => 'Invalid game.'], 422);
    if ($boardVersion !== '5x6-v2') respond(['error' => 'Invalid board version.'], 422);
    if (!in_array($difficulty, ['relaxed', 'clever', 'fierce'], true)) respond(['error' => 'Invalid game.'], 422);
    if (!is_array($letters) || count($letters) !== 30 || !is_array($owners) || count($owners) !== 30) respond(['error' => 'Invalid game.'], 422);
    $cleanLetters = [];
    $cleanOwners = [];
    foreach ($letters as $letter) {
        $letter = (string) $letter;
        if (!preg_match('/^[A-Z]$/', $letter)) respond(['error' => 'Invalid game.'], 422);
        $cleanLetters[] = $letter;
    }
    foreach ($owners as $owner) {
        if (!is_int($owner) || $owner < 0 || $owner > 2) respond(['error' => 'Invalid game.'], 422);
        $cleanOwners[] = $owner;
    }
    if (!is_array($played) || count($played) > 100) respond(['error' => 'Invalid game.'], 422);
    $cleanPlayed = [];
    foreach ($played as $play) {
        if (!is_array($play)) respond(['error' => 'Invalid game.'], 422);
        $word = strtolower((string) ($play['word'] ?? ''));
        $owner = $play['owner'] ?? null;
        if (!preg_match('/^[a-z]{2,30}$/', $word) || !in_array($owner, [1, 2], true)) respond(['error' => 'Invalid game.'], 422);
        $captures = (int) ($play['captures'] ?? 0);
        if ($captures < 0 || $captures > 30) respond(['error' => 'Invalid game.'], 422);
        $cleanPlayed[] = ['word' => $word, 'owner' => $owner, 'captures' => $captures];
    }
    if (!in_array($turn, ['you', 'rival', 'done'], true) || strlen($message) > 120) respond(['error' => 'Invalid game.'], 422);
    if (!in_array($result, [null, 'win', 'loss', 'tie'], true)) respond(['error' => 'Invalid game.'], 422);
    if (($turn === 'done') !== ($result !== null)) respond(['error' => 'Invalid game.'], 422);
    if (!in_array($mode, ['classic', 'daily'], true)) respond(['error' => 'Invalid game.'], 422);
    if ($dailyDate !== null) $dailyDate = (string) $dailyDate;
    if (($mode === 'daily' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $dailyDate)) || ($mode === 'classic' && $dailyDate !== null)) {
        respond(['error' => 'Invalid game.'], 422);
    }

    return [
        'gameId' => $gameId, 'boardVersion' => $boardVersion, 'difficulty' => $difficulty, 'letters' => $cleanLetters,
        'owners' => $cleanOwners, 'played' => $cleanPlayed, 'turn' => $turn,
        'message' => $message, 'result' => $result, 'mode' => $mode, 'dailyDate' => $dailyDate,
    ];
}

try {
    $action = (string) ($_GET['action'] ?? 'status');

    if ($action === 'status') {
        $user = current_user();
        respond([
            'game' => $user ? latest_game((int) $user['id']) : null,
            'stats' => $user ? stats_for_user((int) $user['id']) : empty_stats(),
            'user' => $user ? ['email' => $user['email']] : null,
        ]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respond(['error' => 'Method not allowed.'], 405);

    if ($action === 'validate-word') {
        $word = strtolower(trim((string) (body()['word'] ?? '')));
        respond(['valid' => valid_word($word)]);
    }

    if ($action === 'define-word') {
        $word = strtolower(trim((string) (body()['word'] ?? '')));
        if (!preg_match('/^[a-z]{2,30}$/', $word)) respond(['error' => 'Invalid word.'], 422);
        $context = stream_context_create(['http' => ['timeout' => 5, 'header' => "User-Agent: ENCIRCLE/1.0\r\n"]]);
        $definition = null;
        $source = null;

        $datamuseRaw = @file_get_contents('https://api.datamuse.com/words?sp=' . rawurlencode($word) . '&md=d&max=3', false, $context);
        $datamuseEntries = is_string($datamuseRaw) ? json_decode($datamuseRaw, true) : null;
        if (is_array($datamuseEntries)) {
            foreach ($datamuseEntries as $entry) {
                if (strtolower((string) ($entry['word'] ?? '')) !== $word || !is_array($entry['defs'] ?? null)) continue;
                $rawDefinition = $entry['defs'][0] ?? null;
                if (!is_string($rawDefinition) || trim($rawDefinition) === '') continue;
                $parts = explode("\t", trim($rawDefinition), 2);
                $labels = ['adj' => 'adjective', 'adv' => 'adverb', 'n' => 'noun', 'v' => 'verb'];
                $definition = count($parts) === 2
                    ? (($labels[$parts[0]] ?? $parts[0]) . ' — ' . trim($parts[1]))
                    : trim($rawDefinition);
                $source = 'Datamuse';
                break;
            }
        }

        if ($definition === null) {
            $raw = @file_get_contents('https://api.dictionaryapi.dev/api/v2/entries/en/' . rawurlencode($word), false, $context);
            $entries = is_string($raw) ? json_decode($raw, true) : null;
            if (is_array($entries)) {
                foreach (($entries[0]['meanings'] ?? []) as $meaning) {
                    foreach (($meaning['definitions'] ?? []) as $item) {
                        if (is_string($item['definition'] ?? null) && trim($item['definition']) !== '') {
                            $definition = trim($item['definition']);
                            $source = 'Free Dictionary API';
                            break 2;
                        }
                    }
                }
            }
        }
        respond(['definition' => $definition, 'source' => $source]);
    }

    if ($action === 'request-code') {
        $email = strtolower(trim((string) (body()['email'] ?? '')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) respond(['error' => 'Enter a valid email address.'], 422);
        $config = app_config();
        $ipHash = hash_hmac('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? ''), $config['app_secret']);
        $rate = db()->prepare(
            'SELECT SUM(email = ?) AS email_count, SUM(ip_hash = ?) AS ip_count FROM login_codes WHERE created_at > ?'
        );
        $rate->execute([$email, $ipHash, gmdate('Y-m-d H:i:s', time() - 3600)]);
        $counts = $rate->fetch();
        if ((int) ($counts['email_count'] ?? 0) >= 5 || (int) ($counts['ip_count'] ?? 0) >= 12) {
            respond(['error' => 'Too many codes requested. Try again later.'], 429);
        }
        $code = (string) random_int(100000, 999999);
        $codeHash = hash_hmac('sha256', $email . ':' . $code, $config['app_secret']);
        $statement = db()->prepare(
            'INSERT INTO login_codes (email, code_hash, ip_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
        );
        $statement->execute([$email, $codeHash, $ipHash, gmdate('Y-m-d H:i:s', time() + 600), gmdate('Y-m-d H:i:s')]);
        $mailSent = app_send_code_email($email, $code);
        if (!$mailSent) {
            error_log("ENCIRCLE API: failed to send login code email to {$email}");
            if (!empty($config['mail_debug_codes'])) {
                respond([
                    'ok' => true,
                    'debug_code' => $code,
                    'note' => 'Mail sending is currently unavailable. Use this debug code for testing.',
                ]);
            }
            respond(['error' => 'Could not send the login email. Check your spam folder or try again in a moment.'], 503);
        }
        respond(['ok' => true]);
    }

    if ($action === 'verify-code') {
        $input = body();
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        $code = preg_replace('/\D/', '', (string) ($input['code'] ?? ''));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($code) !== 6) respond(['error' => 'That code is not valid.'], 422);
        $statement = db()->prepare(
            'SELECT * FROM login_codes WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1'
        );
        $statement->execute([$email, gmdate('Y-m-d H:i:s')]);
        $record = $statement->fetch();
        $expected = hash_hmac('sha256', $email . ':' . $code, app_config()['app_secret']);
        if (!$record || (int) $record['attempts'] >= 6 || !hash_equals($record['code_hash'], $expected)) {
            if ($record) db()->prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?')->execute([$record['id']]);
            respond(['error' => 'That code is not valid or has expired.'], 422);
        }
        db()->beginTransaction();
        db()->prepare('UPDATE login_codes SET used_at = ? WHERE id = ?')->execute([gmdate('Y-m-d H:i:s'), $record['id']]);
        $userStatement = db()->prepare('SELECT id, email FROM users WHERE email = ?');
        $userStatement->execute([$email]);
        $user = $userStatement->fetch();
        if (!$user) {
            db()->prepare('INSERT INTO users (email, created_at) VALUES (?, ?)')->execute([$email, gmdate('Y-m-d H:i:s')]);
            $userStatement->execute([$email]);
            $user = $userStatement->fetch();
        }
        $token = bin2hex(random_bytes(32));
        db()->prepare('INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)')
            ->execute([$user['id'], hash('sha256', $token), gmdate('Y-m-d H:i:s', time() + 180 * 86400), gmdate('Y-m-d H:i:s')]);
        db()->commit();
        setcookie('gridlock_session', $token, [
            'expires' => time() + 180 * 86400, 'httponly' => true, 'path' => '/', 'samesite' => 'Lax', 'secure' => true,
        ]);
        respond([
            'game' => latest_game((int) $user['id']),
            'stats' => stats_for_user((int) $user['id']),
            'user' => ['email' => $user['email']],
        ]);
    }

    if ($action === 'logout') {
        $token = $_COOKIE['gridlock_session'] ?? '';
        if (is_string($token) && $token !== '') db()->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([hash('sha256', $token)]);
        setcookie('gridlock_session', '', ['expires' => 1, 'httponly' => true, 'path' => '/', 'samesite' => 'Lax', 'secure' => true]);
        respond(['ok' => true]);
    }

    if ($action === 'save-game') {
        $user = require_user();
        $game = validated_game(body());
        $now = gmdate('Y-m-d H:i:s');
        $completedAt = $game['result'] === null ? null : $now;
        $existing = db()->prepare('SELECT id, completed_at FROM games WHERE user_id = ? AND game_id = ? LIMIT 1');
        $existing->execute([$user['id'], $game['gameId']]);
        $row = $existing->fetch();
        if ($row && $row['completed_at']) {
            $margin = count(array_filter($game['owners'], static fn ($owner) => $owner === 1)) - count(array_filter($game['owners'], static fn ($owner) => $owner === 2));
            respond(['game' => $game, 'stats' => stats_for_user((int) $user['id']), 'daily' => $game['mode'] === 'daily' ? daily_standing((string) $game['dailyDate'], $margin) : null]);
        }
        $state = json_encode($game, JSON_UNESCAPED_SLASHES);
        if ($row) {
            $statement = db()->prepare(
                'UPDATE games SET difficulty = ?, state_json = ?, completed_at = ?, result = ?, updated_at = ? WHERE id = ?'
            );
            $statement->execute([$game['difficulty'], $state, $completedAt, $game['result'], $now, $row['id']]);
        } else {
            $statement = db()->prepare(
                'INSERT INTO games (user_id, game_id, difficulty, state_json, completed_at, result, updated_at, created_at) '
                . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            );
            $statement->execute([$user['id'], $game['gameId'], $game['difficulty'], $state, $completedAt, $game['result'], $now, $now]);
        }
        $margin = count(array_filter($game['owners'], static fn ($owner) => $owner === 1)) - count(array_filter($game['owners'], static fn ($owner) => $owner === 2));
        respond(['game' => $game, 'stats' => stats_for_user((int) $user['id']), 'daily' => $game['mode'] === 'daily' && $game['result'] !== null ? daily_standing((string) $game['dailyDate'], $margin) : null]);
    }

    respond(['error' => 'Not found.'], 404);
} catch (Throwable $error) {
    error_log('ENCIRCLE API: ' . $error->getMessage());
    respond(['error' => 'The server could not complete that request.'], 500);
}
