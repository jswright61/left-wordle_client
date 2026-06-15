"use strict";

// ─── Class 1: SyncDataLogic ───────────────────────────────────────────────────
// Pure data logic — no DOM, no localStorage, no Supabase.
class SyncDataLogic {
    // ── Time / format ──

    safeParseJSON(str, fallback) {
        if (str === null || str === undefined) return fallback;
        try {
            return JSON.parse(str);
        } catch (e) {
            return fallback;
        }
    }

    toMs(value) {
        if (!value) return 0;
        if (typeof value === "number") return value;
        var parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    toIso(ms) {
        if (!ms) return null;
        return new Date(ms).toISOString();
    }

    formatLocalDate(date) {
        var year = date.getFullYear();
        var month = String(date.getMonth() + 1).padStart(2, "0");
        var day = String(date.getDate()).padStart(2, "0");
        return "".concat(year, "-").concat(month, "-").concat(day);
    }

    getTodayDateString() {
        return this.formatLocalDate(new Date());
    }

    // ── Normalization ──

    normalizeHistory(history) {
        if (!history) return {};
        if (Array.isArray(history)) {
            return history.reduce(function(acc, entry) {
                if (entry && entry.puzzle_num !== undefined && entry.puzzle_num !== null) {
                    acc[String(entry.puzzle_num)] = entry;
                }
                return acc;
            }, {});
        }
        if (typeof history === "object") return history;
        return {};
    }

    normalizeGameStateForSync(state) {
        if (!state || typeof state !== "object") return null;
        var puzzleNumRaw = state.puzzleNum;
        if (puzzleNumRaw === undefined || puzzleNumRaw === null) puzzleNumRaw = state.puzzle_num;
        var puzzleNum = Number(puzzleNumRaw);
        if (!Number.isFinite(puzzleNum)) return null;

        var date = typeof state.date === "string" ? state.date : null;
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

        return {
            puzzleNum: puzzleNum,
            date: date,
            rowIndex: Number.isFinite(Number(state.rowIndex)) ? Number(state.rowIndex) : 0,
            boardState: Array.isArray(state.boardState) ? state.boardState : [],
            evaluations: Array.isArray(state.evaluations) ? state.evaluations : [],
            solution: state.solution || null,
            gameStatus: state.gameStatus || null,
            hardMode: state.hardMode === true,
            lastPlayedTs: this.toMs(state.lastPlayedTs),
            lastCompletedTs: this.toMs(state.lastCompletedTs),
            updatedAt: this.toMs(state.updatedAt || state.updated_at || Date.now())
        };
    }

    normalizeRedirectPath(path) {
        var redirectPath = (typeof path === "string" && path.trim()) ? path.trim() : "/sync-resolve";
        return redirectPath.charAt(0) === "/" ? redirectPath : "/" + redirectPath;
    }

    // ── Game state comparison ──

    isCompletedStatus(status) {
        return status === "WIN" || status === "FAIL";
    }

    getBoardRow(state, rowIndex) {
        if (!state || !Array.isArray(state.boardState)) return "";
        if (rowIndex < 0 || rowIndex >= state.boardState.length) return "";
        var row = state.boardState[rowIndex];
        return typeof row === "string" ? row : "";
    }

    getEvaluationRow(state, rowIndex) {
        if (!state || !Array.isArray(state.evaluations)) return null;
        if (rowIndex < 0 || rowIndex >= state.evaluations.length) return null;
        return state.evaluations[rowIndex] || null;
    }

    areGameStateRowsEqual(leftState, rightState, rowIndex) {
        return (
            this.getBoardRow(leftState, rowIndex) === this.getBoardRow(rightState, rowIndex) &&
            JSON.stringify(this.getEvaluationRow(leftState, rowIndex)) === JSON.stringify(this.getEvaluationRow(rightState, rowIndex))
        );
    }

    isRemoteInProgressPrefixOfLocal(remoteState, localState) {
        if (!remoteState || !localState) return false;
        if (remoteState.gameStatus !== "IN_PROGRESS") return false;
        if (remoteState.date !== localState.date) return false;
        if (remoteState.puzzleNum !== localState.puzzleNum) return false;

        var remoteRows = Math.max(0, Number(remoteState.rowIndex) || 0);
        var localRows = Math.max(0, Number(localState.rowIndex) || 0);
        if (localRows < remoteRows) return false;

        var i;
        for (i = 0; i < remoteRows; i += 1) {
            if (!this.areGameStateRowsEqual(remoteState, localState, i)) return false;
        }

        var remoteActive = this.getBoardRow(remoteState, remoteRows);
        if (remoteActive.length) {
            var localAtRemoteActive = this.getBoardRow(localState, remoteRows);
            if (!localAtRemoteActive.startsWith(remoteActive)) return false;
        }

        return true;
    }

    areGameStatesEquivalent(leftState, rightState) {
        if (!leftState || !rightState) return false;
        return (
            leftState.puzzleNum === rightState.puzzleNum &&
            leftState.date === rightState.date &&
            (Number(leftState.rowIndex) || 0) === (Number(rightState.rowIndex) || 0) &&
            JSON.stringify(leftState.boardState || []) === JSON.stringify(rightState.boardState || []) &&
            JSON.stringify(leftState.evaluations || []) === JSON.stringify(rightState.evaluations || []) &&
            leftState.solution === rightState.solution &&
            leftState.gameStatus === rightState.gameStatus &&
            (leftState.hardMode === true) === (rightState.hardMode === true)
        );
    }

    shouldApplyRemoteGameState(localState, remoteState) {
        if (!localState) return true;

        if (this.areGameStatesEquivalent(localState, remoteState)) return false;

        var today = this.getTodayDateString();
        if (localState.date !== remoteState.date) {
            if (remoteState.date === today && localState.date !== today) return true;
            return false;
        }

        if (localState.puzzleNum !== remoteState.puzzleNum) {
            return true;
        }

        var localCompleted = this.isCompletedStatus(localState.gameStatus);
        var remoteCompleted = this.isCompletedStatus(remoteState.gameStatus);

        // Never overwrite a local completed game with an in-progress remote state.
        if (localCompleted && !remoteCompleted) return false;

        if (remoteCompleted) return true;

        if (remoteState.gameStatus === "IN_PROGRESS") {
            return !this.isRemoteInProgressPrefixOfLocal(remoteState, localState);
        }

        return true;
    }

    shouldPushLocalGameState(remoteState, localState) {
        if (!localState) return false;
        if (!remoteState) return true;

        var today = this.getTodayDateString();
        if (remoteState.date !== localState.date || remoteState.puzzleNum !== localState.puzzleNum) {
            return localState.date === today && remoteState.date !== today;
        }

        if (this.areGameStatesEquivalent(remoteState, localState)) return false;

        if (this.isCompletedStatus(remoteState.gameStatus)) return false;

        // Local completed state should always overwrite remote in-progress.
        if (this.isCompletedStatus(localState.gameStatus)) return true;

        if (remoteState.gameStatus !== "IN_PROGRESS") return false;
        if (!this.isRemoteInProgressPrefixOfLocal(remoteState, localState)) return false;
        return true;
    }

    // ── History comparison ──

    historyEntriesEqual(leftEntry, rightEntry) {
        if (!leftEntry || !rightEntry) return false;
        return (
            Number(leftEntry.puzzle_num) === Number(rightEntry.puzzle_num) &&
            (leftEntry.date || null) === (rightEntry.date || null) &&
            Number(leftEntry.result) === Number(rightEntry.result) &&
            (leftEntry.answer || null) === (rightEntry.answer || null) &&
            (leftEntry.mode || null) === (rightEntry.mode || null) &&
            (leftEntry.starter || null) === (rightEntry.starter || null) &&
            this.toMs(leftEntry.completed_at) === this.toMs(rightEntry.completed_at) &&
            (leftEntry.device_id || null) === (rightEntry.device_id || null)
        );
    }

    mergeRemoteHistory(localHistory, remoteRows) {
        var self = this;
        var history = Object.assign({}, localHistory);
        var changed = false;

        remoteRows.forEach(function(row) {
            var remoteEntry = self.rowToHistoryEntry(row);
            var key = String(remoteEntry.puzzle_num);
            var existing = history[key];
            if (!existing) {
                history[key] = remoteEntry;
                changed = true;
                return;
            }

            if (!self.historyEntriesEqual(existing, remoteEntry)) {
                history[key] = remoteEntry;
                changed = true;
            }
        });

        return { history: history, changed: changed };
    }

    // ── Row transformations ──

    rowToHistoryEntry(row) {
        return {
            puzzle_num: row.puzzle_num,
            date: row.date,
            result: row.result,
            answer: row.answer || null,
            mode: row.mode || null,
            starter: row.starter || null,
            completed_at: this.toMs(row.completed_at),
            updated_at: this.toMs(row.updated_at),
            device_id: row.device_id || null
        };
    }

    historyEntryToRow(entry, userId) {
        var updatedAt = this.toMs(entry.updated_at) || Date.now();
        var completedAt = this.toMs(entry.completed_at) || updatedAt;
        return {
            user_id: userId,
            puzzle_num: entry.puzzle_num,
            date: entry.date,
            result: entry.result,
            answer: entry.answer || null,
            mode: entry.mode || null,
            starter: entry.starter || null,
            completed_at: this.toIso(completedAt),
            updated_at: this.toIso(updatedAt),
            device_id: entry.device_id || null
        };
    }

    gameStateToRow(state, userId, deviceId) {
        var normalized = this.normalizeGameStateForSync(state);
        if (!normalized) return null;
        return {
            user_id: userId,
            puzzle_num: normalized.puzzleNum,
            date: normalized.date,
            row_index: normalized.rowIndex,
            board_state: normalized.boardState,
            evaluations: normalized.evaluations,
            solution: normalized.solution,
            game_status: normalized.gameStatus || "IN_PROGRESS",
            hard_mode: normalized.hardMode === true,
            last_played_at: normalized.lastPlayedTs ? this.toIso(normalized.lastPlayedTs) : null,
            last_completed_at: normalized.lastCompletedTs ? this.toIso(normalized.lastCompletedTs) : null,
            updated_at: this.toIso(normalized.updatedAt || Date.now()),
            device_id: deviceId,
            schema_version: 1
        };
    }

    rowToGameState(row) {
        if (!row) return null;
        return this.normalizeGameStateForSync({
            puzzleNum: row.puzzle_num,
            date: row.date,
            rowIndex: row.row_index,
            boardState: row.board_state,
            evaluations: row.evaluations,
            solution: row.solution,
            gameStatus: row.game_status,
            hardMode: row.hard_mode === true,
            lastPlayedTs: this.toMs(row.last_played_at),
            lastCompletedTs: this.toMs(row.last_completed_at),
            updatedAt: this.toMs(row.updated_at)
        });
    }

    // ── Predicates ──

    hasNonEmptyObject(value) {
        return !!value && typeof value === "object" && Object.keys(value).length > 0;
    }

    parseStoredBool(stored, fallback) {
        if (stored === null || stored === undefined) return fallback;
        return this.safeParseJSON(stored, fallback);
    }
}


// ─── Class 2: SyncStore ──────────────────────────────────────────────────────
// Manages all localStorage operations for sync.
class SyncStore {
    constructor(logic) {
        this.logic = logic;

        this.HISTORY_KEY = "history";
        this.GAME_STATE_KEY = "gameState";
        this.LEGACY_STATS_KEY = "legacy_stats";
        this.DEVICE_ID_KEY = "device_id";
        this.SYNC_META_KEY = "sync_meta";
        this.PRE_MERGE_STATS_KEY = "pre_merge_stats";
        this.PRE_MERGE_HISTORY_KEY = "pre_merge_history";
        this.PRE_MERGE_LEGACY_KEY = "pre_merge_legacy_stats";

        this.DARK_THEME_KEY = "darkTheme";
        this.COLOR_BLIND_THEME_KEY = "colorBlindTheme";
        this.SHARE_TEXT_ADDITIONS_KEY = "shareTextAdditions";
        this.SHARE_FORMAT_KEY = "shareFormat";
    }

