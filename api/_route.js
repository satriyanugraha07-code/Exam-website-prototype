const { handleApi, sendJson } = require("../api-handler");

module.exports = async function routeApi(req, res, pathname) {
    try {
        await handleApi(req, res, pathname);
    } catch (err) {
        console.error(err);
        sendJson(res, 500, { error: "Server error" });
    }
};
