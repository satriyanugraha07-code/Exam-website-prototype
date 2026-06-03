const { handleApi, sendJson } = require("../api-handler");

module.exports = async function handler(req, res) {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url, `https://${host}`);

    try {
        await handleApi(req, res, url.pathname);
    } catch (err) {
        console.error(err);
        sendJson(res, 500, { error: "Server error" });
    }
};