    // ── Sync metadata ──

    getSyncMeta() {
        var stored = window.localStorage.getItem(this.SYNC_META_KEY);
        var meta = stored ? this.logic.safeParseJSON(stored, null) : null;
        if (!meta) {
            meta = {
                history_dirty: [],
                history_last_pulled_at: 0,
                preferences_updated_at: 0,
                legacy_updated_at: 0,
                game_state_updated_at: 0,
                premerge_complete: false
            };
        }
        if (!Array.isArray(meta.history_dirty)) meta.history_dirty = [];
        if (!meta.history_last_pulled_at) meta.history_last_pulled_at = 0;
        if (!meta.preferences_updated_at) meta.preferences_updated_at = 0;
        if (!meta.legacy_updated_at) meta.legacy_updated_at = 0;
        if (!meta.game_state_updated_at) meta.game_state_updated_at = 0;
        if (meta.premerge_complete !== true) meta.premerge_complete = false;
        return meta;
    }

    setSyncMeta(meta) {
        window.localStorage.setItem(this.SYNC_META_KEY, JSON.stringify(meta));
    }

    updateSyncMeta(patch) {
        var current = this.getSyncMeta();
        Object.keys(patch).forEach(function(key) {
            current[key] = patch[key];
        });
        this.setSyncMeta(current);
        return current;
    }

