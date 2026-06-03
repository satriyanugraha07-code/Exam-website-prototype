/**
 * ==========================================================================
 * EXAGUARD PRO - APPLICATION LOGIC ENGINE
 * High-Security Web-based Examination System with Local Live-Proctoring Sync
 * ==========================================================================
 */

// 1. DATA ENCRYPTION & DECRYPTION HELPERS (Base64 Web Obfuscator)
const CryptoHelper = {
    encode: (str) => {
        try {
            return btoa(unescape(encodeURIComponent(str)));
        } catch (e) {
            return str;
        }
    },
    decode: (str) => {
        try {
            return decodeURIComponent(escape(atob(str)));
        } catch (e) {
            return str;
        }
    },
    // Safe storage getters & setters
    saveEncrypted: (key, obj) => {
        const jsonStr = JSON.stringify(obj);
        const encrypted = CryptoHelper.encode(jsonStr);
        localStorage.setItem(key, encrypted);
    },
    getDecrypted: (key) => {
        const encrypted = localStorage.getItem(key);
        if (!encrypted) return null;
        try {
            const decrypted = CryptoHelper.decode(encrypted);
            return JSON.parse(decrypted);
        } catch (e) {
            return null;
        }
    }
};

const TextHelper = {
    escapeHtml: (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    }[char])),
    plainTextToHtml: (value) => TextHelper.escapeHtml(value).replace(/\r?\n/g, "<br>")
};

// 2. DEFAULT EXAM QUESTIONS SET
const DEFAULT_QUESTIONS = [
    {
        text: "Siapakah penemu mesin uap yang memicu terjadinya Revolusi Industri?",
        type: "mcq",
        points: 20,
        options: [
            "Thomas Alva Edison",
            "James Watt",
            "Nikola Tesla",
            "Albert Einstein"
        ],
        correct: 1 // index for James Watt
    },
    {
        text: "Planet manakah di tata surya kita yang posisinya paling dekat dengan Matahari?",
        type: "mcq",
        points: 20,
        image: "https://images.unsplash.com/photo-1614730321146-b6fa6a46bcb4?w=500&auto=format&fit=crop",
        options: [
            "Venus",
            "Merkurius",
            "Mars",
            "Yupiter"
        ],
        correct: 1 // index for Merkurius
    },
    {
        text: "Berapakah hasil akhir perhitungan aritmetika berikut: 15 dikalikan 6 dikurangi 20?",
        type: "mcq",
        points: 20,
        options: [
            "60",
            "70",
            "80",
            "90"
        ],
        correct: 1 // index for 70
    },
    {
        text: "Tuliskan nama ibu kota Negara Kesatuan Republik Indonesia saat ini (Jawaban bersifat case-insensitive, contoh: Jakarta).",
        type: "essay",
        points: 20,
        correct: "jakarta" // expected text
    },
    {
        text: "Dalam tabel periodik kimia dasar, lambang unsur 'H' merupakan representasi dari unsur apa?",
        type: "essay",
        points: 20,
        correct: "hidrogen" // expected text
    }
];

// Default configurations
const DEFAULT_SETTINGS = {
    token: "EGUARD",
    duration: 60, // in minutes
    maxWarnings: 3,
    supervisorPin: "1234",
    adminPassword: "admin123",
    examId: "",
    examStatus: "draft",
    examCreatedAt: null,
    examStartedAt: null,
    examClosedAt: null,
    policyAutoSubmitFullscreen: false,
    policyShowScoreEnd: true,
    policyShuffleQuestions: false,
    policyEnableWatermark: true
};

// 3. CORE STATE NAMESPACE
const AppState = {
    currentView: "login", // login, exam, lock, result, admin
    
    // Config loaded from storage or default
    settings: {},
    questions: [],
    
    // Active student exam session
    studentSession: null,
    
    // Student timer reference
    timerInterval: null,
    examSecondsRemaining: 0,
    questionTimerInterval: null,
    questionSecondsRemaining: 0,
    questionTimerQuestionId: null,
    
    // Admin state
    adminSessionActive: false,
    proctoringInterval: null,
    examGateInterval: null,
    remoteControlPollBusy: false,
    fullscreenSupported: true,
    questionGridPage: 0,
    questionGridPageSize: 20,

    // Initialize local storage configurations
    initLocalStorage: () => {
        // Load Settings
        const settings = localStorage.getItem("eg_settings");
        if (settings) {
            AppState.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(settings) };
            localStorage.setItem("eg_settings", JSON.stringify(AppState.settings));
        } else {
            AppState.settings = { ...DEFAULT_SETTINGS };
            localStorage.setItem("eg_settings", JSON.stringify(AppState.settings));
        }

        // Load Questions
        const qData = localStorage.getItem("eg_questions");
        if (qData) {
            AppState.questions = JSON.parse(qData);
        } else {
            AppState.questions = [ ...DEFAULT_QUESTIONS ];
            localStorage.setItem("eg_questions", JSON.stringify(AppState.questions));
        }

        // Initialize empty logs list if missing
        if (!localStorage.getItem("eg_proctoring_sessions")) {
            localStorage.setItem("eg_proctoring_sessions", JSON.stringify([]));
        }
    },

    loadServerState: () => ServerSync.loadState(),

    saveSettings: () => {
        localStorage.setItem("eg_settings", JSON.stringify(AppState.settings));
        // Sync active token display if visible
        const indicator = document.getElementById("admin-token-indicator");
        if (indicator) indicator.textContent = AppState.settings.token.toUpperCase();
        return ServerSync.saveSettings(AppState.settings);
    },

    saveQuestions: () => {
        localStorage.setItem("eg_questions", JSON.stringify(AppState.questions));
        return ServerSync.saveQuestions(AppState.questions);
    }
};

const ServerSync = {
    isEnabled: () => window.location.protocol === "http:" || window.location.protocol === "https:",

    request: async (path, options = {}) => {
        if (!ServerSync.isEnabled()) return null;

        const response = await fetch(path, {
            cache: "no-store",
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {})
            }
        });

        if (!response.ok) throw new Error(`Server sync gagal (${response.status})`);
        return response.json();
    },

    applyState: (payload) => {
        const incoming = payload && payload.state ? payload.state : payload;
        if (!incoming || !incoming.settings) return false;

        AppState.settings = { ...DEFAULT_SETTINGS, ...incoming.settings };
        localStorage.setItem("eg_settings", JSON.stringify(AppState.settings));

        if (Array.isArray(incoming.questions)) {
            AppState.questions = incoming.questions;
            localStorage.setItem("eg_questions", JSON.stringify(AppState.questions));
        }

        if (Array.isArray(incoming.sessions)) {
            localStorage.setItem("eg_proctoring_sessions", JSON.stringify(incoming.sessions));
        }

        return true;
    },

    loadState: async () => {
        try {
            const data = await ServerSync.request("/api/state");
            if (!data || data.initialized === false) return false;
            return ServerSync.applyState(data);
        } catch (err) {
            return false;
        }
    },

    saveSettings: async (settings) => {
        try {
            return await ServerSync.request("/api/settings", {
                method: "POST",
                body: JSON.stringify({ settings })
            });
        } catch (err) {
            return false;
        }
    },

    saveQuestions: async (questions) => {
        try {
            return await ServerSync.request("/api/questions", {
                method: "POST",
                body: JSON.stringify({ questions })
            });
        } catch (err) {
            return false;
        }
    },

    saveSession: async (session) => {
        try {
            return await ServerSync.request("/api/sessions/upsert", {
                method: "POST",
                body: JSON.stringify({ session })
            });
        } catch (err) {
            return false;
        }
    },

    loadSessions: async () => {
        try {
            const data = await ServerSync.request("/api/sessions");
            if (!data || !Array.isArray(data.sessions)) return false;
            localStorage.setItem("eg_proctoring_sessions", JSON.stringify(data.sessions));
            return data.sessions;
        } catch (err) {
            return false;
        }
    }
};

