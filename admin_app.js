/**
 * ==========================================================================
 * EXAGUARD PRO - STANDALONE SUPERVISOR DASHBOARD ENGINE
 * Provides Live Proctoring, Question Database Management, Settings, and Grades
 * ==========================================================================
 */

// 1. UTILITY AND PERSISTED DATABASE MANAGERS (Safe LocalStorage Loaders)
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
    getDecrypted: (key) => {
        const encrypted = localStorage.getItem(key);
        if (!encrypted) return null;
        try {
            const decrypted = CryptoHelper.decode(encrypted);
            return JSON.parse(decrypted);
        } catch (e) {
            return null;
        }
    },
    saveEncrypted: (key, obj) => {
        const jsonStr = JSON.stringify(obj);
        const encrypted = CryptoHelper.encode(jsonStr);
        localStorage.setItem(key, encrypted);
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
        correct: 1
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
        correct: 1
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
        correct: 1
    },
    {
        text: "Tuliskan nama ibu kota Negara Kesatuan Republik Indonesia saat ini (Jawaban bersifat case-insensitive, contoh: Jakarta).",
        type: "essay",
        points: 20,
        correct: "jakarta"
    },
    {
        text: "Dalam tabel periodik kimia dasar, lambang unsur 'H' merupakan representasi dari unsur apa?",
        type: "essay",
        points: 20,
        correct: "hidrogen"
    }
];