    // ── History ──

    getLocalHistory() {
        return this.logic.normalizeHistory(StorageController.history.getAll());
    }

    setLocalHistory(history) {
        StorageController.history.replace(history || {});
    }

    // ── Game state ──

    getLocalGameState() {
        return StorageController.gameState.getAll();
    }

    setLocalGameState(state) {
        if (!state || typeof state !== "object") return;
        StorageController.gameState.replace(state);
    }

    getLocalGameStateForProfile() {
        var normalized = this.logic.normalizeGameStateForSync(this.getLocalGameState());
        if (!normalized) return null;
        if (normalized.date !== this.logic.getTodayDateString()) return null;
        return normalized;
    }

    applyRemoteGameState(remoteState) {
        var normalizedRemote = this.logic.normalizeGameStateForSync(remoteState);
        if (!normalizedRemote) return false;
        if (normalizedRemote.date !== this.logic.getTodayDateString()) return false;

        var localState = this.logic.normalizeGameStateForSync(this.getLocalGameState());
        if (!this.logic.shouldApplyRemoteGameState(localState, normalizedRemote)) return false;

        this.setLocalGameState({
            boardState: normalizedRemote.boardState,
            evaluations: normalizedRemote.evaluations,
            rowIndex: normalizedRemote.rowIndex,
            solution: normalizedRemote.solution,
            gameStatus: normalizedRemote.gameStatus,
            lastPlayedTs: normalizedRemote.lastPlayedTs || null,
            lastCompletedTs: normalizedRemote.lastCompletedTs || null,
            restoringFromLocalStorage: null,
            hardMode: normalizedRemote.hardMode === true,
            puzzleNum: normalizedRemote.puzzleNum,
            date: normalizedRemote.date,
            updatedAt: normalizedRemote.updatedAt || Date.now()
        });
        return true;
    }

