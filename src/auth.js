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

    // Translates the client's local history entries into the
    // {puzzle_num, date, mode, game_status, completed_at, device_id} shape
    // the server's /import/local_data and /history/import endpoints expect
    // (see api/app.rb import_history_row!). game_status is normalized to
    // "WIN"/"FAIL" here -- only the client understands its own local
    // `result` encoding (1-6 for a win in that many guesses, anything else
    // for a loss), so that translation belongs on this side of the wire.
    function historyEntriesForUpload() {
        var all = StorageController.history.getAll();
        return Object.keys(all).map(function(key) {
            var entry = all[key] || {};
            var isWin = typeof entry.result === "number" && entry.result >= 1 && entry.result <= 6;
            return {
                puzzle_num: entry.puzzle_num,
                date: entry.date,
                mode: entry.mode || "regular",
                game_status: isWin ? "WIN" : "FAIL",
                completed_at: entry.completed_at || null,
                device_id: entry.device_id || StorageController.deviceId.get()
            };
        });
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
        var finish = await api().registerFinish({ credential: credential, nickname: guessDeviceNickname() });
        applyProfile(finish);
        return finish;
    };

    LeftWordleAuth.registerViaDeviceLink = async function(linkToken) {
        requireWebauthnSupport();
        var begin = await api().registerBegin({ device_link_token: linkToken });
        var credential = await window.LeftWordleWebauthn.createCredential(begin.options);
        var finish = await api().registerFinish({ credential: credential, nickname: guessDeviceNickname() });
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

    // One-time upload for a brand-new account, gated by user confirmation
    // in the UI layer. The server itself also enforces one-time-ness
    // (409 if users.imported_at is already set) as a defense against a
    // buggy or replaying client, not just this client-side gate.
    LeftWordleAuth.importLocalData = async function() {
        return api().importLocalData({
            history: historyEntriesForUpload(),
            preferences: StorageController.preferences.getAll(),
            game_state: StorageController.gameState.getAll(),
            statistics: StorageController.statistics.getAll(),
            // Not restored into any account column server-side -- along for
            // the ride into the storage_snapshots audit row only, as an
            // extra safety net during the login-backend rollout (see
            // api/app.rb import_local_data_response).
            settings_backup: StorageController.settingsBackup.get() || {}
        });
    };

    // Server is always the source of truth once an account exists -- this
    // is a full overwrite, never a merge, of this device's local cache.
    LeftWordleAuth.syncFromServerAndOverwriteLocal = async function() {
        var profile = await api().getProfile();
        applyProfile(profile);
        var history = await api().getHistory();
        StorageController.preferences.replace(profile.preferences || {});
        StorageController.gameState.replace(profile.game_state || {});
        StorageController.statistics.replace(profile.statistics || {});
        StorageController.history.replace(history || {});
        return profile;
    };

    var config = window.LEFT_WORDLE_CONFIG || {};
    LeftWordleAuth.ready = config.passkeyAuthEnabled
        ? LeftWordleAuth.refreshProfile()
        : Promise.resolve(null);

    window.LeftWordleAuth = LeftWordleAuth;
})();