const DEFAULT_SETTINGS = {
    token: "EGUARD",
    duration: 60,
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

const AppState = {
    settings: {},
    questions: [],
    proctoringInterval: null,

    initLocalStorage: () => {
        const settings = localStorage.getItem("eg_settings");
        if (settings) {
            AppState.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(settings) };
            localStorage.setItem("eg_settings", JSON.stringify(AppState.settings));
        } else {
            AppState.settings = { ...DEFAULT_SETTINGS };
            localStorage.setItem("eg_settings", JSON.stringify(AppState.settings));
        }

        const qData = localStorage.getItem("eg_questions");
        if (qData) {
            AppState.questions = JSON.parse(qData);
        } else {
            AppState.questions = [ ...DEFAULT_QUESTIONS ];
            localStorage.setItem("eg_questions", JSON.stringify(AppState.questions));
        }

        if (!localStorage.getItem("eg_proctoring_sessions")) {
            localStorage.setItem("eg_proctoring_sessions", JSON.stringify([]));
        }
    },

    loadServerState: () => ServerSync.loadState(),

    saveSettings: () => {
        localStorage.setItem("eg_settings", JSON.stringify(AppState.settings));
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
        if (!incoming) return false;

        if (incoming.settings) {
            AppState.settings = { ...DEFAULT_SETTINGS, ...incoming.settings };
            localStorage.setItem("eg_settings", JSON.stringify(AppState.settings));
        }

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
            if (!data) return false;

            if (data.initialized === false) {
                const bootstrapped = await ServerSync.request("/api/bootstrap", {
                    method: "POST",
                    body: JSON.stringify({
                        settings: AppState.settings,
                        questions: AppState.questions
                    })
                });
                return ServerSync.applyState(bootstrapped);
            }

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

    loadSessions: async () => {
        try {
            const data = await ServerSync.request("/api/sessions");
            if (!data || !Array.isArray(data.sessions)) return false;
            localStorage.setItem("eg_proctoring_sessions", JSON.stringify(data.sessions));
            return true;
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

    clearSessions: async () => {
        try {
            await ServerSync.request("/api/sessions/clear", {
                method: "POST",
                body: JSON.stringify({})
            });
            return true;
        } catch (err) {
            return false;
        }
    }
};

// 2. DASHBOARD FUNCTIONALITIES NAMESPACE
const AdminPanel = {

    verifyAdminLogin: async (e) => {
        e.preventDefault();
        await AppState.loadServerState();

        const pwd = document.getElementById("admin-password-input").value;
        const correct = AppState.settings.adminPassword;

        if (pwd === correct) {
            // Save Session Persistence
            localStorage.setItem("eg_admin_session", "active");
            
            document.getElementById("admin-login-view").classList.remove("active");
            document.getElementById("admin-view").classList.add("active");
            document.getElementById("admin-password-input").value = "";

            AdminPanel.initAdminView();
        } else {
            const err = document.getElementById("admin-login-error");
            err.classList.remove("hidden");
            // Beep alert
            AdminPanel.beep();
        }
    },

    initAdminView: () => {
        document.getElementById("admin-token-indicator").textContent = AppState.settings.token.toUpperCase();
        AdminPanel.switchTab("admin-proctoring-tab");
        AdminPanel.renderExamControl();

        if (AppState.proctoringInterval) clearInterval(AppState.proctoringInterval);
        AdminPanel.loadProctoringLogs();
        AppState.proctoringInterval = setInterval(AdminPanel.loadProctoringLogs, 1000);

        window.addEventListener("storage", AdminPanel.handleStorageSyncEvent);
    },

    handleStorageSyncEvent: (e) => {
        if (e.key === "eg_proctoring_sessions") {
            AdminPanel.loadProctoringLogs();
        } else if (e.key === "eg_settings") {
            try {
                AppState.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(e.newValue) };
            } catch(err) {}
            AdminPanel.renderExamControl();
        }
    },

    ensureExamId: () => {
        if (!AppState.settings.examId) {
            const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
            AppState.settings.examId = `EXAM-${Date.now().toString(36).toUpperCase()}-${randomPart}`;
            AppState.settings.examCreatedAt = new Date().toISOString();
        }
        return AppState.settings.examId;
    },

    buildExamLink: () => {
        const examId = AdminPanel.ensureExamId();
        const url = new URL("index.html", window.location.href);
        url.searchParams.set("exam", examId);
        url.searchParams.set("token", AppState.settings.token.toUpperCase());
        return url.href;
    },

    getExamStatusMeta: () => {
        const status = AppState.settings.examStatus || "draft";
        const map = {
            draft: {
                label: "Belum dibuat",
                badgeClass: "muted",
                description: "Buat link ujian terlebih dahulu, bagikan ke siswa, lalu tekan Start saat ujian boleh dimulai."
            },
            waiting: {
                label: "Menunggu Start",
                badgeClass: "warning",
                description: "Link sudah siap. Siswa yang membuka link akan tertahan sampai admin menekan Start Ujian."
            },
            started: {
                label: "Sedang Berjalan",
                badgeClass: "success",
                description: "Ujian sedang dibuka. Siswa dengan link yang benar dapat mulai mengerjakan."
            },
            closed: {
                label: "Ditutup",
                badgeClass: "danger",
                description: "Ujian ditutup. Siswa tidak bisa memulai ujian baru sampai admin membuat link/start lagi."
            }
        };
        return map[status] || map.draft;
    },

    renderExamControl: () => {
        const linkInput = document.getElementById("exam-link-output");
        const statusBadge = document.getElementById("exam-status-badge");
        const description = document.getElementById("exam-control-description");
        const copyBtn = document.getElementById("copy-exam-link-btn");
        const startBtn = document.getElementById("start-exam-session-btn");
        const closeBtn = document.getElementById("close-exam-session-btn");
        if (!linkInput || !statusBadge || !description || !copyBtn || !startBtn || !closeBtn) return;

        const hasLink = Boolean(AppState.settings.examId);
        const status = AppState.settings.examStatus || "draft";
        const meta = AdminPanel.getExamStatusMeta();
        const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
        const hostNote = isLocalHost
            ? " Untuk dibagikan ke perangkat lain, buka admin lewat IP laptop/server agar link tidak memakai localhost."
            : "";

        linkInput.value = hasLink ? AdminPanel.buildExamLink() : "";
        description.textContent = `${meta.description}${hostNote}`;
        statusBadge.className = `badge ${meta.badgeClass}`;
        statusBadge.textContent = meta.label;

        copyBtn.disabled = !hasLink;
        startBtn.disabled = !hasLink || AppState.questions.length === 0 || status === "started";
        closeBtn.disabled = status !== "started" && status !== "waiting";
        document.getElementById("admin-token-indicator").textContent = AppState.settings.token.toUpperCase();
    },

    createExamLink: async () => {
        AdminPanel.ensureExamId();
        AppState.settings.examStatus = "waiting";
        AppState.settings.examCreatedAt = new Date().toISOString();
        AppState.settings.examStartedAt = null;
        AppState.settings.examClosedAt = null;
        await AppState.saveSettings();
        AdminPanel.renderExamControl();
        alert("Link ujian berhasil dibuat. Bagikan link ke siswa, lalu tekan Start Ujian saat sudah siap.");
    },

    copyExamLink: async () => {
        const link = document.getElementById("exam-link-output").value;
        if (!link) {
            alert("Buat link ujian dulu.");
            return;
        }

        try {
            await navigator.clipboard.writeText(link);
            alert("Link ujian berhasil disalin.");
        } catch (err) {
            const input = document.getElementById("exam-link-output");
            input.select();
            document.execCommand("copy");
            alert("Link ujian berhasil disalin.");
        }
    },

    startExamSession: async () => {
        if (AppState.questions.length === 0) {
            alert("Bank soal masih kosong. Import atau tambah soal dulu sebelum ujian dimulai.");
            return;
        }

        if (!AppState.settings.examId) {
            alert("Buat link ujian dulu sebelum menekan Start Ujian.");
            return;
        }

        AppState.settings.examStatus = "started";
        AppState.settings.examStartedAt = new Date().toISOString();
        AppState.settings.examClosedAt = null;
        await AppState.saveSettings();
        AdminPanel.renderExamControl();
        alert("Ujian sudah dimulai. Siswa yang membuka link ujian sekarang bisa klik Mulai Ujian.");
    },

    closeExamSession: async () => {
        const confirmed = confirm("Tutup akses mulai ujian untuk siswa baru?");
        if (!confirmed) return;

        AppState.settings.examStatus = "closed";
        AppState.settings.examClosedAt = new Date().toISOString();
        await AppState.saveSettings();
        AdminPanel.renderExamControl();
        alert("Ujian ditutup. Siswa baru tidak bisa memulai ujian.");
    },

    switchTab: (tabId) => {
        document.querySelectorAll(".admin-nav-btn").forEach(btn => {
            if (btn.getAttribute("data-tab") === tabId) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });

        document.querySelectorAll(".admin-tab-content").forEach(content => {
            if (content.id === tabId) {
                content.classList.add("active");
            } else {
                content.classList.remove("active");
            }
        });

        const titles = {
            "admin-proctoring-tab": "Pemantauan Live Siswa",
            "admin-questions-tab": "Kelola Bank Soal Ujian",
            "admin-settings-tab": "Pengaturan Keamanan & Ujian",
            "admin-results-tab": "Daftar Nilai Akhir Siswa"
        };
        document.getElementById("admin-current-view-title").textContent = titles[tabId];

        if (tabId === "admin-questions-tab") {
            AdminPanel.loadQuestionsManager();
        } else if (tabId === "admin-settings-tab") {
            AdminPanel.loadSettingsForm();
        } else if (tabId === "admin-results-tab") {
            AdminPanel.loadResultsTable();
        }
    },

    getStoredSessions: () => {
        const raw = localStorage.getItem("eg_proctoring_sessions");
        let list = [];
        try {
            list = JSON.parse(raw) || [];
        } catch(e) {
            list = [];
        }
        return Array.isArray(list) ? list : [];
    },

    loadProctoringLogs: (skipServerSync = false) => {
        if (!skipServerSync) {
            ServerSync.loadSessions().then(loaded => {
                if (loaded) AdminPanel.loadProctoringLogs(true);
            });
        }

        let list = AdminPanel.getStoredSessions();

        let active = 0;
        let locked = 0;
        let finished = 0;

        const tableBody = document.getElementById("proctoring-table-body");
        tableBody.innerHTML = "";

        if (list.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Belum ada siswa yang bergabung ke ujian.</td></tr>`;
            document.getElementById("stat-total-students").textContent = 0;
            document.getElementById("stat-completed-students").textContent = 0;
            document.getElementById("stat-locked-students").textContent = 0;
            return;
        }

        list.sort((a,b) => a.name.localeCompare(b.name));

        list.forEach(std => {
            if (std.status === "active") active++;
            else if (std.status === "locked") locked++;
            else if (std.status === "finished" || std.status === "submitted") finished++;

            const tr = document.createElement("tr");

            let statusBadge = `<span class="badge muted">Mencari...</span>`;
            if (std.status === "active") {
                statusBadge = `<span class="badge success">Aktif Mengerjakan</span>`;
            } else if (std.status === "locked") {
                statusBadge = `<span class="badge danger">Layar Terkunci</span>`;
            } else if (std.status === "finished" || std.status === "submitted") {
                statusBadge = `<span class="badge info">Selesai Dikumpul</span>`;
            }

            let warningClass = "text-muted";
            if (std.warnings > 0) warningClass = std.warnings >= AppState.settings.maxWarnings ? "text-danger" : "text-warning";
            const warningText = `<span class="${warningClass} font-bold">${std.warnings} kali</span>`;

            const progress = `${std.answeredCount} / ${std.totalQuestions} Soal`;

            let logHistoryList = `<div class="live-log-box">`;
            if (std.warningHistory && std.warningHistory.length > 0) {
                std.warningHistory.forEach(w => {
                    logHistoryList += `<span>[${w.time}] ${w.event}</span>`;
                });
            } else {
                logHistoryList += `<span>Normal</span>`;
            }
            logHistoryList += `</div>`;

            let actionButtons = ``;
            const sessionKey = encodeURIComponent(std.sessionId || std.nis || "");
            if (std.status === "locked") {
                actionButtons = `
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        <button onclick="AdminPanel.remoteUnlock('${sessionKey}')" class="btn-success" style="padding:4px 8px; font-size:0.75rem;">ACC Buka Kunci</button>
                        <button onclick="AdminPanel.remoteForceSubmit('${sessionKey}')" class="btn-danger-outline" style="padding:4px 8px; font-size:0.75rem;">Kumpul Paksa</button>
                    </div>
                `;
            } else if (std.status === "active") {
                actionButtons = `<button onclick="AdminPanel.remoteForceSubmit('${sessionKey}')" class="btn-danger-outline" style="padding:4px 8px; font-size:0.75rem;">Kumpul Paksa</button>`;
            } else {
                actionButtons = `<span class="text-muted">-</span>`;
            }

            tr.innerHTML = `
                <td><strong>${std.name}</strong></td>
                <td>${std.nis}</td>
                <td>${statusBadge}</td>
                <td>${progress}</td>
                <td>${warningText}</td>
                <td>${logHistoryList}</td>
                <td>${actionButtons}</td>
            `;

            tableBody.appendChild(tr);
        });

        document.getElementById("stat-total-students").textContent = list.length;
        document.getElementById("stat-completed-students").textContent = finished;
        document.getElementById("stat-locked-students").textContent = locked;
    },

    findSessionIndexByKey: (list, encodedKey) => {
        const key = decodeURIComponent(encodedKey || "");
        return list.findIndex(std => std.sessionId === key || std.nis === key);
    },

    remoteUnlock: async (encodedKey) => {
        await ServerSync.loadSessions();
        const raw = localStorage.getItem("eg_proctoring_sessions");
        if (!raw) return;
        try {
            let list = JSON.parse(raw) || [];
            const index = AdminPanel.findSessionIndexByKey(list, encodedKey);
            if (index !== -1) {
                list[index].status = "active";
                list[index].warningHistory = Array.isArray(list[index].warningHistory) ? list[index].warningHistory : [];
                list[index].warningHistory.push({
                    event: "ACC buka kunci oleh admin",
                    time: new Date().toLocaleTimeString()
                });
                localStorage.setItem("eg_proctoring_sessions", JSON.stringify(list));
                await ServerSync.saveSession(list[index]);
                AdminPanel.loadProctoringLogs(true);
            }
        } catch(e) {}
    },

    buildRemoteSubmitRecord: (session) => {
        const now = new Date();
        const answerDetails = AdminPanel.buildAnswerDetailsFromStoredAnswers(session);
        const totalScorePoints = answerDetails.reduce((sum, detail) => sum + Number(detail.points || 0), 0);
        const earnedPoints = answerDetails.reduce((sum, detail) => sum + Number(detail.earnedPoints || 0), 0);
        const answeredCount = answerDetails.filter(detail => detail.isAnswered).length;
        const warningHistory = Array.isArray(session.warningHistory) ? session.warningHistory : [];

        warningHistory.push({
            event: "Dikumpulkan paksa oleh admin",
            time: now.toLocaleTimeString()
        });

        return {
            ...session,
            status: "submitted",
            submitMethod: "Paksa / Admin",
            forceReason: "Dikumpulkan paksa oleh admin",
            endTime: now.toLocaleTimeString(),
            endDate: now.toLocaleDateString(),
            endIso: now.toISOString(),
            answerDetails,
            answeredCount,
            unansweredCount: Math.max(0, answerDetails.length - answeredCount),
            totalQuestions: answerDetails.length,
            totalScorePoints,
            earnedPoints,
            score: totalScorePoints > 0 ? Math.round((earnedPoints / totalScorePoints) * 100) : 0,
            warningHistory
        };
    },

    remoteForceSubmit: async (encodedKey) => {
        const confirmForce = confirm("Apakah Anda yakin ingin mengumpulkan paksa lembar ujian siswa ini?");
        if (!confirmForce) return;

        await ServerSync.loadSessions();
        const raw = localStorage.getItem("eg_proctoring_sessions");
        if (!raw) return;
        try {
            let list = JSON.parse(raw) || [];
            const index = AdminPanel.findSessionIndexByKey(list, encodedKey);
            if (index !== -1) {
                list[index] = AdminPanel.buildRemoteSubmitRecord(list[index]);
                localStorage.setItem("eg_proctoring_sessions", JSON.stringify(list));
                await ServerSync.saveSession(list[index]);
                AdminPanel.loadProctoringLogs(true);
            }
        } catch(e) {}
    },

    loadQuestionsManager: () => {
        document.getElementById("admin-total-questions-tag").textContent = AppState.questions.length;
        const listContainer = document.getElementById("admin-questions-list");
        listContainer.innerHTML = "";

        if (AppState.questions.length === 0) {
            listContainer.innerHTML = `<div class="glass-panel text-center text-muted" style="padding: 40px;">Bank soal kosong. Klik "+ Tambah Soal Baru" untuk mulai membuat soal ujian.</div>`;
            return;
        }

        AppState.questions.forEach((q, idx) => {
            const card = document.createElement("div");
            card.classList.add("admin-q-card", "glass-panel");

            let choicesHtml = "";
            if (q.type === "mcq") {
                q.options.forEach((opt, optIdx) => {
                    const isCorrect = (optIdx === q.correct);
                    choicesHtml += `
                        <div class="admin-choice-item ${isCorrect ? 'correct' : ''}">
                            ${String.fromCharCode(65 + optIdx)}. ${TextHelper.escapeHtml(opt)} ${isCorrect ? '(Kunci Jawaban)' : ''}
                        </div>
                    `;
                });
            } else {
                choicesHtml = `<div class="text-success font-bold" style="font-size:0.88rem;">Kunci Jawaban: ${TextHelper.escapeHtml(q.correct)}</div>`;
            }

            const imageHtml = q.image && q.image.trim() !== "" ? `
                <div style="margin: 10px 0; border: 1px dashed var(--border-glass); border-radius: var(--radius-sm); padding: 4px; display: inline-block;">
                    <img src="${TextHelper.escapeHtml(q.image.trim())}" alt="Preview" style="max-height: 80px; max-width: 120px; border-radius: 4px; display: block; object-fit: contain;">
                </div>
            ` : "";
            const timeHtml = q.timeLimit && Number(q.timeLimit) > 0
                ? `<span class="text-muted font-bold">${Number(q.timeLimit)} Detik</span>`
                : "";

            card.innerHTML = `
                <div class="admin-q-header">
                    <span class="badge info">${q.type === 'mcq' ? 'Pilihan Ganda' : 'Isian Singkat'}</span>
                    <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                        ${timeHtml}
                        <span class="text-muted font-bold">${q.points} Poin</span>
                    </div>
                </div>
                <div class="admin-q-body">
                    <strong>Soal ${idx + 1}:</strong> ${TextHelper.plainTextToHtml(q.text)}
                    ${imageHtml}
                </div>
                <div class="admin-q-choices">
                    ${choicesHtml}
                </div>
                <div class="admin-q-actions">
                    <button onclick="AdminPanel.editQuestion(${idx})" class="btn-secondary" style="padding:4px 10px; font-size:0.8rem;">Edit</button>
                    <button onclick="AdminPanel.deleteQuestion(${idx})" class="btn-danger-outline" style="padding:4px 10px; font-size:0.8rem;">Hapus</button>
                </div>
            `;

            listContainer.appendChild(card);
        });
    },

    openNewQuestionForm: () => {
        document.getElementById("question-form-panel").classList.remove("hidden");
        document.getElementById("question-form-title").textContent = "Tambah Soal Baru";
        document.getElementById("question-editor-form").reset();
        document.getElementById("edit-question-index").value = "";
        document.getElementById("question-time-input").value = "";
        
        // Reset image fields
        document.getElementById("question-image-file").value = "";
        document.getElementById("question-image-base64").value = "";
        document.getElementById("form-image-preview").src = "";
        document.getElementById("form-image-preview-box").classList.add("hidden");
        document.getElementById("clear-uploaded-image-btn").classList.add("hidden");
        
        AdminPanel.toggleQuestionTypeForm("mcq");
    },

    toggleQuestionTypeForm: (type) => {
        const mcqBlock = document.getElementById("mcq-options-form-block");
        const essayBlock = document.getElementById("essay-answer-form-block");

        if (type === "mcq") {
            mcqBlock.classList.remove("hidden");
            essayBlock.classList.add("hidden");
            document.querySelectorAll(".mcq-option-input").forEach((input, idx) => {
                input.required = idx < 2;
            });
            document.getElementById("essay-correct-answer").required = false;
        } else {
            mcqBlock.classList.add("hidden");
            essayBlock.classList.remove("hidden");
            document.querySelectorAll(".mcq-option-input").forEach(i => i.required = false);
            document.getElementById("essay-correct-answer").required = true;
        }
    },

    saveQuestionEditor: (e) => {
        e.preventDefault();
        
        const qText = document.getElementById("question-text").value.trim();
        const qPoints = Number(document.getElementById("question-points-input").value);
        const qTimeLimit = Number(document.getElementById("question-time-input").value);
        const qType = document.getElementById("question-type").value;
        const editIdxStr = document.getElementById("edit-question-index").value;
        const qImage = document.getElementById("question-image-base64").value.trim();

        let questionObj = {
            text: qText,
            type: qType,
            points: qPoints,
            image: qImage
        };

        if (Number.isFinite(qTimeLimit) && qTimeLimit > 0) {
            questionObj.timeLimit = Math.floor(qTimeLimit);
        }

        if (qType === "mcq") {
            const optionInputs = document.querySelectorAll(".mcq-option-input");
            const optionPairs = [];
            let foundGap = false;
            let hasEmptyBeforeFilled = false;

            optionInputs.forEach((input, originalIdx) => {
                const text = input.value.trim();
                if (text) {
                    if (hasEmptyBeforeFilled) {
                        foundGap = true;
                    }
                    optionPairs.push({ originalIdx, text });
                } else {
                    hasEmptyBeforeFilled = true;
                }
            });

            const radios = document.getElementsByName("correct-option-radio");
            let selectedOriginalIdx = 0;
            for (let i = 0; i < radios.length; i++) {
                if (radios[i].checked) {
                    selectedOriginalIdx = Number(radios[i].value);
                    break;
                }
            }

            if (optionPairs.length < 2) {
                alert("Pilihan ganda minimal harus memiliki 2 opsi jawaban.");
                return;
            }

            if (foundGap) {
                alert("Urutan pilihan jawaban tidak boleh lompat. Isi opsi A, B, C, D, E secara berurutan.");
                return;
            }

            const correctIdx = optionPairs.findIndex(option => option.originalIdx === selectedOriginalIdx);
            if (correctIdx === -1) {
                alert("Kunci jawaban harus mengarah ke opsi yang sudah diisi.");
                return;
            }

            questionObj.options = optionPairs.map(option => option.text);
            questionObj.correct = correctIdx;
        } else {
            const correctAns = document.getElementById("essay-correct-answer").value.trim();
            questionObj.correct = correctAns;
        }

        if (editIdxStr === "") {
            AppState.questions.push(questionObj);
        } else {
            const idx = Number(editIdxStr);
            AppState.questions[idx] = questionObj;
        }

        AppState.saveQuestions();
        document.getElementById("question-form-panel").classList.add("hidden");
        AdminPanel.loadQuestionsManager();
        AdminPanel.renderExamControl();
    },

    editQuestion: (idx) => {
        const q = AppState.questions[idx];
        document.getElementById("question-form-panel").classList.remove("hidden");
        document.getElementById("question-form-title").textContent = `Edit Soal #${idx + 1}`;
        document.getElementById("edit-question-index").value = idx;

        document.getElementById("question-text").value = q.text;
        document.getElementById("question-points-input").value = q.points;
        document.getElementById("question-time-input").value = q.timeLimit && Number(q.timeLimit) > 0 ? q.timeLimit : "";
        document.getElementById("question-type").value = q.type;

        document.getElementById("question-image-file").value = "";
        if (q.image && q.image.trim() !== "") {
            document.getElementById("question-image-base64").value = q.image;
            document.getElementById("form-image-preview").src = q.image;
            document.getElementById("form-image-preview-box").classList.remove("hidden");
            document.getElementById("clear-uploaded-image-btn").classList.remove("hidden");
        } else {
            document.getElementById("question-image-base64").value = "";
            document.getElementById("form-image-preview").src = "";
            document.getElementById("form-image-preview-box").classList.add("hidden");
            document.getElementById("clear-uploaded-image-btn").classList.add("hidden");
        }

        AdminPanel.toggleQuestionTypeForm(q.type);

        if (q.type === "mcq") {
            const inputs = document.querySelectorAll(".mcq-option-input");
            inputs.forEach(input => input.value = "");
            q.options.forEach((opt, optIdx) => {
                if (inputs[optIdx]) inputs[optIdx].value = opt;
            });

            const radios = document.getElementsByName("correct-option-radio");
            for (let i = 0; i < radios.length; i++) {
                radios[i].checked = (Number(radios[i].value) === q.correct);
            }
        } else {
            document.getElementById("essay-correct-answer").value = q.correct;
        }

        document.getElementById("question-form-panel").scrollIntoView({ behavior: 'smooth' });
    },

    deleteQuestion: (idx) => {
        const confirmDel = confirm(`Apakah Anda yakin ingin menghapus soal #${idx + 1}?`);
        if (confirmDel) {
            AppState.questions.splice(idx, 1);
            AppState.saveQuestions();
            AdminPanel.loadQuestionsManager();
            AdminPanel.renderExamControl();
        }
    },

    applyBulkPoints: () => {
        const pointsInput = document.getElementById("bulk-points-input");
        const newPoints = Number(pointsInput.value);

        if (isNaN(newPoints) || newPoints < 1) {
            alert("Harap masukkan nilai poin yang valid (minimal 1)!");
            return;
        }

        if (AppState.questions.length === 0) {
            alert("Bank soal kosong! Tidak ada soal yang dapat diubah.");
            return;
        }

        const confirmBulk = confirm(`Apakah Anda yakin ingin mengubah seluruh poin dari ${AppState.questions.length} soal menjadi ${newPoints} poin?`);
        if (!confirmBulk) return;

        AppState.questions.forEach(q => {
            q.points = newPoints;
        });

        AppState.saveQuestions();
        AdminPanel.loadQuestionsManager();
        AdminPanel.renderExamControl();
        alert(`Berhasil mengubah seluruh poin soal menjadi ${newPoints} poin!`);
    },

    exportQuestionsJSON: () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(AppState.questions, null, 2));
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href", dataStr);
        dlAnchorElem.setAttribute("download", "exaguard_bank_soal.json");
        dlAnchorElem.click();
    },

    importQuestionsJSON: (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const fileName = file.name.toLowerCase();
        const applyImportedQuestions = (parsed, sourceLabel) => {
            if (parsed && parsed.length > 0) {
                AppState.questions = parsed;
                AppState.saveQuestions();
                AdminPanel.loadQuestionsManager();
                AdminPanel.renderExamControl();
                alert(`Bank Soal Berhasil di-Import! Berhasil mengimpor ${parsed.length} soal dari ${sourceLabel}.`);
            } else {
                alert(`Gagal mengimpor ${sourceLabel}. Pastikan format file berisi data soal yang valid.`);
            }
        };

        const reader = new FileReader();

        if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
            reader.onload = (evt) => {
                try {
                    const parsed = AdminPanel.parseWorkbookQuestions(evt.target.result);
                    applyImportedQuestions(parsed, "Excel/Quizizz");
                } catch (err) {
                    alert("Terjadi kesalahan saat memproses file Excel: " + err.message);
                } finally {
                    e.target.value = "";
                }
            };
            reader.onerror = () => {
                alert("Gagal membaca file Excel.");
                e.target.value = "";
            };
            reader.readAsArrayBuffer(file);
            return;
        }

        reader.onload = (evt) => {
            const fileText = evt.target.result;

            if (fileName.endsWith('.csv')) {
                try {
                    const parsed = AdminPanel.parseCSVQuestions(fileText);
                    applyImportedQuestions(parsed, "CSV");
                } catch (err) {
                    alert("Terjadi kesalahan saat memproses file CSV: " + err.message);
                }
            } else {
                try {
                    const parsed = JSON.parse(fileText);
                    if (Array.isArray(parsed)) {
                        const isValid = parsed.every(item => item.text && item.type && item.points && (item.correct !== undefined));
                        if (isValid) {
                            applyImportedQuestions(parsed, "JSON");
                        } else {
                            alert("Format JSON salah! Pastikan struktur bank soal sesuai standar.");
                        }
                    } else {
                        alert("File JSON harus berupa Array.");
                    }
                } catch (err) {
                    alert("Gagal membaca file JSON!");
                }
            }
            // Reset the input value so the same file can be imported again if needed
            e.target.value = "";
        };
        reader.readAsText(file);
    },

    parseWorkbookQuestions: (arrayBuffer) => {
        if (typeof XLSX === "undefined") {
            throw new Error("Library pembaca Excel belum termuat. Pastikan koneksi internet aktif, lalu muat ulang halaman admin.");
        }

        const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: false });
        let lastError = null;

        for (const sheetName of workbook.SheetNames) {
            const worksheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet, {
                header: 1,
                raw: false,
                blankrows: false,
                defval: ""
            });

            try {
                const parsed = AdminPanel.parseQuestionRows(rows);
                if (parsed.length > 0) {
                    return parsed;
                }
            } catch (err) {
                lastError = err;
            }
        }

        throw new Error(lastError ? lastError.message : "Tidak ditemukan sheet yang berisi soal.");
    },

    parseCSVQuestions: (text) => {
        // RFC 4180 compliant CSV parser with Excel-friendly delimiter detection.
        const normalizeCSVText = (rawText) => {
            let csvText = rawText.replace(/^\uFEFF/, "");
            let delimiter = ",";
            const firstLineEnd = csvText.search(/\r?\n/);
            const firstLine = (firstLineEnd === -1 ? csvText : csvText.slice(0, firstLineEnd)).trim();

            if (/^sep=./i.test(firstLine)) {
                delimiter = firstLine.slice(4, 5);
                csvText = firstLineEnd === -1 ? "" : csvText.slice(firstLineEnd).replace(/^\r?\n/, "");
            } else {
                const semicolonCount = (firstLine.match(/;/g) || []).length;
                const commaCount = (firstLine.match(/,/g) || []).length;
                if (semicolonCount > commaCount) {
                    delimiter = ";";
                }
            }

            return { csvText, delimiter };
        };

        const parseCSVRows = (rawText, delimiter = ",") => {
            const rows = [];
            let row = [""];
            let inQuotes = false;

            for (let i = 0; i < rawText.length; i++) {
                const c = rawText[i];
                const next = rawText[i + 1];
                if (c === '"') {
                    if (inQuotes && next === '"') {
                        row[row.length - 1] += '"';
                        i++;
                    } else {
                        inQuotes = !inQuotes;
                    }
                } else if (c === delimiter && !inQuotes) {
                    row.push("");
                } else if ((c === '\r' || c === '\n') && !inQuotes) {
                    if (c === '\r' && next === '\n') {
                        i++;
                    }
                    rows.push(row);
                    row = [""];
                } else {
                    row[row.length - 1] += c;
                }
            }
            if (row.length > 1 || row[0] !== "") {
                rows.push(row);
            }
            return rows;
        };

        const { csvText, delimiter } = normalizeCSVText(text);
        const rows = parseCSVRows(csvText, delimiter);
        return AdminPanel.parseQuestionRows(rows);
    },

    parseQuestionRows: (rows) => {
        if (!Array.isArray(rows) || rows.length === 0) {
            throw new Error("File kosong atau tidak memiliki data.");
        }

        const normalizedRows = rows.map(row => (Array.isArray(row) ? row : []).map(cell => String(cell ?? "").trim()));
        const header = AdminPanel.detectQuestionHeader(normalizedRows);
        const importedQuestions = [];

        for (let i = header.startRow; i < normalizedRows.length; i++) {
            const row = normalizedRows[i];
            if (!row || row.every(cell => cell === "")) continue;
            if (AdminPanel.isInstructionRow(row, header, i)) continue;

            const textVal = row[header.text] ? row[header.text].trim() : "";
            if (!textVal) continue;

            const optionIndexes = header.options.filter(index => index >= 0);
            const options = optionIndexes
                .map(index => row[index] ? row[index].trim() : "")
                .filter(Boolean);

            const typeRaw = header.type >= 0 ? row[header.type] : "";
            const typeVal = AdminPanel.normalizeQuestionType(typeRaw, options);
            const pointsRaw = header.points >= 0 ? row[header.points] : "";
            const parsedPoints = Number(String(pointsRaw).replace(",", "."));
            const pointsVal = Number.isFinite(parsedPoints) && parsedPoints > 0 ? parsedPoints : 10;
            const timeRaw = header.time >= 0 ? row[header.time] : "";
            const parsedTime = Number(String(timeRaw).replace(",", "."));
            const imageVal = header.image >= 0 && row[header.image] ? row[header.image].trim() : "";
            const correctRaw = header.correct >= 0 && row[header.correct] ? row[header.correct].trim() : "";

            const questionObj = {
                text: textVal,
                type: typeVal,
                points: pointsVal,
                image: imageVal
            };

            if (Number.isFinite(parsedTime) && parsedTime > 0) {
                questionObj.timeLimit = Math.floor(parsedTime);
            }

            if (typeVal === "mcq") {
                if (options.length < 2) continue;
                questionObj.options = options;
                questionObj.correct = AdminPanel.parseCorrectAnswerIndex(correctRaw, options);
            } else {
                questionObj.correct = correctRaw.toLowerCase();
            }

            importedQuestions.push(questionObj);
        }

        if (importedQuestions.length === 0) {
            throw new Error("Tidak ada soal valid yang bisa diimpor.");
        }

        return importedQuestions;
    },

    detectQuestionHeader: (rows) => {
        const defaultHeader = {
            startRow: 0,
            text: 0,
            type: 1,
            points: 2,
            options: [3, 4, 5, 6],
            correct: 7,
            image: 8,
            time: -1
        };

        let best = null;
        const maxScan = Math.min(rows.length, 10);

        for (let rowIdx = 0; rowIdx < maxScan; rowIdx++) {
            const row = rows[rowIdx] || [];
            const headers = row.map(AdminPanel.normalizeHeaderText);
            const findHeader = (aliases) => headers.findIndex(header => aliases.some(alias => header === alias || header.includes(alias)));

            const text = findHeader(["questiontext", "tekspertanyaan", "pertanyaan"]);
            const type = findHeader(["questiontype", "tipepertanyaan", "tipesoal", "tipe"]);
            const points = findHeader(["points", "poin", "nilai", "bobot"]);
            const time = findHeader(["timeinseconds", "timeseconds", "waktudetik", "durasi", "timer"]);
            const correct = findHeader(["correctanswer", "correctoption", "kuncijawaban", "jawabanbenar", "kunci"]);
            const image = findHeader(["imagelink", "imageurl", "urlgambar", "linkgambar", "gambar"]);
            const optionLetters = ["a", "b", "c", "d", "e"];
            const options = optionLetters.map((letter, idx) => findHeader([
                `option${idx + 1}`,
                `pilihan${letter}`,
                `opsi${letter}`
            ]));
            const optionCount = options.filter(index => index >= 0).length;
            const score = (text >= 0 ? 4 : 0) + optionCount + (correct >= 0 ? 2 : 0) + (type >= 0 ? 1 : 0);

            if (!best || score > best.score) {
                best = { rowIdx, score, text, type, points, time, options, correct, image };
            }
        }

        if (best && best.score >= 5 && best.text >= 0) {
            return {
                startRow: best.rowIdx + 1,
                text: best.text,
                type: best.type,
                points: best.points,
                time: best.time,
                options: best.options,
                correct: best.correct,
                image: best.image
            };
        }

        return defaultHeader;
    },

    normalizeHeaderText: (value) => String(value ?? "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, ""),

    isInstructionRow: (row, header, rowIdx) => {
        const normalizedText = AdminPanel.normalizeHeaderText(row[header.text] || "");
        const normalizedType = header.type >= 0 ? AdminPanel.normalizeHeaderText(row[header.type] || "") : "";
        const nearHeader = rowIdx <= header.startRow + 2;

        if (normalizedText === "questiontext" || normalizedText === "pertanyaan" || normalizedText === "tekspertanyaan") {
            return true;
        }

        return nearHeader && (
            normalizedText.includes("textofthequestion") ||
            normalizedText.includes("tulistekssoal") ||
            (normalizedText.includes("required") && normalizedType.includes("questiontype")) ||
            (normalizedText.includes("tulistekssoal") && normalizedType.includes("questiontype"))
        );
    },

    normalizeQuestionType: (value, options = []) => {
        const normalized = AdminPanel.normalizeHeaderText(value);

        if (normalized.includes("multiplechoice") || normalized.includes("pilihanganda") || normalized === "mcq") {
            return "mcq";
        }

        if (
            normalized.includes("essay") ||
            normalized.includes("openended") ||
            normalized.includes("shortanswer") ||
            normalized.includes("fillintheblank") ||
            normalized.includes("isian")
        ) {
            return "essay";
        }

        return options.length >= 2 ? "mcq" : "essay";
    },

    parseCorrectAnswerIndex: (rawValue, options) => {
        const raw = String(rawValue ?? "").trim();
        if (!raw) return 0;

        const firstToken = raw.split(/[,;|]/)[0].trim();
        const upper = firstToken.toUpperCase();
        const letterIdx = "ABCDE".indexOf(upper);
        if (letterIdx >= 0 && letterIdx < options.length) {
            return letterIdx;
        }

        const optionNumberMatch = firstToken.match(/(?:option|opsi|pilihan)\s*(\d+)/i);
        const numberText = optionNumberMatch ? optionNumberMatch[1] : firstToken;
        if (/^\d+$/.test(numberText)) {
            const numeric = Number(numberText);
            if (numeric >= 1 && numeric <= options.length) return numeric - 1;
            if (numeric >= 0 && numeric < options.length) return numeric;
        }

        const normalizedAnswer = AdminPanel.normalizeHeaderText(firstToken);
        const matchIdx = options.findIndex(option => AdminPanel.normalizeHeaderText(option) === normalizedAnswer);
        return matchIdx >= 0 ? matchIdx : 0;
    },

    loadSettingsForm: () => {
        document.getElementById("set-exam-duration").value = AppState.settings.duration;
        document.getElementById("set-max-warnings").value = AppState.settings.maxWarnings;
        document.getElementById("set-exam-token").value = AppState.settings.token;

        document.getElementById("policy-auto-submit-fullscreen").checked = AppState.settings.policyAutoSubmitFullscreen;
        document.getElementById("policy-show-score-end").checked = AppState.settings.policyShowScoreEnd;
        document.getElementById("policy-shuffle-questions").checked = AppState.settings.policyShuffleQuestions;
        document.getElementById("policy-enable-watermark").checked = AppState.settings.policyEnableWatermark;
    },

    saveSettingsForm: (e) => {
        e.preventDefault();

        AppState.settings.duration = Number(document.getElementById("set-exam-duration").value);
        AppState.settings.maxWarnings = Number(document.getElementById("set-max-warnings").value);
        AppState.settings.token = document.getElementById("set-exam-token").value.trim().toUpperCase();

        AppState.settings.policyAutoSubmitFullscreen = document.getElementById("policy-auto-submit-fullscreen").checked;
        AppState.settings.policyShowScoreEnd = document.getElementById("policy-show-score-end").checked;
        AppState.settings.policyShuffleQuestions = document.getElementById("policy-shuffle-questions").checked;
        AppState.settings.policyEnableWatermark = document.getElementById("policy-enable-watermark").checked;

        AppState.saveSettings();
        AdminPanel.renderExamControl();
        alert("Konfigurasi Berhasil Disimpan!");
    },

    getSubmittedResults: () => {
        const results = AdminPanel.getStoredSessions()
            .filter(std => std.status === "submitted" || std.status === "finished")
            .map(AdminPanel.normalizeResultRecord);

        results.sort((a, b) => (
            a.name.localeCompare(b.name, "id", { sensitivity: "base" }) ||
            a.nis.localeCompare(b.nis, "id", { numeric: true }) ||
            a.finishedAt.localeCompare(b.finishedAt)
        ));

        return results;
    },

    normalizeResultRecord: (res) => {
        const answerDetails = Array.isArray(res.answerDetails) ? res.answerDetails : AdminPanel.buildAnswerDetailsFromStoredAnswers(res);
        const derivedEarnedPoints = answerDetails.reduce((sum, detail) => sum + Number(detail.earnedPoints || 0), 0);
        const totalQuestions = Number(res.totalQuestions || (res.questionsOrder || []).length || AppState.questions.length || 0);
        const answeredCount = Number(res.answeredCount ?? Object.values(res.answers || {}).filter(value => value !== undefined && value !== null && String(value).trim() !== "").length);
        const storedTotalPoints = Number(res.totalScorePoints);
        const totalPoints = storedTotalPoints > 0
            ? storedTotalPoints
            : AppState.questions.reduce((sum, q) => sum + Number(q.points || 0), 0);
        const earnedPoints = Number(res.earnedPoints ?? derivedEarnedPoints);
        const score = Number(res.score || (totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0));
        const warnings = Number(res.warnings || 0);
        const finishedAt = res.endIso || "";

        return {
            ...res,
            sessionId: res.sessionId || `${res.examId || "LOCAL"}-${res.nis || ""}`,
            name: String(res.name || "-"),
            nis: String(res.nis || "-"),
            status: res.status || "-",
            score,
            earnedPoints,
            totalScorePoints: totalPoints,
            answeredCount,
            unansweredCount: Number(res.unansweredCount ?? Math.max(0, totalQuestions - answeredCount)),
            totalQuestions,
            warnings,
            warningHistory: Array.isArray(res.warningHistory) ? res.warningHistory : [],
            startDisplay: AdminPanel.formatResultDateTime(res.startIso, res.startDate, res.startTime),
            finishDisplay: AdminPanel.formatResultDateTime(res.endIso, res.endDate, res.endTime),
            finishedAt,
            durationDisplay: AdminPanel.formatDuration(res.durationSeconds),
            submitMethod: res.submitMethod || (res.forceReason ? "Paksa / Otomatis" : "Manual Siswa"),
            forceReason: res.forceReason || "",
            answerDetails
        };
    },

    formatResultDateTime: (iso, dateText, timeText) => {
        if (iso) {
            const date = new Date(iso);
            if (!Number.isNaN(date.getTime())) {
                return date.toLocaleString("id-ID", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                });
            }
        }

        return [dateText, timeText].filter(Boolean).join(" ") || "-";
    },

    formatDuration: (seconds) => {
        if (!Number.isFinite(Number(seconds))) return "-";
        const safeSeconds = Math.max(0, Number(seconds));
        const mins = Math.floor(safeSeconds / 60);
        const secs = safeSeconds % 60;
        if (mins < 60) return `${mins}m ${secs}s`;
        const hours = Math.floor(mins / 60);
        return `${hours}j ${mins % 60}m`;
    },

    getWarningText: (res) => {
        if (!res.warningHistory || res.warningHistory.length === 0) return "Normal, tidak ada pelanggaran.";
        return res.warningHistory.map(w => `[${w.time || "-"}] ${w.event || "-"}`).join("; ");
    },

    getQuestionAnswerDisplay: (question, answer) => {
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

    gradeStoredAnswer: (question, answer) => {
        const hasAnswer = answer !== undefined && answer !== null && String(answer).trim() !== "";
        if (!hasAnswer) return { isAnswered: false, isCorrect: false, earnedPoints: 0 };
        if (question.type === "mcq") {
            const isCorrect = Number(answer) === Number(question.correct);
            return { isAnswered: true, isCorrect, earnedPoints: isCorrect ? Number(question.points || 0) : 0 };
        }
        const isCorrect = String(answer).trim().toLowerCase() === String(question.correct ?? "").trim().toLowerCase();
        return { isAnswered: true, isCorrect, earnedPoints: isCorrect ? Number(question.points || 0) : 0 };
    },

    buildAnswerDetailsFromStoredAnswers: (res) => {
        const answers = res.answers || {};
        const order = Array.isArray(res.questionsOrder) ? res.questionsOrder : AppState.questions.map((_, idx) => idx);

        return AppState.questions.map((question, questionIdx) => {
            const grading = AdminPanel.gradeStoredAnswer(question, answers[questionIdx]);
            const displayIndex = order.indexOf(questionIdx);
            return {
                questionIndex: questionIdx,
                displayNumber: displayIndex >= 0 ? displayIndex + 1 : questionIdx + 1,
                type: question.type,
                questionText: question.text,
                studentAnswer: AdminPanel.getQuestionAnswerDisplay(question, answers[questionIdx]),
                correctAnswer: AdminPanel.getCorrectAnswerDisplay(question),
                isAnswered: grading.isAnswered,
                isCorrect: grading.isCorrect,
                earnedPoints: grading.earnedPoints,
                points: Number(question.points || 0),
                flagged: Boolean((res.flags || {})[questionIdx]),
                expired: false
            };
        });
    },

    renderResultSummaryCards: (results) => {
        const container = document.getElementById("results-summary-cards");
        if (!container) return;

        if (results.length === 0) {
            container.innerHTML = "";
            return;
        }

        const total = results.length;
        const avg = Math.round(results.reduce((sum, res) => sum + res.score, 0) / total);
        const highest = Math.max(...results.map(res => res.score));
        const attention = results.filter(res => res.warnings > 0 || res.unansweredCount > 0).length;

        container.innerHTML = `
            <div class="result-kpi-card">
                <span>Total Submit</span>
                <strong>${total}</strong>
            </div>
            <div class="result-kpi-card">
                <span>Rata-rata Nilai</span>
                <strong>${avg}</strong>
            </div>
            <div class="result-kpi-card">
                <span>Nilai Tertinggi</span>
                <strong>${highest}</strong>
            </div>
            <div class="result-kpi-card">
                <span>Perlu Dicek</span>
                <strong>${attention}</strong>
            </div>
        `;
    },

    loadResultsTable: (skipServerSync = false) => {
        if (!skipServerSync) {
            ServerSync.loadSessions().then(loaded => {
                if (loaded) AdminPanel.loadResultsTable(true);
            });
        }

        const tableBody = document.getElementById("results-table-body");
        tableBody.innerHTML = "";

        const results = AdminPanel.getSubmittedResults();
        AdminPanel.renderResultSummaryCards(results);

        if (results.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">Belum ada lembar jawaban siswa yang masuk ke daftar nilai.</td></tr>`;
            return;
        }

        results.forEach((res, idx) => {
            const tr = document.createElement("tr");
            const warningClass = res.warnings > 0
                ? (res.warnings >= AppState.settings.maxWarnings ? "danger" : "warning")
                : "success";
            const warningText = res.warnings > 0 ? `${res.warnings} kali` : "Bersih";
            const logsText = AdminPanel.getWarningText(res);
            const statusBadge = res.forceReason ? "warning" : "success";
            const scoreClass = res.score >= 75 ? "good" : (res.score >= 60 ? "mid" : "low");

            tr.innerHTML = `
                <td class="result-number">${idx + 1}</td>
                <td>
                    <div class="student-result-cell">
                        <strong>${TextHelper.escapeHtml(res.name)}</strong>
                        <span>NIS: ${TextHelper.escapeHtml(res.nis)}</span>
                    </div>
                </td>
                <td>
                    <span class="badge ${statusBadge}">${TextHelper.escapeHtml(res.submitMethod)}</span>
                    ${res.forceReason ? `<small class="result-subtext">${TextHelper.escapeHtml(res.forceReason)}</small>` : ""}
                </td>
                <td><span class="score-pill ${scoreClass}">${res.score}</span></td>
                <td><strong>${res.earnedPoints}</strong> / ${res.totalScorePoints}</td>
                <td>
                    <strong>${res.answeredCount} / ${res.totalQuestions}</strong>
                    <small class="result-subtext">${res.unansweredCount} belum dijawab</small>
                </td>
                <td>
                    <strong>${TextHelper.escapeHtml(res.finishDisplay)}</strong>
                    <small class="result-subtext">Mulai: ${TextHelper.escapeHtml(res.startDisplay)} | ${TextHelper.escapeHtml(res.durationDisplay)}</small>
                </td>
                <td><span class="badge ${warningClass}">${warningText}</span></td>
                <td><div class="result-log-preview" title="${TextHelper.escapeHtml(logsText)}">${TextHelper.escapeHtml(logsText)}</div></td>
            `;

            tableBody.appendChild(tr);
        });
    },

    buildResultExportRows: (results, generatedAt) => {
        const summaryRows = [
            ["REKAPITULASI NILAI UJIAN"],
            [`Dibuat: ${generatedAt.toLocaleString("id-ID")}`],
            [],
            ["No", "Nama Siswa", "NIS", "Status Submit", "Nilai Akhir", "Poin Benar", "Total Poin", "Terjawab", "Belum Dijawab", "Total Soal", "Mulai", "Selesai", "Durasi", "Peringatan", "Keterangan Pelanggaran", "ID Sesi"]
        ];

        results.forEach((res, idx) => {
            summaryRows.push([
                idx + 1,
                res.name,
                res.nis,
                res.submitMethod,
                res.score,
                res.earnedPoints,
                res.totalScorePoints,
                res.answeredCount,
                res.unansweredCount,
                res.totalQuestions,
                res.startDisplay,
                res.finishDisplay,
                res.durationDisplay,
                res.warnings,
                AdminPanel.getWarningText(res),
                res.sessionId
            ]);
        });

        const detailRows = [
            ["No", "Nama Siswa", "NIS", "No Soal Tampil", "No Soal Bank", "Tipe", "Pertanyaan", "Jawaban Siswa", "Kunci Jawaban", "Status", "Poin Didapat", "Poin Soal", "Ditandai Ragu", "Timer Habis"]
        ];

        results.forEach(res => {
            res.answerDetails.forEach((detail, idx) => {
                detailRows.push([
                    idx + 1,
                    res.name,
                    res.nis,
                    detail.displayNumber || "",
                    Number(detail.questionIndex) + 1,
                    detail.type === "mcq" ? "Pilihan Ganda" : "Isian",
                    detail.questionText || "",
                    detail.studentAnswer || "",
                    detail.correctAnswer || "",
                    detail.isAnswered ? (detail.isCorrect ? "Benar" : "Salah") : "Kosong",
                    Number(detail.earnedPoints || 0),
                    Number(detail.points || 0),
                    detail.flagged ? "Ya" : "Tidak",
                    detail.expired ? "Ya" : "Tidak"
                ]);
            });
        });

        const logRows = [
            ["No", "Nama Siswa", "NIS", "Waktu", "Kejadian"]
        ];

        results.forEach(res => {
            if (!res.warningHistory.length) {
                logRows.push([1, res.name, res.nis, "-", "Normal, tidak ada pelanggaran"]);
                return;
            }

            res.warningHistory.forEach((log, idx) => {
                logRows.push([idx + 1, res.name, res.nis, log.time || "-", log.event || "-"]);
            });
        });

        return { summaryRows, detailRows, logRows };
    },

    downloadBlob: (buffer, filename, mimeType) => {
        const blob = new Blob([buffer], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    styleExcelWorksheet: (worksheet, headerRowNumber, columnCount) => {
        worksheet.views = [{ state: "frozen", ySplit: headerRowNumber }];
        worksheet.autoFilter = {
            from: { row: headerRowNumber, column: 1 },
            to: { row: headerRowNumber, column: columnCount }
        };

        worksheet.eachRow((row, rowNumber) => {
            row.eachCell((cell) => {
                cell.alignment = {
                    vertical: "top",
                    horizontal: rowNumber === headerRowNumber ? "center" : "left",
                    wrapText: true
                };
                cell.border = {
                    top: { style: "thin", color: { argb: "FFE2E8F0" } },
                    left: { style: "thin", color: { argb: "FFE2E8F0" } },
                    bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
                    right: { style: "thin", color: { argb: "FFE2E8F0" } }
                };
            });
        });

        const header = worksheet.getRow(headerRowNumber);
        header.height = 28;
        header.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
            cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FF1E3A8A" }
            };
        });
    },

    exportResultsWithExcelJS: async (results, generatedAt) => {
        const { summaryRows, detailRows, logRows } = AdminPanel.buildResultExportRows(results, generatedAt);
        const workbook = new ExcelJS.Workbook();
        workbook.creator = "ExaGuard Pro";
        workbook.created = generatedAt;
        workbook.modified = generatedAt;

        const summarySheet = workbook.addWorksheet("Rekap Nilai", {
            views: [{ state: "frozen", ySplit: 4 }]
        });
        summarySheet.addRows(summaryRows);
        summarySheet.mergeCells("A1:P1");
        summarySheet.mergeCells("A2:P2");
        summarySheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
        summarySheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
        summarySheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
        summarySheet.getCell("A2").font = { italic: true, color: { argb: "FF475569" } };
        summarySheet.columns = [
            { width: 6 }, { width: 28 }, { width: 16 }, { width: 20 }, { width: 12 }, { width: 12 },
            { width: 12 }, { width: 11 }, { width: 14 }, { width: 11 }, { width: 24 }, { width: 24 },
            { width: 12 }, { width: 12 }, { width: 55 }, { width: 30 }
        ];
        AdminPanel.styleExcelWorksheet(summarySheet, 4, 16);

        summarySheet.eachRow((row, rowNumber) => {
            if (rowNumber <= 4) return;
            const score = Number(row.getCell(5).value || 0);
            row.getCell(5).font = { bold: true, color: { argb: score >= 75 ? "FF047857" : (score >= 60 ? "FFB45309" : "FFB91C1C") } };
            row.getCell(5).alignment = { horizontal: "center", vertical: "middle" };
        });

        const detailSheet = workbook.addWorksheet("Detail Jawaban");
        detailSheet.addRows(detailRows);
        detailSheet.columns = [
            { width: 6 }, { width: 28 }, { width: 16 }, { width: 13 }, { width: 12 }, { width: 16 },
            { width: 55 }, { width: 38 }, { width: 38 }, { width: 12 }, { width: 12 }, { width: 10 },
            { width: 14 }, { width: 12 }
        ];
        AdminPanel.styleExcelWorksheet(detailSheet, 1, 14);

        detailSheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const status = String(row.getCell(10).value || "");
            const color = status === "Benar" ? "FFDCFCE7" : (status === "Kosong" ? "FFF1F5F9" : "FFFEE2E2");
            row.getCell(10).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
            row.getCell(10).font = { bold: true };
        });

        const logSheet = workbook.addWorksheet("Log Pelanggaran");
        logSheet.addRows(logRows);
        logSheet.columns = [
            { width: 6 }, { width: 28 }, { width: 16 }, { width: 18 }, { width: 70 }
        ];
        AdminPanel.styleExcelWorksheet(logSheet, 1, 5);

        [summarySheet, detailSheet, logSheet].forEach(sheet => {
            sheet.properties.defaultRowHeight = 22;
            sheet.pageSetup = {
                orientation: "landscape",
                fitToPage: true,
                fitToWidth: 1,
                fitToHeight: 0
            };
        });

        const stamp = generatedAt.toISOString().slice(0, 19).replace(/[-:T]/g, "");
        const buffer = await workbook.xlsx.writeBuffer();
        AdminPanel.downloadBlob(
            buffer,
            `rekap_nilai_exaguard_${stamp}.xlsx`,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
    },

    exportResultsWithSheetJS: (results, generatedAt) => {
        const { summaryRows, detailRows, logRows } = AdminPanel.buildResultExportRows(results, generatedAt);
        const workbook = XLSX.utils.book_new();
        const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
        const detailSheet = XLSX.utils.aoa_to_sheet(detailRows);
        const logSheet = XLSX.utils.aoa_to_sheet(logRows);

        summarySheet["!merges"] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: 15 } },
            { s: { r: 1, c: 0 }, e: { r: 1, c: 15 } }
        ];
        summarySheet["!cols"] = [
            { wch: 5 }, { wch: 28 }, { wch: 16 }, { wch: 18 }, { wch: 12 }, { wch: 12 },
            { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 22 }, { wch: 22 },
            { wch: 12 }, { wch: 12 }, { wch: 45 }, { wch: 28 }
        ];
        detailSheet["!cols"] = [
            { wch: 5 }, { wch: 28 }, { wch: 16 }, { wch: 13 }, { wch: 12 }, { wch: 14 },
            { wch: 50 }, { wch: 36 }, { wch: 36 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
            { wch: 14 }, { wch: 12 }
        ];
        logSheet["!cols"] = [
            { wch: 5 }, { wch: 28 }, { wch: 16 }, { wch: 18 }, { wch: 60 }
        ];
        summarySheet["!autofilter"] = { ref: `A4:P${summaryRows.length}` };
        detailSheet["!autofilter"] = { ref: `A1:N${detailRows.length}` };
        logSheet["!autofilter"] = { ref: `A1:E${logRows.length}` };
        summarySheet["!freeze"] = { xSplit: 0, ySplit: 4 };
        detailSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
        logSheet["!freeze"] = { xSplit: 0, ySplit: 1 };

        XLSX.utils.book_append_sheet(workbook, summarySheet, "Rekap Nilai");
        XLSX.utils.book_append_sheet(workbook, detailSheet, "Detail Jawaban");
        XLSX.utils.book_append_sheet(workbook, logSheet, "Log Pelanggaran");

        const stamp = generatedAt.toISOString().slice(0, 19).replace(/[-:T]/g, "");
        XLSX.writeFile(workbook, `rekap_nilai_exaguard_${stamp}.xlsx`);
    },

    exportResultsExcel: async () => {
        await ServerSync.loadSessions();
        const results = AdminPanel.getSubmittedResults();
        if (results.length === 0) {
            alert("Tidak ada data siswa untuk di-export!");
            return;
        }

        const generatedAt = new Date();

        if (window.ExcelJS) {
            try {
                await AdminPanel.exportResultsWithExcelJS(results, generatedAt);
                return;
            } catch (err) {
                console.error("Export ExcelJS gagal, fallback ke SheetJS:", err);
            }
        }

        if (!window.XLSX) {
            alert("Library Excel belum termuat. Refresh halaman admin lalu coba lagi.");
            return;
        }

        AdminPanel.exportResultsWithSheetJS(results, generatedAt);
    },

    clearAllData: async () => {
        const verify = confirm("PERINGATAN KERAS! Tindakan ini akan menghapus seluruh data siswa, riwayat pengawasan live, dan rekapitulasi nilai ujian. Tindakan tidak dapat dibatalkan. Lanjutkan?");
        if (verify) {
            await ServerSync.clearSessions();
            localStorage.setItem("eg_proctoring_sessions", JSON.stringify([]));
            localStorage.removeItem("eg_active_session");
            localStorage.removeItem("eg_privacy_accepted");
            AdminPanel.loadProctoringLogs();
            AdminPanel.loadResultsTable();
            alert("Database dibersihkan!");
        }
    },

    beep: () => {
        try {
            const context = new (window.AudioContext || window.webkitAudioContext)();
            const osc = context.createOscillator();
            const gain = context.createGain();
            osc.type = "sawtooth";
            osc.frequency.setValueAtTime(320, context.currentTime);
            osc.frequency.exponentialRampToValueAtTime(100, context.currentTime + 0.3);
            gain.gain.setValueAtTime(0.4, context.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.3);
            osc.connect(gain);
            gain.connect(context.destination);
            osc.start();
            osc.stop(context.currentTime + 0.3);
        } catch(e) {}
    }
};