    // ── Preferences ──

    getLocalPreferences() {
        return {
            darkTheme: StorageController.preferences.get("darkTheme"),
            colorBlindTheme: StorageController.preferences.get("colorBlindTheme"),
            shareTextAdditions: StorageController.preferences.get("shareTextAdditions") || {
                header: "(Left Wordle)",
                afterGrid: ""
            },
            shareFormat: StorageController.preferences.get("shareFormat") || "grid"
        };
    }

    setLocalPreferences(prefs) {
        prefs = prefs || {};
        if (prefs.darkTheme !== undefined) {
            StorageController.preferences.set("darkTheme", prefs.darkTheme);
        }
        if (prefs.colorBlindTheme !== undefined) {
            StorageController.preferences.set("colorBlindTheme", prefs.colorBlindTheme);
        }
        if (prefs.shareTextAdditions !== undefined) {
            StorageController.preferences.set("shareTextAdditions", prefs.shareTextAdditions || { header: "", afterGrid: "" });
        }
        if (prefs.shareFormat !== undefined) {
            StorageController.preferences.set("shareFormat", prefs.shareFormat || "grid");
        }
    }

    applyRemoteUiPreferences(remotePrefs) {
        remotePrefs = remotePrefs || {};
        var before = this.getLocalPreferences();
        this.setLocalPreferences(remotePrefs);
        var after = this.getLocalPreferences();
        return (
            JSON.stringify(before.darkTheme) !== JSON.stringify(after.darkTheme) ||
            JSON.stringify(before.colorBlindTheme) !== JSON.stringify(after.colorBlindTheme) ||
            JSON.stringify(before.shareTextAdditions) !== JSON.stringify(after.shareTextAdditions) ||
            before.shareFormat !== after.shareFormat
        );
    }

    // ── Legacy stats ──

    getLocalLegacyStats() {
        return StorageController.legacyStats.get() || {};
    }

    setLocalLegacyStats(stats) {
        StorageController.legacyStats.set(stats || {});
    }

    // ── Device ──

    getDeviceId() {
        var existing = StorageController.deviceId.get();
        if (existing) return existing;
        var generated = (typeof crypto !== "undefined" && crypto.randomUUID) ?
            crypto.randomUUID() :
            Math.random().toString(36).slice(2) + Date.now().toString(36);
        StorageController.deviceId.set(generated);
        return generated;
    }

    // ── Backup ──

