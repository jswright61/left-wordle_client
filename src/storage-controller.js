"use strict";

// Single source of truth for Left Wordle's application-owned localStorage.

var SCHEMA_VERSION = 1;

// Canonical schema for each NamespacedStorage. Values use JS typeof strings,
// plus "array" (detected via Array.isArray). null is always a valid value.
var SCHEMA = {
    preferences: {
        darkTheme:              "boolean",
        colorBlindTheme:        "boolean",
        shareFormat:            "string",
        shareTextAdditions:     "object",
        hideDateInShareHeader:  "boolean",
        suppressLoginPrompt:    "boolean",
        remainingAnswersMode:   "string",
        showRemainingInShareText: "boolean",
        goofProtectionMode:     "boolean",
        hardMode:               "boolean",
        insaneMode:             "boolean"
    },
    gameState: {
        puzzleNum:                  "number",
        date:                       "string",
        rowIndex:                   "number",
        boardState:                 "array",
        evaluations:                "array",
        gameStatus:                 "string",
        hardMode:                   "boolean",
        insaneMode:                 "boolean",
        goofProtectionMode:         "boolean",
        completedInHardMode:        "boolean",
        completedInInsaneMode:      "boolean",
        solution:                   "string",
        lastPlayedTs:               "number",
        lastCompletedTs:            "number",
        updatedAt:                  "string",
        restoringFromLocalStorage:  "boolean",
        answersRemaining:           "number",
        encryptedAnswer:            "string"
    },
    statistics: {
        currentStreak:      "number",
        maxStreak:          "number",
        terminatedStreak:   "number",
        guesses:            "object",
        winPercentage:      "number",
        gamesPlayed:        "number",
        gamesWon:           "number",
        averageGuesses:     "number",
        versionNumber:      "number",
        migratedBy:         "string"
    }
};

class NamespacedStorage {
    constructor(storageKey, schema) {
        this._storageKey = storageKey;
        this._schema = schema;
        this._validKeys = new Set(Object.keys(schema));
    }

    _assertKey(key) {
        if (!this._validKeys.has(key)) {
            var msg = 'StorageController.' + this._storageKey + ': unknown key "' + key + '"';
            console.error(msg);
            throw new Error(msg);
        }
    }

    _assertValue(key, value) {
        if (value === null || value === undefined) return;
        var expected = this._schema[key];
        var actual = Array.isArray(value) ? "array" : typeof value;
        if (actual !== expected) {
            var msg = 'StorageController.' + this._storageKey + '["' + key + '"]: expected ' + expected + ', got ' + actual;
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
            Object.keys(obj).forEach(function(key) {
                self._assertKey(key);
                self._assertValue(key, obj[key]);
            });
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
            Object.keys(obj).forEach(function(key) {
                self._assertKey(key);
                self._assertValue(key, obj[key]);
            });
        }
        this._write(obj || {});
    }

    set(key, value) {
        this._assertKey(key);
        this._assertValue(key, value);
        var stored = this._read();
        stored[key] = value;
        this._write(stored);
    }
}

class PreferencesStorage extends NamespacedStorage {
    constructor() {
        super("preferences", SCHEMA.preferences);
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

class SchemaVersionStorage {
    constructor() {
        this._storageKey = "schema_version";
    }

    read() {
        try {
            var raw = window.localStorage.getItem(this._storageKey);
            return raw === null ? null : parseInt(raw, 10);
        } catch (e) {
            return null;
        }
    }

    write(version) {
        try { window.localStorage.setItem(this._storageKey, String(version)); } catch (e) {}
    }
}

window.StorageController = {
    schemaVersion: SCHEMA_VERSION,
    preferences: new PreferencesStorage(),
    gameState: new NamespacedStorage("gameState", SCHEMA.gameState),
    history: new HistoryStorage("history"),
    legacyStats: new BlobStorage("legacy_stats"),
    statistics: new NamespacedStorage("statistics", SCHEMA.statistics),
    deviceId: new ScalarStorage("device_id"),
    settingsBackup: new SettingsBackupStorage()
};

(function() {
    var sv = new SchemaVersionStorage();
    var stored = sv.read();
    if (stored === null) {
        sv.write(SCHEMA_VERSION);
    } else if (stored !== SCHEMA_VERSION) {
        console.warn(
            "StorageController: schema version mismatch — stored=" + stored +
            ", current=" + SCHEMA_VERSION
        );
    }
})();
