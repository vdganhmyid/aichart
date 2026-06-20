<?php
// market.php - Market Data Fetcher & Technical Indicator Calculator

/**
 * Maps standard symbols to Yahoo Finance symbols
 */
function mapSymbol($symbol) {
    $symbol = strtoupper(trim($symbol));
    $mapping = [
        'XAUUSD' => 'GC=F', // Gold Futures is most reliable spot-proxy on Yahoo
        'GOLD'   => 'GC=F',
        'EURUSD' => 'EURUSD=X',
        'GBPUSD' => 'GBPUSD=X',
        'USDJPY' => 'USDJPY=X',
        'AUDUSD' => 'AUDUSD=X',
        'USDCAD' => 'USDCAD=X',
        'USDCHF' => 'USDCHF=X',
        'NZDUSD' => 'NZDUSD=X',
        'BTCUSD' => 'BTC-USD',
        'BTCUSDT'=> 'BTC-USD',
        'ETHUSD' => 'ETH-USD',
        'ETHUSDT'=> 'ETH-USD',
    ];
    
    return isset($mapping[$symbol]) ? $mapping[$symbol] : $symbol;
}

/**
 * Fetches candlestick data from Yahoo Finance
 */
function fetchYahooCandles($symbol, $timeframe) {
    $yahooSymbol = mapSymbol($symbol);
    
    // Determine interval and range based on timeframe
    $interval = '15m';
    $range = '10d';
    
    switch (strtoupper($timeframe)) {
        case 'M1':
            $interval = '1m';
            $range = '4d'; // Yahoo limits 1m to 7 days max
            break;
        case 'M5':
            $interval = '5m';
            $range = '5d';
            break;
        case 'M15':
            $interval = '15m';
            $range = '10d';
            break;
        case 'H1':
            $interval = '60m'; // or '1h'
            $range = '30d';
            break;
        case 'H4':
            // H4 is not supported natively by Yahoo Finance.
            // We fetch H1 (60m) and aggregate to H4.
            $interval = '60m';
            $range = '60d';
            break;
        case 'D1':
            $interval = '1d';
            $range = '1y';
            break;
    }
    
    $url = "https://query1.finance.yahoo.com/v8/finance/chart/{$yahooSymbol}?interval={$interval}&range={$range}";
    
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36');
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode !== 200 || !$response) {
        return null;
    }
    
    $data = json_decode($response, true);
    if (!isset($data['chart']['result'][0])) {
        return null;
    }
    
    $result = $data['chart']['result'][0];
    if (!isset($result['timestamp']) || !isset($result['indicators']['quote'][0])) {
        return null;
    }
    
    $timestamps = $result['timestamp'];
    $quote = $result['indicators']['quote'][0];
    
    $opens = isset($quote['open']) ? $quote['open'] : [];
    $highs = isset($quote['high']) ? $quote['high'] : [];
    $lows = isset($quote['low']) ? $quote['low'] : [];
    $closes = isset($quote['close']) ? $quote['close'] : [];
    $volumes = isset($quote['volume']) ? $quote['volume'] : [];
    
    // Build raw candles array
    $candles = [];
    $len = count($timestamps);
    
    for ($i = 0; $i < $len; $i++) {
        // Skip null values (sometimes Yahoo has null values for holidays/after hours)
        if ($opens[$i] === null || $highs[$i] === null || $lows[$i] === null || $closes[$i] === null) {
            continue;
        }
        
        $candles[] = [
            'timestamp' => $timestamps[$i],
            'time_str'  => date('Y-m-d H:i:s', $timestamps[$i]),
            'open'      => floatval($opens[$i]),
            'high'      => floatval($highs[$i]),
            'low'       => floatval($lows[$i]),
            'close'     => floatval($closes[$i]),
            'volume'    => floatval($volumes[$i] ?? 0)
        ];
    }
    
    // If timeframe is H4, we aggregate H1 candles
    if (strtoupper($timeframe) === 'H4') {
        $candles = aggregateH1ToH4($candles);
    }
    
    return $candles;
}