    ensurePreMergeBackup(syncMeta) {
        if (syncMeta.premerge_complete) return syncMeta;
        var stats = window.localStorage.getItem("statistics");
        var history = window.localStorage.getItem(this.HISTORY_KEY);
        var legacy = window.localStorage.getItem(this.LEGACY_STATS_KEY);

        if (stats !== null && window.localStorage.getItem(this.PRE_MERGE_STATS_KEY) === null) {
            window.localStorage.setItem(this.PRE_MERGE_STATS_KEY, stats);
        }
        if (history !== null && window.localStorage.getItem(this.PRE_MERGE_HISTORY_KEY) === null) {
            window.localStorage.setItem(this.PRE_MERGE_HISTORY_KEY, history);
        }
        if (legacy !== null && window.localStorage.getItem(this.PRE_MERGE_LEGACY_KEY) === null) {
            window.localStorage.setItem(this.PRE_MERGE_LEGACY_KEY, legacy);
        }

        syncMeta.premerge_complete = true;
        this.setSyncMeta(syncMeta);
        return syncMeta;
    }

    // ── Stats ──

    requestStatsRefresh() {
        window.wordleSyncNeedsStatsRefresh = true;
        if (window.wordleStats && typeof window.wordleStats.recompute === "function") {
            window.wordleStats.recompute();
            window.wordleSyncNeedsStatsRefresh = false;
        }
    }
}


// ─── Class 3: CloudSync ──────────────────────────────────────────────────────
// Supabase client wrapper, auth, sync orchestration, debounced push, and public API.
class CloudSync {
    constructor(store, client) {
        this.store = store;
        this.client = client;
        this.logic = store.logic;

        this.enabled = true;
        this.GAMES_TABLE = "games";
        this.PROFILES_TABLE = "profiles";
        this.GAME_STATE_TABLE = "current_game_state";
        this.DEBOUNCE_MS = 1000;
        this.pushTimer = null;

        this.LEGACY_PROFILE_GAME_STATE_KEY = "__sync_game_state";
    }

    // ── Supabase client operations ──

    async getSession() {
        var result = await this.client.auth.getSession();
        return result && result.data ? result.data.session : null;
    }

    async fetchProfile(userId) {
        var result = await this.client.from(this.PROFILES_TABLE).select("*").eq("user_id", userId).maybeSingle();
        if (result.error) {
            console.error("Sync: profile fetch error", result.error);
            return null;
        }
        return result.data;
    }

    async upsertProfile(userId, email, prefs, legacy, prefsUpdatedAt, legacyUpdatedAt) {
        var row = {
            user_id: userId,
            email: email || null,
            preferences: prefs || {},
            legacy_stats: legacy || {},
            preferences_updated_at: prefsUpdatedAt ? this.logic.toIso(prefsUpdatedAt) : null,
            legacy_updated_at: legacyUpdatedAt ? this.logic.toIso(legacyUpdatedAt) : null
        };
        var result = await this.client.from(this.PROFILES_TABLE).upsert(row, { onConflict: "user_id" });
        if (result.error) {
            console.error("Sync: profile upsert error", result.error);
            return false;
        }
        return true;
    }

    async fetchGameState(userId) {
        var result = await this.client.from(this.GAME_STATE_TABLE).select("*").eq("user_id", userId).maybeSingle();
        if (result.error) {
            console.error("Sync: game_state fetch error", result.error);
            return null;
        }
        return result.data;
    }

    async upsertGameState(userId, state) {
        var row = this.logic.gameStateToRow(state, userId, this.store.getDeviceId());
        if (!row) return true;

        var result = await this.client.from(this.GAME_STATE_TABLE).upsert(row, { onConflict: "user_id" });
        if (result.error) {
            console.error("Sync: game_state upsert error", result.error);
            return false;
        }
        return true;
    }

    async fetchHistorySince(userId, sinceTs) {
        var query = this.client.from(this.GAMES_TABLE).select("*").eq("user_id", userId);
        if (sinceTs > 0) {
            query = query.gt("updated_at", this.logic.toIso(sinceTs));
        }
        var result = await query;
        if (result.error) {
            console.error("Sync: history fetch error", result.error);
            return null;
        }
        return result.data || [];
    }

    async fetchHistoryByPuzzleNums(userId, puzzleNums) {
        if (!puzzleNums.length) return [];
        var parsed = puzzleNums.map(function(v) { return parseInt(v, 10); })
            .filter(function(v) { return Number.isFinite(v); });
        if (!parsed.length) return [];

        var result = await this.client.from(this.GAMES_TABLE)
            .select("*")
            .eq("user_id", userId)
            .in("puzzle_num", parsed);

        if (result.error) {
            console.error("Sync: history fetch (dirty) error", result.error);
            return null;
        }
        return result.data || [];
    }

