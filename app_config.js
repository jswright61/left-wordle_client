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
        apiCredentials: "same-origin",
        apiRequestTimeoutMs: 3000,
        passkeyAuthEnabled: false,
        serverSyncEnabled: false
    };

    window.LEFT_WORDLE_CONFIG = Object.freeze(Object.assign(
        {},
        defaults,
        window.LEFT_WORDLE_CONFIG || {}
    ));
})();