/**
 * Aggregates 1-hour candles into 4-hour candles
 */
function aggregateH1ToH4($h1Candles) {
    $h4Candles = [];
    $count = count($h1Candles);
    
    $temp = [];
    for ($i = 0; $i < $count; $i++) {
        $c = $h1Candles[$i];
        $temp[] = $c;
        
        if (count($temp) === 4 || $i === $count - 1) {
            $highs = array_map(function($x) { return $x['high']; }, $temp);
            $lows = array_map(function($x) { return $x['low']; }, $temp);
            $volumes = array_map(function($x) { return $x['volume']; }, $temp);
            
            $h4Candles[] = [
                'timestamp' => $temp[0]['timestamp'],
                'time_str'  => $temp[0]['time_str'],
                'open'      => $temp[0]['open'],
                'high'      => max($highs),
                'low'       => min($lows),
                'close'     => end($temp)['close'],
                'volume'    => array_sum($volumes)
            ];
            $temp = [];
        }
    }
    
    return $h4Candles;
}

/**
 * Calculates Simple Moving Average
 */
function calculateSMA($prices, $period) {
    $count = count($prices);
    $sma = array_fill(0, $count, null);
    
    if ($count < $period) {
        return $sma;
    }
    
    $sum = 0;
    for ($i = 0; $i < $period; $i++) {
        $sum += $prices[$i];
    }
    $sma[$period - 1] = $sum / $period;
    
    for ($i = $period; $i < $count; $i++) {
        $sum += $prices[$i] - $prices[$i - $period];
        $sma[$i] = $sum / $period;
    }
    
    return $sma;
}

/**
 * Calculates Exponential Moving Average
 */
function calculateEMA($prices, $period) {
    $count = count($prices);
    $ema = array_fill(0, $count, null);
    
    if ($count < $period) {
        return $ema;
    }
    
    $sum = 0;
    for ($i = 0; $i < $period; $i++) {
        $sum += $prices[$i];
    }
    $ema[$period - 1] = $sum / $period;
    
    $multiplier = 2 / ($period + 1);
    for ($i = $period; $i < $count; $i++) {
        $ema[$i] = ($prices[$i] - $ema[$i - 1]) * $multiplier + $ema[$i - 1];
    }
    
    return $ema;
}

/**
 * Calculates Relative Strength Index (RSI)
 */
function calculateRSI($prices, $period = 14) {
    $count = count($prices);
    $rsi = array_fill(0, $count, null);
    
    if ($count <= $period) {
        return $rsi;
    }
    
    $gains = [];
    $losses = [];
    
    for ($i = 1; $i < $count; $i++) {
        $diff = $prices[$i] - $prices[$i - 1];
        $gains[$i] = $diff > 0 ? $diff : 0;
        $losses[$i] = $diff < 0 ? abs($diff) : 0;
    }
    
    $avgGain = array_sum(array_slice($gains, 1, $period)) / $period;
    $avgLoss = array_sum(array_slice($losses, 1, $period)) / $period;
    
    if ($avgLoss == 0) {
        $rsi[$period] = 100;
    } else {
        $rs = $avgGain / $avgLoss;
        $rsi[$period] = 100 - (100 / (1 + $rs));
    }
    
    for ($i = $period + 1; $i < $count; $i++) {
        $avgGain = (($avgGain * ($period - 1)) + $gains[$i]) / $period;
        $avgLoss = (($avgLoss * ($period - 1)) + $losses[$i]) / $period;
        
        if ($avgLoss == 0) {
            $rsi[$i] = 100;
        } else {
            $rs = $avgGain / $avgLoss;
            $rsi[$i] = 100 - (100 / (1 + $rs));
        }
    }
    
    return $rsi;
}

/**
 * Calculates Bollinger Bands
 */
