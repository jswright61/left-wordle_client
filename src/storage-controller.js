"use strict";

// Single source of truth for Left Wordle's application-owned localStorage.

class NamespacedStorage {
    constructor(storageKey, validKeys) {
        this._storageKey = storageKey;
        this._validKeys = validKeys;
    }

    _assertKey(key) {
        if (!this._validKeys.has(key)) {
            var msg = 'StorageController.' + this._storageKey + ': unknown key "' + key + '"';
            console.error(msg);
            throw new Error(msg);
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
            "hideDateInShareHeader",
            "suppressLoginPrompt",
            "remainingAnswersMode",
            "showRemainingInShareText",
            "goofProtectionMode",
            "hardMode",
            "insaneMode"
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

class SettingsBackupStorage {
    constructor() {
        this._storageKey = "settingsBackup";
    }

    maybeBackup(appVersion) {
        if (!appVersion) return;
        try {
            var storedVersion = window.localStorage.getItem("version");
            var trimmedStored = storedVersion ? storedVersion.trim() : "";
            if (trimmedStored === appVersion) return;
            var baseKey = trimmedStored ? trimmedStored : appVersion + "-pre";

            var raw = window.localStorage.getItem(this._storageKey);
            var backup = null;
            try { backup = raw ? JSON.parse(raw) : null; } catch (e) {}
            if (!backup || typeof backup !== "object" || Array.isArray(backup)) backup = {};

            var key = baseKey;
            var counter = 1;
            while (backup[key]) {
                key = baseKey + "." + String(counter).padStart(3, "0");
                counter++;
            }

            var snapshot = { ts: new Date().toISOString() };
            for (var i = 0; i < window.localStorage.length; i++) {
                var lsKey = window.localStorage.key(i);
                if (lsKey !== this._storageKey) snapshot[lsKey] = window.localStorage.getItem(lsKey);
            }
            backup[key] = snapshot;
            window.localStorage.setItem(this._storageKey, JSON.stringify(backup));
            window.localStorage.setItem("version", appVersion);
        } catch (e) {}
    }

    prune() {
        try {
            var raw = window.localStorage.getItem(this._storageKey);
            var backup = null;
            try { backup = raw ? JSON.parse(raw) : null; } catch (e) {}
            if (!backup || typeof backup !== "object" || Array.isArray(backup)) return;

            var keys = Object.keys(backup);
            if (keys.length <= 2) return;

            keys.sort(function(a, b) {
                var tsA = backup[a] && backup[a].ts ? new Date(backup[a].ts).getTime() : 0;
                var tsB = backup[b] && backup[b].ts ? new Date(backup[b].ts).getTime() : 0;
                return tsB - tsA;
            });

            var cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
            var changed = false;
            keys.forEach(function(key, index) {
                if (index < 2) return;
                var ts = backup[key] && backup[key].ts ? new Date(backup[key].ts).getTime() : 0;
                if (ts < cutoff) {
                    delete backup[key];
                    changed = true;
                }
            });

            if (changed) window.localStorage.setItem(this._storageKey, JSON.stringify(backup));
        } catch (e) {}
    }

    get() {
        try {
            var raw = window.localStorage.getItem(this._storageKey);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    clear() {
        try { window.localStorage.removeItem(this._storageKey); } catch (e) {}
    }
}

window.StorageController = {
    preferences: new PreferencesStorage(),
    gameState: new NamespacedStorage("gameState", new Set([
        "puzzleNum", "date", "rowIndex", "boardState", "evaluations",
        "gameStatus", "hardMode", "insaneMode", "goofProtectionMode", "completedInHardMode", "completedInInsaneMode", "solution",
        "lastPlayedTs", "lastCompletedTs", "updatedAt", "restoringFromLocalStorage",
        "answersRemaining", "encryptedAnswer"
    ])),
    history: new HistoryStorage("history"),
    legacyStats: new BlobStorage("legacy_stats"),
    statistics: new NamespacedStorage("statistics", new Set([
        "currentStreak", "maxStreak", "terminatedStreak", "guesses", "winPercentage",
        "gamesPlayed", "gamesWon", "averageGuesses", "versionNumber", "migratedBy"
    ])),
    deviceId: new ScalarStorage("device_id"),
    settingsBackup: new SettingsBackupStorage()
};
