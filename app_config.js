(function() {
    "use strict";

    var host = window.location.hostname;
    var isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
    var defaults = {
        apiBaseUrl: isLocal ? "http://localhost:9292" : "https://api.left-wordle.com",
        // "same-origin" (not "omit") so the passkey session cookie -- which
        // is HttpOnly and never touched directly by client JS -- actually
        // gets sent once passkeyAuthEnabled is on. Never "include": this
        // app's deployments are same-origin, and blanket "include" would
        // send the cookie cross-origin too, which credentialed CORS isn't
        // set up for. Harmless today since no cookie exists until login.
        // Local dev is the exception: client (port 3000) and API (port
        // 9292) are different origins, so "same-origin" would silently
        // drop the pending-ceremony and session cookies. The API's CORS
        // config already echoes the specific origin with
        // Allow-Credentials: true (see api/app.rb cors_headers), so
        // "include" is safe here.
        apiCredentials: isLocal ? "include" : "same-origin",
        apiRequestTimeoutMs: 3000,
        passkeyAuthEnabled: true,
        serverSyncEnabled: true
    };

    window.LEFT_WORDLE_CONFIG = Object.freeze(Object.assign(
        {},
        defaults,
        window.LEFT_WORDLE_CONFIG || {}
    ));
})();