function calculateBollingerBands($prices, $period = 20, $stdDevMultiplier = 2) {
    $count = count($prices);
    $bands = [
        'upper'  => array_fill(0, $count, null),
        'middle' => array_fill(0, $count, null),
        'lower'  => array_fill(0, $count, null)
    ];
    
    if ($count < $period) {
        return $bands;
    }
    
    $sma = calculateSMA($prices, $period);
    
    for ($i = $period - 1; $i < $count; $i++) {
        $slice = array_slice($prices, $i - $period + 1, $period);
        $mean = $sma[$i];
        
        $variance = 0;
        foreach ($slice as $val) {
            $variance += pow($val - $mean, 2);
        }
        $stdDev = sqrt($variance / $period);
        
        $bands['middle'][$i] = $mean;
        $bands['upper'][$i]  = $mean + ($stdDevMultiplier * $stdDev);
        $bands['lower'][$i]  = $mean - ($stdDevMultiplier * $stdDev);
    }
    
    return $bands;
}

/**
 * Calculates MACD
 */
function calculateMACD($prices, $fastPeriod = 12, $slowPeriod = 26, $signalPeriod = 9) {
    $count = count($prices);
    
    $macd = array_fill(0, $count, null);
    $signal = array_fill(0, $count, null);
    $hist = array_fill(0, $count, null);
    
    if ($count < $slowPeriod) {
        return ['macd' => $macd, 'signal' => $signal, 'hist' => $hist];
    }
    
    $fastEma = calculateEMA($prices, $fastPeriod);
    $slowEma = calculateEMA($prices, $slowPeriod);
    
    $macdValues = [];
    for ($i = 0; $i < $count; $i++) {
        if ($fastEma[$i] !== null && $slowEma[$i] !== null) {
            $macd[$i] = $fastEma[$i] - $slowEma[$i];
            $macdValues[$i] = $macd[$i];
        } else {
            $macdValues[$i] = null;
        }
    }
    
    $nonNullMacd = array_filter($macdValues, function($x) { return $x !== null; });
    $nonNullIndices = array_keys($nonNullMacd);
    $nonNullValues = array_values($nonNullMacd);
    
    $nonNullSignal = calculateEMA($nonNullValues, $signalPeriod);
    
    foreach ($nonNullIndices as $idx => $origIdx) {
        $signal[$origIdx] = $nonNullSignal[$idx];
        if ($macd[$origIdx] !== null && $signal[$origIdx] !== null) {
            $hist[$origIdx] = $macd[$origIdx] - $signal[$origIdx];
        }
    }
    
    return [
        'macd'   => $macd,
        'signal' => $signal,
        'hist'   => $hist
    ];
}

/**
 * Calculates ATR (Average True Range)
 */
function calculateATR($candles, $period = 14) {
    $count = count($candles);
    $atr = array_fill(0, $count, null);
    
    if ($count <= $period) {
        return $atr;
    }
    
    $tr = [0 => 0];
    for ($i = 1; $i < $count; $i++) {
        $high = $candles[$i]['high'];
        $low = $candles[$i]['low'];
        $prevClose = $candles[$i - 1]['close'];
        
        $tr[$i] = max(
            $high - $low,
            abs($high - $prevClose),
            abs($low - $prevClose)
        );
    }
    
    $sum = 0;
    for ($i = 1; $i <= $period; $i++) {
        $sum += $tr[$i];
    }
    $atr[$period] = $sum / $period;
    
    for ($i = $period + 1; $i < $count; $i++) {
        $atr[$i] = (($atr[$i - 1] * ($period - 1)) + $tr[$i]) / $period;
    }
    
    return $atr;
}

/**
 * Calculates Support & Resistance levels from recent swings with fallback
 */