// 4. STUDENT SESSION MONITOR & PROCTORING SYNC SYSTEM
const SessionSync = {
    buildStudentRecord: (session) => {
        const answers = session.answers || {};
        const totalQuestions = Array.isArray(session.questionsOrder) ? session.questionsOrder.length : AppState.questions.length;
        const answeredCount = Object.values(answers).filter(value => value !== undefined && value !== null && String(value).trim() !== "").length;
        const startMs = session.startTimestamp || (session.startIso ? Date.parse(session.startIso) : null);
        const endMs = session.endIso ? Date.parse(session.endIso) : null;
        const durationSeconds = startMs && endMs ? Math.max(0, Math.round((endMs - startMs) / 1000)) : null;

        return {
            sessionId: session.sessionId || `${session.examId || "LOCAL"}-${session.nis || "NOID"}`,
            examId: session.examId || AppState.settings.examId || "",
            name: session.name,
            nis: session.nis,
            token: session.token,
            status: session.status,
            answeredCount,
            unansweredCount: Math.max(0, totalQuestions - answeredCount),
            totalQuestions,
            warnings: session.warnings || 0,
            warningHistory: session.warningHistory || [],
            startTime: session.startTime,
            startDate: session.startDate || "",
            startIso: session.startIso || null,
            endTime: session.endTime || null,
            endDate: session.endDate || "",
            endIso: session.endIso || null,
            durationSeconds,
            score: session.score || 0,
            earnedPoints: session.earnedPoints || 0,
            totalScorePoints: session.totalScorePoints || 0,
            submitMethod: session.submitMethod || "",
            forceReason: session.forceReason || "",
            answers,
            answerDetails: session.answerDetails || [],
            flags: session.flags || {},
            questionsOrder: session.questionsOrder || [],
            lastActive: Date.now()
        };
    },

    // Generate active student updates to local logs database
    updateStudentInLogs: async (session) => {
        if (!session) return false;
        const record = SessionSync.buildStudentRecord(session);
        const rawSessions = localStorage.getItem("eg_proctoring_sessions");
        let list = [];
        try {
            list = JSON.parse(rawSessions) || [];
        } catch(e) {
            list = [];
        }
        
        // Replace this exact attempt while preserving other attempts/students.
        list = list.filter(item => {
            if (record.sessionId && item.sessionId) return item.sessionId !== record.sessionId;
            return item.nis !== record.nis;
        });
        
        // Push current status clone
        list.push(record);
        
        localStorage.setItem("eg_proctoring_sessions", JSON.stringify(list));
        return ServerSync.saveSession(record);
    },

    findStudentRecord: (list, sessionOrNis) => {
        if (!Array.isArray(list)) return null;
        const session = typeof sessionOrNis === "object" && sessionOrNis ? sessionOrNis : null;
        const nis = session ? session.nis : sessionOrNis;
        const sessionId = session ? session.sessionId : null;
        const examId = session ? session.examId : null;

        if (sessionId) {
            const exact = list.find(item => item.sessionId === sessionId);
            if (exact) return exact;
        }

        return list.find(item => {
            if (item.nis !== nis) return false;
            if (examId && item.examId && item.examId !== examId) return false;
            return true;
        }) || null;
    },

    // Retrieve active student session from local database
    getStudentFromLogs: (sessionOrNis) => {
        const rawSessions = localStorage.getItem("eg_proctoring_sessions");
        if (!rawSessions) return null;
        try {
            const list = JSON.parse(rawSessions);
            return SessionSync.findStudentRecord(list, sessionOrNis);
        } catch(e) {
            return null;
        }
    },

    getStudentFromServer: async (session) => {
        const list = await ServerSync.loadSessions();
        if (!list) return SessionSync.getStudentFromLogs(session);
        return SessionSync.findStudentRecord(list, session);
    },

    // Remove active student session
    deleteStudentSessionLog: (nis) => {
        const rawSessions = localStorage.getItem("eg_proctoring_sessions");
        if (!rawSessions) return;
        try {
            let list = JSON.parse(rawSessions) || [];
            list = list.filter(item => item.nis !== nis);
            localStorage.setItem("eg_proctoring_sessions", JSON.stringify(list));
        } catch(e) {}
    }
};

// 5. EXAM ACCESS GATE (Admin-created link and start control)
const ExamGate = {
    getParams: () => new URLSearchParams(window.location.search),

    getUrlExamId: () => ExamGate.getParams().get("exam") || "",

    getUrlToken: () => ExamGate.getParams().get("token") || "",

    syncStorage: async () => {
        const loadedFromServer = await AppState.loadServerState();
        if (loadedFromServer) return;

        const settings = localStorage.getItem("eg_settings");
        if (settings) {
            try {
                AppState.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(settings) };
            } catch (err) {}
        }

        const questions = localStorage.getItem("eg_questions");
        if (questions) {
            try {
                AppState.questions = JSON.parse(questions) || [];
            } catch (err) {}
        }
    },

    isCurrentLinkValid: () => {
        const expectedExamId = AppState.settings.examId || "";
        const urlExamId = ExamGate.getUrlExamId();
        return Boolean(expectedExamId && urlExamId && urlExamId === expectedExamId);
    },

    getState: () => {
        const status = AppState.settings.examStatus || "draft";

        if (!AppState.settings.examId || status === "draft") {
            return {
                canStart: false,
                className: "waiting",
                message: "Admin belum membuat link ujian. Tunggu link resmi dari pengawas."
            };
        }

        if (!ExamGate.isCurrentLinkValid()) {
            return {
                canStart: false,
                className: "closed",
                message: "Link ujian tidak sesuai. Gunakan link terbaru yang dibagikan admin."
            };
        }

        if (status === "waiting") {
            return {
                canStart: false,
                className: "waiting",
                message: "Link sudah benar, tetapi ujian belum dimulai. Tunggu admin menekan Start Ujian."
            };
        }

        if (status === "closed") {
            return {
                canStart: false,
                className: "closed",
                message: "Ujian sudah ditutup oleh admin. Hubungi pengawas jika masih perlu akses."
            };
        }

        if (AppState.questions.length === 0) {
            return {
                canStart: false,
                className: "waiting",
                message: "Bank soal belum tersedia. Hubungi admin untuk menyiapkan soal."
            };
        }

        return {
            canStart: true,
            className: "ready",
            message: "Ujian sudah dibuka. Lengkapi data diri, lalu klik Mulai Ujian."
        };
    },

    canStart: () => ExamGate.getState().canStart,

    getBlockMessage: () => ExamGate.getState().message,

    refresh: async () => {
        if (AppState.currentView !== "login" && AppState.currentView !== "login-view") return;

        await ExamGate.syncStorage();

        const notice = document.getElementById("exam-gate-notice");
        const message = document.getElementById("exam-gate-message");
        const startBtn = document.getElementById("start-exam-btn");
        if (!notice || !message || !startBtn) return;

        const state = ExamGate.getState();
        notice.classList.remove("ready", "waiting", "closed");
        notice.classList.add(state.className);

        if (!AppState.fullscreenSupported) {
            message.textContent = "Browser belum mendukung layar penuh, jadi ujian tidak bisa dimulai di perangkat ini.";
            startBtn.disabled = true;
            return;
        }

        message.textContent = state.message;
        startBtn.disabled = !state.canStart;
    },

    init: () => {
        const tokenFromUrl = ExamGate.getUrlToken();
        const tokenInput = document.getElementById("exam-token");
        if (tokenFromUrl && tokenInput) {
            tokenInput.value = tokenFromUrl.toUpperCase();
        }

        ExamGate.refresh();

        window.addEventListener("storage", (e) => {
            if (e.key === "eg_settings" || e.key === "eg_questions") {
                ExamGate.refresh();
            }
        });

        if (AppState.examGateInterval) clearInterval(AppState.examGateInterval);
        AppState.examGateInterval = setInterval(() => ExamGate.refresh(), 1000);
    }
};

