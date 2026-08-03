(function() {
    "use strict";

    function api() {
        return window.LeftWordleApi.client;
    }

    var LeftWordleAuth = {
        loggedIn: false,
        email: null,
        // Read directly by api_client.js's request() and attached as
        // X-CSRF-Token on state-changing calls. In-memory only -- refetched
        // from GET /profile on load, never persisted (the session cookie,
        // which IS persistent, is what actually keeps the account signed in
        // across reloads).
        csrfToken: null,
        ready: null
    };

    function applyProfile(profile) {
        LeftWordleAuth.loggedIn = true;
        LeftWordleAuth.email = profile.email || null;
        LeftWordleAuth.csrfToken = profile.csrf_token || null;
    }

    function clearSessionState() {
        LeftWordleAuth.loggedIn = false;
        LeftWordleAuth.email = null;
        LeftWordleAuth.csrfToken = null;
    }

    function requireWebauthnSupport() {
        if (!window.LeftWordleWebauthn || !window.LeftWordleWebauthn.isSupported()) {
            throw new Error("Passkeys are not supported in this browser");
        }
    }

    function guessDeviceNickname() {
        var ua = navigator.userAgent || "";
        if (/iPhone/.test(ua)) return "iPhone";
        if (/iPad/.test(ua)) return "iPad";
        if (/Android/.test(ua)) return "Android Device";
        if (/Macintosh/.test(ua)) return "Mac";
        if (/Windows/.test(ua)) return "Windows PC";
        return "Device";
    }

    LeftWordleAuth.isLoggedIn = function() {
        return LeftWordleAuth.loggedIn;
    };

    LeftWordleAuth.refreshProfile = async function() {
        try {
            var profile = await api().getProfile();
            applyProfile(profile);
            return profile;
        } catch (error) {
            clearSessionState();
            return null;
        }
    };

    LeftWordleAuth.register = async function(options) {
        requireWebauthnSupport();
        options = options || {};
        var beginPayload = {};
        if (options.email) beginPayload.email = options.email;

        var begin = await api().registerBegin(beginPayload);
        var credential = await window.LeftWordleWebauthn.createCredential(begin.options);
        var nickname = (options.nickname && options.nickname.trim()) || guessDeviceNickname();
        var finish = await api().registerFinish({ credential: credential, nickname: nickname });
        applyProfile(finish);
        return finish;
    };

    LeftWordleAuth.registerViaDeviceLink = async function(linkToken, nickname) {
        requireWebauthnSupport();
        var begin = await api().registerBegin({ device_link_token: linkToken });
        var credential = await window.LeftWordleWebauthn.createCredential(begin.options);
        var finalNickname = (nickname && nickname.trim()) || guessDeviceNickname();
        var finish = await api().registerFinish({ credential: credential, nickname: finalNickname });
        applyProfile(finish);
        return finish;
    };

    LeftWordleAuth.login = async function() {
        requireWebauthnSupport();
        var begin = await api().loginBegin();
        var credential = await window.LeftWordleWebauthn.getCredential(begin.options);
        var finish = await api().loginFinish({ credential: credential });
        applyProfile(finish);
        return finish;
    };

    LeftWordleAuth.logout = async function() {
        try {
            await api().logout();
        } finally {
            clearSessionState();
        }
    };

    LeftWordleAuth.guessDeviceNickname = guessDeviceNickname;

    LeftWordleAuth.listPasskeys = async function() {
        var result = await api().listPasskeys();
        return result.passkeys || [];
    };

    LeftWordleAuth.revokePasskey = async function(id) {
        return api().revokePasskey(id);
    };

    LeftWordleAuth.requestRecovery = async function(email) {
        return api().requestRecovery(email);
    };

    // GET /api/v2/history rows carry game_status/guesses but no `result`,
    // and everything local (getHistoryCompletionForPuzzle,
    // computeHistoryStats, exports) keys off `result` -- so server rows must
    // be translated back into the local entry shape before they're written
    // to localStorage. A WIN with no recorded guesses (e.g. an imported
    // game) has an unknowable guess count; result stays null and stats code
    // skips it, same as before.
    function serverHistoryToLocalHistory(serverHistory) {
        var local = {};
        Object.keys(serverHistory || {}).forEach(function(key) {
            var entry = serverHistory[key];
            if (!entry || entry.puzzle_num === undefined || entry.puzzle_num === null) return;
            var guesses = Array.isArray(entry.guesses) ? entry.guesses : [];
            var result = entry.game_status === "WIN" ? (guesses.length || null)
                : entry.game_status === "FAIL" ? 7 : null;
            local[String(entry.puzzle_num)] = {
                puzzle_num: entry.puzzle_num,
                date: entry.date || null,
                result: result,
                answer: null,
                mode: entry.mode || null,
                starter: guesses.length && Array.isArray(guesses[0]) ? guesses[0][0] : null,
                completed_at: entry.completed_at || null,
                updated_at: null,
                device_id: null,
                origin: "server"
            };
        });
        return local;
    }

    // Server is always the source of truth once an account exists -- this
    // is a full overwrite, never a merge, of this device's local cache.
    LeftWordleAuth.syncFromServerAndOverwriteLocal = async function() {
        var profile = await api().getProfile();
        applyProfile(profile);
        var history = await api().getHistory();
        StorageController.preferences.replace(profile.preferences || {});
        StorageController.gameState.replace(profile.game_state || {});
        StorageController.statistics.replace(profile.statistics || {});
        StorageController.history.replace(serverHistoryToLocalHistory(history));
        return profile;
    };

    LeftWordleAuth.serverHistoryToLocalHistory = serverHistoryToLocalHistory;

    var config = window.LEFT_WORDLE_CONFIG || {};
    LeftWordleAuth.ready = config.passkeyAuthEnabled
        ? LeftWordleAuth.refreshProfile()
        : Promise.resolve(null);

    window.LeftWordleAuth = LeftWordleAuth;
})();