function calculateSupportResistance($candles, $depth = 5, $numLevels = 3) {
    $count = count($candles);
    $highs = [];
    $lows = [];
    
    $startIdx = max(0, $count - 100);
    $lastClose = end($candles)['close'];
    
    for ($i = $startIdx + $depth; $i < $count - $depth; $i++) {
        $isSwingHigh = true;
        $isSwingLow = true;
        
        for ($j = 1; $j <= $depth; $j++) {
            if ($candles[$i]['high'] < $candles[$i - $j]['high'] || $candles[$i]['high'] < $candles[$i + $j]['high']) {
                $isSwingHigh = false;
            }
            if ($candles[$i]['low'] > $candles[$i - $j]['low'] || $candles[$i]['low'] > $candles[$i + $j]['low']) {
                $isSwingLow = false;
            }
        }
        
        if ($isSwingHigh) {
            $highs[] = $candles[$i]['high'];
        }
        if ($isSwingLow) {
            $lows[] = $candles[$i]['low'];
        }
    }
    
    // Deduplicate and group closely spaced levels
    sort($highs);
    sort($lows);
    
    $resistances = [];
    foreach ($highs as $h) {
        $merged = false;
        foreach ($resistances as &$r) {
            if (abs($r - $h) / $h < 0.003) { // 0.3% tolerance
                $r = ($r + $h) / 2;
                $merged = true;
                break;
            }
        }
        if (!$merged) {
            $resistances[] = $h;
        }
    }
    
    $supports = [];
    foreach ($lows as $l) {
        $merged = false;
        foreach ($supports as &$s) {
            if (abs($s - $l) / $l < 0.003) {
                $s = ($s + $l) / 2;
                $merged = true;
                break;
            }
        }
        if (!$merged) {
            $supports[] = $l;
        }
    }
    
    $resFiltered = array_filter($resistances, function($r) use ($lastClose) { return $r > $lastClose; });
    $supFiltered = array_filter($supports, function($s) use ($lastClose) { return $s < $lastClose; });
    
    sort($resFiltered);
    rsort($supFiltered);
    
    $finalRes = array_slice($resFiltered, 0, $numLevels);
    $finalSup = array_slice($supFiltered, 0, $numLevels);
    
    // --- FALLBACK: Pivot Points ---
    if (count($finalRes) < $numLevels || count($finalSup) < $numLevels) {
        // Calculate Classical Pivot Points on last 50 candles as proxy day
        $lookback = array_slice($candles, -50);
        $highVals = array_map(function($x) { return $x['high']; }, $lookback);
        $lowVals  = array_map(function($x) { return $x['low']; }, $lookback);
        
        $pHigh  = max($highVals);
        $pLow   = min($lowVals);
        $pClose = $lastClose;
        
        $pivot = ($pHigh + $pLow + $pClose) / 3;
        $r1 = 2 * $pivot - $pLow;
        $s1 = 2 * $pivot - $pHigh;
        $r2 = $pivot + ($pHigh - $pLow);
        $s2 = $pivot - ($pHigh - $pLow);
        $r3 = $pHigh + 2 * ($pivot - $pLow);
        $s3 = $pLow - 2 * ($pHigh - $pivot);
        
        $pivotsRes = array_filter([$r1, $r2, $r3], function($r) use ($lastClose) { return $r > $lastClose; });
        $pivotsSup = array_filter([$s1, $s2, $s3], function($s) use ($lastClose) { return $s < $lastClose; });
        
        sort($pivotsRes);
        rsort($pivotsSup);
        
        foreach ($pivotsRes as $r) {
            if (count($finalRes) >= $numLevels) break;
            if (!in_array($r, $finalRes)) $finalRes[] = $r;
        }
        
        foreach ($pivotsSup as $s) {
            if (count($finalSup) >= $numLevels) break;
            if (!in_array($s, $finalSup)) $finalSup[] = $s;
        }
        
        sort($finalRes);
        rsort($finalSup);
    }
    
    // Force format values to 2 decimal places
    $finalRes = array_map(function($v) { return round($v, 2); }, $finalRes);
    $finalSup = array_map(function($v) { return round($v, 2); }, $finalSup);
    
    return [
        'supports'    => $finalSup,
        'resistances' => $finalRes
    ];
}

/**
 * Calculates all technical indicators for the candle series
 */