// 3. SCREEN VIEW MANAGER
const ViewManager = {
    showView: (viewId) => {
        document.querySelectorAll(".view-panel").forEach(panel => {
            if (panel.id === viewId) {
                panel.classList.add("active");
            } else {
                panel.classList.remove("active");
            }
        });
    }
};

// 4. ENTRY POINTS
document.addEventListener("DOMContentLoaded", () => {
    AppState.initLocalStorage();

    // Check Persistent Admin Session
    const savedAdminSession = localStorage.getItem("eg_admin_session");
    const bootSavedAdminSession = () => {
        if (savedAdminSession === "active") {
            document.getElementById("admin-login-view").classList.remove("active");
            document.getElementById("admin-view").classList.add("active");
            AdminPanel.initAdminView();
        }
    };
    AppState.loadServerState().finally(bootSavedAdminSession);

    // Submit handler - Passcode Login
    document.getElementById("admin-login-form").addEventListener("submit", AdminPanel.verifyAdminLogin);

    // Logout Button Handler
    document.getElementById("admin-logout-btn").addEventListener("click", () => {
        localStorage.removeItem("eg_admin_session");
        if (AppState.proctoringInterval) clearInterval(AppState.proctoringInterval);
        window.removeEventListener("storage", AdminPanel.handleStorageSyncEvent);
        
        // Reset View panels
        document.getElementById("admin-view").classList.remove("active");
        document.getElementById("admin-login-view").classList.add("active");
    });

    // Switch Tabs in Admin View
    document.querySelectorAll(".admin-nav-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const tabId = e.currentTarget.getAttribute("data-tab");
            AdminPanel.switchTab(tabId);
        });
    });

    // Exam Link & Start Controls
    document.getElementById("create-exam-link-btn").addEventListener("click", AdminPanel.createExamLink);
    document.getElementById("copy-exam-link-btn").addEventListener("click", AdminPanel.copyExamLink);
    document.getElementById("start-exam-session-btn").addEventListener("click", AdminPanel.startExamSession);
    document.getElementById("close-exam-session-btn").addEventListener("click", AdminPanel.closeExamSession);

    // Question Form Buttons
    document.getElementById("add-new-question-btn").addEventListener("click", AdminPanel.openNewQuestionForm);
    document.getElementById("cancel-question-btn").addEventListener("click", () => {
        document.getElementById("question-form-panel").classList.add("hidden");
    });
    document.getElementById("question-type").addEventListener("change", (e) => {
        AdminPanel.toggleQuestionTypeForm(e.target.value);
    });
    document.getElementById("question-editor-form").addEventListener("submit", AdminPanel.saveQuestionEditor);
    
    // Import/Export Questions
    document.getElementById("export-questions-btn").addEventListener("click", AdminPanel.exportQuestionsJSON);
    document.getElementById("import-questions-btn").addEventListener("click", () => {
        document.getElementById("question-file-input").click();
    });
    document.getElementById("question-file-input").addEventListener("change", AdminPanel.importQuestionsJSON);

    // Bulk Points Setter
    document.getElementById("apply-bulk-points-btn").addEventListener("click", AdminPanel.applyBulkPoints);

    // Settings Save
    document.getElementById("settings-basic-form").addEventListener("submit", AdminPanel.saveSettingsForm);

    // Export Results
    const exportResultsBtn = document.getElementById("export-results-excel-btn") || document.getElementById("export-results-csv-btn");
    if (exportResultsBtn) exportResultsBtn.addEventListener("click", AdminPanel.exportResultsExcel);
    document.getElementById("clear-all-data-btn").addEventListener("click", AdminPanel.clearAllData);

    // Image Upload Handlers
    document.getElementById("upload-image-trigger-btn").addEventListener("click", () => {
        document.getElementById("question-image-file").click();
    });

    document.getElementById("question-image-file").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            const base64Data = evt.target.result;
            document.getElementById("question-image-base64").value = base64Data;
            document.getElementById("form-image-preview").src = base64Data;
            document.getElementById("form-image-preview-box").classList.remove("hidden");
            document.getElementById("clear-uploaded-image-btn").classList.remove("hidden");
        };
        reader.readAsDataURL(file);
    });

    document.getElementById("clear-uploaded-image-btn").addEventListener("click", () => {
        document.getElementById("question-image-file").value = "";
        document.getElementById("question-image-base64").value = "";
        document.getElementById("form-image-preview").src = "";
        document.getElementById("form-image-preview-box").classList.add("hidden");
        document.getElementById("clear-uploaded-image-btn").classList.add("hidden");
    });
});
