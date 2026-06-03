const storage = require("./storage");

const MAX_BODY_BYTES = 25 * 1024 * 1024;

function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });
    res.end(body);
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", chunk => {
            body += chunk;
            if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
                reject(new Error("Payload terlalu besar"));
                req.destroy();
            }
        });
        req.on("end", () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(new Error("Format JSON tidak valid"));
            }
        });
        req.on("error", reject);
    });
}

async function handleApi(req, res, pathname) {
    if (req.method === "GET" && pathname === "/api/health") {
        const health = await storage.getHealth();
        return sendJson(res, health.ok ? 200 : 500, health);
    }

    if (req.method === "GET" && pathname === "/api/state") {
        const current = await storage.getState({ initialize: false });
        return sendJson(res, 200, {
            initialized: Boolean(current),
            settings: current ? current.settings : null,
            questions: current ? current.questions : null,
            sessions: current ? current.sessions : null,
            updatedAt: current ? current.updatedAt : null
        });
    }

    if (req.method === "GET" && pathname === "/api/sessions") {
        const current = await storage.getState({ initialize: true });
        return sendJson(res, 200, { sessions: current.sessions || [] });
    }

    if (req.method !== "POST") {
        return sendJson(res, 405, { error: "Method tidak didukung" });
    }

    let payload;
    try {
        payload = await readJsonBody(req);
    } catch (err) {
        return sendJson(res, 400, { error: err.message });
    }

    if (pathname === "/api/bootstrap") {
        const current = await storage.bootstrapState({
            settings: payload.settings || storage.DEFAULT_SETTINGS,
            questions: Array.isArray(payload.questions) ? payload.questions : storage.DEFAULT_QUESTIONS
        });
        return sendJson(res, 200, { ok: true, state: current });
    }

    if (pathname === "/api/settings") {
        const current = await storage.updateSettings(payload.settings || {});
        return sendJson(res, 200, { ok: true, state: current });
    }

    if (pathname === "/api/questions") {
        const current = await storage.updateQuestions(payload.questions || []);
        return sendJson(res, 200, { ok: true, state: current });
    }

    if (pathname === "/api/sessions/upsert") {
        const session = payload.session;
        if (!session || !session.nis) {
            return sendJson(res, 400, { error: "Data sesi siswa tidak valid" });
        }

        const result = await storage.upsertSession(session);
        return sendJson(res, 200, { ok: true, session: result.session, sessions: result.sessions });
    }

    if (pathname === "/api/sessions/clear") {
        const sessions = await storage.clearSessions();
        return sendJson(res, 200, { ok: true, sessions });
    }

    return sendJson(res, 404, { error: "Endpoint tidak ditemukan" });
}

module.exports = {
    handleApi,
    sendJson
};
