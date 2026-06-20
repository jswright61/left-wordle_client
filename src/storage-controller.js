"use strict";

// Single source of truth for Left Wordle's application-owned localStorage.

class NamespacedStorage {
    constructor(storageKey, validKeys) {
        this._storageKey = storageKey;
        this._validKeys = validKeys;
    }

    _assertKey(key) {
        if (!this._validKeys.has(key)) {
            throw new Error('StorageController.' + this._storageKey + ': unknown key "' + key + '"');
        }
    }

    _read() {
        try {
            var raw = window.localStorage.getItem(this._storageKey);
            if (!raw) return {};
            var parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    _write(obj) {
        try { window.localStorage.setItem(this._storageKey, JSON.stringify(obj)); } catch (e) {}
    }

    clear() {
        try { window.localStorage.removeItem(this._storageKey); } catch (e) {}
    }

    get(key) {
        this._assertKey(key);
        var value = this._read()[key];
        return value !== undefined ? value : null;
    }

    getAll() {
        return this._read();
    }

    merge(obj) {
        var self = this;
        if (obj && typeof obj === "object") {
            Object.keys(obj).forEach(function(key) { self._assertKey(key); });
        }
        var stored = this._read();
        Object.assign(stored, obj);
        this._write(stored);
    }

    remove(key) {
        this._assertKey(key);
        var stored = this._read();
        delete stored[key];
        this._write(stored);
    }

    replace(obj) {
        var self = this;
        if (obj && typeof obj === "object") {
            Object.keys(obj).forEach(function(key) { self._assertKey(key); });
        }
        this._write(obj || {});
    }

    set(key, value) {
        this._assertKey(key);
        var stored = this._read();
        stored[key] = value;
        this._write(stored);
    }
}

class PreferencesStorage extends NamespacedStorage {
    constructor() {
        super("preferences", new Set([
            "darkTheme",
            "colorBlindTheme",
            "shareFormat",
            "shareTextAdditions",
            "suppressLoginPrompt",
            "showRemainingAnswers"
        ]));
        this._legacyKeys = ["darkTheme", "colorBlindTheme", "shareFormat", "shareTextAdditions"];
    }

    _read() {
        try {
            var raw = window.localStorage.getItem(this._storageKey);
            if (raw !== null) {
                var parsed = JSON.parse(raw);
                return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
            }

            var migrated = {};
            var found = false;
            this._legacyKeys.forEach(function(key) {
                var legacyValue = window.localStorage.getItem(key);
                if (legacyValue === null) return;
                found = true;
                try { migrated[key] = JSON.parse(legacyValue); } catch (e) { migrated[key] = legacyValue; }
            });

            if (found) {
                window.localStorage.setItem(this._storageKey, JSON.stringify(migrated));
                this._legacyKeys.forEach(function(key) {
                    window.localStorage.removeItem(key);
                });
            }
            return migrated;
        } catch (e) {
            return {};
        }
    }
}

class BlobStorage {
    constructor(storageKey) {
        this._storageKey = storageKey;
    }

    clear() {
        try { window.localStorage.removeItem(this._storageKey); } catch (e) {}
    }

    get() {
        try {
            var raw = window.localStorage.getItem(this._storageKey);
            return raw === null ? null : JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    set(obj) {
        try { window.localStorage.setItem(this._storageKey, JSON.stringify(obj)); } catch (e) {}
    }
}

class HistoryStorage {
    constructor(storageKey) {
        this._storageKey = storageKey;
    }

    _read() {
        try {
            var raw = window.localStorage.getItem(this._storageKey);
            if (!raw) return {};
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") return {};
            if (!Array.isArray(parsed)) return parsed;

            var mapped = {};
            parsed.forEach(function(entry) {
                if (entry && entry.puzzle_num !== undefined && entry.puzzle_num !== null) {
                    mapped[String(entry.puzzle_num)] = entry;
                }
            });
            return mapped;
        } catch (e) {
            return {};
        }
    }

    _write(map) {
        try { window.localStorage.setItem(this._storageKey, JSON.stringify(map)); } catch (e) {}
    }

    clear() {
        try { window.localStorage.removeItem(this._storageKey); } catch (e) {}
    }

    getAll() {
        return this._read();
    }

    getEntry(puzzleNum) {
        return this._read()[String(puzzleNum)] || null;
    }

    mergeEntries(incoming) {
        var stored = this._read();
        var changed = false;
        Object.keys(incoming || {}).forEach(function(key) {
            if (stored[key]) return;
            stored[key] = incoming[key];
            changed = true;
        });
        if (changed) this._write(stored);
        return changed;
    }

    replace(map) {
        this._write(map || {});
    }

    setEntry(puzzleNum, entry) {
        var stored = this._read();
        stored[String(puzzleNum)] = entry;
        this._write(stored);
    }
}

class ScalarStorage {
    constructor(storageKey) {
        this._storageKey = storageKey;
    }

    clear() {
        try { window.localStorage.removeItem(this._storageKey); } catch (e) {}
    }

    get() {
        try { return window.localStorage.getItem(this._storageKey); } catch (e) { return null; }
    }

    set(value) {
        try { window.localStorage.setItem(this._storageKey, value); } catch (e) {}
    }
}

window.StorageController = {
    preferences: new PreferencesStorage(),
    gameState: new NamespacedStorage("gameState", new Set([
        "puzzleNum", "date", "rowIndex", "boardState", "evaluations",
        "gameStatus", "hardMode", "completedInHardMode", "solution",
        "lastPlayedTs", "lastCompletedTs", "updatedAt", "restoringFromLocalStorage"
    ])),
    history: new HistoryStorage("history"),
    legacyStats: new BlobStorage("legacy_stats"),
    legacyStatsBackup: new BlobStorage("legacy_stats_pre_history_authoritative"),
    statistics: new NamespacedStorage("statistics", new Set([
        "currentStreak", "maxStreak", "guesses", "winPercentage",
        "gamesPlayed", "gamesWon", "averageGuesses"
    ])),
    deviceId: new ScalarStorage("device_id")
};
