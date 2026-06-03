const fs = require("fs");
const path = require("path");

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const STATE_FILE = path.join(DATA_DIR, "exam-state.json");
const DATABASE_URL = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_DB_URL || "";
const MAIN_ID = process.env.EXAM_STATE_ID || "main";

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

const DEFAULT_QUESTIONS = [
    {
        text: "Siapakah penemu mesin uap yang memicu terjadinya Revolusi Industri?",
        type: "mcq",
        points: 20,
        options: ["Thomas Alva Edison", "James Watt", "Nikola Tesla", "Albert Einstein"],
        correct: 1
    },
    {
        text: "Planet manakah di tata surya kita yang posisinya paling dekat dengan Matahari?",
        type: "mcq",
        points: 20,
        options: ["Venus", "Merkurius", "Mars", "Yupiter"],
        correct: 1
    },
    {
        text: "Tuliskan nama ibu kota Negara Kesatuan Republik Indonesia saat ini.",
        type: "essay",
        points: 20,
        correct: "jakarta"
    }
];

let fileState = DATABASE_URL ? null : readStateFile();
let pgPool = null;
let databaseReady = null;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeState(raw = {}) {
    return {
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
        questions: Array.isArray(raw.questions) ? raw.questions : clone(DEFAULT_QUESTIONS),
        sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
        updatedAt: raw.updatedAt || raw.updated_at || new Date().toISOString()
    };
}

function readStateFile() {
    try {
        if (!fs.existsSync(STATE_FILE)) return null;
        const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
        return normalizeState(parsed);
    } catch (err) {
        console.warn("Gagal membaca data ujian lokal:", err.message);
        return null;
    }
}

function saveStateFile() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fileState.updatedAt = new Date().toISOString();
    fs.writeFileSync(STATE_FILE, JSON.stringify(fileState, null, 2));
}

function isDatabaseEnabled() {
    return Boolean(DATABASE_URL);
}

function shouldUseSsl() {
    const sslMode = String(process.env.PGSSLMODE || "").toLowerCase();
    return process.env.PGSSL !== "false" && sslMode !== "disable";
}

function getPgPool() {
    if (pgPool) return pgPool;

    let Pool;
    try {
        ({ Pool } = require("pg"));
    } catch (err) {
        throw new Error("DATABASE_URL sudah diisi, tetapi package 'pg' belum terpasang. Jalankan npm install.");
    }

    pgPool = new Pool({
        connectionString: DATABASE_URL,
        max: Number(process.env.PG_POOL_MAX || 10),
        ssl: shouldUseSsl() ? { rejectUnauthorized: false } : false
    });

    return pgPool;
}

async function initDatabase() {
    if (!isDatabaseEnabled()) return;

    if (!databaseReady) {
        databaseReady = (async () => {
            const pool = getPgPool();
            await pool.query(`
                CREATE TABLE IF NOT EXISTS exam_config (
                    id text PRIMARY KEY,
                    settings jsonb NOT NULL,
                    questions jsonb NOT NULL,
                    updated_at timestamptz NOT NULL DEFAULT now()
                );

                CREATE TABLE IF NOT EXISTS exam_sessions (
                    session_id text PRIMARY KEY,
                    nis text,
                    exam_id text,
                    payload jsonb NOT NULL,
                    updated_at timestamptz NOT NULL DEFAULT now()
                );

                CREATE INDEX IF NOT EXISTS exam_sessions_nis_idx ON exam_sessions (nis);
                CREATE INDEX IF NOT EXISTS exam_sessions_exam_id_idx ON exam_sessions (exam_id);
                CREATE INDEX IF NOT EXISTS exam_sessions_updated_at_idx ON exam_sessions (updated_at);
            `);
        })();
    }

    return databaseReady;
}

async function loadDatabaseState({ initialize = false, seed = null } = {}) {
    await initDatabase();

    const pool = getPgPool();
    const configResult = await pool.query(
        "SELECT settings, questions, updated_at FROM exam_config WHERE id = $1",
        [MAIN_ID]
    );

    if (configResult.rowCount === 0) {
        if (!initialize) return null;

        const nextState = normalizeState(seed || {});
        await insertDatabaseConfigIfMissing(nextState);
        return loadDatabaseState({ initialize: false });
    }

    const sessionsResult = await pool.query(
        "SELECT payload FROM exam_sessions ORDER BY updated_at ASC, session_id ASC"
    );
    const row = configResult.rows[0];
    const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at;

    return normalizeState({
        settings: row.settings,
        questions: row.questions,
        sessions: sessionsResult.rows.map(item => item.payload),
        updatedAt
    });
}

async function insertDatabaseConfigIfMissing(nextState) {
    const pool = getPgPool();
    await pool.query(
        `INSERT INTO exam_config (id, settings, questions, updated_at)
         VALUES ($1, $2::jsonb, $3::jsonb, now())
         ON CONFLICT (id) DO NOTHING`,
        [MAIN_ID, JSON.stringify(nextState.settings), JSON.stringify(nextState.questions)]
    );
}