// 5. SECURITY & EVENT BLOCKING ENGINE (Anti-Cheating Mechanics)
const SecurityEngine = {
    isCheatProtectionActive: false,

    activateProtection: () => {
        if (SecurityEngine.isCheatProtectionActive) return;
        
        // 1. Right Click Blocker
        document.addEventListener("contextmenu", SecurityEngine.blockEvent);

        // 2. Select Text Blocker (CSS handles user-select, fallback here)
        document.addEventListener("selectstart", SecurityEngine.blockEvent);

        // 3. Keyboard Shortcut Blocker
        document.addEventListener("keydown", SecurityEngine.handleKeyDown);

        // 4. Tab switch / Window blur tracker
        window.addEventListener("blur", SecurityEngine.handleWindowBlur);
        document.addEventListener("visibilitychange", SecurityEngine.handleVisibilityChange);

        // 5. Fullscreen exit detector
        document.addEventListener("fullscreenchange", SecurityEngine.handleFullscreenChange);
        document.addEventListener("webkitfullscreenchange", SecurityEngine.handleFullscreenChange);

        // 6. Direct Clipboard Event Blockers (Copy, Cut, Paste)
        document.addEventListener("copy", SecurityEngine.blockEvent);
        document.addEventListener("cut", SecurityEngine.blockEvent);
        document.addEventListener("paste", SecurityEngine.blockEvent);

        // 7. Drag and Drop Blockers (Prevents dragging external answers)
        document.addEventListener("dragstart", SecurityEngine.blockEvent);
        document.addEventListener("drop", SecurityEngine.blockEvent);

        SecurityEngine.isCheatProtectionActive = true;
        console.log("Anti-Cheating Security Engine Activated successfully.");
    },

    deactivateProtection: () => {
        if (!SecurityEngine.isCheatProtectionActive) return;

        document.removeEventListener("contextmenu", SecurityEngine.blockEvent);
        document.removeEventListener("selectstart", SecurityEngine.blockEvent);
        document.removeEventListener("keydown", SecurityEngine.handleKeyDown);
        window.removeEventListener("blur", SecurityEngine.handleWindowBlur);
        document.removeEventListener("visibilitychange", SecurityEngine.handleVisibilityChange);
        document.removeEventListener("fullscreenchange", SecurityEngine.handleFullscreenChange);
        document.removeEventListener("webkitfullscreenchange", SecurityEngine.handleFullscreenChange);

        document.removeEventListener("copy", SecurityEngine.blockEvent);
        document.removeEventListener("cut", SecurityEngine.blockEvent);
        document.removeEventListener("paste", SecurityEngine.blockEvent);
        document.removeEventListener("dragstart", SecurityEngine.blockEvent);
        document.removeEventListener("drop", SecurityEngine.blockEvent);

        SecurityEngine.isCheatProtectionActive = false;
        console.log("Anti-Cheating Security Engine Deactivated.");
    },

    blockEvent: (e) => {
        e.preventDefault();
        return false;
    },

    handleKeyDown: (e) => {
        // Prevent F12 (Developer tools)
        if (e.keyCode === 123) {
            e.preventDefault();
            return false;
        }

        // Prevent Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C (Inspector Tools)
        if (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) {
            e.preventDefault();
            return false;
        }

        // Prevent Ctrl+U (View Source)
        if (e.ctrlKey && e.keyCode === 85) {
            e.preventDefault();
            return false;
        }

        // Prevent Ctrl+S (Save Page)
        if (e.ctrlKey && e.keyCode === 83) {
            e.preventDefault();
            return false;
        }

        // Prevent Copy (Ctrl+C), Paste (Ctrl+V), Cut (Ctrl+X)
        if (e.ctrlKey && (e.keyCode === 67 || e.keyCode === 86 || e.keyCode === 88)) {
            e.preventDefault();
            return false;
        }

        // Prevent Print shortcut Ctrl+P
        if (e.ctrlKey && e.keyCode === 80) {
            e.preventDefault();
            return false;
        }
    },

    handleWindowBlur: () => {
        if (AppState.studentSession && AppState.studentSession.status === "active") {
            SecurityEngine.triggerCheatWarning("Kehilangan fokus layar browser (Membuka aplikasi lain)");
        }
    },

    handleVisibilityChange: () => {
        if (document.hidden && AppState.studentSession && AppState.studentSession.status === "active") {
            SecurityEngine.triggerCheatWarning("Berpindah tab halaman browser");
        }
    },

    handleFullscreenChange: () => {
        const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement;
        
        if (!isFullscreen && AppState.studentSession && AppState.studentSession.status === "active") {
            // Student exited fullscreen mode
            if (AppState.settings.policyAutoSubmitFullscreen) {
                // Auto Submit Policy Enabled
                AppState.studentSession.warningHistory.push({
                    event: "Keluar Fullscreen (Auto-Submit)",
                    time: new Date().toLocaleTimeString()
                });
                ExamRunner.submitExam(true); // Forced submit
            } else {
                // Lock screen mode Enabled
                ExamRunner.lockExamView("Keluar dari Mode Layar Penuh");
            }
        }
    },

    triggerCheatWarning: (reason) => {
        if (!AppState.studentSession || AppState.studentSession.status !== "active") return;

        // Add to warnings count
        AppState.studentSession.warnings += 1;
        const timeStamp = new Date().toLocaleTimeString();
        AppState.studentSession.warningHistory.push({
            event: reason,
            time: timeStamp
        });

        // Sync session update to local database
        CryptoHelper.saveEncrypted("eg_active_session", AppState.studentSession);
        SessionSync.updateStudentInLogs(AppState.studentSession);

        const limit = AppState.settings.maxWarnings;

        // Check if exceeded max warning threshold
        if (AppState.studentSession.warnings > limit) {
            ExamRunner.submitExam(true, `Dikumpulkan paksa karena melanggar batas maksimal toleransi peringatan (${limit} kali).`);
        } else {
            // Display Warning Popup Modal
            const warningModal = document.getElementById("cheat-warning-modal");
            document.getElementById("popup-warning-count").textContent = AppState.studentSession.warnings;
            document.getElementById("popup-max-warnings").textContent = limit;
            
            warningModal.classList.remove("hidden");
            
            // Audio Warning Buzz (HTML5 Synth oscillator as visual/audible alert)
            SecurityEngine.beep();
        }
    },

    // Web Audio API Beep Generator (100% offline simple warning buzzer)
    beep: () => {
        try {
            const context = new (window.AudioContext || window.webkitAudioContext)();
            const osc = context.createOscillator();
            const gain = context.createGain();
            
            osc.type = "sawtooth";
            osc.frequency.setValueAtTime(440, context.currentTime); // A4
            osc.frequency.exponentialRampToValueAtTime(150, context.currentTime + 0.4);
            
            gain.gain.setValueAtTime(0.5, context.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.4);
            
            osc.connect(gain);
            gain.connect(context.destination);
            osc.start();
            osc.stop(context.currentTime + 0.4);
        } catch (e) {
            // Audio context not allowed or unsupported
        }
    },

    // Enforce Fullscreen Mode API
    requestFullscreen: async (element) => {
        try {
            if (element.requestFullscreen) {
                await element.requestFullscreen();
            } else if (element.webkitRequestFullscreen) {
                await element.webkitRequestFullscreen();
            } else if (element.msRequestFullscreen) {
                await element.msRequestFullscreen();
            }
            return true;
        } catch (err) {
            console.error("Gagal masuk mode fullscreen:", err);
            return false;
        }
    },

    exitFullscreen: async () => {
        try {
            if (document.exitFullscreen) {
                await document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                await document.webkitExitFullscreen();
            }
        } catch(e) {}
    }
};

