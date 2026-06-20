<?php
// Disable PHP execution time limit â€” large NIM models can take 60â€“120s
set_time_limit(0);
ini_set('max_execution_time', 0);

require_once 'market.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Default API Key provided by the user
$defaultApiKey = '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';

// Check if Authorization header is set, otherwise use default
$apiKey = $defaultApiKey;
$headers = getallheaders();
if (isset($headers['Authorization']) && preg_match('/Bearer\s(\S+)/', $headers['Authorization'], $matches)) {
    $apiKey = $matches[1];
}

$action = isset($_GET['action']) ? $_GET['action'] : '';

// Helper function to send API requests to NVIDIA NIM
// $timeout = 300 means 5 minutes timeout by default (large models like Nemotron 550B need this)
function callNvidiaNim($model, $messages, $apiKey, $temperature = 0.5, $maxTokens = 2048, $timeout = 300) {
    $url = 'https://integrate.api.nvidia.com/v1/chat/completions';
    
    $payload = [
        'model'       => $model,
        'messages'    => $messages,
        'temperature' => $temperature,
        'max_tokens'  => $maxTokens,
        'top_p'       => 1
    ];
    
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $apiKey
    ]);
    // Set explicit timeout (e.g. 300 seconds) to override any system/php defaults
    curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 30); // connection must establish within 30s
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($error) {
        return [
            'success' => false,
            'error' => 'cURL Error: ' . $error
        ];
    }
    
    if ($httpCode !== 200) {
        $errorMsg = 'HTTP ' . $httpCode;
        $responseDecoded = json_decode($response, true);
        if (isset($responseDecoded['detail'])) {
            $errorMsg .= ': ' . $responseDecoded['detail'];
        } elseif (isset($responseDecoded['error']['message'])) {
            $errorMsg .= ': ' . $responseDecoded['error']['message'];
        } else {
            $errorMsg .= ': ' . $response;
        }
        return [
            'success' => false,
            'error' => $errorMsg
        ];
    }
    
    $data = json_decode($response, true);
    if (isset($data['choices'][0]['message'])) {
        $msg = $data['choices'][0]['message'];
        $content = isset($msg['content']) && $msg['content'] !== null ? $msg['content'] : '';
        
        // Fallback to reasoning_content or reasoning fields if content is empty/null
        if ($content === '') {
            if (isset($msg['reasoning_content']) && $msg['reasoning_content'] !== null && $msg['reasoning_content'] !== '') {
                $content = $msg['reasoning_content'];
            } elseif (isset($msg['reasoning']) && $msg['reasoning'] !== null && $msg['reasoning'] !== '') {
                $content = $msg['reasoning'];
            }
        }
        
        if ($content !== '') {
            return [
                'success' => true,
                'content' => $content
            ];
        }
    }
    
    return [
        'success' => false,
        'error' => 'Invalid response structure from API: ' . $response
    ];
}