async function saveDatabaseConfig(nextState) {
    const pool = getPgPool();
    await pool.query(
        `INSERT INTO exam_config (id, settings, questions, updated_at)
         VALUES ($1, $2::jsonb, $3::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET
            settings = EXCLUDED.settings,
            questions = EXCLUDED.questions,
            updated_at = now()`,
        [MAIN_ID, JSON.stringify(nextState.settings), JSON.stringify(nextState.questions)]
    );
}

function ensureFileState(seed = null) {
    if (!fileState) {
        fileState = normalizeState(seed || {});
        saveStateFile();
    }
    return fileState;
}

async function getState({ initialize = false, seed = null } = {}) {
    if (isDatabaseEnabled()) {
        return loadDatabaseState({ initialize, seed });
    }

    if (!fileState && initialize) {
        ensureFileState(seed);
    }

    return fileState ? normalizeState(fileState) : null;
}

async function bootstrapState(seed = {}) {
    const existing = await getState({ initialize: false });
    if (existing) return existing;

    const nextState = normalizeState(seed);

    if (isDatabaseEnabled()) {
        await initDatabase();
        await insertDatabaseConfigIfMissing(nextState);
        return loadDatabaseState({ initialize: true });
    }

    fileState = nextState;
    saveStateFile();
    return normalizeState(fileState);
}

async function updateSettings(settings = {}) {
    if (isDatabaseEnabled()) {
        const current = await loadDatabaseState({ initialize: true });
        const nextState = normalizeState({
            ...current,
            settings: { ...DEFAULT_SETTINGS, ...settings }
        });
        await saveDatabaseConfig(nextState);
        return loadDatabaseState({ initialize: true });
    }

    const current = ensureFileState();
    current.settings = { ...DEFAULT_SETTINGS, ...settings };
    saveStateFile();
    return normalizeState(current);
}

async function updateQuestions(questions = []) {
    const safeQuestions = Array.isArray(questions) ? questions : [];

    if (isDatabaseEnabled()) {
        const current = await loadDatabaseState({ initialize: true });
        const nextState = normalizeState({
            ...current,
            questions: safeQuestions
        });
        await saveDatabaseConfig(nextState);
        return loadDatabaseState({ initialize: true });
    }

    const current = ensureFileState();
    current.questions = safeQuestions;
    saveStateFile();
    return normalizeState(current);
}

async function upsertSession(session) {
    const nextSession = {
        ...session,
        sessionId: session.sessionId || `${session.examId || "LOCAL"}-${session.nis}`
    };

    if (isDatabaseEnabled()) {
        await loadDatabaseState({ initialize: true });
        const pool = getPgPool();
        await pool.query(
            `INSERT INTO exam_sessions (session_id, nis, exam_id, payload, updated_at)
             VALUES ($1, $2, $3, $4::jsonb, now())
             ON CONFLICT (session_id) DO UPDATE SET
                nis = EXCLUDED.nis,
                exam_id = EXCLUDED.exam_id,
                payload = EXCLUDED.payload,
                updated_at = now()`,
            [
                nextSession.sessionId,
                nextSession.nis || null,
                nextSession.examId || null,
                JSON.stringify(nextSession)
            ]
        );

        const current = await loadDatabaseState({ initialize: true });
        return { session: nextSession, sessions: current.sessions };
    }

    const current = ensureFileState();
    current.sessions = Array.isArray(current.sessions) ? current.sessions : [];
    current.sessions = current.sessions.filter(item => {
        if (item.sessionId) return item.sessionId !== nextSession.sessionId;
        return item.nis !== nextSession.nis;
    });
    current.sessions.push(nextSession);
    saveStateFile();

    return { session: nextSession, sessions: normalizeState(current).sessions };
}

async function clearSessions() {
    if (isDatabaseEnabled()) {
        await loadDatabaseState({ initialize: true });
        const pool = getPgPool();
        await pool.query("DELETE FROM exam_sessions");
        return [];
    }

    const current = ensureFileState();
    current.sessions = [];
    saveStateFile();
    return [];
}

async function getHealth() {
    const base = {
        ok: true,
        storageMode: isDatabaseEnabled() ? "database" : "local-file",
        databaseConfigured: isDatabaseEnabled(),
        timestamp: new Date().toISOString()
    };

    if (!isDatabaseEnabled()) {
        const current = await getState({ initialize: false });
        return {
            ...base,
            initialized: Boolean(current),
            sessionCount: current && Array.isArray(current.sessions) ? current.sessions.length : 0
        };
    }

    try {
        const current = await loadDatabaseState({ initialize: true });
        return {
            ...base,
            databaseConnected: true,
            initialized: Boolean(current),
            sessionCount: current && Array.isArray(current.sessions) ? current.sessions.length : 0
        };
    } catch (err) {
        return {
            ...base,
            ok: false,
            databaseConnected: false,
            error: err.message
        };
    }
}

module.exports = {
    DEFAULT_SETTINGS,
    DEFAULT_QUESTIONS,
    bootstrapState,
    clearSessions,
    getHealth,
    getState,
    isDatabaseEnabled,
    updateQuestions,
    updateSettings,
    upsertSession
};