// 6. STUDENT EXAM RUNNER ENGINE
const ExamRunner = {
    
    // Start session verification
    attemptStartExam: async (e) => {
        e.preventDefault();
        
        const name = document.getElementById("student-name").value.trim();
        const nis = document.getElementById("student-nis").value.trim();
        const token = document.getElementById("exam-token").value.trim().toUpperCase();
        const consent = document.getElementById("consent-checkbox").checked;

        if (!name || !nis || !token || !consent) {
            alert("Harap lengkapi semua isian formulir dan setujui pernyataan tata tertib!");
            return;
        }

        await ExamGate.refresh();
        if (!ExamGate.canStart()) {
            alert(ExamGate.getBlockMessage());
            return;
        }

        // Verify exam token
        if (token !== AppState.settings.token.toUpperCase()) {
            alert("Token Ujian Salah! Hubungi guru Anda untuk mendapatkan token aktif.");
            return;
        }

        // Verify if questions list is empty
        if (AppState.questions.length === 0) {
            alert("Ujian belum dapat dimulai. Bank soal kosong! Hubungi guru Anda untuk mengisi soal.");
            return;
        }

        // Request Fullscreen Mode
        const successFS = await SecurityEngine.requestFullscreen(document.documentElement);
        if (!successFS) {
            alert("Gagal masuk mode Layar Penuh. Izinkan mode Layar Penuh pada browser Anda untuk dapat memulai ujian!");
            return;
        }

        // Clear any past finished results for the exact same NIS to allow re-entry
        // Or check if they have completed it (Real systems block re-entry, we allow it if token matches)
        
        // Generate Question Order (support shuffling)
        let qIndices = AppState.questions.map((_, idx) => idx);
        if (AppState.settings.policyShuffleQuestions) {
            qIndices = qIndices.sort(() => Math.random() - 0.5);
        }

        // Create student session record
        const now = new Date();
        const examId = AppState.settings.examId || "LOCAL";
        AppState.studentSession = {
            sessionId: `${examId}-${nis}-${Date.now()}`,
            examId,
            name: name,
            nis: nis,
            token: token,
            status: "active",
            currentQuestionIdx: 0,
            answers: {}, // questionId -> answer text or option index
            flags: {}, // questionId -> true/false review status
            warnings: 0,
            warningHistory: [],
            questionsOrder: qIndices, // Shuffled indices map
            startTime: now.toLocaleTimeString(),
            startDate: now.toLocaleDateString(),
            startIso: now.toISOString(),
            startTimestamp: now.getTime(),
            questionTimeRemaining: {},
            endTime: null,
            endDate: "",
            endIso: null,
            submitMethod: "",
            forceReason: "",
            earnedPoints: 0,
            totalScorePoints: 0,
            answerDetails: [],
            score: 0
        };

        // Encrypt and save to storage
        CryptoHelper.saveEncrypted("eg_active_session", AppState.studentSession);

        // Sync with dashboard logs database
        SessionSync.updateStudentInLogs(AppState.studentSession);

        // Transition to Secure Exam Screen
        ViewManager.showView("exam-view");
        
        // Bind student meta details to headers
        document.getElementById("header-student-name").textContent = name;
        document.getElementById("header-student-nis").textContent = `NIS: ${nis}`;
        document.getElementById("max-warnings-display").textContent = AppState.settings.maxWarnings;

        // Apply visual student identity watermark overlay
        ExamRunner.renderWatermarkOverlay(name, nis);

        // Enable security engine listeners
        SecurityEngine.activateProtection();

        // Setup Countdown timer
        AppState.examSecondsRemaining = AppState.settings.duration * 60;
        ExamRunner.startTimer();

        // Render first question
        ExamRunner.renderQuestion(0);
        ExamRunner.renderQuestionGrid();
        ExamRunner.updateProgressBar();
    },

    // Restore interrupted student session from local storage (Refresh protection)
    checkAndResumeSession: () => {
        const savedSession = CryptoHelper.getDecrypted("eg_active_session");
        if (savedSession && savedSession.status !== "finished") {
            
            // Confirm with user if they wish to resume
            const resumeConfirm = confirm(`Ditemukan sesi pengerjaan ujian aktif untuk ${savedSession.name} (${savedSession.nis}). Lanjutkan ujian?`);
            if (resumeConfirm) {
                AppState.studentSession = savedSession;
                if (!AppState.studentSession.questionTimeRemaining) {
                    AppState.studentSession.questionTimeRemaining = {};
                }
                
                // Enforce fullscreen immediately to resume
                alert("Klik OK untuk masuk mode Layar Penuh dan melanjutkan ujian.");
                SecurityEngine.requestFullscreen(document.documentElement).then(success => {
                    if (!success) {
                        // Exit and locked state if fullscreen denied
                        ExamRunner.lockExamView("Meninggalkan mode Fullscreen pada saat reload.");
                        return;
                    }
                    
                    // Activate protections
                    SecurityEngine.activateProtection();
                    
                    // Show View
                    ViewManager.showView("exam-view");
                    document.getElementById("header-student-name").textContent = AppState.studentSession.name;
                    document.getElementById("header-student-nis").textContent = `NIS: ${AppState.studentSession.nis}`;
                    document.getElementById("max-warnings-display").textContent = AppState.settings.maxWarnings;
                    
                    // Watermark
                    ExamRunner.renderWatermarkOverlay(AppState.studentSession.name, AppState.studentSession.nis);

                    // Recalculate remaining seconds from the original session timestamp.
                    const examDurationSeconds = AppState.settings.duration * 60;
                    const elapsedSeconds = AppState.studentSession.startTimestamp
                        ? Math.floor((Date.now() - AppState.studentSession.startTimestamp) / 1000)
                        : 10;
                    AppState.examSecondsRemaining = Math.max(0, examDurationSeconds - elapsedSeconds);
                    
                    ExamRunner.startTimer();
                    
                    // Render UI
                    ExamRunner.renderQuestion(AppState.studentSession.currentQuestionIdx);
                    ExamRunner.renderQuestionGrid();
                    ExamRunner.updateProgressBar();
                });
            } else {
                // Clear active session to start clean
                localStorage.removeItem("eg_active_session");
            }
        }
    },

    renderWatermarkOverlay: (name, nis) => {
        const overlay = document.getElementById("global-watermark");
        if (AppState.settings.policyEnableWatermark) {
            overlay.style.display = "block";
            // Generate repeated inline SVG with name and date
            const time = new Date().toLocaleDateString();
            const watermarkText = `${name} | ${nis} | SECURE EXAM ${time}`;
            
            // Convert to base64 SVG for repetitive background pattern
            const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200">
                <text x="10" y="100" fill="%23FFFFFF" font-size="10" font-family="sans-serif" transform="rotate(-30 150 100)" opacity="0.06" font-weight="bold">${watermarkText}</text>
            </svg>`;
            
            overlay.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svgString)}")`;
        } else {
            overlay.style.display = "none";
        }
    },

    formatTimer: (totalSeconds) => {
        const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
        const hrs = Math.floor(safeSeconds / 3600);
        const mins = Math.floor((safeSeconds % 3600) / 60);
        const secs = safeSeconds % 60;
        const format = (val) => String(val).padStart(2, "0");

        return hrs > 0 ? `${format(hrs)}:${format(mins)}:${format(secs)}` : `${format(mins)}:${format(secs)}`;
    },

    getQuestionTimeLimit: (qData) => {
        const rawLimit = Number(qData?.timeLimit);
        return Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 0;
    },

    getQuestionRemaining: (actualQuestionIdx, qData) => {
        if (!AppState.studentSession.questionTimeRemaining) {
            AppState.studentSession.questionTimeRemaining = {};
        }

        const limit = ExamRunner.getQuestionTimeLimit(qData);
        if (limit <= 0) return 0;

        const stored = AppState.studentSession.questionTimeRemaining[actualQuestionIdx];
        if (stored === undefined || stored === null) {
            AppState.studentSession.questionTimeRemaining[actualQuestionIdx] = limit;
            return limit;
        }

        const remaining = Number(stored);
        return Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining)) : limit;
    },

    isQuestionExpired: (actualQuestionIdx) => {
        const qData = AppState.questions[actualQuestionIdx];
        const limit = ExamRunner.getQuestionTimeLimit(qData);
        if (limit <= 0 || !AppState.studentSession?.questionTimeRemaining) return false;

        return Number(AppState.studentSession.questionTimeRemaining[actualQuestionIdx]) <= 0;
    },

    stopQuestionTimer: () => {
        if (AppState.questionTimerInterval) {
            clearInterval(AppState.questionTimerInterval);
            AppState.questionTimerInterval = null;
        }
        AppState.questionTimerQuestionId = null;
    },

    updateQuestionTimerDisplay: (secondsRemaining, limit) => {
        const box = document.getElementById("display-q-time-box");
        const display = document.getElementById("display-q-time");
        if (!box || !display) return;

        if (limit <= 0) {
            box.classList.add("hidden");
            box.classList.remove("warning", "expired");
            display.textContent = "00:00";
            return;
        }

        box.classList.remove("hidden", "warning", "expired");
        display.textContent = ExamRunner.formatTimer(secondsRemaining);

        if (secondsRemaining <= 0) {
            box.classList.add("expired");
        } else if (secondsRemaining <= Math.min(30, Math.ceil(limit * 0.25))) {
            box.classList.add("warning");
        }
    },

    startQuestionTimer: (actualQuestionIdx) => {
        ExamRunner.stopQuestionTimer();

        const qData = AppState.questions[actualQuestionIdx];
        const limit = ExamRunner.getQuestionTimeLimit(qData);
        let remaining = ExamRunner.getQuestionRemaining(actualQuestionIdx, qData);
        ExamRunner.updateQuestionTimerDisplay(remaining, limit);

        if (limit <= 0 || remaining <= 0) return;

        AppState.questionTimerQuestionId = actualQuestionIdx;
        AppState.questionSecondsRemaining = remaining;

        AppState.questionTimerInterval = setInterval(() => {
            if (!AppState.studentSession || AppState.questionTimerQuestionId !== actualQuestionIdx) return;

            AppState.questionSecondsRemaining = Math.max(0, AppState.questionSecondsRemaining - 1);
            AppState.studentSession.questionTimeRemaining[actualQuestionIdx] = AppState.questionSecondsRemaining;
            CryptoHelper.saveEncrypted("eg_active_session", AppState.studentSession);
            ExamRunner.updateQuestionTimerDisplay(AppState.questionSecondsRemaining, limit);

            if (AppState.questionSecondsRemaining <= 0) {
                ExamRunner.stopQuestionTimer();
                ExamRunner.handleQuestionTimeout(actualQuestionIdx);
            }
        }, 1000);
    },

    handleQuestionTimeout: (actualQuestionIdx) => {
        if (!AppState.studentSession) return;
        AppState.studentSession.questionTimeRemaining[actualQuestionIdx] = 0;
        CryptoHelper.saveEncrypted("eg_active_session", AppState.studentSession);
        ExamRunner.renderQuestionGrid();

        const currentIdx = AppState.studentSession.currentQuestionIdx;
        const currentActualIdx = AppState.studentSession.questionsOrder[currentIdx];
        if (currentActualIdx !== actualQuestionIdx) return;

        const total = AppState.studentSession.questionsOrder.length;
        if (currentIdx >= total - 1) {
            alert("Waktu soal terakhir habis. Ujian akan otomatis dikumpulkan.");
            ExamRunner.submitExam(true, "Dikumpulkan otomatis (Timer soal terakhir habis)");
        } else {
            ExamRunner.renderQuestion(currentIdx + 1);
        }
    },

    startTimer: () => {
        if (AppState.timerInterval) clearInterval(AppState.timerInterval);
        
        const display = document.getElementById("exam-timer-display");
        const timerBox = document.getElementById("timer-box");

        if (AppState.examSecondsRemaining <= 0) {
            display.textContent = "00:00:00";
            ExamRunner.submitExam(true, "Dikumpulkan otomatis (Durasi ujian habis)");
            return;
        }

        const renderExamTimer = () => {
            if (AppState.examSecondsRemaining <= 300) {
                timerBox.classList.add("warning-timer");
            } else {
                timerBox.classList.remove("warning-timer");
            }

            const hrs = Math.floor(AppState.examSecondsRemaining / 3600);
            const mins = Math.floor((AppState.examSecondsRemaining % 3600) / 60);
            const secs = AppState.examSecondsRemaining % 60;
            const format = (val) => String(val).padStart(2, '0');
            display.textContent = `${format(hrs)}:${format(mins)}:${format(secs)}`;
        };

        renderExamTimer();

        AppState.timerInterval = setInterval(() => {
            AppState.examSecondsRemaining--;

            if (AppState.examSecondsRemaining <= 0) {
                clearInterval(AppState.timerInterval);
                display.textContent = "00:00:00";
                // Timeout Auto Submit
                alert("Waktu Ujian Telah Habis! Ujian Anda akan otomatis dikumpulkan.");
                ExamRunner.submitExam(true, "Dikumpulkan otomatis (Durasi ujian habis)");
                return;
            }

            renderExamTimer();
        }, 1000);
    },

    renderQuestion: (index) => {
        if (!AppState.studentSession) return;
        AppState.studentSession.currentQuestionIdx = index;
        
        const actualQuestionIdx = AppState.studentSession.questionsOrder[index];
        const qData = AppState.questions[actualQuestionIdx];
        const isExpired = ExamRunner.isQuestionExpired(actualQuestionIdx);

        document.getElementById("display-q-num").textContent = index + 1;
        document.getElementById("display-q-points").textContent = `${qData.points} Poin`;
        document.getElementById("display-q-text").innerHTML = TextHelper.plainTextToHtml(qData.text);

        const questionCard = document.getElementById("current-question-card");
        const hasImage = Boolean(qData.image && qData.image.trim() !== "");
        const questionTextLength = String(qData.text || "").length;
        questionCard.classList.toggle("has-image", hasImage);
        questionCard.classList.toggle("long-question", questionTextLength > 260);
        questionCard.classList.toggle("essay-question", qData.type !== "mcq");

        ExamRunner.startQuestionTimer(actualQuestionIdx);

        // Render Image if available
        const imgBox = document.getElementById("display-q-image-box");
        const imgEl = document.getElementById("display-q-image");
        if (hasImage) {
            imgEl.src = qData.image.trim();
            imgBox.classList.remove("hidden");
        } else {
            imgEl.src = "";
            imgBox.classList.add("hidden");
        }

        const optionsBox = document.getElementById("display-q-options");
        optionsBox.innerHTML = "";
        optionsBox.className = "options-container";
        optionsBox.classList.add(qData.type === "mcq" ? "mcq-options" : "essay-options");

        if (isExpired) {
            const expiredNotice = document.createElement("div");
            expiredNotice.classList.add("question-time-expired-note");
            expiredNotice.textContent = "Waktu untuk soal ini sudah habis.";
            optionsBox.appendChild(expiredNotice);
        }

        // Check if question is MCQ or Essay
        if (qData.type === "mcq") {
            qData.options.forEach((optText, optIdx) => {
                const optElement = document.createElement("div");
                optElement.classList.add("option-item");
                if (isExpired) {
                    optElement.classList.add("locked");
                }
                
                const labelLetter = String.fromCharCode(65 + optIdx); // A, B, C, D...
                
                // Add selected class if matched
                const savedAns = AppState.studentSession.answers[actualQuestionIdx];
                if (savedAns !== undefined && Number(savedAns) === optIdx) {
                    optElement.classList.add("selected");
                }

                const labelElement = document.createElement("span");
                labelElement.classList.add("option-label");
                labelElement.textContent = labelLetter;

                const textElement = document.createElement("span");
                textElement.classList.add("option-text");
                textElement.textContent = optText;

                optElement.appendChild(labelElement);
                optElement.appendChild(textElement);

                if (!isExpired) {
                    optElement.addEventListener("click", () => ExamRunner.selectAnswer(actualQuestionIdx, optIdx));
                }
                optionsBox.appendChild(optElement);
            });
        } else {
            // Essay question input area
            const essayWrapper = document.createElement("div");
            essayWrapper.classList.add("essay-input-area");
            
            const savedAns = AppState.studentSession.answers[actualQuestionIdx] || "";

            const textarea = document.createElement("textarea");
            textarea.classList.add("essay-textarea");
            textarea.placeholder = "Tuliskan kata kunci jawaban Anda di sini...";
            textarea.autocomplete = "off";
            textarea.value = savedAns;
            textarea.disabled = isExpired;

            // Auto save answer on input change
            textarea.addEventListener("input", (e) => {
                ExamRunner.saveEssayAnswer(actualQuestionIdx, e.target.value);
            });

            essayWrapper.appendChild(textarea);
            optionsBox.appendChild(essayWrapper);
        }

        // Toggle Flag button state
        const flagBtn = document.getElementById("flag-review-btn");
        const flagText = document.getElementById("flag-btn-text");
        if (AppState.studentSession.flags[actualQuestionIdx]) {
            flagBtn.classList.add("flagged");
            flagText.textContent = "Ditandai Ragu-Ragu";
        } else {
            flagBtn.classList.remove("flagged");
            flagText.textContent = "Ragu-Ragu";
        }

        // Handle navigation buttons availability
        document.getElementById("prev-question-btn").disabled = (index === 0);
        
        const nextBtn = document.getElementById("next-question-btn");
        if (index === AppState.studentSession.questionsOrder.length - 1) {
            nextBtn.innerHTML = `
                <span>Kumpulkan Ujian</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            `;
            nextBtn.classList.replace("btn-primary", "btn-success");
        } else {
            nextBtn.innerHTML = `
                <span>Berikutnya</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            `;
            nextBtn.classList.replace("btn-success", "btn-primary");
        }
    },

    selectAnswer: (qIdx, optIdx) => {
        if (ExamRunner.isQuestionExpired(qIdx)) return;

        AppState.studentSession.answers[qIdx] = optIdx;
        CryptoHelper.saveEncrypted("eg_active_session", AppState.studentSession);
        
        // Re-render choices & updates
        ExamRunner.renderQuestion(AppState.studentSession.currentQuestionIdx);
        ExamRunner.renderQuestionGrid();
        ExamRunner.updateProgressBar();
        SessionSync.updateStudentInLogs(AppState.studentSession);
    },

    saveEssayAnswer: (qIdx, text) => {
        if (ExamRunner.isQuestionExpired(qIdx)) return;

        AppState.studentSession.answers[qIdx] = text;
        CryptoHelper.saveEncrypted("eg_active_session", AppState.studentSession);
        
        ExamRunner.renderQuestionGrid();
        ExamRunner.updateProgressBar();
        SessionSync.updateStudentInLogs(AppState.studentSession);
    },

    toggleFlag: () => {
        if (!AppState.studentSession) return;
        const currentIdx = AppState.studentSession.currentQuestionIdx;
        const actualQuestionIdx = AppState.studentSession.questionsOrder[currentIdx];

        // Toggle state
        AppState.studentSession.flags[actualQuestionIdx] = !AppState.studentSession.flags[actualQuestionIdx];
        CryptoHelper.saveEncrypted("eg_active_session", AppState.studentSession);

        ExamRunner.renderQuestion(currentIdx);
        ExamRunner.renderQuestionGrid();
        SessionSync.updateStudentInLogs(AppState.studentSession);
    },

    changeQuestionGridPage: (delta) => {
        if (!AppState.studentSession) return;
        const total = AppState.studentSession.questionsOrder.length;
        const pageSize = AppState.questionGridPageSize;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        AppState.questionGridPage = Math.min(totalPages - 1, Math.max(0, AppState.questionGridPage + delta));
        ExamRunner.renderQuestionGrid(true);
    },

    renderQuestionGrid: (keepSelectedPage = false) => {
        if (!AppState.studentSession) return;
        const grid = document.getElementById("question-navigator-grid");
        const upBtn = document.getElementById("question-page-up-btn");
        const downBtn = document.getElementById("question-page-down-btn");
        const pageLabel = document.getElementById("question-page-label");
        grid.innerHTML = "";

        const order = AppState.studentSession.questionsOrder;
        const total = order.length;
        const pageSize = AppState.questionGridPageSize;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));

        if (!keepSelectedPage) {
            AppState.questionGridPage = Math.floor(AppState.studentSession.currentQuestionIdx / pageSize);
        }

        AppState.questionGridPage = Math.min(totalPages - 1, Math.max(0, AppState.questionGridPage));
        const start = AppState.questionGridPage * pageSize;
        const end = Math.min(total, start + pageSize);
        const visibleOrder = order.slice(start, end);

        visibleOrder.forEach((actualIdx, localIdx) => {
            const orderIdx = start + localIdx;
            const btn = document.createElement("button");
            btn.classList.add("q-grid-btn");
            btn.textContent = orderIdx + 1;

            // Mark active index
            if (AppState.studentSession.currentQuestionIdx === orderIdx) {
                btn.classList.add("active");
            }

            // Mark completed or review flags
            const hasAnswer = AppState.studentSession.answers[actualIdx] !== undefined && String(AppState.studentSession.answers[actualIdx]).trim() !== "";
            const isReview = AppState.studentSession.flags[actualIdx];
            const isExpired = ExamRunner.isQuestionExpired(actualIdx);

            if (isExpired && !hasAnswer) {
                btn.classList.add("expired");
            } else if (isReview) {
                btn.classList.add("review");
            } else if (hasAnswer) {
                btn.classList.add("answered");
            }

            btn.addEventListener("click", () => ExamRunner.renderQuestion(orderIdx));
            grid.appendChild(btn);
        });

        const hasMultiplePages = totalPages > 1;
        if (upBtn) {
            upBtn.disabled = !hasMultiplePages || AppState.questionGridPage === 0;
            upBtn.classList.toggle("hidden", !hasMultiplePages);
        }
        if (downBtn) {
            downBtn.disabled = !hasMultiplePages || AppState.questionGridPage >= totalPages - 1;
            downBtn.classList.toggle("hidden", !hasMultiplePages);
        }
        if (pageLabel) {
            pageLabel.textContent = hasMultiplePages
                ? `Soal ${start + 1}-${end} dari ${total}`
                : `${total} soal`;
        }
    },

    updateProgressBar: () => {
        if (!AppState.studentSession) return;
        const total = AppState.studentSession.questionsOrder.length;
        
        let answered = 0;
        AppState.studentSession.questionsOrder.forEach(idx => {
            const val = AppState.studentSession.answers[idx];
            if (val !== undefined && String(val).trim() !== "") {
                answered++;
            }
        });

        const percent = (answered / total) * 100;
        document.getElementById("exam-progress-bar").style.width = `${percent}%`;
        document.getElementById("answered-count-display").textContent = answered;
        document.getElementById("total-questions-display").textContent = total;
    },

    // Trigger Lockscreen Overlay
    lockExamView: (reason) => {
        if (!AppState.studentSession || AppState.studentSession.status !== "active") return;
        
        AppState.studentSession.status = "locked";
        CryptoHelper.saveEncrypted("eg_active_session", AppState.studentSession);
        SessionSync.updateStudentInLogs(AppState.studentSession);

        // Shift views
        document.getElementById("lock-violation-details").textContent = reason;
        
        ViewManager.showView("lock-view");
        
        // Deactivate window focus trackers temporarily while locked
        window.removeEventListener("blur", SecurityEngine.handleWindowBlur);
        document.removeEventListener("visibilitychange", SecurityEngine.handleVisibilityChange);
    },

    // Prompt submit confirmation box
    promptSubmitConfirm: () => {
        if (!AppState.studentSession) return;
        const total = AppState.studentSession.questionsOrder.length;
        
        let answered = 0;
        let review = 0;
        
        AppState.studentSession.questionsOrder.forEach(idx => {
            const hasAns = AppState.studentSession.answers[idx] !== undefined && String(AppState.studentSession.answers[idx]).trim() !== "";
            const isRev = AppState.studentSession.flags[idx];

            if (isRev) review++;
            if (hasAns) answered++;
        });

        const pending = total - answered;

        document.getElementById("confirm-total-q").textContent = total;
        document.getElementById("confirm-answered-q").textContent = answered;
        document.getElementById("confirm-review-q").textContent = review;
        document.getElementById("confirm-pending-q").textContent = pending;

        document.getElementById("submit-confirm-modal").classList.remove("hidden");
    },

    getAnswerDisplay: (question, answer) => {
        if (answer === undefined || answer === null || String(answer).trim() === "") return "";

        if (question.type === "mcq") {
            const optionIndex = Number(answer);
            const letter = String.fromCharCode(65 + optionIndex);
            const optionText = question.options && question.options[optionIndex] ? question.options[optionIndex] : "";
            return optionText ? `${letter}. ${optionText}` : letter;
        }

        return String(answer).trim();
    },

    getCorrectAnswerDisplay: (question) => {
        if (question.type === "mcq") {
            const optionIndex = Number(question.correct);
            const letter = String.fromCharCode(65 + optionIndex);
            const optionText = question.options && question.options[optionIndex] ? question.options[optionIndex] : "";
            return optionText ? `${letter}. ${optionText}` : letter;
        }

        return String(question.correct ?? "").trim();
    },

    gradeQuestionAnswer: (question, answer) => {
        const hasAnswer = answer !== undefined && answer !== null && String(answer).trim() !== "";
        if (!hasAnswer) return { isAnswered: false, isCorrect: false, earnedPoints: 0 };

        if (question.type === "mcq") {
            const isCorrect = Number(answer) === Number(question.correct);
            return { isAnswered: true, isCorrect, earnedPoints: isCorrect ? Number(question.points || 0) : 0 };
        }

        const studentAnswer = String(answer).trim().toLowerCase();
        const correctAnswer = String(question.correct ?? "").trim().toLowerCase();
        const isCorrect = studentAnswer === correctAnswer;
        return { isAnswered: true, isCorrect, earnedPoints: isCorrect ? Number(question.points || 0) : 0 };
    },

    buildGradingSummary: () => {
        let totalScorePoints = 0;
        let earnedPoints = 0;
        const answerDetails = [];
        const displayOrder = AppState.studentSession.questionsOrder || AppState.questions.map((_, idx) => idx);

        AppState.questions.forEach((question, questionIdx) => {
            const points = Number(question.points || 0);
            const answer = AppState.studentSession.answers[questionIdx];
            const grading = ExamRunner.gradeQuestionAnswer(question, answer);
            const displayIndex = displayOrder.indexOf(questionIdx);

            totalScorePoints += points;
            earnedPoints += grading.earnedPoints;
            answerDetails.push({
                questionIndex: questionIdx,
                displayNumber: displayIndex >= 0 ? displayIndex + 1 : questionIdx + 1,
                type: question.type,
                questionText: question.text,
                studentAnswer: ExamRunner.getAnswerDisplay(question, answer),
                rawAnswer: answer === undefined ? "" : answer,
                correctAnswer: ExamRunner.getCorrectAnswerDisplay(question),
                isAnswered: grading.isAnswered,
                isCorrect: grading.isCorrect,
                earnedPoints: grading.earnedPoints,
                points,
                flagged: Boolean(AppState.studentSession.flags[questionIdx]),
                expired: ExamRunner.isQuestionExpired(questionIdx)
            });
        });

        return {
            totalScorePoints,
            earnedPoints,
            finalScore: totalScorePoints > 0 ? Math.round((earnedPoints / totalScorePoints) * 100) : 0,
            answerDetails
        };
    },

    // Submit Exam evaluation logic
    submitExam: async (forced = false, forceReason = "") => {
        if (!AppState.studentSession) return;

        clearInterval(AppState.timerInterval);
        ExamRunner.stopQuestionTimer();
        
        // Disable warning popups
        document.getElementById("submit-confirm-modal").classList.add("hidden");
        document.getElementById("cheat-warning-modal").classList.add("hidden");

        const gradingSummary = ExamRunner.buildGradingSummary();
        const finalScore = gradingSummary.finalScore;
        const submittedAt = new Date();
        
        // Update Session details
        AppState.studentSession.status = "submitted";
        AppState.studentSession.score = finalScore;
        AppState.studentSession.earnedPoints = gradingSummary.earnedPoints;
        AppState.studentSession.totalScorePoints = gradingSummary.totalScorePoints;
        AppState.studentSession.answerDetails = gradingSummary.answerDetails;
        AppState.studentSession.endTime = submittedAt.toLocaleTimeString();
        AppState.studentSession.endDate = submittedAt.toLocaleDateString();
        AppState.studentSession.endIso = submittedAt.toISOString();
        AppState.studentSession.submitMethod = forced ? "Paksa / Otomatis" : "Manual Siswa";
        AppState.studentSession.forceReason = forced ? (forceReason || "Dipaksa sistem") : "";
        
        if (forced) {
            AppState.studentSession.warningHistory.push({
                event: `Kumpul Paksa: ${forceReason || "Dipaksa sistem"}`,
                time: new Date().toLocaleTimeString()
            });
        }

        // Save encrypted completed state
        AppState.studentSession.status = "finished"; // Prevent resume hack
        CryptoHelper.saveEncrypted("eg_active_session", AppState.studentSession);
        
        // Sync logs
        const syncedToServer = await SessionSync.updateStudentInLogs(AppState.studentSession);
        if (!syncedToServer) {
            AppState.studentSession.warningHistory.push({
                event: "Sinkronisasi server gagal saat submit final",
                time: new Date().toLocaleTimeString()
            });
        }

        // Remove active session reference so they can login clean next time
        localStorage.removeItem("eg_active_session");

        // Turn off anti-cheat blockers
        SecurityEngine.deactivateProtection();
        SecurityEngine.exitFullscreen();

        // Render Student Grade Results page
        document.getElementById("res-student-name").textContent = AppState.studentSession.name;
        document.getElementById("res-student-nis").textContent = AppState.studentSession.nis;
        document.getElementById("res-submit-time").textContent = AppState.studentSession.endTime;
        document.getElementById("res-warnings").textContent = `${AppState.studentSession.warnings} kali`;

        const scoreRow = document.getElementById("res-score-row");
        if (AppState.settings.policyShowScoreEnd) {
            scoreRow.classList.remove("hidden");
            document.getElementById("res-score").textContent = finalScore;
        } else {
            scoreRow.classList.add("hidden");
        }

        ViewManager.showView("result-view");
    }
};

