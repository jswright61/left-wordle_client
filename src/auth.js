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
            // A successful call here proves the session and connectivity are
            // both good -- exactly the moment anything left over from a
            // previous offline stretch (see PENDING_RUNNERS below) should
            // get another chance to land.
            LeftWordleAuth.flushPendingSync();
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
            // A pending push belongs to the account being logged out of, and
            // can't be retried without its session -- drop it rather than
            // risk it landing against a different account that later logs
            // in on this same device/browser.
            writePendingQueue([]);
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

    // Push-up counterparts to syncFromServerAndOverwriteLocal: once an
    // account exists, local writes at gameplay checkpoints (a preference
    // change, a completed puzzle) should reach the server too, not just
    // sit in this device's localStorage until the next explicit sync-down.
    // In-progress game state (mid-puzzle guesses) is intentionally not
    // synced live; only settled, completed data is pushed.
    //
    // Statistics are never pushed as a client-computed blob -- the server
    // derives gamesPlayed/gamesWon/streak itself from each played_games
    // event (see api/app.rb's apply_played_game_to_statistics!), so a
    // completed game reaching the server via syncHistoryEntry is what
    // actually moves the numbers, not a separate stats push.
    //
    // Every push below is retry-on-failure rather than fire-and-forget: a
    // failed call is queued (see PENDING_RUNNERS/flushPendingSync) and
    // retried the next time any sync call succeeds, which is what "re-sync
    // after offline" amounts to -- no separate reconnect/offline-detection
    // state machine.
    var PENDING_SYNC_STORAGE_KEY = "pendingSyncQueue";

    function readPendingQueue() {
        try {
            var parsed = JSON.parse(window.localStorage.getItem(PENDING_SYNC_STORAGE_KEY) || "[]");
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    function writePendingQueue(queue) {
        try {
            window.localStorage.setItem(PENDING_SYNC_STORAGE_KEY, JSON.stringify(queue));
        } catch (e) {
            // localStorage unavailable/full -- this job just won't survive a
            // reload, same as if it had never been queued.
        }
    }

    function enqueuePending(key, type, payload) {
        var queue = readPendingQueue().filter(function(job) { return job.key !== key; });
        queue.push({key: key, type: type, payload: payload});
        writePendingQueue(queue);
    }

    function dequeuePending(key) {
        var queue = readPendingQueue();
        var next = queue.filter(function(job) { return job.key !== key; });
        if (next.length !== queue.length) writePendingQueue(next);
    }

    // Looked up by job.type at flush time, so queued job descriptors stay
    // plain JSON (safe to persist across a reload) instead of holding an
    // actual function reference. "preferences" ignores its payload and
    // re-reads current localStorage on every attempt -- a retry should push
    // whatever the device's newest intent is, not a stale snapshot from
    // whenever it first failed.
    var PENDING_RUNNERS = {
        preferences: function() {
            return api().putPreferences(StorageController.preferences.getAll());
        },
        history: function(payload) {
            return api().importHistory([payload]);
        },
        historyBulk: function(payload) {
            return api().importHistory(payload);
        },
        completion: function(payload) {
            return api().reportCompletion(payload.date, payload.puzzleNum, payload.mode, payload.gameStatus, payload.guesses);
        }
    };

    var flushingPendingQueue = false;

    // Retries every queued job once, dropping whichever succeed and leaving
    // the rest queued. Re-entrant calls while one is already in flight are a
    // no-op. Every job here is naturally safe to replay (a preferences PUT
    // is a full overwrite, a history import dedupes server-side by
    // client_device_id+date), so retrying a job that actually already
    // landed is harmless.
    LeftWordleAuth.flushPendingSync = async function() {
        if (flushingPendingQueue || !LeftWordleAuth.isLoggedIn()) return;
        var queue = readPendingQueue();
        if (!queue.length) return;

        flushingPendingQueue = true;
        try {
            var remaining = [];
            for (var i = 0; i < queue.length; i++) {
                var job = queue[i];
                var runner = PENDING_RUNNERS[job.type];
                try {
                    if (runner) await runner(job.payload);
                } catch (e) {
                    remaining.push(job);
                }
            }
            writePendingQueue(remaining);
        } finally {
            flushingPendingQueue = false;
        }
    };

    function syncWithRetry(key, type, payload) {
        var runner = PENDING_RUNNERS[type];
        return runner(payload).then(function(result) {
            dequeuePending(key);
            LeftWordleAuth.flushPendingSync();
            return result;
        }).catch(function(error) {
            enqueuePending(key, type, payload);
            throw error;
        });
    }

    LeftWordleAuth.syncPreferences = function() {
        if (!LeftWordleAuth.isLoggedIn()) return Promise.resolve();
        return syncWithRetry("preferences", "preferences", null).catch(function() {});
    };

    // entry shape (agreed client<->API contract, see api/app.rb
    // import_history_row!): {puzzle_num, date, mode, game_status
    // ("WIN"/"FAIL"), completed_at}.
    function toHistoryImportPayload(entry) {
        return {
            puzzle_num: entry.puzzle_num,
            date: entry.date,
            mode: entry.mode || "regular",
            game_status: (entry.result >= 1 && entry.result <= 6) ? "WIN" : "FAIL",
            completed_at: entry.completed_at || null
        };
    }

    LeftWordleAuth.syncHistoryEntry = function(entry) {
        if (!LeftWordleAuth.isLoggedIn() || !entry) return Promise.resolve();
        var payload = toHistoryImportPayload(entry);
        return syncWithRetry("history:" + payload.puzzle_num, "history", payload).catch(function() {});
    };

    // Bulk variant for pushing a whole history dump at once (e.g. after a
    // local restore-from-backup while logged in).
    LeftWordleAuth.syncHistoryEntries = function(entries) {
        if (!LeftWordleAuth.isLoggedIn() || !entries || !entries.length) return Promise.resolve();
        var payload = entries.map(toHistoryImportPayload);
        return syncWithRetry("historyBulk", "historyBulk", payload).catch(function() {});
    };

    // /api/v1/game/complete reporting (wordle.js's _fireCompletionReport).
    // Retry-queued the same as the other pushes when logged in; anonymous
    // play keeps the old fire-and-forget behavior in wordle.js since there's
    // no account for a queued retry to eventually reconcile against.
    LeftWordleAuth.syncCompletion = function(date, puzzleNum, mode, gameStatus, guesses) {
        if (!LeftWordleAuth.isLoggedIn()) return Promise.resolve();
        var payload = {date: date, puzzleNum: puzzleNum, mode: mode, gameStatus: gameStatus, guesses: guesses};
        return syncWithRetry("completion:" + puzzleNum, "completion", payload).catch(function() {});
    };

    StorageController.preferences.onChange(LeftWordleAuth.syncPreferences);

    var config = window.LEFT_WORDLE_CONFIG || {};
    LeftWordleAuth.ready = config.passkeyAuthEnabled
        ? LeftWordleAuth.refreshProfile()
        : Promise.resolve(null);

    window.LeftWordleAuth = LeftWordleAuth;
})();