function calculateAllIndicators($candles) {
    $closes = array_map(function($c) { return $c['close']; }, $candles);
    
    $sma20 = calculateSMA($closes, 20);
    $sma50 = calculateSMA($closes, 50);
    $sma200 = calculateSMA($closes, 200);
    $ema12 = calculateEMA($closes, 12);
    $ema26 = calculateEMA($closes, 26);
    
    $rsi14 = calculateRSI($closes, 14);
    $bb = calculateBollingerBands($closes, 20, 2);
    $macd = calculateMACD($closes, 12, 26, 9);
    $atr14 = calculateATR($candles, 14);
    
    $sr = calculateSupportResistance($candles, 5, 3);
    
    $count = count($candles);
    $result = [];
    
    for ($i = 0; $i < $count; $i++) {
        $result[] = array_merge($candles[$i], [
            'sma20'     => $sma20[$i],
            'sma50'     => $sma50[$i],
            'sma200'    => $sma200[$i],
            'ema12'     => $ema12[$i],
            'ema26'     => $ema26[$i],
            'rsi14'     => $rsi14[$i],
            'bb_upper'  => $bb['upper'][$i],
            'bb_middle' => $bb['middle'][$i],
            'bb_lower'  => $bb['lower'][$i],
            'macd'      => $macd['macd'][$i],
            'macd_signal'=> $macd['signal'][$i],
            'macd_hist' => $macd['hist'][$i],
            'atr14'     => $atr14[$i]
        ]);
    }
    
    return [
        'candles' => $result,
        'supports' => $sr['supports'],
        'resistances' => $sr['resistances']
    ];
}

/**
 * 6-step Verification check for market data
 */
function verifyMarketData($symbol, $timeframe, $candles, $indicatorResult) {
    $errors = [];
    
    // 1. Verifikasi symbol aktif tersedia
    if (empty($symbol)) {
        $errors[] = "Symbol aktif tidak tersedia";
    }
    
    // 2. Verifikasi timeframe aktif tersedia
    $validTfs = ['M1', 'M5', 'M15', 'H1', 'H4', 'D1'];
    if (empty($timeframe) || !in_array(strtoupper($timeframe), $validTfs)) {
        $errors[] = "Timeframe aktif tidak tersedia atau tidak valid";
    }
    
    // 3. Verifikasi minimal 200 candle tersedia
    $candleCount = is_array($candles) ? count($candles) : 0;
    if ($candleCount < 200) {
        $errors[] = "Jumlah candle kurang dari 200 (tersedia: {$candleCount})";
    }
    
    // 4. Verifikasi harga terakhir tersedia
    $lastPrice = null;
    if ($candleCount > 0) {
        $lastPrice = $candles[$candleCount - 1]['close'];
    }
    if ($lastPrice === null || $lastPrice <= 0) {
        $errors[] = "Harga terakhir tidak tersedia";
    }
    
    // 5. Verifikasi timestamp candle terbaru tersedia
    $lastTimestamp = null;
    if ($candleCount > 0) {
        $lastTimestamp = $candles[$candleCount - 1]['timestamp'];
    }
    if ($lastTimestamp === null || $lastTimestamp <= 0) {
        $errors[] = "Timestamp candle terbaru tidak tersedia";
    }
    
    // 6. Verifikasi indikator teknikal berhasil dihitung
    $indicatorsValid = false;
    if ($indicatorResult && isset($indicatorResult['candles']) && count($indicatorResult['candles']) > 0) {
        $lastCandleWithInds = end($indicatorResult['candles']);
        if (
            isset($lastCandleWithInds['sma200']) && $lastCandleWithInds['sma200'] !== null &&
            isset($lastCandleWithInds['rsi14']) && $lastCandleWithInds['rsi14'] !== null &&
            isset($lastCandleWithInds['bb_upper']) && $lastCandleWithInds['bb_upper'] !== null
        ) {
            $indicatorsValid = true;
        }
    }
    if (!$indicatorsValid) {
        $errors[] = "Gagal menghitung indikator teknikal";
    }
    
    return [
        'success' => count($errors) === 0,
        'errors'  => $errors
    ];
}