    async upsertHistoryRows(userId, entries) {
        var self = this;
        if (!entries.length) return true;
        var rows = entries.map(function(entry) {
            return self.logic.historyEntryToRow(entry, userId);
        });

        var result = await this.client.from(this.GAMES_TABLE).upsert(rows, { onConflict: "user_id,puzzle_num" });
        if (result.error) {
            console.error("Sync: history upsert error", result.error);
            return false;
        }
        return true;
    }

    // ── Auth ──

    async signInWithMagicLink(email) {
        var normalizedEmail = String(email || "").trim().toLowerCase();
        if (!normalizedEmail) {
            return { error: { message: "Email is required" } };
        }

        var redirectPath = this.getMagicLinkRedirectPath();
        if (window.SUPABASE_MAGIC_LINK_USE_EDGE_FUNCTION === true) {
            var fnName = window.SUPABASE_MAGIC_LINK_FUNCTION_NAME || "send-magic-link";
            var invokeResult = await this.client.functions.invoke(fnName, {
                body: { email: normalizedEmail, redirectPath: redirectPath }
            });
            if (invokeResult.error) {
                return { error: { message: invokeResult.error.message || "Failed to send magic link" } };
            }
            if (invokeResult.data && invokeResult.data.error) {
                return { error: { message: invokeResult.data.error } };
            }
            return { error: null };
        }

        var redirectUrl = this.getMagicLinkRedirectUrl(redirectPath);
        var payload = { email: normalizedEmail };
        if (redirectUrl) {
            payload.options = { emailRedirectTo: redirectUrl };
        }

        var result = await this.client.auth.signInWithOtp(payload);
        if (result.error) {
            return { error: { message: result.error.message || "Failed to send magic link" } };
        }
        return { error: null };
    }

    async signOut() {
        await this.client.auth.signOut();
    }

    async getUserEmail() {
        var session = await this.getSession();
        return session && session.user ? session.user.email : null;
    }

    async isSignedIn() {
        var session = await this.getSession();
        return !!session;
    }

    getMagicLinkRedirectPath() {
        return this.logic.normalizeRedirectPath(window.SUPABASE_MAGIC_LINK_REDIRECT_PATH || "/sync-resolve");
    }

    getMagicLinkRedirectUrl(redirectPath) {
        if (!window.location || !window.location.origin) return null;
        return window.location.origin + this.logic.normalizeRedirectPath(redirectPath);
    }

    // ── Orchestration ──