// 8. ROUTING & SCREEN VIEW MANAGER
const ViewManager = {
    showView: (viewId) => {
        // Toggle view containers
        document.querySelectorAll(".view-panel").forEach(panel => {
            if (panel.id === viewId) {
                panel.classList.add("active");
            } else {
                panel.classList.remove("active");
            }
        });

        AppState.currentView = viewId;
        console.log(`Active View Port: ${viewId}`);

        // Handle specific timer/loop cleaners based on view navigation
        if (viewId !== "admin" && AppState.proctoringInterval) {
            clearInterval(AppState.proctoringInterval);
        }
    }
};

// 9. APP ENTRY POINT / EVENT BINDINGS INITIALIZATION
document.addEventListener("DOMContentLoaded", () => {
    // 1. Initialize storage configurations
    AppState.initLocalStorage();

    // 1b. Check Privacy Policy acceptance
    const privacyAccepted = localStorage.getItem("eg_privacy_accepted");
    if (!privacyAccepted) {
        document.getElementById("privacy-policy-modal").classList.remove("hidden");
    }

    // Bind Privacy Policy buttons
    document.getElementById("accept-policy-btn").addEventListener("click", () => {
        localStorage.setItem("eg_privacy_accepted", "true");
        document.getElementById("privacy-policy-modal").classList.add("hidden");
    });

    document.getElementById("decline-policy-btn").addEventListener("click", () => {
        alert("Peringatan: Anda harus menyetujui kebijakan ini agar dapat login dan mengikuti sesi ujian!");
    });

    // 1c. Lock start button until admin creates the link and starts the exam
    ExamGate.init();

    // 2. Resume active student session check
    ExamRunner.checkAndResumeSession();

    // 3. System checklist validation for Welcome screen
    const width = window.innerWidth || document.documentElement.clientWidth;
    const height = window.innerHeight || document.documentElement.clientHeight;
    
    // Minimum resolution constraint (allow mobile, but show DND warning if width < 760px)
    const checkScreen = document.getElementById("check-screen");
    if (width < 760) {
        checkScreen.innerHTML = `<span class="icon">⚠</span> Mode HP Aktif (Wajib nyalakan Jangan Ganggu / DND)`;
        checkScreen.className = "check-item passed"; // Keep passed so button is not disabled
        checkScreen.style.color = "var(--warning)";
    } else {
        checkScreen.innerHTML = `<span class="icon">✓</span> Layar memenuhi syarat minimal`;
        checkScreen.className = "check-item passed";
    }

    // Fullscreen support API check
    const checkFS = document.getElementById("check-fullscreen-api");
    const fsSupported = document.fullscreenEnabled || document.webkitFullscreenEnabled;
    AppState.fullscreenSupported = Boolean(fsSupported);
    if (!fsSupported) {
        checkFS.textContent = "✗ Browser tidak mendukung Fullscreen API";
        checkFS.classList.replace("passed", "failed");
    } else {
        checkFS.textContent = "✓ Browser mendukung Mode Layar Penuh";
        checkFS.classList.replace("failed", "passed");
    }

    ExamGate.refresh();

    // Battery API check (discreet recommendation helper)
    if (navigator.getBattery) {
        navigator.getBattery().then(battery => {
            const batteryEl = document.getElementById("check-battery");
            const updateBatteryStatus = () => {
                const pct = Math.round(battery.level * 100);
                if (battery.charging) {
                    batteryEl.innerHTML = `<span class="icon">✓</span> Baterai sedang di-charge (${pct}%)`;
                    batteryEl.className = "check-item passed";
                } else if (pct < 20) {
                    batteryEl.innerHTML = `<span class="icon">⚠</span> Baterai lemah (${pct}%)! Hubungkan charger.`;
                    batteryEl.className = "check-item failed";
                } else {
                    batteryEl.innerHTML = `<span class="icon">•</span> Baterai terisi (${pct}%) - Disarankan charge`;
                    batteryEl.className = "check-item";
                }
            };
            updateBatteryStatus();
            battery.addEventListener("levelchange", updateBatteryStatus);
            battery.addEventListener("chargingchange", updateBatteryStatus);
        });
    }

    // 4. Form Submission Binding - Student login
    document.getElementById("student-login-form").addEventListener("submit", ExamRunner.attemptStartExam);

    // 5. Button Bindings - Student Exam
    document.getElementById("prev-question-btn").addEventListener("click", () => {
        if (AppState.studentSession && AppState.studentSession.currentQuestionIdx > 0) {
            ExamRunner.renderQuestion(AppState.studentSession.currentQuestionIdx - 1);
        }
    });

    document.getElementById("next-question-btn").addEventListener("click", () => {
        if (AppState.studentSession) {
            const currentIdx = AppState.studentSession.currentQuestionIdx;
            const total = AppState.studentSession.questionsOrder.length;

            if (currentIdx === total - 1) {
                // Last question, prompt confirmation
                ExamRunner.promptSubmitConfirm();
            } else {
                ExamRunner.renderQuestion(currentIdx + 1);
            }
        }
    });

    document.getElementById("flag-review-btn").addEventListener("click", ExamRunner.toggleFlag);
    document.getElementById("end-exam-early-btn").addEventListener("click", ExamRunner.promptSubmitConfirm);
    document.getElementById("question-page-up-btn").addEventListener("click", () => ExamRunner.changeQuestionGridPage(-1));
    document.getElementById("question-page-down-btn").addEventListener("click", () => ExamRunner.changeQuestionGridPage(1));

    // 6. Submit Confirmation Modal Button Bindings
    document.getElementById("cancel-submit-btn").addEventListener("click", () => {
        document.getElementById("submit-confirm-modal").classList.add("hidden");
    });

    document.getElementById("confirm-submit-btn").addEventListener("click", () => {
        ExamRunner.submitExam(false);
    });

    // 7. Security Warning Dismiss Button
    document.getElementById("close-warning-modal-btn").addEventListener("click", () => {
        document.getElementById("cheat-warning-modal").classList.add("hidden");
    });

    // 10. Result Screen return button
    document.getElementById("return-home-btn").addEventListener("click", () => {
        ViewManager.showView("login-view");
        // Clear login values
        document.getElementById("student-login-form").reset();
    });

    // Remote proctoring listener. Commands are read from the server so admin
    // actions work across different devices, not only within one browser.
    setInterval(async () => {
        if (!AppState.studentSession || AppState.remoteControlPollBusy) return;
        if (AppState.currentView !== "lock-view" && AppState.currentView !== "exam-view") return;

        AppState.remoteControlPollBusy = true;
        try {
            const dbStudent = await SessionSync.getStudentFromServer(AppState.studentSession);
            if (!dbStudent) return;

            if (dbStudent.status === "submitted") {
                alert("Pengawas telah mengumpulkan lembar ujian Anda secara paksa.");
                ExamRunner.submitExam(true, "Dikumpulkan paksa oleh admin");
            } else if (AppState.currentView === "lock-view" && dbStudent.status === "active") {
                alert("Admin sudah menyetujui. Ujian Anda dibuka kembali.");
                SecurityEngine.requestFullscreen(document.documentElement).then(success => {
                    AppState.studentSession.status = "active";
                    AppState.studentSession.warningHistory.push({
                        event: "Dibuka kembali setelah ACC admin",
                        time: new Date().toLocaleTimeString()
                    });
                    CryptoHelper.saveEncrypted("eg_active_session", AppState.studentSession);
                    SessionSync.updateStudentInLogs(AppState.studentSession);

                    window.addEventListener("blur", SecurityEngine.handleWindowBlur);
                    document.addEventListener("visibilitychange", SecurityEngine.handleVisibilityChange);

                    ViewManager.showView("exam-view");
                    if (!success) {
                        alert("Silakan aktifkan layar penuh lagi agar ujian bisa lanjut dengan aman.");
                    }
                });
            }
        } finally {
            AppState.remoteControlPollBusy = false;
        }
    }, 1500);

});
