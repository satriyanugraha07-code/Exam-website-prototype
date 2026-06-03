const http = require("http");
const fs = require("fs");
const path = require("path");
const { handleApi, sendJson } = require("./api-handler");
const storage = require("./storage");

const PORT = Number(process.env.PORT || 8002);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT_DIR = __dirname;

function serveStatic(req, res, pathname) {
    const cleanPath = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.normalize(path.join(ROOT_DIR, cleanPath));

    if (!filePath.startsWith(ROOT_DIR)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end("Not found");
            return;
        }

        res.writeHead(200, {
            "Content-Type": getContentType(filePath),
            "Cache-Control": "no-store"
        });
        res.end(data);
    });
}

function getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".csv": "text/csv; charset=utf-8",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml"
    };
    return types[ext] || "application/octet-stream";
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
        handleApi(req, res, url.pathname).catch(err => {
            console.error(err);
            sendJson(res, 500, { error: "Server error" });
        });
        return;
    }

    serveStatic(req, res, decodeURIComponent(url.pathname));
});

server.listen(PORT, HOST, () => {
    console.log(`ExaGuard server aktif di http://${HOST}:${PORT}`);
    console.log(`Penyimpanan: ${storage.isDatabaseEnabled() ? "Postgres/Supabase" : "file JSON lokal"}`);
    console.log(`Buka admin: http://localhost:${PORT}/admin.html`);
});
