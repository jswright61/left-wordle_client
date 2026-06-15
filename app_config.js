(function() {
    "use strict";

    var host = window.location.hostname;
    var isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
    var defaults = {
        apiBaseUrl: isLocal ? "http://localhost:9292" : "https://api.left-wordle.com",
        apiCredentials: "omit",
        apiGameplayEnabled: false,
        apiGameplayShadowMode: false,
        apiRequestTimeoutMs: 3000,
        localGameplayFallbackEnabled: true,
        passkeyAuthEnabled: false,
        serverSyncEnabled: false
    };

    window.LEFT_WORDLE_CONFIG = Object.freeze(Object.assign(
        {},
        defaults,
        window.LEFT_WORDLE_CONFIG || {}
    ));
})();