    async performSync(options) {
        options = options || {};
        var mode = options.mode || "full";

        var session = await this.getSession();
        if (!session) return;
        var userId = session.user.id;
        var userEmail = session.user && session.user.email ? session.user.email : null;

        var syncMeta = this.store.getSyncMeta();
        syncMeta = this.store.ensurePreMergeBackup(syncMeta);

        var localHistory = this.store.getLocalHistory();
        var localPrefs = this.store.getLocalPreferences();
        var localGameState = this.store.getLocalGameStateForProfile();
        var localLegacy = this.store.getLocalLegacyStats();

        var prefsUpdatedAt = syncMeta.preferences_updated_at || 0;
        var legacyUpdatedAt = syncMeta.legacy_updated_at || 0;
        var gameStateUpdatedAt = syncMeta.game_state_updated_at || 0;
        if (localGameState && !gameStateUpdatedAt) {
            gameStateUpdatedAt = this.logic.toMs(localGameState.updatedAt) || Date.now();
        }

        // First sync bootstrap: reconcile all known local history rows.
        if ((syncMeta.history_last_pulled_at || 0) === 0 && (!syncMeta.history_dirty || syncMeta.history_dirty.length === 0)) {
            var localPuzzleNums = Object.keys(localHistory);
            if (localPuzzleNums.length) {
                syncMeta.history_dirty = localPuzzleNums;
            }
        }

        var remoteProfile = await this.fetchProfile(userId);
        var profileNeedsPush = false;
        var legacyChanged = false;
        var prefsChanged = false;
        var gameStateChanged = false;
        var remoteLegacyProfileGameState = null;

        if (remoteProfile) {
            var remotePrefsUpdatedAt = this.logic.toMs(remoteProfile.preferences_updated_at);
            var remoteLegacyUpdatedAt = this.logic.toMs(remoteProfile.legacy_updated_at);
            var remoteProfilePrefs = remoteProfile.preferences || {};
            remoteLegacyProfileGameState = remoteProfilePrefs[this.LEGACY_PROFILE_GAME_STATE_KEY] || null;

            if (remotePrefsUpdatedAt > prefsUpdatedAt) {
                localPrefs = {
                    darkTheme: remoteProfilePrefs.darkTheme,
                    colorBlindTheme: remoteProfilePrefs.colorBlindTheme,
                    shareTextAdditions: remoteProfilePrefs.shareTextAdditions
                };
                prefsChanged = this.store.applyRemoteUiPreferences(localPrefs);
                prefsUpdatedAt = remotePrefsUpdatedAt;
            } else if (prefsUpdatedAt > remotePrefsUpdatedAt) {
                profileNeedsPush = true;
            }

            if (remoteLegacyUpdatedAt > legacyUpdatedAt) {
                localLegacy = remoteProfile.legacy_stats || {};
                this.store.setLocalLegacyStats(localLegacy);
                legacyUpdatedAt = remoteLegacyUpdatedAt;
                legacyChanged = true;
            } else if (legacyUpdatedAt > remoteLegacyUpdatedAt) {
                profileNeedsPush = true;
            }
        } else {
            profileNeedsPush = true;
            if (!prefsUpdatedAt) prefsUpdatedAt = Date.now();
            if (!legacyUpdatedAt && this.logic.hasNonEmptyObject(localLegacy)) legacyUpdatedAt = Date.now();
        }

        if (profileNeedsPush) {
            await this.upsertProfile(userId, userEmail, this.store.getLocalPreferences(), localLegacy, prefsUpdatedAt, legacyUpdatedAt);
        }

        var remoteGameStateRow = await this.fetchGameState(userId);
        var remoteGameState = this.logic.rowToGameState(remoteGameStateRow);

        // Backward-compatibility path for existing profile-embedded game state.
        if (!remoteGameState && remoteLegacyProfileGameState) {
            remoteGameState = this.logic.normalizeGameStateForSync(remoteLegacyProfileGameState);
            if (remoteGameState) {
                await this.upsertGameState(userId, remoteGameState);
            }
        }

        if (remoteGameState) {
            if (this.store.applyRemoteGameState(remoteGameState)) {
                gameStateChanged = true;
                gameStateUpdatedAt = this.logic.toMs(remoteGameState.updatedAt) || Date.now();
            } else {
                var refreshedLocalGameState = this.store.getLocalGameStateForProfile();
                if (this.logic.shouldPushLocalGameState(remoteGameState, refreshedLocalGameState)) {
                    var pushedGameState = await this.upsertGameState(userId, refreshedLocalGameState);
                    if (pushedGameState) {
                        gameStateUpdatedAt = this.logic.toMs(refreshedLocalGameState.updatedAt) || Date.now();
                    }
                }
            }
        } else if (localGameState) {
            var seededGameState = await this.upsertGameState(userId, localGameState);
            if (seededGameState) {
                gameStateUpdatedAt = this.logic.toMs(localGameState.updatedAt) || Date.now();
            }
        }

        if ((prefsChanged || gameStateChanged) && window.location && typeof window.location.reload === "function") {
            // Persist fresh timestamps before reload so first-time profile pulls do not loop reload forever.
            this.store.updateSyncMeta({
                history_dirty: syncMeta.history_dirty,
                history_last_pulled_at: syncMeta.history_last_pulled_at,
                preferences_updated_at: prefsUpdatedAt,
                legacy_updated_at: legacyUpdatedAt,
                game_state_updated_at: gameStateUpdatedAt,
                premerge_complete: syncMeta.premerge_complete
            });
            window.location.reload();
            return;
        }

        if (legacyChanged) {
            this.store.requestStatsRefresh();
        }

        if (mode === "full") {
            var lastPulledAt = syncMeta.history_last_pulled_at || 0;
            var remoteUpdates = await this.fetchHistorySince(userId, lastPulledAt);
            if (remoteUpdates !== null) {
                var mergeResult = this.logic.mergeRemoteHistory(localHistory, remoteUpdates);
                if (mergeResult.changed) {
                    localHistory = mergeResult.history;
                    this.store.setLocalHistory(localHistory);
                    this.store.requestStatsRefresh();
                }
                syncMeta.history_last_pulled_at = Date.now();
            }
        }

        var dirty = syncMeta.history_dirty || [];
        if (dirty.length) {
            var remoteForDirty = await this.fetchHistoryByPuzzleNums(userId, dirty);
            if (remoteForDirty !== null) {
                var remoteMap = {};
                remoteForDirty.forEach(function(row) {
                    remoteMap[String(row.puzzle_num)] = row;
                });

                var toUpsert = [];
                var remainingDirty = [];
                var localChanged = false;
                var self = this;

                dirty.forEach(function(puzzleNum) {
                    var key = String(puzzleNum);
                    var localEntry = localHistory[key];
                    if (!localEntry) return;
                    var remoteRow = remoteMap[key];

                    if (!remoteRow) {
                        toUpsert.push(localEntry);
                        remainingDirty.push(key);
                        return;
                    }

                    var remoteEntry = self.logic.rowToHistoryEntry(remoteRow);
                    if (!self.logic.historyEntriesEqual(localEntry, remoteEntry)) {
                        localHistory[key] = remoteEntry;
                        localChanged = true;
                    }
                });

                if (localChanged) {
                    this.store.setLocalHistory(localHistory);
                    this.store.requestStatsRefresh();
                }

                if (toUpsert.length) {
                    var ok = await this.upsertHistoryRows(userId, toUpsert);
                    syncMeta.history_dirty = ok ? [] : remainingDirty;
                } else {
                    syncMeta.history_dirty = [];
                }
            }
        }

        this.store.updateSyncMeta({
            history_dirty: syncMeta.history_dirty,
            history_last_pulled_at: syncMeta.history_last_pulled_at,
            preferences_updated_at: prefsUpdatedAt,
            legacy_updated_at: legacyUpdatedAt,
            game_state_updated_at: gameStateUpdatedAt,
            premerge_complete: syncMeta.premerge_complete
        });
    }

