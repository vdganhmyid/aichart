document.addEventListener('DOMContentLoaded', () => {
    // ═══════════════════════════════════════════════════════════════════════════════
    // ───────────────────── ACCESS GATE SYSTEM (PASSWORD) ───────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════════
    
    const accessGateModule = (() => {
        const STORAGE_KEY = 'vdganh_lock_state';
        const LIMIT_WINDOW = 86400000; // 24 hours in milliseconds
        
        // DOM Elements
        const gateOverlay = document.getElementById('access-gate');
        const gateKeyInput = document.getElementById('gate-key-input');
        const gateSubmitBtn = document.getElementById('gate-submit-btn');
        const gateEyeBtn = document.getElementById('gate-eye-btn');
        const gateError = document.getElementById('gate-error');
        const gateErrorText = document.getElementById('gate-error-text');
        const gateLimitBanner = document.getElementById('gate-limit-banner');
        const gateLimitHint = document.getElementById('gate-limit-hint');
        const gateCountdown = document.getElementById('gate-countdown');
        const gateBtnLabel = document.getElementById('gate-btn-label');
        const gateBtnIcon = document.getElementById('gate-btn-icon');
        const appContainer = document.querySelector('.app-container');
        const appLimitCountdown = document.getElementById('app-limit-countdown');
        const appCountdownTimer = document.getElementById('app-countdown-timer');
        
        let countdownInterval = null;
        let isLocked = false;
        let lockExpiresAt = null;
        
        // ─── Initialize System ───
        function init() {
            if (!gateKeyInput || !gateSubmitBtn) {
                console.error('Access gate elements not found');
                return;
            }
            
            // FORCE clear any running interval from previous session
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
            
            // Clean up expired localStorage data on init
            cleanupExpiredData();
            
            checkDeviceStatusOnLoad();
            bindEventListeners();
        }
        
        // ─── Clean up Expired Data ───
        function cleanupExpiredData() {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                try {
                    const state = JSON.parse(stored);
                    if (state.expiresAt && state.expiresAt <= Date.now()) {
                        localStorage.removeItem(STORAGE_KEY);
                        console.log('Cleared expired lock data from localStorage');
                    }
                } catch (e) {
                    localStorage.removeItem(STORAGE_KEY);
                    console.log('Cleaned invalid localStorage data');
                }
            }
        }
        
        // ─── Check Device Status ───
        function checkDeviceStatusOnLoad() {
            // Check server status
            fetch('auth.php?action=check_device')
                .then(res => res.json())
                .then(data => {
                    if (data.limited) {
                        // Server says device is limited and still within the limit window.
                        console.log('⚠️ Server: Device IS limited - require password first');
                        if (countdownInterval) clearInterval(countdownInterval);
                        countdownInterval = null;
                        
                        isLocked = true;
                        lockExpiresAt = data.expires_at * 1000; // Convert to milliseconds
                        localStorage.setItem(STORAGE_KEY, JSON.stringify({
                            expiresAt: lockExpiresAt,
                            usedAt: Date.now()
                        }));
                        showLimitUI();
                        startCountdown();
                        // DO NOT unlock yet - show gate for user to input permanent key first
                        // unlockGate() will be called after user submits permanent key
                    } else {
                        // Server says NOT limited - user must re-authenticate
                        console.log('✅ Server: Device NOT authenticated - Showing gate');
                        if (countdownInterval) clearInterval(countdownInterval);
                        countdownInterval = null;
                        
                        isLocked = false;
                        lockExpiresAt = null;
                        localStorage.removeItem(STORAGE_KEY);
                        
                        // Force clear all limit UI
                        gateLimitBanner.classList.add('hidden');
                        gateLimitHint.classList.add('hidden');
                        gateKeyInput.placeholder = 'Masukkan Kunci Akses...';
                        gateCountdown.textContent = '00:00:00';
                        if (appLimitCountdown) appLimitCountdown.classList.add('hidden');
                        if (appCountdownTimer) appCountdownTimer.textContent = '00:00:00';
                        
                        // ⭐ SHOW GATE - User is not authenticated
                        showGate();
                    }
                })
                .catch(err => {
                    console.error('Error checking device status:', err);
                    console.log('⚠️ Server unreachable - checking localStorage fallback');
                    
                    // Fallback: check localStorage
                    const stored = localStorage.getItem(STORAGE_KEY);
                    if (stored) {
                        try {
                            const state = JSON.parse(stored);
                            if (state.expiresAt && state.expiresAt > Date.now()) {
                                // Still valid - show gate with limit UI but require password
                                console.log('⚠️ localStorage: Device IS locked - require password');
                                if (countdownInterval) clearInterval(countdownInterval);
                                countdownInterval = null;
                                
                                isLocked = true;
                                lockExpiresAt = state.expiresAt;
                                showLimitUI();
                                startCountdown();
                                // Show gate - user must input permanent key to proceed
                                showGate();
                            } else {
                                // Expired - clean up and show gate for re-authentication
                                console.log('✅ localStorage: Lock EXPIRED - showing gate for re-auth');
                                if (countdownInterval) clearInterval(countdownInterval);
                                countdownInterval = null;
                                
                                localStorage.removeItem(STORAGE_KEY);
                                isLocked = false;
                                lockExpiresAt = null;
                                
                                // Force clear UI, GATE STAYS VISIBLE
                                gateLimitBanner.classList.add('hidden');
                                gateLimitHint.classList.add('hidden');
                                gateKeyInput.placeholder = 'Masukkan Kunci Akses...';
                                gateCountdown.textContent = '00:00:00';
                                if (appLimitCountdown) appLimitCountdown.classList.add('hidden');
                                
                                // ⭐ SHOW GATE - Lock expired
                                showGate();
                            }
                        } catch (e) {
                            console.log('❌ Invalid localStorage data - clearing and showing gate');
                            if (countdownInterval) clearInterval(countdownInterval);
                            countdownInterval = null;
                            
                            localStorage.removeItem(STORAGE_KEY);
                            isLocked = false;
                            lockExpiresAt = null;
                            gateLimitBanner.classList.add('hidden');
                            gateLimitHint.classList.add('hidden');
                            gateKeyInput.placeholder = 'Masukkan Kunci Akses...';
                            if (appLimitCountdown) appLimitCountdown.classList.add('hidden');
                            
                            // ⭐ SHOW GATE - Invalid data
                            showGate();
                        }
                    } else {
                        // No data - show gate for authentication
                        console.log('✅ No lock data - Showing gate, awaiting password');
                        if (countdownInterval) clearInterval(countdownInterval);
                        countdownInterval = null;
                        
                        isLocked = false;
                        lockExpiresAt = null;
                        gateLimitBanner.classList.add('hidden');
                        gateLimitHint.classList.add('hidden');
                        gateKeyInput.placeholder = 'Masukkan Kunci Akses...';
                        if (appLimitCountdown) appLimitCountdown.classList.add('hidden');
                        
                        // ⭐ SHOW GATE - No data
                        showGate();
                    }
                });
        }
        
        // ─── Bind Event Listeners ───
        function bindEventListeners() {
            // Eye button to toggle password visibility
            if (gateEyeBtn) {
                gateEyeBtn.addEventListener('click', () => {
                    const type = gateKeyInput.type === 'password' ? 'text' : 'password';
                    gateKeyInput.type = type;
                    const icon = gateEyeBtn.querySelector('i');
                    if (icon) {
                        icon.className = type === 'password' ? 'bx bx-hide' : 'bx bx-show';
                    }
                });
            }
            
            // Submit button
            gateSubmitBtn.addEventListener('click', submitKey);
            
            // Enter key
            gateKeyInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !gateSubmitBtn.disabled) {
                    submitKey();
                }
            });
        }
        
        // ─── Submit Key ───
        async function submitKey() {
            const key = gateKeyInput.value.trim();
            
            if (!key) {
                showError('Silakan masukkan kunci akses');
                return;
            }
            
            gateSubmitBtn.disabled = true;
            gateBtnLabel.textContent = 'MEMVERIFIKASI...';
            gateBtnIcon.className = 'bx bx-loader-alt bx-spin';
            gateError.classList.add('hidden');
            
            try {
                const response = await fetch('auth.php?action=validate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: `key=${encodeURIComponent(key)}`
                });
                
                const data = await response.json();
                
                if (data.success) {
                    gateKeyInput.value = '';
                    
                    if (data.type === 'permanent') {
                        // Permanent access - COMPLETE RESET
                        if (countdownInterval) clearInterval(countdownInterval);
                        countdownInterval = null;
                        isLocked = false;
                        lockExpiresAt = null;
                        localStorage.removeItem(STORAGE_KEY);
                        
                        // Reset all UI
                        gateLimitBanner.classList.add('hidden');
                        gateLimitHint.classList.add('hidden');
                        gateKeyInput.placeholder = 'Masukkan Kunci Akses...';
                        gateCountdown.textContent = '00:00:00';
                        gateSubmitBtn.textContent = 'MASUK';
                        if (appLimitCountdown) appLimitCountdown.classList.add('hidden');
                        if (appCountdownTimer) appCountdownTimer.textContent = '00:00:00';
                        
                        console.log('✅ Permanent key accepted - resetting system');
                        
                        // Unlock gate
                        unlockGate();
                    } else if (data.type === 'limit') {
                        // Limited access - lock for 24 hours
                        if (countdownInterval) clearInterval(countdownInterval);
                        countdownInterval = null;
                        
                        isLocked = true;
                        lockExpiresAt = data.expires_at * 1000;
                        
                        // Save to localStorage
                        localStorage.setItem(STORAGE_KEY, JSON.stringify({
                            expiresAt: lockExpiresAt,
                            usedAt: Date.now()
                        }));
                        
                        showLimitUI();
                        startCountdown();
                        
                        // Unlock temporarily to use the app
                        unlockGate();
                    }
                } else {
                    if (data.type === 'limited') {
                        // Already limited - restart countdown and allow access
                        if (countdownInterval) clearInterval(countdownInterval);
                        countdownInterval = null;
                        
                        isLocked = true;
                        lockExpiresAt = data.expires_at * 1000;
                        localStorage.setItem(STORAGE_KEY, JSON.stringify({
                            expiresAt: lockExpiresAt,
                            usedAt: Date.now()
                        }));
                        showLimitUI();
                        startCountdown();
                        unlockGate();
                        showError('Kunci limit sudah digunakan; akses terbatas tetap aktif selama periode ini.');
                    } else {
                        showError('Kunci akses tidak valid. Coba lagi.');
                        gateKeyInput.classList.add('error');
                        setTimeout(() => gateKeyInput.classList.remove('error'), 400);
                    }
                }
            } catch (err) {
                showError(`Kesalahan: ${err.message}`);
            } finally {
                gateSubmitBtn.disabled = false;
                gateBtnLabel.textContent = 'MASUK';
                gateBtnIcon.className = 'bx bx-lock-open-alt';
            }
        }
        
        // ─── Show Error Message ───
        function showError(message) {
            gateErrorText.textContent = message;
            gateError.classList.remove('hidden');
        }
        
        // ─── Show Limit UI ───
        function showLimitUI() {
            gateLimitBanner.classList.remove('hidden');
            gateLimitHint.classList.remove('hidden');
            gateKeyInput.placeholder = 'Sistem terkunci. Gunakan Kunci Tetap untuk masuk.';
            gateSubmitBtn.textContent = 'MASUK DENGAN KUNCI TETAP';
        }

        function setFeatureLock(enabled, lockChat = true) {
            const targets = [modeSelectorCard, panelMarket, inputCard, workflowCard, consoleCard, agentsSection];
            targets.forEach(el => {
                if (el) el.classList.toggle('locked-feature', enabled);
            });

            if (startConsensusBtn) startConsensusBtn.disabled = enabled;
            if (chatUserInput) chatUserInput.disabled = enabled && lockChat;
            if (chatSendBtn) chatSendBtn.disabled = enabled && lockChat;
            if (copyMarkdownBtn) copyMarkdownBtn.disabled = enabled;
            if (downloadReportBtn) downloadReportBtn.disabled = enabled;
            if (refreshMarketBtn) refreshMarketBtn.disabled = enabled;
        }

        function lockAppFeatures(reason, lockChat = true) {
            setFeatureLock(true, lockChat);
            if (lockChat && chatUserInput) chatUserInput.placeholder = reason || 'Fitur terbatas terkunci.';
            if (chatMessagesLog && reason) {
                appendChatMessage('SYSTEM', 'assistant', reason);
            }
        }

        function startQwenChatTimer(seconds = 180) {
            if (!qwenChatTimer) return;
            qwenChatExpiresAt = Date.now() + seconds * 1000;
            if (qwenChatTimerInterval) clearInterval(qwenChatTimerInterval);

            function updateQwenTimer() {
                const remaining = qwenChatExpiresAt - Date.now();
                if (remaining <= 0) {
                    clearInterval(qwenChatTimerInterval);
                    qwenChatTimerInterval = null;
                    qwenChatTimer.textContent = '00:00';
                    lockAppFeatures('Waktu TANYA KETUA DEWAN telah habis. Sistem akan kembali ke layar login.');
                    showGate();
                    return;
                }
                const mins = Math.floor(remaining / 60000);
                const secs = Math.floor((remaining % 60000) / 1000);
                qwenChatTimer.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            }

            qwenChatTimer.classList.remove('hidden');
            updateQwenTimer();
            qwenChatTimerInterval = setInterval(updateQwenTimer, 1000);
        }

        function clearQwenChatTimer() {
            if (qwenChatTimerInterval) {
                clearInterval(qwenChatTimerInterval);
                qwenChatTimerInterval = null;
            }
            if (qwenChatTimer) {
                qwenChatTimer.classList.add('hidden');
                qwenChatTimer.textContent = '03:00';
            }
        }

        // ─── Start Countdown ───
        function startCountdown() {
            if (countdownInterval) clearInterval(countdownInterval);
            
            function updateCountdown() {
                const now = Date.now();
                const remaining = lockExpiresAt - now;
                
                if (remaining <= 0) {
                    clearInterval(countdownInterval);
                    localStorage.removeItem(STORAGE_KEY);
                    isLocked = false;
                    lockExpiresAt = null;
                    
                    // Show gate again for re-authentication
                    showGate();
                    gateLimitBanner.classList.add('hidden');
                    gateLimitHint.classList.add('hidden');
                    gateKeyInput.placeholder = 'Masukkan Kunci Akses...';
                    gateKeyInput.value = '';
                    gateCountdown.textContent = '00:00:00';
                    gateSubmitBtn.textContent = 'MASUK';
                    
                    // Hide app countdown
                    if (appLimitCountdown) appLimitCountdown.classList.add('hidden');
                    
                    console.log('Lock period expired - system reset');
                    return;
                }
                
                const hours = Math.floor(remaining / 3600000);
                const minutes = Math.floor((remaining % 3600000) / 60000);
                const seconds = Math.floor((remaining % 60000) / 1000);
                
                const timeStr = String(hours).padStart(2, '0') + ':' +
                               String(minutes).padStart(2, '0') + ':' +
                               String(seconds).padStart(2, '0');
                
                gateCountdown.textContent = timeStr;
                if (appCountdownTimer) appCountdownTimer.textContent = timeStr;
            }
            
            updateCountdown();
            countdownInterval = setInterval(updateCountdown, 1000);
            
            // Show app countdown
            if (appLimitCountdown) appLimitCountdown.classList.remove('hidden');
        }
        
        // ─── Show Gate ───
        function showGate() {
            if (gateOverlay) {
                gateOverlay.classList.remove('unlocking');
                gateOverlay.style.display = 'flex';
            }
            if (appContainer) {
                appContainer.style.display = 'none';
            }
        }
        
        // ─── Unlock Gate ───
        function unlockGate() {
            // Stop any running countdown
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
            
            // Hide gate overlay
            if (gateOverlay) {
                gateOverlay.classList.add('unlocking');
                setTimeout(() => {
                    gateOverlay.style.display = 'none';
                }, 600);
            }
            
            // Show app container
            if (appContainer) {
                appContainer.style.display = 'flex';
            }
            
            // Show app countdown ONLY if actually locked (with valid expiry time)
            // NOTE: For limited accounts we DO NOT immediately lock features here.
            // Locking should occur after the workflow completes (handled elsewhere).
            if (isLocked && lockExpiresAt && lockExpiresAt > Date.now() && appLimitCountdown) {
                appLimitCountdown.classList.remove('hidden');
                const now = Date.now();
                const remaining = lockExpiresAt - now;
                const hours = Math.floor(remaining / 3600000);
                const minutes = Math.floor((remaining % 3600000) / 60000);
                const seconds = Math.floor((remaining % 60000) / 1000);
                const timeStr = String(hours).padStart(2, '0') + ':' +
                               String(minutes).padStart(2, '0') + ':' +
                               String(seconds).padStart(2, '0');
                if (appCountdownTimer) appCountdownTimer.textContent = timeStr;
                console.log('🔒 Limited access - countdown active: ' + timeStr);
                // Keep features available until explicit lock (e.g., after workflow finishes)
                setFeatureLock(false);
            } else {
                // NOT locked - hide countdown
                if (appLimitCountdown) appLimitCountdown.classList.add('hidden');
                setFeatureLock(false);
                clearQwenChatTimer();
                console.log('🔓 Full access - no countdown');
            }
        }
        
        // Public API
        return {
            init,
            isLocked: () => isLocked,
            getLockTime: () => lockExpiresAt,
            // Expose feature/lock helpers so outer code can control UI lock state
            setFeatureLock,
            lockAppFeatures,
            startQwenChatTimer,
            clearQwenChatTimer
        };
    })();
    
    // Initialize Access Gate
    accessGateModule.init();
    
    // ═══════════════════════════════════════════════════════════════════════════════
    
    // --- STATE MANAGEMENT ---
    let activeApiKey = '';
    let currentWorkflowActive = false;
    let currentActiveAgentId = null; // For modal
    
    const agents = {
        qwen: {
            id: 'qwen',
            name: 'Qwen3.5-397B-A17B',
            model: 'qwen/qwen3.5-397b-a17b',
            role: 'Strategic Analyst',
            focus: 'Logika, Analisis, Efisiensi, Konsistensi',
            accentClass: 'cyan',
            state: { p1: null, p1_confidence: null, p2: null, p3: null, p3_confidence: null }
        },
        nemotron: {
            id: 'nemotron',
            name: 'Llama-3.3-Nemotron-49B',
            model: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
            role: 'Consensus Chairman / Judge',
            focus: 'Validasi fakta, Akurasi, Objektivitas, Penilaian akhir',
            accentClass: 'emerald',
            state: { p1: null, p1_confidence: null, p2: null, p3: null, p3_confidence: null }
        },
        deepseek: {
            id: 'deepseek',
            name: 'DeepSeek-V4-Pro',
            model: 'deepseek-ai/deepseek-v4-pro',
            role: 'Problem Solver / Technical Expert',
            focus: 'Solusi praktis, Implementasi, Langkah teknis, Penyelesaian masalah',
            accentClass: 'purple',
            state: { p1: null, p1_confidence: null, p2: null, p3: null, p3_confidence: null }
        },
        llama: {
            id: 'llama',
            name: 'Llama-3.3-70B-Instruct',
            model: 'meta/llama-3.3-70b-instruct',
            role: 'General Expert / Communication Specialist',
            focus: 'Kejelasan, Kemudahan dipahami, Ringkasan, Penyederhanaan konsep',
            accentClass: 'orange',
            state: { p1: null, p1_confidence: null, p2: null, p3: null, p3_confidence: null }
        },
        'nemotron-reasoning': {
            id: 'nemotron-reasoning',
            name: 'Nemotron-Nano-Omni-30B-Reasoning',
            model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
            role: 'Reasoning Specialist',
            focus: 'Penalaran multi-langkah, Deduksi logis, Chain-of-Thought analysis',
            accentClass: 'rose',
            state: { p1: null, p1_confidence: null, p2: null, p3: null, p3_confidence: null }
        },
        'llama-maverick': {
            id: 'llama-maverick',
            name: 'Llama-4-Maverick-17B',
            model: 'meta/llama-4-maverick-17b-128e-instruct',
            role: 'Creative Innovator',
            focus: 'Pemikiran lateral, Perspektif baru, Solusi kreatif dan inovatif',
            accentClass: 'indigo',
            state: { p1: null, p1_confidence: null, p2: null, p3: null, p3_confidence: null }
        },
        'qwen-coder': {
            id: 'qwen-coder',
            name: 'qwen/qwen3.5-122b-a10b',
            model: 'qwen/qwen3.5-122b-a10b',
            role: 'Code Architect',
            focus: 'Kualitas kode, Arsitektur software, Best practices teknis',
            accentClass: 'lime',
            state: { p1: null, p1_confidence: null, p2: null, p3: null, p3_confidence: null }
        }
    };
    let rawConsensusMarkdown = '';
    let chatHistory = [];
    let chairmanFailoverNotice = null;

    // Image Upload State
    let uploadedImageBase64 = '';
    let uploadedImageMimeType = '';

    // --- DOM ELEMENTS ---
    const userQuestionTxt = document.getElementById('user-question');
    const startConsensusBtn = document.getElementById('start-consensus-btn');
    const toggleConfigBtn = document.getElementById('toggle-config-btn');
    const configPanel = document.getElementById('config-panel');
    const closeConfigBtn = document.getElementById('close-config-btn');
    
    // Image Upload Elements
    const imageDropzone = document.getElementById('image-dropzone');
    const imageFileInput = document.getElementById('image-file-input');
    const dropzoneTextContent = document.getElementById('dropzone-text-content');
    const imagePreviewContainer = document.getElementById('image-preview-container');
    const imagePreviewImg = document.getElementById('image-preview-img');
    const removeImageBtn = document.getElementById('remove-image-btn');
    const imageSizeBadge = document.getElementById('image-size-badge');
    
    // Config controls
    const apiKeyInput = document.getElementById('api-key-input');
    const toggleKeyVisibility = document.getElementById('toggle-key-visibility');
    const tempInput = document.getElementById('temp-input');
    const tempVal = document.getElementById('temp-val');
    const maxTokensInput = document.getElementById('max-tokens-input');
    const testConnectionBtn = document.getElementById('test-connection-btn');
    const connectionStatusMsg = document.getElementById('connection-status-msg');
    
    // Timeline steps
    const stepPrecheck = document.getElementById('step-precheck');
    const stepThinking = document.getElementById('step-thinking');
    const stepReview = document.getElementById('step-review');
    const stepImprove = document.getElementById('step-improve');
    const stepConsensus = document.getElementById('step-consensus');
    const workflowOverallStatus = document.getElementById('workflow-overall-status');
    
    // Console
    const consoleLogs = document.getElementById('console-logs');
    const clearConsoleBtn = document.getElementById('clear-console-btn');
    
    // Output area elements
    const outputPlaceholderArea = document.getElementById('output-placeholder-area');
    const outputResultsArea = document.getElementById('output-results-area');
    const copyMarkdownBtn = document.getElementById('copy-markdown-btn');
    const downloadReportBtn = document.getElementById('download-report-btn');
    const scoreRing = document.getElementById('score-ring');
    const consensusScoreVal = document.getElementById('consensus-score-val');
    const confidenceLevelVal = document.getElementById('confidence-level-val');
    const confidenceReasonVal = document.getElementById('confidence-reason-val');
    const listAgreedFacts = document.getElementById('list-agreed-facts');
    const listDisputedFacts = document.getElementById('list-disputed-facts');
    const finalAnswerContent = document.getElementById('final-answer-content');
    const consensusReasonContent = document.getElementById('consensus-reason-content');
    
    // Follow-up Chat elements
    const followupChatSection = document.getElementById('followup-chat-section');
    const chatMessagesLog     = document.getElementById('chat-messages-log');
    const chatUserInput       = document.getElementById('chat-user-input');
    const chatSendBtn         = document.getElementById('chat-send-btn');
    
    // Summaries accordion contents
    const summaryQwen     = document.getElementById('summary-qwen');
    const summaryNemotron = document.getElementById('summary-nemotron');
    const summaryDeepseek = document.getElementById('summary-deepseek');
    const summaryLlama    = document.getElementById('summary-llama');
    const summaryNemotronReasoning = document.getElementById('summary-nemotron-reasoning');
    const summaryLlamaMaverick     = document.getElementById('summary-llama-maverick');
    const summaryQwenCoder         = document.getElementById('summary-qwen-coder');
    
    // Modal elements
    const agentWorkspaceModal = document.getElementById('agent-workspace-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const modalAgentAvatar = document.getElementById('modal-agent-avatar');
    const modalAgentName = document.getElementById('modal-agent-name');
    const modalP1Confidence = document.getElementById('modal-p1-confidence');
    const modalP1Content = document.getElementById('modal-p1-content');
    const modalP2Content = document.getElementById('modal-p2-content');
    const modalP3Confidence = document.getElementById('modal-p3-confidence');
    const modalP3Content = document.getElementById('modal-p3-content');
    // â”€â”€ MODE + MARKET DOM ELEMENTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const marketSymbolSelect   = document.getElementById('market-symbol');
    const marketTimeframeSelect = document.getElementById('market-timeframe');
    const refreshMarketBtn     = document.getElementById('refresh-market-btn');
    const marketStatusBadge    = document.getElementById('market-status-badge');
    const marketInfoPanel      = document.getElementById('market-info-panel');
    const marketChartContainer = document.getElementById('market-chart-container');
    const infoLastPrice        = document.getElementById('info-last-price');
    const infoCandlesCount     = document.getElementById('info-candles-count');
    const infoLastCandle       = document.getElementById('info-last-candle');
    const infoDataAge          = document.getElementById('info-data-age');
    const panelMarket          = document.getElementById('panel-market');
    const panelImage           = document.getElementById('panel-image');
    const modeLabelBadge       = document.getElementById('mode-label-badge');
    const modeSelectorCard     = document.querySelector('.mode-selector-card');
    const inputCard            = document.querySelector('.input-card');
    const workflowCard         = document.querySelector('.workflow-card');
    const consoleCard          = document.querySelector('.console-card');
    const agentsSection        = document.querySelector('.agents-section');
    const qwenChatTimer        = document.getElementById('qwen-chat-timer');
    let qwenChatTimerInterval  = null;
    let qwenChatExpiresAt      = null;

    // --- HELPER FUNCTIONS ---

    // Custom Logger
    function log(message, type = 'system') {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const line = document.createElement('div');
        line.className = `log-line ${type}`;
        line.textContent = `[${time}] ${message}`;
        consoleLogs.appendChild(line);
        consoleLogs.scrollTop = consoleLogs.scrollHeight;
    }

    // â”€â”€ 4 ANALYSIS MODES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let activeMode = 1; // 1=Chart, 2=Text, 3=Photo+Text, 4=Auto
    let marketDataCache = null;

    const MODE_LABELS = {
        1: 'Chart Data',
        2: 'Text Only',
        3: 'Photo + Text',
        4: 'Auto All'
    };

    function switchMode(mode) {
        activeMode = mode;

        // Update button states
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.mode) === mode);
        });

        // Update badge
        if (modeLabelBadge) modeLabelBadge.textContent = MODE_LABELS[mode] || '';

        // Show/hide panels
        const showMarket = (mode === 1 || mode === 4);
        const showImage  = (mode === 3 || mode === 4);

        if (panelMarket) panelMarket.classList.toggle('hidden', !showMarket);
        if (panelImage)  panelImage.classList.toggle('hidden', !showImage);

        // Reset market cache when hiding market panel
        if (!showMarket) {
            marketDataCache = null;
            destroyChart();
            updateVerificationUI('inactive');
        }

        log(`[MODE] Beralih ke Mode ${mode}: ${MODE_LABELS[mode]}`, 'info');
    }

    // Register mode buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => switchMode(parseInt(btn.dataset.mode)));
    });

    // â”€â”€ VERIFICATION UI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    function setVerifState(id, success) {
        const el = document.getElementById(id);
        if (!el) return;
        el.className = 'verif-item ' + (success ? 'success' : 'danger');
        el.querySelector('i').className = 'bx ' + (success ? 'bx-check-circle' : 'bx-x-circle') + ' status-icon';
    }

    function updateVerificationUI(status, errors = [], data = null) {
        const ids = ['verif-symbol', 'verif-timeframe', 'verif-candles', 'verif-price', 'verif-timestamp', 'verif-indicators'];

        if (status === 'inactive') {
            if (marketStatusBadge) { marketStatusBadge.textContent = 'Inactive'; marketStatusBadge.className = 'badge'; }
            ids.forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.className = 'verif-item'; el.querySelector('i').className = 'bx bx-help-circle status-icon'; }
            });
            if (marketInfoPanel) marketInfoPanel.classList.add('hidden');
            return;
        }

        if (status === 'loading') {
            if (marketStatusBadge) { marketStatusBadge.textContent = 'Memverifikasi...'; marketStatusBadge.className = 'badge badge-purple'; }
            return;
        }

        if (status === 'error') {
            if (marketStatusBadge) { marketStatusBadge.textContent = 'Gagal'; marketStatusBadge.className = 'badge badge-red'; }
            setVerifState('verif-symbol',     !errors.some(e => e.includes('Symbol') || e.includes('symbol')));
            setVerifState('verif-timeframe',  !errors.some(e => e.includes('Timeframe') || e.includes('timeframe')));
            setVerifState('verif-candles',    !errors.some(e => e.includes('candle') || e.includes('Candle') || e.includes('200')));
            setVerifState('verif-price',      !errors.some(e => e.includes('Harga') || e.includes('harga')));
            setVerifState('verif-timestamp',  !errors.some(e => e.includes('Timestamp') || e.includes('kedaluwarsa')));
            setVerifState('verif-indicators', !errors.some(e => e.includes('indikator') || e.includes('Indikator')));
            if (marketInfoPanel) marketInfoPanel.classList.add('hidden');
            return;
        }

        if (status === 'success' && data) {
            if (marketStatusBadge) { marketStatusBadge.textContent = 'Verified âœ“'; marketStatusBadge.className = 'badge badge-emerald'; }
            ids.forEach(id => setVerifState(id, true));

            if (infoLastPrice)    infoLastPrice.textContent    = parseFloat(data.last_price).toFixed(2);
            if (infoCandlesCount) infoCandlesCount.textContent = `${data.candles_count} candles`;
            if (infoLastCandle)   infoLastCandle.textContent   = data.last_candle_time;
            if (infoDataAge) {
                const ageSec = data.age_seconds;
                const ageMin = Math.round(ageSec / 60);
                let ageLabel;
                if (ageSec < 60)       ageLabel = `${ageSec}s`;
                else if (ageMin < 60)  ageLabel = `${ageMin}m`;
                else                   ageLabel = `${Math.round(ageMin / 60)}h ${ageMin % 60}m`;

                // is_stale = server says data is older than the generous threshold (weekend/holiday)
                if (data.is_stale) {
                    infoDataAge.textContent = `${ageLabel} âš  Stale`;
                    infoDataAge.style.color = 'var(--color-amber, #f59e0b)';
                } else {
                    infoDataAge.textContent = ageLabel;
                    infoDataAge.style.color = ageSec > 3600 ? 'var(--color-amber, #f59e0b)' : 'var(--color-emerald)';
                }
            }
            if (marketInfoPanel) marketInfoPanel.classList.remove('hidden');
        }
    }

    // â”€â”€ CHART RENDERING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let _lwChart = null;

    function destroyChart() {
        if (_lwChart) { try { _lwChart.remove(); } catch(e) {} _lwChart = null; }
        if (marketChartContainer) marketChartContainer.classList.add('hidden');
    }

    function renderMarketChart(data) {
        if (!data || !data.chart_candles || data.chart_candles.length === 0) { destroyChart(); return; }
        if (typeof LightweightCharts === 'undefined') { log('[CHART] LightweightCharts tidak tersedia.', 'error'); return; }

        // Show container FIRST so we can measure its width
        marketChartContainer.classList.remove('hidden');

        const chartEl = document.getElementById('tv-chart-el');
        if (!chartEl) return;

        // Destroy old instance
        if (_lwChart) { try { _lwChart.remove(); } catch(e) {} _lwChart = null; }

        // Force reflow then measure
        const w = Math.max(chartEl.offsetWidth || chartEl.parentElement.clientWidth, 200);

        _lwChart = LightweightCharts.createChart(chartEl, {
            width: w,
            height: 240,
            layout:  { background: { color: 'transparent' }, textColor: '#94a3b8' },
            grid:    { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
            crosshair: { mode: 1 }, // Normal
            rightPriceScale: { borderColor: 'rgba(255,255,255,0.06)' },
            timeScale: { borderColor: 'rgba(255,255,255,0.06)', timeVisible: true, secondsVisible: false },
            handleScroll: true,
            handleScale: true,
        });

        const candleSeries = _lwChart.addCandlestickSeries({
            upColor: '#10b981', downColor: '#ef4444',
            borderUpColor: '#10b981', borderDownColor: '#ef4444',
            wickUpColor: '#10b981', wickDownColor: '#ef4444',
        });
        candleSeries.setData(data.chart_candles.map(c => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close })));

        // SMA 20
        const sma20 = _lwChart.addLineSeries({ color: '#00f2fe', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        sma20.setData(data.chart_candles.filter(c => c.sma20 != null).map(c => ({ time: c.timestamp, value: c.sma20 })));

        // SMA 50
        const sma50 = _lwChart.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        sma50.setData(data.chart_candles.filter(c => c.sma50 != null).map(c => ({ time: c.timestamp, value: c.sma50 })));

        // Support lines (green dashed)
        if (data.supports) data.supports.slice(0, 3).forEach(lvl => candleSeries.createPriceLine({ price: parseFloat(lvl), color: '#10b981', lineWidth: 1, lineStyle: 2, title: 'S' }));
        // Resistance lines (red dashed)
        if (data.resistances) data.resistances.slice(0, 3).forEach(lvl => candleSeries.createPriceLine({ price: parseFloat(lvl), color: '#ef4444', lineWidth: 1, lineStyle: 2, title: 'R' }));

        _lwChart.timeScale().fitContent();

        // Responsive resize
        new ResizeObserver(() => {
            if (_lwChart) {
                const newW = Math.max(chartEl.offsetWidth, 200);
                _lwChart.applyOptions({ width: newW });
            }
        }).observe(chartEl);

        log(`[CHART âœ“] Chart berhasil dirender: ${data.chart_candles.length} candles, SMA20 + SMA50 + S/R levels.`, 'success');
    }

    // â”€â”€ MARKET DATA FETCH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async function fetchAndVerifyMarketData() {
        const symbol    = marketSymbolSelect ? marketSymbolSelect.value : 'XAUUSD';
        const timeframe = marketTimeframeSelect ? marketTimeframeSelect.value : 'D1';

        updateVerificationUI('loading');

        // Animate refresh button
        if (refreshMarketBtn) refreshMarketBtn.classList.add('spinning');

        log(`[MARKET] Mengambil data ${symbol} (${timeframe}) dari Yahoo Finance...`, 'system');

        try {
            const res  = await fetch('api.php?action=get_market_data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol, timeframe })
            });
            const data = await res.json();

            if (data.status === 'success') {
                data.fetchTime = Date.now();
                marketDataCache = data;
                updateVerificationUI('success', [], data);
                renderMarketChart(data);
                log(`[MARKET âœ“] Data verified: ${symbol} (${timeframe}) â€” Harga: ${parseFloat(data.last_price).toFixed(2)}, ${data.candles_count} candles.`, 'success');
                return true;
            } else {
                marketDataCache = null;
                updateVerificationUI('error', data.errors || [data.message]);
                log(`[MARKET âœ—] Gagal: ${data.message}`, 'error');
                if (data.errors) data.errors.forEach(e => log(`   â†’ ${e}`, 'error'));
                return data;
            }
        } catch (err) {
            marketDataCache = null;
            updateVerificationUI('error', ['Koneksi ke server gagal']);
            log(`[MARKET âœ—] Error: ${err.message}`, 'error');
            return { status: 'error', message: 'Data market tidak tersedia', failsafe: true };
        } finally {
            if (refreshMarketBtn) refreshMarketBtn.classList.remove('spinning');
        }
    }

    // â”€â”€ MARKET EVENT LISTENERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (refreshMarketBtn) {
        refreshMarketBtn.addEventListener('click', () => fetchAndVerifyMarketData());
    }
    if (marketSymbolSelect) {
        marketSymbolSelect.addEventListener('change', () => { marketDataCache = null; destroyChart(); updateVerificationUI('inactive'); });
    }
    if (marketTimeframeSelect) {
        marketTimeframeSelect.addEventListener('change', () => { marketDataCache = null; destroyChart(); updateVerificationUI('inactive'); });
    }

    // Init: Mode 1 active by default (market panel visible, image hidden)
    switchMode(1);

    // Update Slider Value Display
    tempInput.addEventListener('input', (e) => {
        tempVal.textContent = e.target.value;
    });

    // Toggle Password Visibility
    toggleKeyVisibility.addEventListener('click', () => {
        const type = apiKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
        apiKeyInput.setAttribute('type', type);
        toggleKeyVisibility.querySelector('i').className = type === 'password' ? 'bx bx-show' : 'bx bx-hide';
    });

    // Configuration Panel toggles
    toggleConfigBtn.addEventListener('click', () => { configPanel.classList.toggle('hidden'); });
    closeConfigBtn.addEventListener('click',  () => { configPanel.classList.add('hidden'); });

    // Suggestion Chips
    document.querySelectorAll('.chip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            userQuestionTxt.value = btn.getAttribute('data-prompt');
            userQuestionTxt.focus();
        });
    });
    

    



    
    // Clear Console
    clearConsoleBtn.addEventListener('click', () => {
        consoleLogs.innerHTML = '';
        log('Console logs cleared.', 'system');
    });
    
    // Accordion interaction
    document.querySelectorAll('.accordion-header').forEach(header => {
        header.addEventListener('click', () => {
            const item = header.parentElement;
            item.classList.toggle('active');
        });
    });
    
    // --- IMAGE UPLOAD LOGIC ---
    
    // Clicking the dropzone triggers the hidden input
    imageDropzone.addEventListener('click', (e) => {
        if (!e.target.closest('#remove-image-btn') && !e.target.closest('.hidden-file-input')) {
            imageFileInput.click();
        }
    });
    
    // Drag & Drop event listener setups
    ['dragenter', 'dragover'].forEach(eventName => {
        imageDropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            imageDropzone.classList.add('dragover');
        }, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        imageDropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            imageDropzone.classList.remove('dragover');
        }, false);
    });
    
    // Handle Drop
    imageDropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handleImageFile(files[0]);
        }
    });
    
    // Handle manual select
    imageFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleImageFile(e.target.files[0]);
        }
    });
    
    // Remove selected image
    removeImageBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        resetImageUpload();
    });
    
    // Read the image file as base64
    function handleImageFile(file) {
        if (!file.type.startsWith('image/')) {
            alert('File yang diunggah harus berupa gambar!');
            return;
        }
        
        const maxSize = 4 * 1024 * 1024; // 4MB file input limit
        if (file.size > maxSize) {
            alert('Ukuran gambar melebihi batas maksimum 4MB!');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const rawDataUrl = e.target.result;
            
            // Use Canvas to resize + compress before sending to NVIDIA NIM
            // NVIDIA NIM Vision API works best with images < 180KB in base64
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                
                // Resize: max 512px on longest side â€” keeps base64 payload small for NVIDIA NIM
                const MAX_SIDE = 512;
                let w = img.width;
                let h = img.height;
                
                if (w > MAX_SIDE || h > MAX_SIDE) {
                    if (w >= h) {
                        h = Math.round(h * MAX_SIDE / w);
                        w = MAX_SIDE;
                    } else {
                        w = Math.round(w * MAX_SIDE / h);
                        h = MAX_SIDE;
                    }
                }
                
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                
                // Fill white background (for transparent PNGs)
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                
                // Compress to JPEG at 60% quality â†’ keeps payload under ~100KB base64 for NVIDIA NIM
                const compressed = canvas.toDataURL('image/jpeg', 0.60);
                const approxKB    = Math.round((compressed.length * 0.75) / 1024);
                
                uploadedImageBase64  = compressed;
                uploadedImageMimeType = 'image/jpeg';
                
                // Update preview
                imagePreviewImg.src = compressed;
                imageSizeBadge.textContent = `${w}Ã—${h}px â€¢ ~${approxKB}KB`;
                
                dropzoneTextContent.classList.add('hidden');
                imagePreviewContainer.classList.remove('hidden');
                imageDropzone.style.borderColor = ''; // reset any previous color
                
                log(`[IMAGE] Gambar dimuat & dikompresi: ${file.name} â†’ ${w}Ã—${h}px, ~${approxKB}KB (siap untuk Vision AI)`, 'success');
                
                if (approxKB > 100) {
                    log(`[IMAGE-WARN] Gambar masih agak besar (~${approxKB}KB). Jika vision timeout, coba gunakan gambar yang lebih sederhana/kecil.`, 'error');
                }
            };
            img.src = rawDataUrl;
        };
        reader.readAsDataURL(file);
    }
    
    function resetImageUpload() {
        uploadedImageBase64 = '';
        uploadedImageMimeType = '';
        imageFileInput.value = '';
        imagePreviewImg.src = '';
        imagePreviewContainer.classList.add('hidden');
        dropzoneTextContent.classList.remove('hidden');
        log('[SYSTEM] Gambar berhasil dihapus.', 'info');
    }
    
    // --- ROBUST PARSING FOR REPORT SECTIONS ---
    function parseConsensusReport(text) {
        const sections = {
            consensusScore: 0,
            agreedFacts: [],
            disputedFacts: [],
            qwenAnalysis: '',
            nemotronAnalysis: '',
            deepseekAnalysis: '',
            llamaAnalysis: '',
            nemotronReasoningAnalysis: '',
            llamaMaverickAnalysis: '',
            qwenCoderAnalysis: '',
            finalAnswer: '',
            confidenceLevel: 'Sedang',
            reason: ''
        };
        
        if (!text) return sections;
        
        // Parse the markdown into raw level-2 blocks
        const blocks = {};
        let currentHeader = '';
        let currentLines = [];
        
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
            // Level-2 header match (must start with exactly ##, not ###)
            const hMatch = line.match(/^##(?!#)\s*(.+?)\s*$/);
            if (hMatch) {
                // Save previous block
                if (currentHeader) {
                    blocks[currentHeader] = currentLines.join('\n').trim();
                }
                // Start new block (normalize header name)
                currentHeader = hMatch[1].replace(/[*_:#]/g, '').trim().toLowerCase();
                currentLines = [];
            } else {
                if (currentHeader) {
                    currentLines.push(line);
                }
            }
        }
        // Save the last block
        if (currentHeader) {
            blocks[currentHeader] = currentLines.join('\n').trim();
        }
        
        // Helper to find a block by keywords in the header name
        const findBlockByKeywords = (keywords) => {
            // Priority 1: Exact matches or contains all keywords
            for (const h in blocks) {
                if (keywords.every(kw => h.includes(kw))) {
                    return blocks[h];
                }
            }
            // Priority 2: Contains any of the keywords
            for (const h in blocks) {
                if (keywords.some(kw => h.includes(kw))) {
                    return blocks[h];
                }
            }
            return '';
        };
        
        // 1. Consensus Score
        const scoreContent = findBlockByKeywords(['score']) || findBlockByKeywords(['skor']) || findBlockByKeywords(['nilai']);
        if (scoreContent) {
            const scoreMatch = scoreContent.match(/(\d+)/);
            sections.consensusScore = scoreMatch ? parseInt(scoreMatch[1]) : 0;
        }
        
        // 2. Agreed Facts
        const agreedContent = findBlockByKeywords(['setuju']) || findBlockByKeywords(['agreed']) || findBlockByKeywords(['fakta']);
        if (agreedContent) {
            sections.agreedFacts = agreedContent.split(/[\r\n]+/)
                .map(line => line.replace(/^[-*+\s\d.]+\s*/, '').trim())
                .filter(line => line.length > 0);
        }
        
        // 3. Disputed Facts
        const disputedContent = findBlockByKeywords(['debat']) || findBlockByKeywords(['diperdebatkan']) || findBlockByKeywords(['disputed']) || findBlockByKeywords(['beda']);
        if (disputedContent) {
            sections.disputedFacts = disputedContent.split(/[\r\n]+/)
                .map(line => line.replace(/^[-*+\s\d.]+\s*/, '').trim())
                .filter(line => line.length > 0);
        }
        
        // 4. Council Analysis
        const analysisContent = findBlockByKeywords(['analisis', 'dewan']) || findBlockByKeywords(['analysis']) || findBlockByKeywords(['pandangan']);
        if (analysisContent) {
            const getSubBlock = (subHeader) => {
                const subLines = analysisContent.split(/\r?\n/);
                let capturing = false;
                let result = [];
                const normSub = subHeader.toLowerCase();
                
                for (const line of subLines) {
                    const headerMatch = line.match(/^###(?!#)\s*(.+?)\s*$/);
                    if (headerMatch) {
                        const headerText = headerMatch[1].replace(/[*_:#]/g, '').trim().toLowerCase();
                        
                        let isMatch = false;
                        if (normSub === 'qwen') {
                            isMatch = headerText.includes('qwen') && !headerText.includes('coder');
                        } else if (normSub === 'nemotron') {
                            isMatch = headerText.includes('nemotron') && !headerText.includes('reasoning') && !headerText.includes('nano');
                        } else if (normSub === 'llama') {
                            isMatch = headerText.includes('llama') && !headerText.includes('maverick');
                        } else {
                            isMatch = headerText.includes(normSub);
                        }
                        
                        if (isMatch) {
                            capturing = true;
                            result = [];
                        } else {
                            capturing = false;
                        }
                        continue;
                    }
                    if (capturing) {
                        result.push(line);
                    }
                }
                return result.join('\n').trim();
            };
            
            sections.qwenAnalysis              = getSubBlock('Qwen');
            sections.nemotronAnalysis          = getSubBlock('Nemotron');
            sections.deepseekAnalysis          = getSubBlock('DeepSeek');
            sections.llamaAnalysis             = getSubBlock('Llama');
            sections.nemotronReasoningAnalysis = getSubBlock('Nemotron Reasoning') || getSubBlock('Reasoning') || getSubBlock('Nano');
            sections.llamaMaverickAnalysis     = getSubBlock('Llama Maverick') || getSubBlock('Maverick');
            sections.qwenCoderAnalysis         = getSubBlock('Llama-3.1-Nemotron-51B') || getSubBlock('51B') || getSubBlock('Coder') || getSubBlock('Qwen Coder');
        }
        
        // 5. Final Answer â€” multi-strategy extraction (block parser can miss this if it's the last section)
        sections.finalAnswer = findBlockByKeywords(['jawaban', 'final'])
                            || findBlockByKeywords(['jawaban final'])
                            || findBlockByKeywords(['final answer'])
                            || findBlockByKeywords(['jawaban']);

        // Direct regex fallback: capture everything between the JAWABAN FINAL header and the next ## header (or end)
        if (!sections.finalAnswer || sections.finalAnswer.trim().length < 10) {
            const jawabanMatch = text.match(
                /^##\s*(?:JAWABAN\s*FINAL\s*KONSENSUS|JAWABAN\s*FINAL|FINAL\s*ANSWER)[^\n]*\n([\s\S]*?)(?=^##\s|\s*$)/im
            );
            if (jawabanMatch && jawabanMatch[1].trim().length > 10) {
                sections.finalAnswer = jawabanMatch[1].trim();
            }
        }

        // Last resort: if still empty, grab the longest block that isn't already used
        if (!sections.finalAnswer || sections.finalAnswer.trim().length < 10) {
            const usedBlocks = new Set([
                findBlockByKeywords(['score']), findBlockByKeywords(['skor']),
                findBlockByKeywords(['setuju']), findBlockByKeywords(['fakta']),
                findBlockByKeywords(['debat']), findBlockByKeywords(['diperdebatkan']),
                findBlockByKeywords(['analisis', 'dewan']),
                findBlockByKeywords(['keyakinan']), findBlockByKeywords(['alasan'])
            ]);
            let longest = '';
            for (const h in blocks) {
                const val = blocks[h];
                if (!usedBlocks.has(val) && val.length > longest.length) {
                    longest = val;
                }
            }
            if (longest.length > 20) sections.finalAnswer = longest;
        }
        
        // 6. Confidence Level
        const confidenceContent = findBlockByKeywords(['keyakinan']) || findBlockByKeywords(['confidence']);
        if (confidenceContent) {
            if (confidenceContent.toLowerCase().includes('tinggi')) sections.confidenceLevel = 'Tinggi';
            else if (confidenceContent.toLowerCase().includes('rendah')) sections.confidenceLevel = 'Rendah';
            else sections.confidenceLevel = 'Sedang';
        }
        
        // 7. Reason
        sections.reason = findBlockByKeywords(['alasan']) || findBlockByKeywords(['reason']);
        
        return sections;
    }
    
    // Helper to extract confidence score from individual agent outputs
    function extractAgentConfidence(content) {
        const match = content.match(/Confidence Score:\s*(\d+)/i);
        return match ? parseInt(match[1]) : null;
    }
    
    // Renders the final output inside the UI
    function renderReport(report) {
        // Set Consensus Score
        consensusScoreVal.textContent = `${report.consensusScore}%`;
        const radius = 45;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (report.consensusScore / 100) * circumference;
        scoreRing.style.strokeDasharray = `${circumference} ${circumference}`;
        scoreRing.style.strokeDashoffset = offset;
        
        // Set Confidence Badge
        confidenceLevelVal.textContent = report.confidenceLevel;
        confidenceLevelVal.className = `confidence-badge ${report.confidenceLevel.toLowerCase()}`;
        confidenceReasonVal.textContent = report.reason.split(/[.\n]/)[0] + '.'; // First sentence of reason as subtitle
        
        // Render Agreed Facts
        listAgreedFacts.innerHTML = '';
        if (report.agreedFacts.length > 0) {
            report.agreedFacts.forEach(fact => {
                const li = document.createElement('li');
                li.textContent = fact;
                listAgreedFacts.appendChild(li);
            });
        } else {
            listAgreedFacts.innerHTML = '<li>Tidak ada fakta spesifik yang disepakati mayoritas.</li>';
        }
        
        // Render Disputed Facts
        listDisputedFacts.innerHTML = '';
        if (report.disputedFacts.length > 0) {
            report.disputedFacts.forEach(fact => {
                const li = document.createElement('li');
                li.textContent = fact;
                listDisputedFacts.appendChild(li);
            });
        } else {
            listDisputedFacts.innerHTML = '<li>Tidak ada perbedaan pendapat krusial yang dicatat.</li>';
        }
        
        // Render Final Answer (Markdown parsing via Marked)
        const finalAnswerText = report.finalAnswer && report.finalAnswer.trim().length > 5
            ? report.finalAnswer
            : '_Jawaban final konsensus tidak dapat diekstrak dari respons model. Silakan lihat Ringkasan Analisis Dewan AI di bawah._';
        finalAnswerContent.innerHTML = marked.parse(finalAnswerText);
        
        // Render Accordion Summaries
        summaryQwen.innerHTML     = marked.parse(report.qwenAnalysis || '_Tidak tersedia_');
        summaryNemotron.innerHTML = marked.parse(report.nemotronAnalysis || '_Tidak tersedia_');
        summaryDeepseek.innerHTML = marked.parse(report.deepseekAnalysis || '_Tidak tersedia_');
        summaryLlama.innerHTML    = marked.parse(report.llamaAnalysis || '_Tidak tersedia_');
        if (summaryNemotronReasoning) summaryNemotronReasoning.innerHTML = marked.parse(report.nemotronReasoningAnalysis || '_Tidak tersedia_');
        if (summaryLlamaMaverick)     summaryLlamaMaverick.innerHTML     = marked.parse(report.llamaMaverickAnalysis || '_Tidak tersedia_');
        if (summaryQwenCoder)         summaryQwenCoder.innerHTML         = marked.parse(report.qwenCoderAnalysis || '_Tidak tersedia_');
        
        // Render Reason
        consensusReasonContent.innerHTML = marked.parse(report.reason || '_Tidak tersedia_');
        
        // Trigger Highlight.js for code blocks
        hljs.highlightAll();
        
        // Enable export buttons
        copyMarkdownBtn.disabled = false;
        downloadReportBtn.disabled = false;
    }
    
    // --- HELPER: RETRY LOGIC FOR AGENT PROCESSING ---
    async function agentFetchWithRetry(endpoint, method, body, agentName, headers = {}, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(endpoint, {
                    method: method,
                    headers: headers,
                    body: JSON.stringify(body)
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();
                if (!data.success) {
                    throw new Error(data.error || 'Respon tidak valid');
                }

                return data; // success
            } catch (err) {
                const isLastAttempt = attempt === maxRetries;
                if (isLastAttempt) {
                    // All retries exhausted
                    throw err;
                } else {
                    // Retry
                    log(`[RETRY] ${agentName} percobaan ${attempt}/${maxRetries} gagal: ${err.message}. Menunggu 2 detik...`, 'error');
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        }
    }
    
    // --- PIPELINE ORCHESTRATION ---
    
    /**
     * Lock input features (Mode Analisis, Market Data, Pertanyaan)
     * Called when consensus process starts
     */
    function lockInputFeatures() {
        // Lock Mode Analisis buttons
        const modeButtons = document.querySelectorAll('.mode-btn');
        modeButtons.forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        });
        
        // Lock Market Data panel
        const marketCard = document.getElementById('panel-market');
        if (marketCard) {
            marketCard.style.opacity = '0.5';
            const marketSelects = marketCard.querySelectorAll('.market-select');
            const marketBtns = marketCard.querySelectorAll('button');
            marketSelects.forEach(sel => {
                sel.disabled = true;
            });
            marketBtns.forEach(btn => {
                btn.disabled = true;
                btn.style.cursor = 'not-allowed';
            });
        }
        
        // Lock Pertanyaan / Instruksi panel
        const userQuestion = document.getElementById('user-question');
        if (userQuestion) {
            userQuestion.disabled = true;
            userQuestion.style.opacity = '0.5';
            userQuestion.style.cursor = 'not-allowed';
        }
        const suggestionChips = document.querySelectorAll('.chip-btn');
        suggestionChips.forEach(chip => {
            chip.disabled = true;
            chip.style.opacity = '0.5';
            chip.style.cursor = 'not-allowed';
        });
    }
    
    /**
     * Unlock input features (Mode Analisis, Market Data, Pertanyaan)
     * Called when consensus process ends or fails
     */
    function unlockInputFeatures() {
        // Unlock Mode Analisis buttons
        const modeButtons = document.querySelectorAll('.mode-btn');
        modeButtons.forEach(btn => {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        });
        
        // Unlock Market Data panel
        const marketCard = document.getElementById('panel-market');
        if (marketCard) {
            marketCard.style.opacity = '1';
            const marketSelects = marketCard.querySelectorAll('.market-select');
            const marketBtns = marketCard.querySelectorAll('button');
            marketSelects.forEach(sel => {
                sel.disabled = false;
            });
            marketBtns.forEach(btn => {
                btn.disabled = false;
                btn.style.cursor = 'pointer';
            });
        }
        
        // Unlock Pertanyaan / Instruksi panel
        const userQuestion = document.getElementById('user-question');
        if (userQuestion) {
            userQuestion.disabled = false;
            userQuestion.style.opacity = '1';
            userQuestion.style.cursor = 'auto';
        }
        const suggestionChips = document.querySelectorAll('.chip-btn');
        suggestionChips.forEach(chip => {
            chip.disabled = false;
            chip.style.opacity = '1';
            chip.style.cursor = 'pointer';
        });
    }
    
    async function executeConsensusPipeline() {
        let question = userQuestionTxt.value.trim();
        
        // â”€â”€ MODE-SPECIFIC VALIDATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (activeMode === 1) {
            // Chart Mode
            if (!question) {
                question = "Lakukan analisis teknikal mendalam terhadap chart market aktif ini.";
            }
        } else if (activeMode === 2) {
            // Text Only Mode
            if (!question) {
                alert('Silakan tuliskan pertanyaan terlebih dahulu untuk mode Text Only!');
                return;
            }
        } else if (activeMode === 3) {
            // Photo + Text Mode
            if (!uploadedImageBase64) {
                alert('Silakan unggah gambar terlebih dahulu untuk mode Photo + Text!');
                return;
            }
            if (!question) {
                question = "Lakukan analisis terhadap gambar di atas.";
            }
        } else if (activeMode === 4) {
            // Auto All Mode
            if (!question && !uploadedImageBase64 && !marketDataCache) {
                alert('Silakan masukkan pertanyaan, unggah gambar, atau verifikasi data market terlebih dahulu!');
                return;
            }
        }

        // â”€â”€ MARKET DATA FAILSAFE CHECK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const detectMarketRequest = (q) => {
            if (!q) return false;
            const lower = q.toLowerCase();
            const keywords = ['analisis market', 'analisis chart', 'cari entry', 'cari setup', 'support resistance', 'trend', 'entry', 'setup', 'analisis'];
            const symbols = ['xauusd', 'btcusd', 'eurusd', 'gbpusd', 'usdjpy', 'gold', 'bitcoin'];
            return keywords.some(k => lower.includes(k)) || symbols.some(s => lower.includes(s));
        };

        const needsMarket = (activeMode === 1) || (activeMode === 4 && (marketDataCache || detectMarketRequest(question)));
        if (needsMarket) {
            // Run/fetch fresh verification
            const marketStatus = await fetchAndVerifyMarketData();
            if (marketStatus !== true) {
                // Validation or fetching failed! Halt pipeline execution and return strict failsafe response.
                currentWorkflowActive = false;
                startConsensusBtn.disabled = false;
                startConsensusBtn.innerHTML = '<i class="bx bx-play-circle animate-spin-hover"></i> JALANKAN KONSENSUS AI';
                unlockInputFeatures();
                workflowOverallStatus.textContent = 'FAILED';
                workflowOverallStatus.className = 'badge badge-red';
                
                outputPlaceholderArea.classList.add('hidden');
                outputResultsArea.classList.remove('hidden');
                
                const errorJson = {
                    status: "error",
                    message: "Data market tidak tersedia"
                };
                finalAnswerContent.innerHTML = `<pre><code class="language-json">${JSON.stringify(errorJson, null, 2)}</code></pre>`;
                log(`[VALIDATION-FAIL] AI dilarang melakukan analisis karena data market tidak tersedia.`, 'error');
                hljs.highlightAll();
                return;
            }
        }
        
        currentWorkflowActive = true;
        startConsensusBtn.disabled = true;
        startConsensusBtn.innerHTML = '<i class="bx bx-loader animate-spin"></i> PIPELINE BERJALAN...';
        workflowOverallStatus.textContent = 'RUNNING';
        workflowOverallStatus.className = 'badge badge-purple';
        
        // Only lock input features for limited access accounts (24h window)
        // Unlimited access accounts keep all features available during consensus
        if (accessGateModule.isLocked()) {
            lockInputFeatures();
        }
        
        // Reset output elements
        outputPlaceholderArea.classList.remove('hidden');
        outputResultsArea.classList.add('hidden');
        copyMarkdownBtn.disabled = true;
        downloadReportBtn.disabled = true;
        rawConsensusMarkdown = '';
        
        // Reset all agents states and UI cards
        Object.keys(agents).forEach(key => {
            const agent = agents[key];
            agent.state = { p1: null, p1_confidence: null, p2: null, p3: null, p3_confidence: null };
            
            const card = document.getElementById(`agent-${key}`);
            card.className = 'agent-card glass-panel'; // clear thinking glows
            card.querySelector('.agent-status-badge').className = 'agent-status-badge status-idle';
            card.querySelector('.agent-status-badge').textContent = 'IDLE';
            card.querySelector('.val-confidence').textContent = '-';
            card.querySelector('.progress-bar .fill').style.width = '0%';
            card.querySelector('.pct').textContent = '0%';
            card.querySelector('.btn-view-agent').disabled = true;
        });
        
        // Reset steps UI
        document.querySelectorAll('.timeline-step').forEach(step => {
            step.className = 'timeline-step';
            step.querySelector('.fill').style.width = '0%';
            if (step.id === 'step-precheck') {
                step.querySelector('.step-count').textContent = `0/${Object.keys(agents).length} Siap`;
            } else {
                step.querySelector('.step-count').textContent = `0/${Object.keys(agents).length} Selesai`;
            }
        });
        // fix consensus step which has 'Idle'
        document.getElementById('step-consensus').querySelector('.step-count').textContent = 'Idle';
        
        log('--- INITIALIZING VDGANH - AI CONSENSUS PROTOCOL ---', 'system');
        log(`Pertanyaan Pengguna: "${question.substring(0, 60)}..."`, 'info');
        
        const overrideKey = apiKeyInput.value.trim();
        const headers = { 'Content-Type': 'application/json' };
        if (overrideKey) {
            headers['Authorization'] = `Bearer ${overrideKey}`;
        }
        
        // ----------------------------------------------------
        // TAHAP 0: PRE-FLIGHT VERIFICATION (max 3 retries)
        // ----------------------------------------------------
        log('Memulai Tahap 0: Pre-Flight Verification (maks. 3 percobaan)...', 'system');
        stepPrecheck.className = 'timeline-step active';

        const totalAgents = Object.keys(agents).length;
        let precheckCompleted = 0;

        // Track which agents passed / failed
        const agentStatus = {}; // key -> 'online' | 'offline'

        const checkAgentHealth = async (key) => {
            const agent = agents[key];
            const card = document.getElementById(`agent-${key}`);
            const badge = card.querySelector('.agent-status-badge');

            badge.className = 'agent-status-badge status-checking';
            badge.textContent = 'CHECKING';
            log(`[VERIFICATION] Memeriksa NIM: ${agent.name}...`, 'info');

            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    const response = await fetch('api.php?action=check_model', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({ model: agent.model })
                    });
                    const data = await response.json();
                    if (data.success) {
                        agentStatus[key] = 'online';
                        badge.className = 'agent-status-badge status-verified';
                        badge.textContent = 'VERIFIED';
                        log(`[VERIFICATION] âœ“ ${agent.name} SIAP (Percobaan ${attempt})`, 'success');
                        precheckCompleted++;
                        stepPrecheck.querySelector('.step-count').textContent = `${precheckCompleted}/${totalAgents} Siap`;
                        stepPrecheck.querySelector('.fill').style.width = `${(precheckCompleted / totalAgents) * 100}%`;
                        return; // success
                    }
                    throw new Error(data.error);
                } catch (err) {
                    if (attempt < 3) {
                        badge.className = 'agent-status-badge status-retrying';
                        badge.textContent = `RETRY ${attempt}/3`;
                        log(`[VERIFICATION-WARN] ${agent.name} gagal percobaan ${attempt}/3: ${err.message}. Menunggu 3 detik...`, 'error');
                        await new Promise(r => setTimeout(r, 3000));
                    } else {
                        // 3 attempts exhausted
                        agentStatus[key] = 'offline';
                        badge.className = 'agent-status-badge status-offline';
                        badge.textContent = 'OFFLINE';
                        card.classList.add('agent-card-offline');
                        log(`[VERIFICATION-FAIL] âœ— ${agent.name} TIDAK DAPAT DIJANGKAU setelah 3 percobaan. Akan diwakilkan.`, 'error');
                        precheckCompleted++; // still counted so progress fills
                        stepPrecheck.querySelector('.step-count').textContent = `${precheckCompleted}/${totalAgents} Siap`;
                        stepPrecheck.querySelector('.fill').style.width = `${(precheckCompleted / totalAgents) * 100}%`;
                    }
                }
            }
        };

        // Run all health checks in parallel
        await Promise.all(Object.keys(agents).map(key => checkAgentHealth(key)));

        const onlineKeys  = Object.keys(agentStatus).filter(k => agentStatus[k] === 'online');
        const offlineKeys = Object.keys(agentStatus).filter(k => agentStatus[k] === 'offline');

        if (onlineKeys.length === 0) {
            log('[FATAL] Tidak ada model NIM yang dapat dijangkau. Proses dibatalkan.', 'error');
            workflowOverallStatus.textContent = 'FAILED';
            workflowOverallStatus.className = 'badge badge-red';
            startConsensusBtn.disabled = false;
            startConsensusBtn.innerHTML = '<i class="bx bx-play-circle animate-spin-hover"></i> JALANKAN PROSES KONSENSUS';
            unlockInputFeatures();
            return;
        }

        // Assign proxy: for each offline agent, pick a round-robin online agent to cover it
        const proxyMap = {}; // offlineKey -> onlineKey (proxy)
        if (offlineKeys.length > 0) {
            offlineKeys.forEach((offKey, idx) => {
                const proxyKey = onlineKeys[idx % onlineKeys.length];
                proxyMap[offKey] = proxyKey;
                const proxyName = agents[proxyKey].name;
                const offName   = agents[offKey].name;
                const offCard   = document.getElementById(`agent-${offKey}`);
                const offBadge  = offCard.querySelector('.agent-status-badge');
                offBadge.className = 'agent-status-badge status-proxy';
                offBadge.textContent = `PROXYâ†’${proxyName.split('-')[0].toUpperCase()}`;
                log(`[PROXY] ${offName} OFFLINE â†’ perannya diambil alih oleh ${proxyName}`, 'critique');
            });

            const offlineNames = offlineKeys.map(k => agents[k].name).join(', ');
            const onlineCount  = onlineKeys.length;
            stepPrecheck.className = 'timeline-step completed';
            log(`Tahap 0 Selesai: ${onlineCount} model aktif, ${offlineKeys.length} model dialihkan via proxy.`, 'system');
        } else {
            stepPrecheck.className = 'timeline-step completed';
            log('Tahap 0 Selesai: Seluruh model NIM terverifikasi SIAP!', 'success');
        }

        // Helper: get effective model key (follows proxy if offline)
        const effectiveKey = (key) => agentStatus[key] === 'offline' ? proxyMap[key] : key;

        // ----------------------------------------------------
        // TAHAP 0.5: VISION ANALYSIS (IF IMAGE IS UPLOADED)
        // ----------------------------------------------------
        let finalQuestionForAgents = question;
        if (uploadedImageBase64) {
            log('â”â”â” TAHAP 0.5: VISION PRE-PROCESSING â”â”â”', 'system');
            log('Mendeteksi gambar yang diunggah. Mengirim ke NIM Vision Model (meta/llama-3.2-90b-vision-instruct)...', 'system');
            
            // Show vision-analyzing indicator on dropzone
            imageDropzone.style.borderColor = 'var(--color-cyan)';
            dropzoneTextContent.innerHTML = '<i class="bx bx-loader-alt" style="font-size:1.8rem;color:var(--color-cyan);animation:spin 1s linear infinite"></i><p style="font-size:0.8rem;color:var(--color-cyan);margin-top:6px">Menganalisis gambar...</p>';
            dropzoneTextContent.classList.remove('hidden');
            imagePreviewContainer.classList.add('hidden');
            
            try {
                // Estimate base64 size for warning
                const approxSizeKB = Math.round((uploadedImageBase64.length * 0.75) / 1024);
                if (approxSizeKB > 500) {
                    log(`[VISION-WARN] Ukuran gambar besar (~${approxSizeKB}KB setelah encode). Mungkin membutuhkan waktu lebih lama...`, 'error');
                }
                
                const visionRes = await fetch('api.php?action=describe_image', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        image: uploadedImageBase64,
                        question: question
                    })
                });
                
                if (!visionRes.ok) {
                    throw new Error(`HTTP ${visionRes.status}: ${visionRes.statusText}`);
                }
                
                const visionData = await visionRes.json();
                
                if (!visionData.success) {
                    throw new Error(visionData.error || 'Respon vision NIM tidak valid');
                }
                
                const imageDescription = visionData.content;
                log(`[VISION âœ“] Llama-3.2-Vision berhasil menganalisis gambar. Panjang deskripsi: ${imageDescription.length} karakter.`, 'success');
                log(`[VISION-PREVIEW] ${imageDescription.substring(0, 200)}...`, 'info');
                
                // Construct the enriched prompt with visual context embedded
                finalQuestionForAgents = `[KONTEKS VISUAL â€” GAMBAR YANG DIUNGGAH USER]:\n${imageDescription}\n\n---\n\n[PERTANYAAN / TUGAS USER]:\n${question || 'Berikan analisis menyeluruh dan komprehensif mengenai gambar di atas.'}`;
                
                // Restore preview UI after success
                imageDropzone.style.borderColor = 'var(--color-emerald)';
                dropzoneTextContent.innerHTML = '<i class="bx bx-check-circle" style="font-size:1.8rem;color:var(--color-emerald)"></i><p style="font-size:0.8rem;color:var(--color-emerald);margin-top:6px">Analisis visual selesai âœ“</p>';
                dropzoneTextContent.classList.remove('hidden');
                
            } catch (err) {
                log(`[VISION-FATAL] âœ— Gagal memproses gambar: ${err.message}`, 'error');
                log(`[VISION-FATAL] Pipeline dilanjutkan TANPA konteks visual. Agen dewan tidak akan mengetahui isi gambar.`, 'error');
                
                // Restore preview with error state
                imageDropzone.style.borderColor = 'var(--color-red)';
                dropzoneTextContent.innerHTML = `<i class="bx bx-error-circle" style="font-size:1.8rem;color:var(--color-red)"></i><p style="font-size:0.75rem;color:var(--color-red);margin-top:6px">Vision gagal: ${err.message}</p>`;
                dropzoneTextContent.classList.remove('hidden');
                imagePreviewContainer.classList.add('hidden');
            }
        }

        // ----------------------------------------------------
        // ENRICH WITH MARKET DATA CONTEXT (IF ACTIVE)
        // ----------------------------------------------------
        if (marketDataCache && (activeMode === 1 || activeMode === 4)) {
            let candleRows = '';
            marketDataCache.recent_candles.forEach(c => {
                candleRows += `| ${c.time_str} | ${c.open.toFixed(2)} | ${c.high.toFixed(2)} | ${c.low.toFixed(2)} | ${c.close.toFixed(2)} | ${c.volume.toFixed(0)} |\n`;
            });
            
            const lastCandle = marketDataCache.recent_candles[marketDataCache.recent_candles.length - 1];
            
            const marketContext = `=== DATA MARKET AKTUAL ===
Symbol: ${marketDataCache.symbol}
Timeframe: ${marketDataCache.timeframe}
Harga Terakhir (Last Close): ${marketDataCache.last_price.toFixed(2)}
Jumlah Candle yang Dianalisis: ${marketDataCache.candles_count}
Timestamp Candle Terbaru: ${marketDataCache.last_candle_time}
Timestamp Analisis: ${marketDataCache.analysis_time}

Indikator Teknikal Terbaru:
- RSI (14): ${lastCandle.rsi14 ? lastCandle.rsi14.toFixed(2) : 'N/A'}
- SMA 20: ${lastCandle.sma20 ? lastCandle.sma20.toFixed(2) : 'N/A'}
- SMA 50: ${lastCandle.sma50 ? lastCandle.sma50.toFixed(2) : 'N/A'}
- SMA 200: ${lastCandle.sma200 ? lastCandle.sma200.toFixed(2) : 'N/A'}
- Bollinger Bands (20, 2): Upper = ${lastCandle.bb_upper ? lastCandle.bb_upper.toFixed(2) : 'N/A'}, Middle = ${lastCandle.bb_middle ? lastCandle.bb_middle.toFixed(2) : 'N/A'}, Lower = ${lastCandle.bb_lower ? lastCandle.bb_lower.toFixed(2) : 'N/A'}
- MACD (12, 26, 9): MACD Line = ${lastCandle.macd ? lastCandle.macd.toFixed(2) : 'N/A'}, Signal Line = ${lastCandle.macd_signal ? lastCandle.macd_signal.toFixed(2) : 'N/A'}, Histogram = ${lastCandle.macd_hist ? lastCandle.macd_hist.toFixed(2) : 'N/A'}
- ATR (14): ${lastCandle.atr14 ? lastCandle.atr14.toFixed(2) : 'N/A'}

Level Support & Resistance Utama:
- Support: ${marketDataCache.supports && marketDataCache.supports.length > 0 ? marketDataCache.supports.join(', ') : 'N/A'}
- Resistance: ${marketDataCache.resistances && marketDataCache.resistances.length > 0 ? marketDataCache.resistances.join(', ') : 'N/A'}

15 Candle Terakhir (OHLCV, dari terlama ke terbaru):
| Waktu | Open | High | Low | Close | Volume |
|---|---|---|---|---|---|
${candleRows}`;

            finalQuestionForAgents = `[KONTEKS DATA MARKET AKTUAL]:
${marketContext}

-----

${finalQuestionForAgents}

=== ATURAN ANALISIS KRITIS ===
1. Anda WAJIB menggunakan data market aktual di atas. DILARANG KERAS mengarang harga, mengarang level support/resistance, mengarang level entry, stop loss, atau take profit.
2. Semua angka, level support/resistance, dan kesimpulan harus berasal dari data market aktual di atas. Jangan gunakan asumsi tanpa data.
3. Anda harus menyertakan blok AUDIT MODE pada bagian akhir analisis Anda. Formatnya harus berupa JSON persis seperti contoh berikut:
{
  "symbol": "${marketDataCache.symbol}",
  "timeframe": "${marketDataCache.timeframe}",
  "last_price": ${marketDataCache.last_price.toFixed(2)},
  "candles_analyzed": ${marketDataCache.candles_count},
  "last_candle": "${marketDataCache.last_candle_time}",
  "analysis_time": "${marketDataCache.analysis_time}"
}`;
        }

        // ----------------------------------------------------
        // TAHAP 1: INDEPENDENT THINKING
        // ----------------------------------------------------
        log('Memulai Tahap 1: Independent Thinking...', 'system');
        stepThinking.className = 'timeline-step active';

        let p1Completed = 0;
        const p1Promises = Object.keys(agents).map(async (key) => {
            const agent    = agents[key];
            const card     = document.getElementById(`agent-${key}`);
            const badge    = card.querySelector('.agent-status-badge');
            const eKey     = effectiveKey(key);
            const eAgent   = agents[eKey];
            const isProxy  = eKey !== key;

            if (isProxy) {
                // Show proxy delegation indicator
                card.classList.add(`thinking-${agent.accentClass}`);
                badge.className = 'agent-status-badge status-proxy';
                badge.textContent = `PROXY`;
                card.querySelector('.progress-bar .fill').style.width = '40%';
                card.querySelector('.pct').textContent = '40%';
                log(`[PROXY] ${eAgent.name} menjawab atas nama ${agent.name} (Tahap 1)...`, 'critique');
            } else {
                card.classList.add(`thinking-${agent.accentClass}`);
                badge.className = 'agent-status-badge status-thinking';
                badge.textContent = 'THINKING';
                card.querySelector('.progress-bar .fill').style.width = '40%';
                card.querySelector('.pct').textContent = '40%';
                log(`[AGENT] ${agent.name} menganalisis secara mandiri...`, 'agent');
            }

            try {
                const data = await agentFetchWithRetry(
                    'api.php?action=think',
                    'POST',
                    {
                        model: eAgent.model,
                        question: finalQuestionForAgents,
                        roleInfo: isProxy ? `${agent.role} [diwakilkan oleh ${eAgent.name}]` : agent.role,
                        focusInfo: agent.focus
                    },
                    agent.name,
                    headers,
                    3
                );

                agent.state.p1 = data.content;
                agent.state.p1_confidence = extractAgentConfidence(data.content) || 80;

                card.querySelector('.val-confidence').textContent = `${agent.state.p1_confidence}%`;
                card.querySelector('.progress-bar .fill').style.width = '100%';
                card.querySelector('.pct').textContent = '100%';
                badge.className = `agent-status-badge ${isProxy ? 'status-proxy' : 'status-completed'}`;
                badge.textContent = isProxy ? 'DONE (PROXY)' : 'DONE P1';
                log(`[AGENT] ${agent.name} selesai berpikir mandiri. Confidence: ${agent.state.p1_confidence}%`, 'success');

            } catch (err) {
                card.querySelector('.val-confidence').textContent = 'Err';
                card.querySelector('.progress-bar .fill').style.width = '100%';
                card.querySelector('.pct').textContent = 'Error';
                badge.className = 'agent-status-badge status-error';
                badge.textContent = 'ERROR';
                agent.state.p1 = `Gagal memproses analisis: ${err.message}`;
                agent.state.p1_confidence = 0;
                log(`[ERROR] ${agent.name} gagal pada Tahap 1 setelah 3 percobaan: ${err.message}`, 'error');
            } finally {
                p1Completed++;
                stepThinking.querySelector('.step-count').textContent = `${p1Completed}/${totalAgents} Selesai`;
                stepThinking.querySelector('.fill').style.width = `${(p1Completed / totalAgents) * 100}%`;
            }
        });

        await Promise.all(p1Promises);
        stepThinking.className = 'timeline-step completed';
        log('Tahap 1 selesai. Seluruh dewan telah memberikan draf pemikiran mandiri.', 'system');

        // ----------------------------------------------------
        // TAHAP 2: CROSS REVIEW
        // ----------------------------------------------------
        log('Memulai Tahap 2: Cross Review (Kritik Silang)...', 'system');
        stepReview.className = 'timeline-step active';

        let p2Completed = 0;
        const p2Promises = Object.keys(agents).map(async (key) => {
            const agent   = agents[key];
            const card    = document.getElementById(`agent-${key}`);
            const badge   = card.querySelector('.agent-status-badge');
            const eKey    = effectiveKey(key);
            const eAgent  = agents[eKey];
            const isProxy = eKey !== key;

            badge.className = `agent-status-badge ${isProxy ? 'status-proxy' : 'status-critique'}`;
            badge.textContent = isProxy ? 'PROXY' : 'CRITIQUING';
            card.className = `agent-card glass-panel thinking-${agent.accentClass}`;
            card.querySelector('.progress-bar .fill').style.width = '40%';
            card.querySelector('.pct').textContent = '40%';
            log(`[AGENT] ${agent.name} melakukan kritik silang${isProxy ? ' (via proxy)' : ''}...`, 'critique');

            const otherAnswers = Object.keys(agents)
                .filter(k => k !== key)
                .map(k => ({
                    modelName: agents[k].name,
                    answer: agents[k].state.p1
                }));

            try {
                const data = await agentFetchWithRetry(
                    'api.php?action=review',
                    'POST',
                    {
                        model: eAgent.model,
                        question: finalQuestionForAgents,
                        answers: otherAnswers,
                        roleInfo: isProxy ? `${agent.role} [diwakilkan oleh ${eAgent.name}]` : agent.role,
                        focusInfo: agent.focus
                    },
                    agent.name,
                    headers,
                    3
                );

                agent.state.p2 = data.content;
                card.querySelector('.progress-bar .fill').style.width = '100%';
                card.querySelector('.pct').textContent = '100%';
                badge.className = `agent-status-badge ${isProxy ? 'status-proxy' : 'status-completed'}`;
                badge.textContent = isProxy ? 'DONE (PROXY)' : 'DONE P2';
                log(`[AGENT] ${agent.name} menyelesaikan review draf dewan.`, 'success');

            } catch (err) {
                card.querySelector('.progress-bar .fill').style.width = '100%';
                card.querySelector('.pct').textContent = 'Error';
                badge.className = 'agent-status-badge status-error';
                badge.textContent = 'ERROR';
                agent.state.p2 = `Gagal melakukan review setelah 3 percobaan: ${err.message}`;
                log(`[ERROR] ${agent.name} gagal pada Tahap 2 setelah 3 percobaan: ${err.message}`, 'error');
            } finally {
                p2Completed++;
                stepReview.querySelector('.step-count').textContent = `${p2Completed}/${totalAgents} Selesai`;
                stepReview.querySelector('.fill').style.width = `${(p2Completed / totalAgents) * 100}%`;
            }
        });

        await Promise.all(p2Promises);
        stepReview.className = 'timeline-step completed';
        log('Tahap 2 selesai. Seluruh dewan telah menyelesaikan kritik silang.', 'system');

        // ----------------------------------------------------
        // TAHAP 3: IMPROVEMENT PHASE
        // ----------------------------------------------------
        log('Memulai Tahap 3: Improvement Phase (Penyempurnaan Mandiri)...', 'system');
        stepImprove.className = 'timeline-step active';

        let p3Completed = 0;
        const p3Promises = Object.keys(agents).map(async (key) => {
            const agent   = agents[key];
            const card    = document.getElementById(`agent-${key}`);
            const badge   = card.querySelector('.agent-status-badge');
            const eKey    = effectiveKey(key);
            const eAgent  = agents[eKey];
            const isProxy = eKey !== key;

            badge.className = `agent-status-badge ${isProxy ? 'status-proxy' : 'status-refine'}`;
            badge.textContent = isProxy ? 'PROXY' : 'REFINING';
            card.className = `agent-card glass-panel thinking-${agent.accentClass}`;
            card.querySelector('.progress-bar .fill').style.width = '40%';
            card.querySelector('.pct').textContent = '40%';
            log(`[AGENT] ${agent.name} merevisi draf${isProxy ? ' (via proxy)' : ''}...`, 'agent');

            const critiquesAboutThisModel = Object.keys(agents)
                .filter(k => k !== key)
                .map(k => ({
                    modelName: agents[k].name,
                    critique: agents[k].state.p2
                }));

            try {
                const data = await agentFetchWithRetry(
                    'api.php?action=improve',
                    'POST',
                    {
                        model: eAgent.model,
                        question: finalQuestionForAgents,
                        previousAnswer: agent.state.p1,
                        critiques: critiquesAboutThisModel,
                        roleInfo: isProxy ? `${agent.role} [diwakilkan oleh ${eAgent.name}]` : agent.role,
                        focusInfo: agent.focus
                    },
                    agent.name,
                    headers,
                    3
                );

                agent.state.p3 = data.content;
                agent.state.p3_confidence = extractAgentConfidence(data.content) || agent.state.p1_confidence + 5;
                if (agent.state.p3_confidence > 100) agent.state.p3_confidence = 100;

                card.querySelector('.val-confidence').textContent = `${agent.state.p3_confidence}%`;
                card.querySelector('.progress-bar .fill').style.width = '100%';
                card.querySelector('.pct').textContent = '100%';
                badge.className = `agent-status-badge ${isProxy ? 'status-proxy' : 'status-completed'}`;
                badge.textContent = isProxy ? 'READY (PROXY)' : 'READY';
                if (!isProxy) card.querySelector('.btn-view-agent').disabled = false;
                card.className = 'agent-card glass-panel';
                log(`[AGENT] ${agent.name} menyempurnakan analisis. Confidence Akhir: ${agent.state.p3_confidence}%`, 'success');

            } catch (err) {
                card.querySelector('.progress-bar .fill').style.width = '100%';
                card.querySelector('.pct').textContent = 'Error';
                badge.className = 'agent-status-badge status-error';
                badge.textContent = 'ERROR';
                agent.state.p3 = `Gagal merevisi analisis setelah 3 percobaan: ${err.message}`;
                agent.state.p3_confidence = 0;
                log(`[ERROR] ${agent.name} gagal pada Tahap 3 setelah 3 percobaan: ${err.message}`, 'error');
            } finally {
                p3Completed++;
                stepImprove.querySelector('.step-count').textContent = `${p3Completed}/${totalAgents} Selesai`;
                stepImprove.querySelector('.fill').style.width = `${(p3Completed / totalAgents) * 100}%`;
            }
        });

        await Promise.all(p3Promises);
        stepImprove.className = 'timeline-step completed';
        log('Tahap 3 selesai. Seluruh dewan siap merumuskan konsensus.', 'system');

        // ----------------------------------------------------
        // TAHAP 4: CONSENSUS BUILDING
        // ----------------------------------------------------
        log('Memulai Tahap 4: Consensus Building oleh Ketua Dewan...', 'system');
        stepConsensus.className = 'timeline-step active';
        stepConsensus.querySelector('.step-count').textContent = 'Memproses...';
        stepConsensus.querySelector('.fill').style.width = '50%';

        // Determine chairman ordering â€” prefer Qwen3.5-397B-A17B, lalu Nemotron, lalu model online lainnya
        const chairmanOrder = ['qwen', 'nemotron', ...onlineKeys.filter(k => k !== 'qwen' && k !== 'nemotron')]
            .filter((key, index, self) => self.indexOf(key) === index && onlineKeys.includes(key));

        let chairmanIndex = 0;
        let chairmanKey = chairmanOrder[chairmanIndex];
        let chairmanAgent = agents[chairmanKey];
        let isChairmanProxy = chairmanKey !== 'qwen';

        const qwenCard  = document.getElementById('agent-qwen');
        const qwenBadge = qwenCard ? qwenCard.querySelector('.agent-status-badge') : null;

        const setChairmanUi = (key) => {
            chairmanKey = key;
            chairmanAgent = agents[chairmanKey];
            isChairmanProxy = chairmanKey !== 'qwen';

            if (chairmanKey === 'qwen' && qwenCard) {
                qwenCard.className = `agent-card glass-panel thinking-${chairmanAgent.accentClass}`;
                qwenBadge.className = 'agent-status-badge status-thinking';
                qwenBadge.textContent = 'CHAIRMAN';
            }

            const card = document.getElementById(`agent-${chairmanKey}`);
            const badge = card.querySelector('.agent-status-badge');
            card.className = `agent-card glass-panel thinking-${chairmanAgent.accentClass}`;
            badge.className = 'agent-status-badge status-thinking';
            badge.textContent = isChairmanProxy ? 'CHAIRMAN(PROXY)' : 'CHAIRMAN';
            return { card, badge };
        };

        const resetChairUi = (key) => {
            const card = document.getElementById(`agent-${key}`);
            const badge = card.querySelector('.agent-status-badge');
            card.className = 'agent-card glass-panel';
            badge.className = 'agent-status-badge status-completed';
            badge.textContent = 'READY';
        };

        if (isChairmanProxy) {
            log(`[CHAIRMAN-PROXY] Qwen3.5-397B-A17B OFFLINE â†’ Ketua Dewan diambil alih oleh ${chairmanAgent.name}`, 'error');
        }

        const { card: chairCard, badge: chairBadge } = setChairmanUi(chairmanKey);
        log(`[CHAIRMAN] ${chairmanAgent.name} sedang merumuskan dokumen konsensus final...`, 'info');

        const refinedAnswers = Object.keys(agents).map(key => ({
            modelName: agents[key].name,
            answer: agents[key].state.p3
        }));

        try {
            let consensusResponse = null;
            let lastConsensusError = null;

            while (chairmanIndex < chairmanOrder.length) {
                const { card, badge } = setChairmanUi(chairmanOrder[chairmanIndex]);
                if (chairmanIndex > 0) {
                    log(`[CHAIRMAN-FAILOVER] Ketua Dewan sebelumnya error, sementara dialihkan ke ${chairmanAgent.name}`, 'error');
                }

                try {
                    const data = await agentFetchWithRetry(
                        'api.php?action=consensus',
                        'POST',
                        {
                            question: finalQuestionForAgents,
                            model: chairmanAgent.model,
                            refinedAnswers: refinedAnswers
                        },
                        `${chairmanAgent.name} (Consensus)`,
                        headers,
                        3
                    );

                    consensusResponse = data;
                    break;
                } catch (err) {
                    lastConsensusError = err;
                    badge.className = 'agent-status-badge status-error';
                    badge.textContent = 'ERROR';
                    const failedChairmanName = chairmanAgent.name;
                    log(`[ERROR] Ketua Dewan ${failedChairmanName} gagal merumuskan konsensus akhir: ${err.message}`, 'error');
                    resetChairUi(chairmanOrder[chairmanIndex]);
                    chairmanIndex += 1;
                    if (chairmanIndex < chairmanOrder.length) {
                        const nextKey = chairmanOrder[chairmanIndex];
                        const replacementName = agents[nextKey].name;
                        const notice = `Ketua Dewan sementara digantikan oleh ${replacementName} karena ${failedChairmanName} mengalami error. Proses konsensus dilanjutkan.`;
                        chairmanFailoverNotice = notice;
                        log(`[CHAIRMAN-REPLACE] ${failedChairmanName} digantikan sementara oleh ${replacementName}`, 'error');
                    }
                }
            }

            if (!consensusResponse) {
                throw lastConsensusError || new Error('Semua Ketua Dewan gagal merumuskan konsensus.');
            }

            const data = consensusResponse;

            rawConsensusMarkdown = data.content;
            
            // Parse and render the structured report
            const parsedReport = parseConsensusReport(rawConsensusMarkdown);
            renderReport(parsedReport);
            
            // Initialize Follow-up Chat with the Chairman
            initFollowupChat();
            if (chairmanFailoverNotice) {
                appendChatMessage('SYSTEM', 'assistant', chairmanFailoverNotice);
                chairmanFailoverNotice = null;
            }
            
            if (accessGateModule.isLocked()) {
                // Lock the main analysis panels after consensus for limited sessions,
                // but keep the follow-up Qwen chat open for the 3-minute window.
                accessGateModule.lockAppFeatures('Login terbatas digunakan. Fitur utama dikunci setelah hasil ditampilkan.', false);
                accessGateModule.startQwenChatTimer(180);
            } else {
                accessGateModule.setFeatureLock(false);
                accessGateModule.clearQwenChatTimer();
            }
            
            outputPlaceholderArea.classList.add('hidden');
            outputResultsArea.classList.remove('hidden');
            
            stepConsensus.className = 'timeline-step completed';
            stepConsensus.querySelector('.step-count').textContent = 'Selesai';
            stepConsensus.querySelector('.fill').style.width = '100%';

            chairCard.className = 'agent-card glass-panel';
            chairBadge.className = 'agent-status-badge status-completed';
            chairBadge.textContent = 'READY';
            // Also reset Qwen card if it was offline
            if (isChairmanProxy) {
                qwenCard.className = 'agent-card glass-panel';
            }

            log('Tahap 4 selesai. Laporan konsensus berhasil dirumuskan dan dirender!', 'success');
            log('--- ORCHESTRATION CYCLE COMPLETED SUCCESSFULLY ---', 'system');

            document.getElementById('consensus-output-panel').scrollIntoView({ behavior: 'smooth' });

        } catch (err) {
            stepConsensus.querySelector('.step-count').textContent = 'Gagal';
            stepConsensus.querySelector('.fill').style.width = '100%';
            chairBadge.className = 'agent-status-badge status-error';
            chairBadge.textContent = 'ERROR';
            log(`[ERROR] Gagal merumuskan konsensus akhir setelah 3 percobaan: ${err.message}`, 'error');
            
            // Fallback UI rendering on failure
            outputPlaceholderArea.classList.add('hidden');
            outputResultsArea.classList.remove('hidden');
            finalAnswerContent.innerHTML = `<div class="log-line error">Gagal merumuskan konsensus akhir: ${err.message}</div>`;
        } finally {
            currentWorkflowActive = false;
            startConsensusBtn.disabled = false;
            startConsensusBtn.innerHTML = '<i class="bx bx-play-circle animate-spin-hover"></i> JALANKAN PROSES KONSENSUS';
            workflowOverallStatus.textContent = 'IDLE';
            workflowOverallStatus.className = 'badge';
            unlockInputFeatures();
        }
    }
    
    // Bind Execute Button
    startConsensusBtn.addEventListener('click', executeConsensusPipeline);
    
    // --- WORKSPACE MODAL INSPECTOR ---
    
    function openAgentWorkspace(agentId) {
        const agent = agents[agentId];
        if (!agent || !agent.state.p1) return; // not populated yet
        
        currentActiveAgentId = agentId;
        modalAgentAvatar.textContent = agent.name.charAt(0);
        modalAgentAvatar.className = `agent-avatar-mini avatar-${agent.accentClass}`;
        modalAgentName.textContent = agent.name;
        
        // Populate Tabs Content
        modalP1Confidence.textContent = agent.state.p1_confidence ? `${agent.state.p1_confidence}%` : '-';
        modalP1Content.innerHTML = marked.parse(agent.state.p1 || '_Analisis tidak tersedia_');
        
        modalP2Content.innerHTML = marked.parse(agent.state.p2 || '_Kritik silang tidak tersedia_');
        
        modalP3Confidence.textContent = agent.state.p3_confidence ? `${agent.state.p3_confidence}%` : '-';
        modalP3Content.innerHTML = marked.parse(agent.state.p3 || '_Revisi tidak tersedia_');
        
        // Highlight Code
        hljs.highlightAll();
        
        // Reset tab buttons
        document.querySelectorAll('.workspace-tabs .tab-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-tab') === 'tab-p1') btn.classList.add('active');
        });
        
        // Reset tab panes
        document.querySelectorAll('.tab-contents .tab-pane').forEach(pane => {
            pane.classList.remove('active');
            if (pane.getAttribute('id') === 'tab-p1') pane.classList.add('active');
        });
        
        // Show modal
        agentWorkspaceModal.classList.remove('hidden');
    }
    
    // Modal Close
    closeModalBtn.addEventListener('click', () => {
        agentWorkspaceModal.classList.add('hidden');
    });
    
    agentWorkspaceModal.querySelector('.modal-backdrop').addEventListener('click', () => {
        agentWorkspaceModal.classList.add('hidden');
    });
    
    // Bind "View Workspace" buttons
    document.querySelectorAll('.btn-view-agent').forEach(btn => {
        btn.addEventListener('click', () => {
            const agentId = btn.getAttribute('data-agent');
            openAgentWorkspace(agentId);
        });
    });
    
    // Modal Tab switcher
    document.querySelectorAll('.workspace-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            
            document.querySelectorAll('.workspace-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            document.querySelectorAll('.tab-contents .tab-pane').forEach(pane => {
                pane.classList.remove('active');
                if (pane.getAttribute('id') === tabId) pane.classList.add('active');
            });
        });
    });
    
    // --- UTILITY ACTIONS ---
    
    // Copy Markdown Report
    copyMarkdownBtn.addEventListener('click', () => {
        if (!rawConsensusMarkdown) return;
        
        navigator.clipboard.writeText(rawConsensusMarkdown).then(() => {
            const originalHTML = copyMarkdownBtn.innerHTML;
            copyMarkdownBtn.innerHTML = '<i class="bx bx-check"></i>';
            log('Laporan konsensus berhasil disalin ke clipboard.', 'success');
            setTimeout(() => {
                copyMarkdownBtn.innerHTML = originalHTML;
            }, 2000);
        }).catch(err => {
            log(`Gagal menyalin: ${err.message}`, 'error');
        });
    });
    
    // Download Report as Markdown File
    downloadReportBtn.addEventListener('click', () => {
        if (!rawConsensusMarkdown) return;
        
        const blob = new Blob([rawConsensusMarkdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Consensus-Report-${new Date().toISOString().slice(0,10)}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        log('Laporan konsensus berhasil diunduh.', 'success');
    });

    // --- FOLLOW-UP CHAT FUNCTIONALITY ---
    
    function appendChatMessage(senderName, role, content) {
        if (!chatMessagesLog) return;
        const msgContainer = document.createElement('div');
        msgContainer.className = 'chat-message-container';
        
        const senderSpan = document.createElement('span');
        senderSpan.className = `chat-msg-sender ${role}`;
        senderSpan.textContent = senderName;
        
        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = `chat-bubble chat-bubble-${role} markdown-body`;
        bubbleDiv.innerHTML = marked.parse(content);
        
        msgContainer.appendChild(senderSpan);
        msgContainer.appendChild(bubbleDiv);
        chatMessagesLog.appendChild(msgContainer);
        chatMessagesLog.scrollTop = chatMessagesLog.scrollHeight;
    }

    function initFollowupChat() {
        if (!followupChatSection || !chatMessagesLog) return;
        
        // Reset chat history and visual elements
        chatHistory = [];
        chatMessagesLog.innerHTML = '';
        
        // Show follow-up chat section
        followupChatSection.classList.remove('hidden');
        
        // Initial greetings from Chairman
        const greetingText = "Halo! Saya Qwen3.5-397B, Ketua Dewan VDGANH - AI. Saya telah merangkum konsensus dewan di atas. Apakah ada bagian dari analisis teknikal, support/resistance, rencana eksekusi trading, atau aspek lainnya yang ingin Anda diskusikan atau tanyakan lebih lanjut? Silakan tanyakan di bawah ini.";
        appendChatMessage("KETUA DEWAN (QWEN3.5)", "assistant", greetingText);
        chatHistory.push({ role: 'assistant', content: greetingText });
    }

    async function sendFollowupMessage() {
        if (!chatUserInput || !chatUserInput.value.trim()) return;
        
        const userText = chatUserInput.value.trim();
        chatUserInput.value = '';
        
        // Append user message to log & history
        appendChatMessage("USER", "user", userText);
        chatHistory.push({ role: 'user', content: userText });
        
        // Disable inputs and show loading state
        chatUserInput.disabled = true;
        chatSendBtn.disabled = true;
        const originalBtnHTML = chatSendBtn.innerHTML;
        chatSendBtn.innerHTML = '<span>Mengirim...</span> <i class="bx bx-loader-alt bx-spin"></i>';
        
        // Add a typing placeholder bubble
        const typingIndicator = document.createElement('div');
        typingIndicator.id = 'chat-typing-indicator';
        typingIndicator.className = 'chat-message-container';
        typingIndicator.innerHTML = `
            <span class="chat-msg-sender assistant">KETUA DEWAN (QWEN3.5)</span>
            <div class="chat-bubble chat-bubble-assistant" style="padding: 8px 16px; display: inline-flex; align-items: center; gap: 6px;">
                <span style="font-size: 0.85rem; color: #94a3b8;">Sedang mengetik...</span>
                <i class="bx bx-loader-alt bx-spin" style="color: var(--color-cyan);"></i>
            </div>
        `;
        chatMessagesLog.appendChild(typingIndicator);
        chatMessagesLog.scrollTop = chatMessagesLog.scrollHeight;
        
        try {
            const context = "PERTANYAAN AWAL: " + userQuestionTxt.value + "\n\nLAPORAN KONSENSUS DEWAN:\n" + rawConsensusMarkdown;
            const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
            
            let data = null;
            let lastError = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    const response = await fetch('api.php?action=chat_followup', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            history: chatHistory,
                            context: context
                        })
                    });
                    
                    data = await response.json();
                    
                    if (data.success) {
                        break; // success
                    } else {
                        throw new Error(data.error || 'Respon tidak valid');
                    }
                } catch (err) {
                    lastError = err;
                    if (attempt < 3) {
                        console.log(`[CHAT-RETRY] Percobaan ${attempt}/3 gagal: ${err.message}. Menunggu 2 detik...`);
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }
            }
            
            // Remove typing indicator
            const indicator = document.getElementById('chat-typing-indicator');
            if (indicator) indicator.remove();
            
            if (data && data.success) {
                const reply = data.content;
                appendChatMessage("KETUA DEWAN (QWEN3.5)", "assistant", reply);
                chatHistory.push({ role: 'assistant', content: reply });
            } else {
                const errorMsg = lastError ? lastError.message : (data ? data.error : 'Gagal terhubung dengan Ketua Dewan');
                appendChatMessage("SYSTEM", "assistant", `Error setelah 3 percobaan: ${errorMsg}`);
            }
        } catch (err) {
            // Remove typing indicator
            const indicator = document.getElementById('chat-typing-indicator');
            if (indicator) indicator.remove();
            
            appendChatMessage("SYSTEM", "assistant", `Error: ${err.message}`);
        } finally {
            // Re-enable inputs
            chatUserInput.disabled = false;
            chatSendBtn.disabled = false;
            chatSendBtn.innerHTML = originalBtnHTML;
            chatUserInput.focus();
        }
    }

    if (chatSendBtn) {
        chatSendBtn.addEventListener('click', sendFollowupMessage);
    }
    if (chatUserInput) {
        chatUserInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                sendFollowupMessage();
            }
        });
    }
});