// Route handlers
switch ($action) {
    case 'get_market_data':
        $input = json_decode(file_get_contents('php://input'), true);
        $symbol = isset($input['symbol']) ? trim($input['symbol']) : '';
        $timeframe = isset($input['timeframe']) ? trim($input['timeframe']) : '';
        
        if (empty($symbol) || empty($timeframe)) {
            echo json_encode([
                'status' => 'error',
                'message' => 'Data market tidak tersedia',
                'errors' => ['Symbol atau timeframe tidak ditentukan']
            ]);
            exit;
        }
        
        // 1. Fetch candles
        $candles = fetchYahooCandles($symbol, $timeframe);
        if ($candles === null || empty($candles)) {
            // FAILSAFE: Jika data market gagal diambil
            echo json_encode([
                'status' => 'error',
                'message' => 'Analisis tidak dapat dilakukan karena data market terbaru belum tersedia.',
                'failsafe' => true
            ]);
            exit;
        }
        
        // 2. Calculate indicators
        $indicatorResult = calculateAllIndicators($candles);
        
        // 3. Run the 6-step validation checks
        $verify = verifyMarketData($symbol, $timeframe, $candles, $indicatorResult);
        
        // 4. Check data freshness (WARNING-ONLY â€” does NOT block validation)
        // Generous limits accommodate: weekends, CME daily halt (17:00â€“18:00 ET),
        // Yahoo Finance delayed feeds, and public holidays.
        // A "broken" feed (e.g. data from 3+ days ago on M1) is still caught by
        // the 6-step validation above (candle count, last price, indicators).
        $lastCandle = end($candles);
        $lastCandleTime = $lastCandle['timestamp'];
        $currentTime = time();
        $ageSeconds = $currentTime - $lastCandleTime;

        // "UI warning" threshold â€” age shown in amber/red but analysis is NOT blocked
        // Rule of thumb: ~3Ã— the candle duration for intraday, 7 days for D1
        $freshnessLimit = 259200; // default 72h (covers longest holiday weekend)
        switch (strtoupper($timeframe)) {
            case 'M1':  $freshnessLimit = 7200;   break; // 2h
            case 'M5':  $freshnessLimit = 21600;  break; // 6h
            case 'M15': $freshnessLimit = 43200;  break; // 12h
            case 'H1':  $freshnessLimit = 259200; break; // 72h  â† covers weekends + CME halt
            case 'H4':  $freshnessLimit = 345600; break; // 96h
            case 'D1':  $freshnessLimit = 864000; break; // 10 days
        }

        // Staleness is attached as metadata only â€” validation still succeeds
        $isStale = ($ageSeconds > $freshnessLimit);

        if (!$verify['success']) {
            echo json_encode([
                'status'          => 'error',
                'message'         => 'Data market tidak tersedia',
                'errors'          => $verify['errors'],
                'age_seconds'     => $ageSeconds,
                'freshness_limit' => $freshnessLimit
            ]);
            exit;
        }
        
        // Verification succeeded! Return successful data
        echo json_encode([
            'status'           => 'success',
            'symbol'           => $symbol,
            'timeframe'        => $timeframe,
            'last_price'       => $lastCandle['close'],
            'candles_count'    => count($candles),
            'last_candle_time' => date('Y-m-d\TH:i:s\Z', $lastCandleTime),
            'analysis_time'    => date('Y-m-d\TH:i:s\Z', $currentTime),
            'age_seconds'      => $ageSeconds,
            'freshness_limit'  => $freshnessLimit,
            'is_stale'         => $isStale, // true = data older than threshold (UI warning only)
            'supports'         => $indicatorResult['supports'],
            'resistances'      => $indicatorResult['resistances'],
            'latest_candle'    => $lastCandle,
            'recent_candles'   => array_slice($indicatorResult['candles'], -15), // last 15 candles with indicators for context
            'chart_candles'    => array_slice($indicatorResult['candles'], -150), // last 150 candles for visual chart rendering
        ]);
        exit;
        
    case 'check_key':
        // Quick check using a very lightweight model or just testing the key status
        // Let's use nvidia/nemotron-mini-4b-instruct to check connection
        $testMessage = [['role' => 'user', 'content' => 'ping']];
        $result = callNvidiaNim('nvidia/nemotron-mini-4b-instruct', $testMessage, $apiKey, 0.1, 10);
        if ($result['success']) {
            echo json_encode(['success' => true, 'message' => 'API Key is valid.']);
        } else {
            echo json_encode(['success' => false, 'error' => $result['error']]);
        }
        break;
        
    case 'check_model':
        // Quick health check on specific model
        // Uses 30s timeout & min 100 tokens so large models (Qwen, Nemotron) don't give false-fail
        $input = json_decode(file_get_contents('php://input'), true);
        $model = isset($input['model']) ? $input['model'] : '';
        if (empty($model)) {
            echo json_encode(['success' => false, 'error' => 'Missing model parameter.']);
            exit;
        }
        $testMessage = [['role' => 'user', 'content' => 'hi']];
        // 30s timeout, 100 min tokens â€” prevents HTTP 500 from Qwen (min token requirement)
        $result = callNvidiaNim($model, $testMessage, $apiKey, 0.5, 100, 30);
        echo json_encode($result);
        break;
        
    case 'think':
        // Phase 1: Independent Thinking
        $input = json_decode(file_get_contents('php://input'), true);
        $model = isset($input['model']) ? $input['model'] : '';
        $question = isset($input['question']) ? $input['question'] : '';
        $roleInfo = isset($input['roleInfo']) ? $input['roleInfo'] : '';
        $focusInfo = isset($input['focusInfo']) ? $input['focusInfo'] : '';
        
        if (empty($model) || empty($question)) {
            echo json_encode(['success' => false, 'error' => 'Missing model or question parameters.']);
            exit;
        }
        
        $systemPrompt = "You are a member of the VDGANH - AI Consensus Council. "
                      . "Your identity: $model. Your Role: $roleInfo. Your Focus: $focusInfo.\n\n"
                      . "Task: Answer the user's question independently and objectively. "
                      . "Provide a clear, detailed, and accurate answer based solely on your own knowledge and logic.\n"
                      . "Do not worry about what other models might think.\n\n"
                      . "You MUST output a confidence score at the start or end of your analysis. "
                      . "Format the confidence score explicitly like this: 'Confidence Score: [0-100]'.\n"
                      . "Write your analysis in Indonesian (Bahasa Indonesia) since the user is Indonesian. However, if the question asks for code, keep code blocks in their original programming language.";
                      
        $messages = [
            ['role' => 'system', 'content' => $systemPrompt],
            ['role' => 'user', 'content' => $question]
        ];
        
        $result = callNvidiaNim($model, $messages, $apiKey, 0.5, 1024); // reduced from 2048 for speed
        echo json_encode($result);
        break;
        
    case 'review':
        // Phase 2: Cross Review
        $input = json_decode(file_get_contents('php://input'), true);
        $model = isset($input['model']) ? $input['model'] : '';
        $question = isset($input['question']) ? $input['question'] : '';
        $answers = isset($input['answers']) ? $input['answers'] : []; // Array of {modelName, answer}
        $roleInfo = isset($input['roleInfo']) ? $input['roleInfo'] : '';
        $focusInfo = isset($input['focusInfo']) ? $input['focusInfo'] : '';
        
        if (empty($model) || empty($question) || empty($answers)) {
            echo json_encode(['success' => false, 'error' => 'Missing required parameters for cross review.']);
            exit;
        }
        
        $answersFormatted = "";
        foreach ($answers as $item) {
            $answersFormatted .= "### Model: " . $item['modelName'] . "\n" . $item['answer'] . "\n\n";
        }
        
        $systemPrompt = "You are a member of the VDGANH - AI Consensus Council. "
                      . "Your identity: $model. Your Role: $roleInfo. Your Focus: $focusInfo.\n\n"
                      . "Task: Review the answers provided by the other council members for the user's question. "
                      . "Critically evaluate their responses: look for factual inaccuracies, logical inconsistencies, unsupported assumptions, or incomplete explanations.\n"
                      . "Provide constructive, objective criticism in Indonesian (Bahasa Indonesia). Focus on identifying strengths and weaknesses. Be concise and direct. Do not write a new answer yourself, just critique the others.";
                      
        $userPrompt = "User Question: $question\n\n"
                    . "Here are the answers from other council members:\n\n"
                    . $answersFormatted;
                    
        $messages = [
            ['role' => 'system', 'content' => $systemPrompt],
            ['role' => 'user', 'content' => $userPrompt]
        ];
        
        $result = callNvidiaNim($model, $messages, $apiKey, 0.3, 768); // reduced from 1500 for speed
        echo json_encode($result);
        break;
        
    case 'improve':
        // Phase 3: Improvement Phase
        $input = json_decode(file_get_contents('php://input'), true);
        $model = isset($input['model']) ? $input['model'] : '';
        $question = isset($input['question']) ? $input['question'] : '';
        $previousAnswer = isset($input['previousAnswer']) ? $input['previousAnswer'] : '';
        $critiques = isset($input['critiques']) ? $input['critiques'] : []; // Array of {modelName, critique}
        $roleInfo = isset($input['roleInfo']) ? $input['roleInfo'] : '';
        $focusInfo = isset($input['focusInfo']) ? $input['focusInfo'] : '';
        
        if (empty($model) || empty($previousAnswer)) {
            echo json_encode(['success' => false, 'error' => 'Missing required parameters for improvement phase.']);
            exit;
        }
        
        $critiquesFormatted = "";
        foreach ($critiques as $item) {
            $critiquesFormatted .= "### Critique from " . $item['modelName'] . ":\n" . $item['critique'] . "\n\n";
        }
        
        $systemPrompt = "You are a member of the VDGANH - AI Consensus Council. "
                      . "Your identity: $model. Your Role: $roleInfo. Your Focus: $focusInfo.\n\n"
                      . "Task: Refine and improve your previous answer based on the critiques you received from other council members.\n"
                      . "- Maintain your correct arguments.\n"
                      . "- Fix any factual or logical errors pointed out.\n"
                      . "- Clarify any ambiguities and remove weak or unsupported assumptions.\n"
                      . "- Write a polished, comprehensive final version of your answer in Indonesian (Bahasa Indonesia).\n\n"
                      . "You MUST output a revised confidence score. Format it explicitly as: 'Confidence Score: [0-100]' at the end.";
                      
        $userPrompt = "Original Question: $question\n\n"
                    . "Your Previous Answer:\n" . $previousAnswer . "\n\n"
                    . "Critiques received from other members:\n\n" . $critiquesFormatted;
                    
        $messages = [
            ['role' => 'system', 'content' => $systemPrompt],
            ['role' => 'user', 'content' => $userPrompt]
        ];
        
        $result = callNvidiaNim($model, $messages, $apiKey, 0.4, 1200); // reduced from 2048 for speed
        echo json_encode($result);
        break;
        
    case 'consensus':
        // Phase 4: Consensus Building
        $input = json_decode(file_get_contents('php://input'), true);
        $question = isset($input['question']) ? $input['question'] : '';
        $refinedAnswers = isset($input['refinedAnswers']) ? $input['refinedAnswers'] : []; // Array of {modelName, answer}
        
        if (empty($question) || empty($refinedAnswers)) {
            echo json_encode(['success' => false, 'error' => 'Missing required parameters for consensus.']);
            exit;
        }
        
        $answersFormatted = "";
        foreach ($refinedAnswers as $item) {
            $answersFormatted .= "### Model: " . $item['modelName'] . "\n" . $item['answer'] . "\n\n";
        }
           $systemPrompt = "Anda adalah Qwen3.5-397B-A17B (Strategic Analyst, Fact Checker, Consensus Judge), Ketua Dewan VDGANH - AI Consensus Engine.\n"
                      . "Tugas Anda adalah mengumpulkan seluruh hasil perbaikan dari dewan AI dan menyusun jawaban konsensus final.\n\n"
                      . "TUGAS UTAMA:\n"
                      . "1. Mengumpulkan seluruh hasil.\n"
                      . "2. Mengidentifikasi fakta yang disetujui mayoritas.\n"
                      . "3. Mengidentifikasi fakta yang diperdebatkan.\n"
                      . "4. Menghapus informasi yang lemah.\n"
                      . "5. Menggabungkan keunggulan seluruh model.\n"
                      . "6. Menyusun jawaban final terbaik.\n\n"
                      . "FORMAT OUTPUT WAJIB â€” gunakan persis seperti di bawah ini. JANGAN melewati atau mengosongkan satu pun seksi, terutama ## JAWABAN FINAL KONSENSUS:\n\n"
                      . "## CONSENSUS SCORE\n"
                      . "[Nilai 0-100 berdasarkan tingkat kesepakatan antar model]\n\n"
                      . "## FAKTA YANG DISETUJUI\n"
                      . "- [poin 1]\n"
                      . "- [poin 2]\n"
                      . "...\n\n"
                      . "## FAKTA YANG DIPERDEBATKAN\n"
                      . "- [poin 1]\n"
                      . "- [poin 2]\n"
                      . "...\n\n"
                      . "## ANALISIS DEWAN AI\n\n"
                      . "### Qwen\n"
                      . "[Analisis singkat mengenai pandangan Qwen3.5]\n\n"
                      . "### Nemotron\n"
                      . "[Analisis singkat mengenai pandangan Llama-3.3-Nemotron-49B]\n\n"
                      . "### DeepSeek\n"
                      . "[Analisis singkat mengenai pandangan DeepSeek]\n\n"
                      . "### Llama\n"
                      . "[Analisis singkat mengenai pandangan Llama-3.3]\n\n"
                      . "### Nemotron Reasoning\n"
                      . "[Analisis singkat mengenai pandangan Nemotron Reasoning]\n\n"
                      . "### Llama Maverick\n"
                      . "[Analisis singkat mengenai pandangan Llama Maverick]\n\n"
                      . "### qwen/qwen3.5-122b-a10b\n"
                      . "[Analisis singkat mengenai pandangan qwen/qwen3.5-122b-a10b]\n\n"
                      . "## JAWABAN FINAL KONSENSUS\n"
                      . "[WAJIB DIISI â€” Berikan jawaban terbaik, lengkap, dan komprehensif hasil gabungan seluruh model dalam Bahasa Indonesia. "
                      . "Sertakan rekomendasi entry, stop loss, take profit (jika relevan), dan reasoning utama. "
                      . "Ini adalah seksi yang paling penting â€” JANGAN dikosongkan.]\n\n"
                      . "## TINGKAT KEYAKINAN\n"
                      . "[Tinggi / Sedang / Rendah]\n\n"
                      . "## ALASAN\n"
                      . "[Jelaskan mengapa jawaban ini dipilih sebagai hasil akhir dan bagaimana dewan mencapai konsensus]";
                       
        $userPrompt = "Original User Question: $question\n\n"
                    . "Refined answers from the council members:\n\n" . $answersFormatted;
                     
        $messages = [
            ['role' => 'system', 'content' => $systemPrompt],
            ['role' => 'user', 'content' => $userPrompt]
        ];
        
        // Consensus compiler: use the model passed by JS (usually the online Qwen 397B),
        // with automatic fallback chain if the primary model times out or errors.
        $compilingModel = isset($input['model']) ? $input['model'] : 'qwen/qwen3.5-397b-a17b';
        $result = callNvidiaNim($compilingModel, $messages, $apiKey, 0.3, 2500, 240);

        // Fallback 1: Llama-3.3-Nemotron-Super-49B (confirmed active)
        if (!$result['success']) {
            error_log("[CONSENSUS] Primary compiler '$compilingModel' failed. Trying Llama-3.3-Nemotron-49B...");
            $result = callNvidiaNim('nvidia/llama-3.3-nemotron-super-49b-v1.5', $messages, $apiKey, 0.3, 2500, 120);
        }

        // Fallback 2: DeepSeek-V4-Pro (fast & reliable)
        if (!$result['success']) {
            error_log("[CONSENSUS] Fallback 1 failed. Trying DeepSeek-V4-Pro...");
            $result = callNvidiaNim('deepseek-ai/deepseek-v4-pro', $messages, $apiKey, 0.3, 2500, 120);
        }

        echo json_encode($result);
        break;
        
    case 'chat_followup':
        // Chat directly with the Council Chair (Qwen 397B) about the consensus report
        $input = json_decode(file_get_contents('php://input'), true);
        $history = isset($input['history']) ? $input['history'] : [];
        $context = isset($input['context']) ? $input['context'] : '';
        $model = isset($input['model']) ? $input['model'] : 'qwen/qwen3.5-397b-a17b';

        if (empty($context)) {
            echo json_encode(['success' => false, 'error' => 'Missing context.']);
            exit;
        }

        $systemPrompt = "Anda adalah Qwen3.5-397B-A17B, Ketua Dewan VDGANH - AI Consensus Engine.\n"
                      . "Layani tanya jawab lanjutan (follow-up chat) tentang Laporan Konsensus Dewan AI.\n\n"
                      . "=== KONTEKS LAPORAN ===\n"
                      . $context . "\n\n"
                      . "ATURAN:\n"
                      . "1. Jawab secara mendalam, objektif, dan profesional.\n"
                      . "2. Jaga konsistensi dengan level support, resistance, entry, stop loss, dan take profit di laporan.\n"
                      . "3. Gunakan Bahasa Indonesia.\n"
                      . "4. Jika ditanya hal teknis/koding, berikan contoh sintaks lengkap.";

        $messages = [['role' => 'system', 'content' => $systemPrompt]];
        foreach ($history as $msg) {
            $messages[] = [
                'role' => $msg['role'],
                'content' => $msg['content']
            ];
        }

        $result = callNvidiaNim($model, $messages, $apiKey, 0.5, 1500, 150);

        // Fallback to Llama-Nemotron if primary fails
        if (!$result['success']) {
            $result = callNvidiaNim('nvidia/llama-3.3-nemotron-super-49b-v1.5', $messages, $apiKey, 0.5, 1500, 100);
        }

        echo json_encode($result);
        break;
        
    case 'describe_image':
        // Vision Model Phase: Describe/Analyze the uploaded image using a multi-AI agent setup
        $input = json_decode(file_get_contents('php://input'), true);
        $imageData = isset($input['image']) ? $input['image'] : '';
        $question  = isset($input['question']) ? $input['question'] : '';
        
        if (empty($imageData)) {
            echo json_encode(['success' => false, 'error' => 'Missing image data.']);
            exit;
        }

        // --- STEP 1: VISION #1 (meta/llama-3.2-90b-vision-instruct) - Analisis Gambar Utama ---
        $promptText1 = "Anda adalah Vision Analyst #1 (meta/llama-3.2-90b-vision-instruct) untuk VDGANH - AI Consensus Council.\n\n"
                    . "Analisis gambar yang diberikan secara sangat mendetail dan objektif. Tulis laporan utama yang mencakup:\n"
                    . "1. Objek, entitas, dan elemen visual yang terlihat\n"
                    . "2. Teks, kode, atau angka dalam gambar (OCR lengkap)\n"
                    . "3. Diagram, chart, atau skema (jelaskan strukturnya)\n"
                    . "4. Warna, komposisi, konteks visual\n"
                    . "5. Anomali atau hal menarik lainnya\n\n"
                    . "Gunakan Bahasa Indonesia.\n\n"
                    . "Fokus pertanyaan user: " . ($question ? $question : "Lakukan deskripsi detail.") . "\n\n"
                    . "<img src=\"$imageData\" />";
        
        $messages1 = [['role' => 'user', 'content' => $promptText1]];
        $v1Model = 'meta/llama-3.2-90b-vision-instruct';
        
        $res1 = callNvidiaNim($v1Model, $messages1, $apiKey, 0.2, 1024, 60);
        
        // Fallback for Vision #1 if Llama 90B is offline/overloaded
        if (!$res1['success']) {
            error_log("[VISION #1] $v1Model failed, falling back to 11B version.");
            $v1Model = 'meta/llama-3.2-11b-vision-instruct';
            $res1 = callNvidiaNim($v1Model, $messages1, $apiKey, 0.2, 1024, 60);
        }

        if (!$res1['success']) {
            echo json_encode(['success' => false, 'error' => 'Vision #1 Model failed: ' . $res1['error']]);
            exit;
        }
        $mainAnalysis = $res1['content'];

        // --- STEP 2: VISION #3 (google/gemma-3n-e4b-it) - Pendapat Independen ---
        $promptText3 = "Anda adalah Vision Analyst #3 (google/gemma-3n-e4b-it) untuk VDGANH - AI Consensus Council.\n\n"
                    . "Tugas Anda adalah memberikan analisis visual secara independen dan objektif dari gambar yang dilampirkan.\n"
                    . "Temukan aspek-aspek penting yang mungkin dilewatkan oleh analis lain.\n"
                    . "Tulis laporan pendapat independen Anda dalam Bahasa Indonesia.\n\n"
                    . "Fokus pertanyaan user: " . ($question ? $question : "Lakukan deskripsi detail.") . "\n\n"
                    . "<img src=\"$imageData\" />";
        
        $messages3 = [['role' => 'user', 'content' => $promptText3]];
        $v3Model = 'google/gemma-3n-e4b-it';
        
        $res3 = callNvidiaNim($v3Model, $messages3, $apiKey, 0.2, 1024, 60);
        
        // Fallback for Vision #3 if Gemma 3n is offline/overloaded
        if (!$res3['success']) {
            error_log("[VISION #3] $v3Model failed, falling back to microsoft/phi-3.5-vision-instruct.");
            $v3Model = 'microsoft/phi-3.5-vision-instruct';
            $res3 = callNvidiaNim($v3Model, $messages3, $apiKey, 0.2, 1024, 60);
        }

        if (!$res3['success']) {
            error_log("[VISION #3] Fallbacks failed, using Main Analysis as fallback.");
            $independentAnalysis = $mainAnalysis;
        } else {
            $independentAnalysis = $res3['content'];
        }

        // --- STEP 3: VISION #2 (qwen/qwen3.5-397b-a17b) - Validasi dan Kritik Hasil ---
        $promptText2 = "Anda adalah Vision Analyst #2 (qwen/qwen3.5-397b-a17b) untuk VDGANH - AI Consensus Council.\n\n"
                    . "Tugas Anda adalah meninjau, memvalidasi, dan mengkritik hasil analisis gambar dari analis lainnya:\n\n"
                    . "=== LAPORAN UTAMA (Vision #1) ===\n$mainAnalysis\n\n"
                    . "=== LAPORAN INDEPENDEN (Vision #3) ===\n$independentAnalysis\n\n"
                    . "Fokus pertanyaan user: " . ($question ? $question : "Lakukan deskripsi detail.") . "\n\n"
                    . "Tugas Anda:\n"
                    . "1. Validasi fakta: Identifikasi apakah ada kontradiksi atau kesalahan interpretasi antar laporan.\n"
                    . "2. Kritik & Sintesis: Gabungkan temuan-temuan terbaik dari kedua laporan di atas menjadi satu deskripsi final yang koheren, terstruktur, bebas redundansi, dan sangat akurat.\n"
                    . "3. Tuliskan deskripsi final terverifikasi tersebut dalam Bahasa Indonesia agar siap dibaca oleh dewan AI.";
                    
        $messages2 = [
            ['role' => 'user', 'content' => $promptText2]
        ];
        $v2Model = 'qwen/qwen3.5-397b-a17b';
        
        $res2 = callNvidiaNim($v2Model, $messages2, $apiKey, 0.2, 1024, 60);
        
        // Fallback for Vision #2 if Qwen 397B is offline/overloaded
        if (!$res2['success']) {
            error_log("[VISION #2] $v2Model failed, falling back to Llama-3.3-Nemotron-49B.");
            $v2Model = 'nvidia/llama-3.3-nemotron-super-49b-v1.5';
            $res2 = callNvidiaNim($v2Model, $messages2, $apiKey, 0.2, 1024, 60);
        }

        if (!$res2['success']) {
            error_log("[VISION #2] Fallbacks failed, building simple merge.");
            $finalContent = "### Analisis Visi Gabungan (Fallback)\n\n" . $mainAnalysis . "\n\n### Catatan Tambahan\n\n" . $independentAnalysis;
        } else {
            $finalContent = $res2['content'];
        }

        // Return final validated/critiqued description
        echo json_encode([
            'success' => true,
            'content' => $finalContent,
            'model_used' => "Ensemble (Vision #1: $v1Model, Vision #3: $v3Model, Validator: $v2Model)"
        ]);
        break;
        
    default:
        echo json_encode(['success' => false, 'error' => 'Invalid action.']);
        break;
}