    pushToRemote() {
        var self = this;
        if (this.pushTimer) clearTimeout(this.pushTimer);
        this.pushTimer = setTimeout(function() {
            self.performSync({ mode: "push" });
        }, this.DEBOUNCE_MS);
    }

    onDataChanged(changeType, payload) {
        var syncMeta = this.store.getSyncMeta();

        if (changeType === "history") {
            var puzzleNum = payload && payload.puzzleNum !== undefined ? String(payload.puzzleNum) : null;
            if (puzzleNum && !syncMeta.history_dirty.includes(puzzleNum)) {
                syncMeta.history_dirty.push(puzzleNum);
            }
        }

        if (changeType === "legacy") {
            syncMeta.legacy_updated_at = Date.now();
        }

        if (changeType === "preference") {
            syncMeta.preferences_updated_at = Date.now();
        }

        if (changeType === "game_state") {
            syncMeta.game_state_updated_at = Date.now();
        }

        this.store.setSyncMeta(syncMeta);
        this.pushToRemote();
    }

    // ── Init ──

    init() {
        var self = this;
        this.client.auth.onAuthStateChange(function(event, session) {
            if (event === "SIGNED_IN" && session) {
                self.performSync({ mode: "full" });
            }
        });

        async function runInit() {
            var session = await self.getSession();
            if (session) {
                await self.performSync({ mode: "full" });
            }
        }

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", runInit);
        } else {
            runInit();
        }
    }
}


// ─── Expose classes for testing ──────────────────────────────────────────────
window.supabaseSyncTestExports = {
    SyncDataLogic: SyncDataLogic,
    SyncStore: SyncStore,
    CloudSync: CloudSync
};

// ─── Bootstrap ───────────────────────────────────────────────────────────────
(function() {
    if (!window.SUPABASE_SYNC_ENABLED ||
        typeof window.supabase === "undefined" ||
        !window.SUPABASE_URL || window.SUPABASE_URL === "YOUR_SUPABASE_URL" ||
        !window.SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY === "YOUR_SUPABASE_ANON_KEY") {
        window.wordleSync = {
            enabled: false,
            onDataChanged: function() {},
            performSync: function() { return Promise.resolve(); },
            isSignedIn: function() { return Promise.resolve(false); },
            getUserEmail: function() { return Promise.resolve(null); },
            signInWithMagicLink: function() { return Promise.resolve({ error: { message: "Sync disabled" } }); },
            signOut: function() { return Promise.resolve(); }
        };
        return;
    }

    var client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    var logic = new SyncDataLogic();
    var store = new SyncStore(logic);
    var sync = new CloudSync(store, client);

    window.wordleSync = {
        enabled: true,
        onDataChanged: function(t, p) { return sync.onDataChanged(t, p); },
        performSync: function(o) { return sync.performSync(o); },
        signInWithMagicLink: function(e) { return sync.signInWithMagicLink(e); },
        signOut: function() { return sync.signOut(); },
        isSignedIn: function() { return sync.isSignedIn(); },
        getUserEmail: function() { return sync.getUserEmail(); }
    };

    sync.init();
})();
