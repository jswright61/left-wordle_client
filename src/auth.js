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
        ready: null,
        // Set by refreshProfile() when this device was logged in as of its
        // last visit (see AUTH_STATE_STORAGE_KEY below) but the session
        // didn't validate this time -- i.e. it expired or was revoked, as
        // opposed to a device that was never logged in. login_ui.js
        // consumes this once at boot to surface a toast, since silently
        // reverting to offline play is exactly the "app looks broken"
        // surprise online_play_redesign.md's offline indicator is meant to
        // prevent. Not set on an explicit logout -- the user already knows.
        sessionUnexpectedlyEnded: false,
        // In-memory only -- {preferences, game_state, statistics} from the
        // account's last GET /profile fetch. This is what an online device
        // reads for display (Stats screen, etc.) instead of
        // StorageController, since online play never writes account data
        // into local storage. Populated by refreshProfile() (boot) and
        // refreshCachedProfile() (right after login/register); cleared
        // whenever the session ends so a logged-out device never shows a
        // stale account's numbers.
        cachedProfile: null
    };

    // Persisted (not in-memory) so a fresh page load can tell "was logged
    // in last time, isn't now" apart from "never logged in on this
    // device" -- the distinction refreshProfile() needs to decide whether
    // an expired/revoked session is worth surfacing.
    var AUTH_STATE_STORAGE_KEY = "lastKnownAuthState";

    function rememberLoggedIn() {
        try { window.localStorage.setItem(AUTH_STATE_STORAGE_KEY, "logged_in"); } catch (e) {}
    }

    function forgetLoggedIn() {
        try { window.localStorage.removeItem(AUTH_STATE_STORAGE_KEY); } catch (e) {}
    }

    function wasPreviouslyLoggedIn() {
        try { return window.localStorage.getItem(AUTH_STATE_STORAGE_KEY) === "logged_in"; } catch (e) { return false; }
    }

    // Exposed so wordle.js can gate defining <game-app> until
    // LeftWordleAuth.ready resolves, but only on a device with a real
    // chance of being online -- see GameStateManager.getInitialGameState.
    // A device that's never logged in reads this as false and skips the
    // gate entirely: zero delay, zero change from today.
    LeftWordleAuth.wasPreviouslyLoggedIn = wasPreviouslyLoggedIn;

    function applyProfile(profile) {
        LeftWordleAuth.loggedIn = true;
        LeftWordleAuth.email = profile.email || null;
        LeftWordleAuth.csrfToken = profile.csrf_token || null;
        rememberLoggedIn();
    }

    // Separate from applyProfile because register/login finish responses
    // are minimal ({user_id, email, csrf_token}, no preferences/statistics)
    // -- only calls that fetch a *full* GET /profile should touch the
    // cache, or it'd get clobbered with undefined right after every login.
    function cacheProfile(profile) {
        LeftWordleAuth.cachedProfile = {
            preferences: profile.preferences || {},
            game_state: profile.game_state || {},
            statistics: profile.statistics || {}
        };
    }

    function clearSessionState() {
        LeftWordleAuth.loggedIn = false;
        LeftWordleAuth.email = null;
        LeftWordleAuth.csrfToken = null;
        LeftWordleAuth.cachedProfile = null;
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
            cacheProfile(profile);
            // Deliberately before flushPendingSync, not after: the queued
            // "preferences" job re-reads local storage at flush time (see
            // PENDING_RUNNERS below), so hydrating first means a retry
            // pushes the account's own values back up instead of fighting
            // them. The cost is that a pref change which never reached the
            // server before this boot loses to the server's copy -- that's
            // the same server-wins rule applied consistently, not a special
            // case, and it keeps local and remote in agreement immediately
            // rather than converging over the next couple of loads.
            LeftWordleAuth.applyAccountPreferences();
            // A successful call here proves the session and connectivity are
            // both good -- exactly the moment anything left over from a
            // previous offline stretch (see PENDING_RUNNERS below) should
            // get another chance to land.
            LeftWordleAuth.flushPendingSync();
            return profile;
        } catch (error) {
            LeftWordleAuth.sessionUnexpectedlyEnded = wasPreviouslyLoggedIn();
            clearSessionState();
            forgetLoggedIn();
            return null;
        }
    };

    // Fetches and caches the account's profile without refreshProfile's
    // session-invalidation side effects -- used right after a login/
    // register that just succeeded, where a failed profile fetch means
    // "try again", not "the session died" (the login call itself already
    // proved the session is good). login_ui.js's syncAndAnnounce uses this
    // instead of refreshProfile so a transient failure here can't
    // incorrectly clear a session that was just established.
    LeftWordleAuth.refreshCachedProfile = async function() {
        var profile = await api().getProfile();
        cacheProfile(profile);
        return profile;
    };

    // The one part of an account that going online *does* write into local
    // storage. History, statistics and the in-progress board deliberately do
    // not (see online_play_redesign.md) -- those are the ones where merging
    // two independent timelines is intractable, and where a device's local
    // play quietly becoming account data is the surprise that design exists
    // to prevent. Preferences have neither problem: the blob is already
    // whole-object last-writer-wins server-side (api/app.rb's
    // put_preferences_response), there is nothing to reconcile, and a setting
    // the account holds an opinion about should follow the player onto a new
    // device rather than silently reverting to that device's defaults.
    //
    // Consequence worth knowing: these values stay in local storage after a
    // logout, so an account's theme/hard mode remain in effect on a device
    // that has since gone offline. That's intended -- settings are not
    // gameplay data -- but it is a real difference from the "logout drops
    // straight back to the prior offline state" rule that still holds for
    // everything else.
    //
    // Called at session establishment (login) and confirmation (boot), NOT
    // from every refreshCachedProfile -- syncCompletion refreshes the cache
    // after each finished game purely for the stats counters, and re-pulling
    // preferences there could revert a local toggle whose push hasn't landed
    // yet.
    LeftWordleAuth.applyAccountPreferences = function() {
        if (!LeftWordleAuth.cachedProfile) return;
        StorageController.preferences.mergeFromServer(LeftWordleAuth.cachedProfile.preferences);
    };

    // One-shot: login_ui.js calls this at boot to decide whether to
    // surface the "you're playing offline now" toast, then clears the
    // flag so it doesn't fire again on a later reload of the same
    // still-logged-out device.
    LeftWordleAuth.consumeSessionUnexpectedlyEnded = function() {
        var value = LeftWordleAuth.sessionUnexpectedlyEnded;
        LeftWordleAuth.sessionUnexpectedlyEnded = false;
        return value;
    };

    // Reached mid-play (not just at boot) when a live online push comes
    // back 401 -- the session died between one guess and the next, not
    // just between page loads. `gameStateSnapshot`, if given, is the
    // caller's most recent local `saveGameState`-shaped board (wordle.js
    // stashes this on every guess) written to local storage exactly once
    // here -- the online->offline handoff. Without it, a session dying
    // mid-game would strand the in-progress board server-side with
    // nothing locally to resume from, since online play otherwise never
    // touches local storage. Sets sessionUnexpectedlyEnded so the caller
    // can immediately surface the toast via login_ui.js's
    // announceSessionExpiredIfNeeded (auth.js doesn't touch the DOM).
    LeftWordleAuth.handleSessionInvalidated = function(gameStateSnapshot) {
        if (gameStateSnapshot) {
            StorageController.gameState.replace(gameStateSnapshot);
        }
        LeftWordleAuth.sessionUnexpectedlyEnded = true;
        clearSessionState();
        forgetLoggedIn();
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
            forgetLoggedIn();
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
                // The server doesn't store game_id yet; the key is present
                // so every history entry has one consistent shape.
                game_id: null,
                origin: "server"
            };
        });
        return local;
    }

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
        },
        // A registration push (syncGameStateOnce) has no payload and reads
        // local storage, same "ignore payload, re-read current" shape as
        // "preferences". A live push while online (pushGameState) passes
        // the current in-memory board directly, since online play doesn't
        // write to local storage for the runner to fall back to reading.
        gameState: function(payload) {
            return api().putGameState(payload || StorageController.gameState.getAll());
        },
        snapshot: function(payload) {
            return api().postLocalStorageSnapshot(payload.event, payload.localStorage);
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
        // result is 1-6 (win in N), 7 (fail), or null/unknown -- e.g. a
        // server-originated WIN with no recorded guesses that came back
        // through a backup restore (see serverHistoryToLocalHistory).
        // Unknown must NOT default to FAIL: pushing a real win as a loss
        // corrupts the server-derived stats and streak. Send it with no
        // game_status instead -- the server still preserves the row, but
        // applies no stats for it (see api/app.rb import_history_row!).
        var result = Number(entry.result);
        var gameStatus = null;
        if (result >= 1 && result <= 6) gameStatus = "WIN";
        else if (result === 7) gameStatus = "FAIL";
        return {
            puzzle_num: entry.puzzle_num,
            date: entry.date,
            mode: entry.mode || "regular",
            game_status: gameStatus,
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
        return syncWithRetry("completion:" + puzzleNum, "completion", payload)
            // GameStats reads cachedProfile.statistics for a logged-in user
            // (see toolsmenu.js's Adjust Stats fix), which otherwise stays
            // stale from login/boot until the next full reload -- the just-
            // finished game's board is locally correct, but the aggregate
            // counters (games played, streak, distribution) wouldn't be.
            .then(function() { return LeftWordleAuth.refreshCachedProfile(); })
            .catch(function() {});
    };

    // One-time push of the current in-progress game, at registration only.
    LeftWordleAuth.syncGameStateOnce = function() {
        if (!LeftWordleAuth.isLoggedIn()) return Promise.resolve();
        return syncWithRetry("gameState", "gameState", null).catch(function() {});
    };

    // Live push of the current in-progress board, called after every guess
    // while online (wordle.js's evaluateRow). Queued-retry like the other
    // PENDING_RUNNERS-backed pushes -- unlike pushGameProgress below, a
    // dropped gameState push doesn't block the next guess, since it's a
    // secondary rendering convenience (cross-device resume of the board),
    // not the authoritative per-guess record (that's played_games, via
    // pushGameProgress/reportProgress).
    LeftWordleAuth.pushGameState = function(gameStateBlob) {
        if (!LeftWordleAuth.isLoggedIn()) return Promise.resolve();
        return syncWithRetry("gameState", "gameState", gameStateBlob).catch(function() {});
    };

    var PROGRESS_RETRY_DELAY_MS = 2000;

    function delay(ms) {
        return new Promise(function(resolve) { setTimeout(resolve, ms); });
    }

    // The new "every guess, every device" live save (see
    // online_play_redesign.md's "Playing online" section and this
    // session's extension of it to offline devices). Two entirely
    // different failure modes by design, not just by login state:
    //
    // - Offline: local storage is still this device's real source of
    //   truth, so a failed push is best-effort/fire-and-forget, same as
    //   anonymous completion reporting already is (wordle.js's
    //   _fireCompletionReport) -- a missed beat here is a missed
    //   analytics/abandoned-game signal, never data loss.
    // - Online: there is no local fallback, so the caller awaits this and
    //   is expected to block further input until it resolves. A network
    //   failure retries in place; a 401 specifically means the session
    //   died (not a transient blip), so it's handled via
    //   handleSessionInvalidated instead of retried forever.
    //
    // Deliberately NOT part of PENDING_RUNNERS/pendingSyncQueue -- that
    // queue is for "retry next time anything succeeds, whenever that is",
    // which is exactly the silent-reconciliation-later shape this session
    // chose not to have for live gameplay.
    LeftWordleAuth.pushGameProgress = async function(date, mode, guesses, gameStateSnapshot) {
        if (!LeftWordleAuth.isLoggedIn()) {
            return api().reportProgress(date, mode, guesses).catch(function() {});
        }

        for (;;) {
            try {
                await api().reportProgress(date, mode, guesses);
                return;
            } catch (error) {
                if (error && error.status === 401) {
                    LeftWordleAuth.handleSessionInvalidated(gameStateSnapshot);
                    return;
                }
                // Only transient failures (network/timeout/5xx -- the
                // ApiClientError retryable flag) are worth retrying in
                // place. Anything permanent (a 4xx) would loop forever
                // here with the caller blocking all input on this promise
                // (wordle.js's awaitingOnlineProgressSync) -- give up and
                // drop this beat instead; the queued pushGameState still
                // carries the full board.
                if (!error || error.retryable !== true) return;
                await delay(PROGRESS_RETRY_DELAY_MS);
            }
        }
    };

    // Audit-trail only (see api/app.rb's local_storage_snapshot_response) --
    // captures the client's pristine local storage before any other
    // registration push touches the account. Currently only ever called
    // with event "new user creation".
    LeftWordleAuth.syncNewUserSnapshot = function(localStorageDump) {
        if (!LeftWordleAuth.isLoggedIn()) return Promise.resolve();
        var payload = {event: "new user creation", localStorage: localStorageDump};
        return syncWithRetry("snapshot:new-user-creation", "snapshot", payload).catch(function() {});
    };

    // Shared by the restore-from-backup and new-registration push flows:
    // after pushing local history, compare a locally-computed gamesPlayed
    // figure against what the server could actually derive from it. A gap
    // means some of the local total is legacy/aggregate-only data with no
    // corresponding history entry -- not reconstructable via history import,
    // so it's surfaced rather than silently trusted. Best-effort: if the
    // comparison itself fails, don't guess, just skip it.
    LeftWordleAuth.statsDiscrepancyAfterPush = async function(localGamesPlayed) {
        if (!Number.isFinite(localGamesPlayed)) return null;
        try {
            var profile = await api().getProfile();
            var serverGamesPlayed = (profile && profile.statistics && Number.isFinite(profile.statistics.gamesPlayed))
                ? profile.statistics.gamesPlayed : 0;
            return (localGamesPlayed > serverGamesPlayed) ? {local: localGamesPlayed, server: serverGamesPlayed} : null;
        } catch (e) {
            return null;
        }
    };

    StorageController.preferences.onChange(LeftWordleAuth.syncPreferences);

    var config = window.LEFT_WORDLE_CONFIG || {};
    LeftWordleAuth.ready = config.passkeyAuthEnabled
        ? LeftWordleAuth.refreshProfile()
        : Promise.resolve(null);

    window.LeftWordleAuth = LeftWordleAuth;
})();
