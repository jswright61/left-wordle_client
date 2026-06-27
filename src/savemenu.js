"use strict";

class PuzzleResolver {
    constructor(answerList, puzzleStartDate) {
        this.answerList = answerList;
        this.puzzleStartDate = puzzleStartDate;
    }

    formatLocalDate(date) {
        var year = date.getFullYear();
        var month = String(date.getMonth() + 1).padStart(2, "0");
        var day = String(date.getDate()).padStart(2, "0");
        return "".concat(year, "-").concat(month, "-").concat(day);
    }

    puzzleNumToDate(puzzleNum) {
        var d = new Date(this.puzzleStartDate);
        d.setDate(d.getDate() + puzzleNum);
        return this.formatLocalDate(d);
    }

    dateToPuzzleNum(dateStr) {
        if (!dateStr || typeof dateStr !== "string") return null;
        var parts = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!parts) return null;
        var d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
        if (Number.isNaN(d.getTime())) return null;
        var msPerDay = 86400000;
        var diff = Math.round((d - this.puzzleStartDate) / msPerDay);
        return diff >= 0 ? diff : null;
    }

    answerToPuzzleNum(answer) {
        if (!answer || typeof answer !== "string") return null;
        var idx = this.answerList.indexOf(answer.toLowerCase());
        return idx >= 0 ? idx : null;
    }

    puzzleNumToAnswer(puzzleNum) {
        if (!Number.isFinite(puzzleNum) || puzzleNum < 0) return null;
        return this.answerList[puzzleNum % this.answerList.length];
    }

    safeParseJSON(str, fallback) {
        try {
            return JSON.parse(str);
        } catch (e) {
            return fallback;
        }
    }

    normalizeText(value) {
        if (value === undefined || value === null) return null;
        var str = String(value).trim();
        if (!str) return null;
        return str;
    }

    normalizeLowerText(value) {
        var text = this.normalizeText(value);
        return text ? text.toLowerCase() : null;
    }

    normalizeMode(value, hardModeValue) {
        var mode = this.normalizeLowerText(value);
        if (mode) {
            if (mode === "normal" || mode === "standard" || mode === "classic") return "regular";
            return mode;
        }

        if (hardModeValue === true || String(hardModeValue).toLowerCase() === "true") return "hard";
        if (hardModeValue === false || String(hardModeValue).toLowerCase() === "false") return "regular";
        return null;
    }

    normalizeResult(value) {
        if (value === undefined || value === null || value === "") return null;
        if (typeof value === "number") {
            if (value >= 1 && value <= 6) return value;
            if (value === 7) return 7;
            return null;
        }

        var str = String(value).trim().toLowerCase();
        if (!str) return null;
        if (str === "x" || str === "fail" || str === "failed" || str === "loss" || str === "lost") return 7;

        var parsed = parseInt(str, 10);
        if (!Number.isFinite(parsed)) return null;
        if (parsed >= 1 && parsed <= 6) return parsed;
        if (parsed === 7) return 7;
        return null;
    }

    normalizePuzzleNum(entry) {
        var raw = entry.puzzle_num;
        if (raw === undefined || raw === null) raw = entry.puzzleNum;
        if (raw === undefined || raw === null) raw = entry.puzzle;
        if (raw === undefined || raw === null) raw = entry.dayOffset;
        if (raw === undefined || raw === null) raw = entry.day_offset;

        if (typeof raw === "string" && raw.trim() === "") return null;
        var puzzleNum = Number(raw);
        if (!Number.isFinite(puzzleNum)) return null;
        puzzleNum = Math.floor(puzzleNum);
        if (puzzleNum < 0) return null;
        return puzzleNum;
    }

    normalizeDate(value, puzzleNum) {
        if (typeof value === "string") {
            var trimmed = value.trim();
            var directDateMatch = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
            if (directDateMatch) return trimmed;
            var parsedMs = Date.parse(trimmed);
            if (!Number.isNaN(parsedMs)) {
                return this.formatLocalDate(new Date(parsedMs));
            }
        }

        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return this.formatLocalDate(value);
        }

        if (typeof value === "number" && Number.isFinite(value)) {
            var ms = value > 1e12 ? value : value * 1000;
            return this.formatLocalDate(new Date(ms));
        }

        return Number.isFinite(puzzleNum) ? this.puzzleNumToDate(puzzleNum) : null;
    }

    escapeCsvValue(value) {
        if (value === undefined || value === null) return "";
        var str = String(value);
        if (str.includes('"') || str.includes(",") || str.includes("\n")) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    parseCsvLine(line) {
        var result = [];
        var current = "";
        var inQuotes = false;

        for (var i = 0; i < line.length; i++) {
            var ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i += 1;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === "," && !inQuotes) {
                result.push(current);
                current = "";
            } else {
                current += ch;
            }
        }
        result.push(current);
        return result;
    }

    parseCsvRecords(text) {
        var self = this;
        var cleaned = text.replace(/^\uFEFF/, "").trim();
        if (!cleaned) return [];

        var lines = cleaned.split(/\r?\n/).filter(function(line) {
            return line.trim().length > 0;
        });
        if (lines.length < 2) return [];

        var headers = self.parseCsvLine(lines[0]).map(function(header) {
            return String(header || "")
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/^_+|_+$/g, "");
        });

        var rows = [];
        for (var i = 1; i < lines.length; i++) {
            var values = self.parseCsvLine(lines[i]);
            var row = {};
            headers.forEach(function(header, idx) {
                row[header] = idx < values.length ? values[idx] : "";
            });
            rows.push(row);
        }

        return rows;
    }

    parseJsonRecords(payload) {
        if (!payload) return [];
        if (Array.isArray(payload)) return payload;
        if (payload && typeof payload === "object" && payload.puzzle_num !== undefined) return [payload];
        if (payload && typeof payload === "object" && payload.puzzleNum !== undefined) return [payload];

        if (payload.history) {
            if (Array.isArray(payload.history)) return payload.history;
            if (payload.history && typeof payload.history === "object") {
                return Object.values(payload.history);
            }
        }

        if (payload.games && Array.isArray(payload.games)) return payload.games;

        if (typeof payload === "object") {
            var values = Object.values(payload);
            var maybeEntries = values.filter(function(v) {
                return v && typeof v === "object";
            });
            if (maybeEntries.length) return maybeEntries;
        }

        return [];
    }

    parseImportRecords(text, filename) {
        var lower = (filename || "").toLowerCase();
        var firstNonWhitespace = (text.match(/\S/) || [""])[0];

        if (lower.endsWith(".csv")) {
            return this.parseCsvRecords(text);
        }

        if (lower.endsWith(".json") || firstNonWhitespace === "{" || firstNonWhitespace === "[") {
            var parsed = this.safeParseJSON(text, null);
            if (!parsed) throw new Error("Invalid JSON file");
            return this.parseJsonRecords(parsed);
        }

        // fallback: try CSV first, then JSON
        var csvRows = this.parseCsvRecords(text);
        if (csvRows.length) return csvRows;

        var jsonFallback = this.safeParseJSON(text, null);
        if (jsonFallback) return this.parseJsonRecords(jsonFallback);

        throw new Error("Unsupported file format. Use .csv or .json");
    }

    resolveAndValidateEntry(raw, index) {
        if (!raw || typeof raw !== "object") return { entry: null, flag: "invalid row (not an object)" };

        // Parse result — still required
        var result = this.normalizeResult(
            raw.result !== undefined ? raw.result :
            raw.guesses !== undefined ? raw.guesses :
            raw.num_guesses !== undefined ? raw.num_guesses :
            raw.numGuesses !== undefined ? raw.numGuesses :
            raw.outcome
        );
        if (!Number.isFinite(result)) return { entry: null, flag: "missing or invalid result" };

        // Parse the three deterministic fields
        var puzzleNum = this.normalizePuzzleNum(raw);
        var rawDateValue = raw.date !== undefined ? raw.date :
            raw.played_on !== undefined ? raw.played_on :
            raw.playedOn;
        var date = (rawDateValue !== undefined && rawDateValue !== null && rawDateValue !== "")
            ? this.normalizeDate(rawDateValue, null)
            : null;
        var answer = this.normalizeLowerText(raw.answer);

        // Count how many deterministic fields we have
        var hasPuzzleNum = Number.isFinite(puzzleNum);
        var hasDate = date !== null;
        var hasAnswer = answer !== null;

        if (!hasPuzzleNum && !hasDate && !hasAnswer) {
            return { entry: null, flag: "missing puzzle_num, date, and answer" };
        }

        // Derive missing fields and cross-validate provided ones
        var flag = null;

        if (hasPuzzleNum && hasDate) {
            var expectedDate = this.puzzleNumToDate(puzzleNum);
            if (expectedDate !== date) {
                flag = "puzzle_num " + puzzleNum + " maps to " + expectedDate + ", not " + date;
            }
        }

        if (hasPuzzleNum && hasAnswer) {
            var expectedAnswer = this.puzzleNumToAnswer(puzzleNum);
            if (expectedAnswer !== answer) {
                flag = "puzzle_num " + puzzleNum + " maps to answer \"" + expectedAnswer + "\", not \"" + answer + "\"";
            }
        }

        if (hasDate && hasAnswer && !hasPuzzleNum) {
            var derivedFromDate = this.dateToPuzzleNum(date);
            if (derivedFromDate === null) {
                flag = "date " + date + " is before puzzle start";
            } else {
                var expectedFromDate = this.puzzleNumToAnswer(derivedFromDate);
                if (expectedFromDate !== answer) {
                    flag = "date " + date + " (puzzle #" + derivedFromDate + ") maps to answer \"" + expectedFromDate + "\", not \"" + answer + "\"";
                }
            }
        }

        if (flag) {
            return { entry: null, flag: flag };
        }

        // Derive missing fields
        if (!hasPuzzleNum && hasDate) {
            puzzleNum = this.dateToPuzzleNum(date);
            if (puzzleNum === null) {
                return { entry: null, flag: "date " + date + " is before puzzle start" };
            }
        }
        if (!hasPuzzleNum && !hasDate && hasAnswer) {
            puzzleNum = this.answerToPuzzleNum(answer);
            if (puzzleNum === null) {
                return { entry: null, flag: "answer \"" + answer + "\" not found in answer list" };
            }
        }
        if (!hasDate) {
            date = this.puzzleNumToDate(puzzleNum);
        }
        if (!hasAnswer) {
            answer = this.puzzleNumToAnswer(puzzleNum);
        }

        return {
            entry: {
                puzzle_num: puzzleNum,
                date: date,
                result: result,
                answer: answer,
                mode: null,
                starter: null,
                completed_at: null,
                updated_at: null,
                device_id: null,
                origin: null
            },
            flag: null
        };
    }
}


class HistoryManager {
    constructor(resolver) {
        this.resolver = resolver;
        this.HISTORY_AUTHORITATIVE_MODEL = "history_authoritative_v1";
        this.DEVICE_ID_KEY = "device_id";
    }

    static get HISTORY_BASE_FIELDS() {
        return [
            "puzzle_num",
            "date",
            "result",
            "answer",
            "mode",
            "starter",
            "completed_at",
            "updated_at",
            "device_id",
            "origin"
        ];
    }

    static toDefaultStats() {
        return {
            currentStreak: 0,
            maxStreak: 0,
            guesses: {
                1: 0,
                2: 0,
                3: 0,
                4: 0,
                5: 0,
                6: 0,
                fail: 0
            },
            winPercentage: 0,
            gamesPlayed: 0,
            gamesWon: 0,
            averageGuesses: 0
        };
    }

    getHistoryObject() {
        return StorageController.history.getAll();
    }

    setHistoryObject(history) {
        StorageController.history.replace(history || {});
    }

    getLegacyStatsObject() {
        return StorageController.legacyStats.get() || {};
    }

    setLegacyStatsObject(legacy) {
        StorageController.legacyStats.set(legacy || {});
    }

    createZeroTotals() {
        return {
            gamesPlayed: 0,
            gamesWon: 0,
            guesses: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, fail: 0 }
        };
    }

    normalizeStatsTotals(stats) {
        stats = stats || {};
        var guesses = stats.guesses || {};
        return {
            gamesPlayed: Number(stats.gamesPlayed) || 0,
            gamesWon: Number(stats.gamesWon) || 0,
            currentStreak: Number(stats.currentStreak) || 0,
            maxStreak: Number(stats.maxStreak) || 0,
            guesses: {
                1: Number(guesses[1]) || 0,
                2: Number(guesses[2]) || 0,
                3: Number(guesses[3]) || 0,
                4: Number(guesses[4]) || 0,
                5: Number(guesses[5]) || 0,
                6: Number(guesses[6]) || 0,
                fail: Number(guesses.fail) || 0
            }
        };
    }

    createZeroLegacyForHistoryAuthoritative() {
        return {
            model: this.HISTORY_AUTHORITATIVE_MODEL,
            totals_delta: this.createZeroTotals(),
            current_streak_adjustment: {
                delta: 0,
                anchor_puzzle_num: -1
            },
            max_streak_floor: 0,
            recorded_on: this.resolver.formatLocalDate(new Date())
        };
    }

    backupLegacyStatsIfNeeded(currentLegacy) {
        if (!currentLegacy || typeof currentLegacy !== "object") return;
        if (!Object.keys(currentLegacy).length) return;
        if (currentLegacy.model === this.HISTORY_AUTHORITATIVE_MODEL) return;
        if (StorageController.legacyStatsBackup.get() !== null) return;
        StorageController.legacyStatsBackup.set(currentLegacy);
    }

    setHistoryAuthoritativeLegacyZeroed() {
        var currentLegacy = this.getLegacyStatsObject();
        this.backupLegacyStatsIfNeeded(currentLegacy);
        this.setLegacyStatsObject(this.createZeroLegacyForHistoryAuthoritative());
    }

    computeHistoryMinimums(history) {
        var totals = this.normalizeStatsTotals(this.createZeroTotals());
        var entries = Object.values(history || {}).map(function(entry) {
            if (!entry) return null;
            var puzzleNum = Number(entry.puzzle_num);
            var result = Number(entry.result);
            if (!Number.isFinite(puzzleNum) || !Number.isFinite(result)) return null;
            return { puzzle_num: puzzleNum, result: result };
        }).filter(Boolean).sort(function(a, b) {
            return a.puzzle_num - b.puzzle_num;
        });

        var currentStreak = 0;
        var maxStreak = 0;
        var lastPuzzle = null;
        var lastWasWin = false;

        entries.forEach(function(entry) {
            if (entry.result >= 1 && entry.result <= 6) {
                totals.gamesPlayed += 1;
                totals.gamesWon += 1;
                totals.guesses[entry.result] += 1;

                if (lastWasWin && lastPuzzle !== null && entry.puzzle_num === lastPuzzle + 1) {
                    currentStreak += 1;
                } else {
                    currentStreak = 1;
                }
                if (currentStreak > maxStreak) maxStreak = currentStreak;
                lastWasWin = true;
                lastPuzzle = entry.puzzle_num;
                return;
            }

            if (entry.result === 7) {
                totals.gamesPlayed += 1;
                totals.guesses.fail += 1;
                currentStreak = 0;
                lastWasWin = false;
                lastPuzzle = entry.puzzle_num;
            }
        });

        totals.currentStreak = currentStreak;
        totals.maxStreak = maxStreak;
        totals.latestPuzzleNum = entries.length ? entries[entries.length - 1].puzzle_num : -1;
        return totals;
    }

    buildHistoryAuthoritativeLegacyFromTarget(historyMinimums, targetTotals) {
        var currentDelta = targetTotals.currentStreak - historyMinimums.currentStreak;
        return {
            model: this.HISTORY_AUTHORITATIVE_MODEL,
            totals_delta: {
                gamesPlayed: targetTotals.gamesPlayed - historyMinimums.gamesPlayed,
                gamesWon: targetTotals.gamesWon - historyMinimums.gamesWon,
                guesses: {
                    1: targetTotals.guesses[1] - historyMinimums.guesses[1],
                    2: targetTotals.guesses[2] - historyMinimums.guesses[2],
                    3: targetTotals.guesses[3] - historyMinimums.guesses[3],
                    4: targetTotals.guesses[4] - historyMinimums.guesses[4],
                    5: targetTotals.guesses[5] - historyMinimums.guesses[5],
                    6: targetTotals.guesses[6] - historyMinimums.guesses[6],
                    fail: targetTotals.guesses.fail - historyMinimums.guesses.fail
                }
            },
            current_streak_adjustment: {
                delta: currentDelta,
                anchor_puzzle_num: historyMinimums.latestPuzzleNum
            },
            max_streak_floor: targetTotals.maxStreak,
            recorded_on: this.resolver.formatLocalDate(new Date())
        };
    }

    hasNegativeTotalsDelta(legacyWithDelta) {
        var delta = legacyWithDelta && legacyWithDelta.totals_delta ? legacyWithDelta.totals_delta : this.createZeroTotals();
        if ((Number(delta.gamesPlayed) || 0) < 0) return true;
        if ((Number(delta.gamesWon) || 0) < 0) return true;
        var guesses = delta.guesses || {};
        if ((Number(guesses.fail) || 0) < 0) return true;
        for (var i = 1; i <= 6; i += 1) {
            if ((Number(guesses[i]) || 0) < 0) return true;
        }
        return false;
    }

    hasTargetBelowHistoryMinimums(targetTotals, historyMinimums) {
        if (targetTotals.gamesPlayed < historyMinimums.gamesPlayed) return true;
        if (targetTotals.gamesWon < historyMinimums.gamesWon) return true;
        if (targetTotals.currentStreak < historyMinimums.currentStreak) return true;
        if (targetTotals.maxStreak < historyMinimums.maxStreak) return true;
        if (targetTotals.maxStreak < targetTotals.currentStreak) return true;
        if (targetTotals.guesses.fail < historyMinimums.guesses.fail) return true;
        for (var i = 1; i <= 6; i += 1) {
            if (targetTotals.guesses[i] < historyMinimums.guesses[i]) return true;
        }
        return false;
    }

    formatHistoryMinimumsMessage(historyMinimums) {
        return "Values cannot be below history minimums: Played " + historyMinimums.gamesPlayed +
            ", Won " + historyMinimums.gamesWon +
            ", Current Streak " + historyMinimums.currentStreak +
            ", Max Streak " + historyMinimums.maxStreak + ".";
    }

    computeDerivedFromTotals(totals) {
        var guessSum = 0;
        for (var i = 1; i <= 6; i += 1) {
            guessSum += i * (totals.guesses[i] || 0);
        }
        return {
            winPercentage: totals.gamesPlayed ? Math.round(totals.gamesWon / totals.gamesPlayed * 100) : 0,
            averageGuesses: totals.gamesWon ? Math.round(guessSum / totals.gamesWon) : 0
        };
    }

    validateAdjustTotals(targetTotals) {
        if (!Number.isFinite(targetTotals.gamesPlayed) || !Number.isFinite(targetTotals.gamesWon)) {
            return "Use whole numbers 0 or greater.";
        }
        if (!Number.isFinite(targetTotals.currentStreak) || !Number.isFinite(targetTotals.maxStreak)) {
            return "Use whole numbers 0 or greater.";
        }
        for (var i = 1; i <= 6; i += 1) {
            if (!Number.isFinite(targetTotals.guesses[i])) return "Use whole numbers 0 or greater.";
        }
        if (!Number.isFinite(targetTotals.guesses.fail)) return "Use whole numbers 0 or greater.";

        if (targetTotals.gamesWon > targetTotals.gamesPlayed) {
            return "Games Won cannot be greater than Games Played.";
        }

        var winsByGuess = 0;
        for (var j = 1; j <= 6; j += 1) {
            winsByGuess += targetTotals.guesses[j];
        }
        var totalByGuess = winsByGuess + targetTotals.guesses.fail;

        if (totalByGuess !== targetTotals.gamesPlayed) {
            return "Guess totals (1-6 + Failed) must equal Games Played.";
        }
        if (winsByGuess !== targetTotals.gamesWon) {
            return "Winning guess totals (1-6) must equal Games Won.";
        }
        if (targetTotals.maxStreak < targetTotals.currentStreak) {
            return "Max Streak must be greater than or equal to Current Streak.";
        }

        return null;
    }

    getHistoryExportShape(historyEntries) {
        var fieldSet = Object.create(null);
        HistoryManager.HISTORY_BASE_FIELDS.forEach(function(field) {
            fieldSet[field] = true;
        });

        historyEntries.forEach(function(entry) {
            Object.keys(entry || {}).forEach(function(field) {
                fieldSet[field] = true;
            });
        });

        var extraFields = Object.keys(fieldSet).filter(function(field) {
            return !HistoryManager.HISTORY_BASE_FIELDS.includes(field);
        }).sort();

        return HistoryManager.HISTORY_BASE_FIELDS.concat(extraFields);
    }

    normalizeEntryForExport(entry, fields) {
        var row = {};
        fields.forEach(function(field) {
            row[field] = entry[field] === undefined ? null : entry[field];
        });
        return row;
    }

    exportAsJson() {
        var history = this.getHistoryObject();
        var entries = Object.values(history).filter(Boolean).sort(function(a, b) {
            return (Number(a.puzzle_num) || 0) - (Number(b.puzzle_num) || 0);
        });
        var fields = this.getHistoryExportShape(entries);
        var self = this;
        var rows = entries.map(function(entry) {
            return self.normalizeEntryForExport(entry, fields);
        });

        return {
            filename: "wordle_history_" + this.resolver.formatLocalDate(new Date()) + ".json",
            content: JSON.stringify(rows, null, 2),
            mimeType: "application/json"
        };
    }

    exportAsCsv() {
        var history = this.getHistoryObject();
        var entries = Object.values(history).filter(Boolean).sort(function(a, b) {
            return (Number(a.puzzle_num) || 0) - (Number(b.puzzle_num) || 0);
        });
        var fields = this.getHistoryExportShape(entries);
        var self = this;

        var lines = [];
        lines.push(fields.join(","));

        entries.forEach(function(entry) {
            var normalized = self.normalizeEntryForExport(entry, fields);
            var row = fields.map(function(field) {
                return self.resolver.escapeCsvValue(normalized[field]);
            });
            lines.push(row.join(","));
        });

        return {
            filename: "wordle_history_" + this.resolver.formatLocalDate(new Date()) + ".csv",
            content: lines.join("\n"),
            mimeType: "text/csv"
        };
    }

    buildFlaggedRowsCsv(flaggedRows) {
        var self = this;
        var lines = ["row,reason,raw_data"];
        flaggedRows.forEach(function(f) {
            var rawStr = JSON.stringify(f.raw).replace(/"/g, '""');
            lines.push(self.resolver.escapeCsvValue(f.row) + "," + self.resolver.escapeCsvValue(f.reason) + ",\"" + rawStr + "\"");
        });
        return lines.join("\n");
    }

    getCurrentStatsForAdjustment() {
        if (window.wordleStats && typeof window.wordleStats.compute === "function") {
            return this.normalizeStatsTotals(window.wordleStats.compute());
        }
        var raw = StorageController.statistics.getAll();
        if (!raw || !Object.keys(raw).length) raw = HistoryManager.toDefaultStats();
        return this.normalizeStatsTotals(raw);
    }

    recomputeStatisticsAfterHistoryImport() {
        if (window.wordleStats && typeof window.wordleStats.recompute === "function") {
            window.wordleStats.recompute();
        }
    }

    importRecords(rawRecords) {
        var self = this;
        var localHistory = this.getHistoryObject();
        var changedPuzzleNums = [];
        var flaggedRows = [];
        var validCount = 0;
        var addedCount = 0;
        var stagedByPuzzle = {};

        rawRecords.forEach(function(raw, index) {
            var resolved = self.resolver.resolveAndValidateEntry(raw, index);
            if (resolved.flag) {
                flaggedRows.push({ row: index + 1, raw: raw, reason: resolved.flag });
                return;
            }
            var entry = resolved.entry;
            if (!entry) return;
            validCount += 1;

            var key = String(entry.puzzle_num);
            if (stagedByPuzzle[key]) {
                flaggedRows.push({ row: index + 1, raw: raw, reason: "puzzle #" + key + " is a duplicate of another row in this file" });
                return;
            }
            if (localHistory[key]) {
                flaggedRows.push({ row: index + 1, raw: raw, reason: "puzzle #" + key + " already exists in history" });
                return;
            }

            entry.origin = "imported";
            stagedByPuzzle[key] = entry;
            localHistory[key] = entry;
            changedPuzzleNums.push(entry.puzzle_num);
            addedCount += 1;
        });

        if (changedPuzzleNums.length) {
            this.setHistoryObject(localHistory);
        }

        this.setHistoryAuthoritativeLegacyZeroed();
        this.recomputeStatisticsAfterHistoryImport();

        return {
            addedCount: addedCount,
            validCount: validCount,
            flaggedRows: flaggedRows,
            changedPuzzleNums: changedPuzzleNums
        };
    }
}


class SaveMenu {
    constructor(historyManager) {
        this.historyManager = historyManager;
        this.resolver = historyManager.resolver;
    }

    static showStatus(element, message, isError) {
        if (!element) return;
        element.textContent = message;
        element.style.color = isError ? "#d64242" : "";
    }

    static flashElement(element) {
        if (!element) return;
        element.classList.add("flash");
        setTimeout(function() {
            element.classList.remove("flash");
        }, 200);
    }

    static createDownload(filename, content, mimeType) {
        var file = new Blob([content], { type: mimeType || "text/plain" });
        var link = document.createElement("a");
        var url = URL.createObjectURL(file);
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        setTimeout(function() {
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        }, 0);
    }

    openStatsModalFromSaveMenu() {
        var app = document.querySelector("game-app");
        if (app && typeof app.showStatsModal === "function") {
            app.showStatsModal();
        }
    }

    setImportSummaryLine(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    openHistoryImportSummaryModal(summary) {
        var self = this;
        var modal = document.getElementById("history-import-summary-modal");
        if (!modal) return;

        var p = summary.processed;
        var n = summary.newGames;
        this.setImportSummaryLine("history-import-summary-line1", p + (p === 1 ? " game was" : " games were") + " processed from your file.");
        this.setImportSummaryLine("history-import-summary-line2", n + " of " + (n === 1 ? "those was" : "those were") + " not previously recorded in your history.");
        this.setImportSummaryLine("history-import-summary-line3", n + (n === 1 ? " new game was" : " new games were") + " counted toward stats and streaks.");
        this.setImportSummaryLine("history-import-summary-line4", "Legacy baseline was reset so history is now the authoritative source.");

        // Handle flagged rows
        var flaggedContainer = document.getElementById("history-import-summary-flagged");
        var flaggedTable = document.getElementById("history-import-summary-flagged-table");
        var downloadButton = document.getElementById("history-import-summary-download-flagged");
        var flaggedRows = summary.flaggedRows || [];

        if (flaggedContainer) {
            if (flaggedRows.length) {
                flaggedContainer.classList.remove("hidden");

                if (flaggedTable) {
                    var tbody = flaggedTable.querySelector("tbody");
                    if (tbody) {
                        tbody.innerHTML = "";
                        flaggedRows.forEach(function(f) {
                            var tr = document.createElement("tr");
                            var tdRow = document.createElement("td");
                            tdRow.textContent = f.row;
                            var tdReason = document.createElement("td");
                            tdReason.textContent = f.reason;
                            var tdData = document.createElement("td");
                            var fields = Object.keys(f.raw).map(function(k) {
                                return k + "=" + (f.raw[k] === undefined || f.raw[k] === null ? "" : f.raw[k]);
                            });
                            tdData.textContent = fields.join(", ");
                            tr.appendChild(tdRow);
                            tr.appendChild(tdReason);
                            tr.appendChild(tdData);
                            tbody.appendChild(tr);
                        });
                    }
                }

                if (downloadButton) {
                    downloadButton.onclick = function() {
                        SaveMenu.createDownload(
                            "wordle_import_flagged_" + self.resolver.formatLocalDate(new Date()) + ".csv",
                            self.historyManager.buildFlaggedRowsCsv(flaggedRows),
                            "text/csv"
                        );
                    };
                }
            } else {
                flaggedContainer.classList.add("hidden");
            }
        }

        modal.classList.remove("hidden");
    }

    closeHistoryImportSummaryModal(showStats) {
        var modal = document.getElementById("history-import-summary-modal");
        if (!modal) return;
        modal.classList.add("hidden");
        if (showStats) this.openStatsModalFromSaveMenu();
    }

    wireHistoryImportSummaryModal() {
        var self = this;
        var closeButton = document.getElementById("history-import-summary-close");
        var viewStatsButton = document.getElementById("history-import-summary-view-stats");
        if (closeButton) {
            closeButton.addEventListener("click", function() {
                self.closeHistoryImportSummaryModal(true);
            });
        }
        if (viewStatsButton) {
            viewStatsButton.addEventListener("click", function() {
                self.closeHistoryImportSummaryModal(true);
            });
        }
    }

    async handleHistoryImportFile(file, statusElement, loadButtonElement) {
        if (!file) return;

        SaveMenu.showStatus(statusElement, "Importing history...", false);
        SaveMenu.flashElement(loadButtonElement);

        try {
            var text = await file.text();
            var rawRecords = this.resolver.parseImportRecords(text, file.name);
            if (!rawRecords.length) {
                SaveMenu.showStatus(statusElement, "No history rows found in file", true);
                return;
            }

            var result = this.historyManager.importRecords(rawRecords);

            if (!result.changedPuzzleNums.length) {
                var noChangeMessage = "Import complete: no new games added";
                if (result.flaggedRows.length) {
                    noChangeMessage += " (" + result.flaggedRows.length + " flagged rows skipped)";
                }
                if (!result.validCount) {
                    SaveMenu.showStatus(statusElement, noChangeMessage, false);
                    if (result.flaggedRows.length) {
                        this.openHistoryImportSummaryModal({
                            processed: rawRecords.length,
                            newGames: 0,
                            flaggedRows: result.flaggedRows
                        });
                    }
                    return;
                }
                SaveMenu.showStatus(statusElement, noChangeMessage + "; stats recalculated from full history", false);
                this.openHistoryImportSummaryModal({
                    processed: rawRecords.length,
                    newGames: 0,
                    flaggedRows: result.flaggedRows
                });
                return;
            }

            var statusMessage = "Import complete: " + result.addedCount + " new games added";
            if (result.flaggedRows.length) statusMessage += ", " + result.flaggedRows.length + " flagged";
            SaveMenu.showStatus(statusElement, statusMessage, false);

            this.openHistoryImportSummaryModal({
                processed: rawRecords.length,
                newGames: result.addedCount,
                flaggedRows: result.flaggedRows
            });
        } catch (err) {
            console.error("History import failed", err);
            SaveMenu.showStatus(statusElement, "History import failed: " + (err && err.message ? err.message : "unknown error"), true);
        }
    }

    openAdjustStatsModal(statusElement) {
        var modal = document.getElementById("adjust-stats-modal");
        if (!modal) return;

        var inputs = {
            gamesPlayed: document.getElementById("adjust-gamesPlayed"),
            gamesWon: document.getElementById("adjust-gamesWon"),
            currentStreak: document.getElementById("adjust-currentStreak"),
            maxStreak: document.getElementById("adjust-maxStreak"),
            g1: document.getElementById("adjust-g1"),
            g2: document.getElementById("adjust-g2"),
            g3: document.getElementById("adjust-g3"),
            g4: document.getElementById("adjust-g4"),
            g5: document.getElementById("adjust-g5"),
            g6: document.getElementById("adjust-g6"),
            gfail: document.getElementById("adjust-gfail")
        };
        var preview = {
            winPercentage: document.getElementById("adjust-preview-winPercentage"),
            averageGuesses: document.getElementById("adjust-preview-averageGuesses")
        };
        var errorEl = document.getElementById("adjust-stats-error");

        var stats = this.historyManager.getCurrentStatsForAdjustment();
        inputs.gamesPlayed.value = stats.gamesPlayed;
        inputs.gamesWon.value = stats.gamesWon;
        inputs.currentStreak.value = stats.currentStreak;
        inputs.maxStreak.value = stats.maxStreak;
        for (var i = 1; i <= 6; i += 1) {
            inputs["g" + i].value = stats.guesses[i];
        }
        inputs.gfail.value = stats.guesses.fail;

        if (errorEl) errorEl.textContent = "";

        this.updateAdjustStatsPreview(inputs, preview);
        modal.classList.remove("hidden");
        SaveMenu.showStatus(statusElement, "Adjusting stats totals...", false);
    }

    closeAdjustStatsModal() {
        var modal = document.getElementById("adjust-stats-modal");
        if (!modal) return;
        modal.classList.add("hidden");
    }

    getAdjustTotalsFromInputs(inputs) {
        function parseField(input) {
            if (!input) return NaN;
            var value = String(input.value || "").trim();
            if (!/^\d+$/.test(value)) return NaN;
            return parseInt(value, 10);
        }

        return {
            gamesPlayed: parseField(inputs.gamesPlayed),
            gamesWon: parseField(inputs.gamesWon),
            currentStreak: parseField(inputs.currentStreak),
            maxStreak: parseField(inputs.maxStreak),
            guesses: {
                1: parseField(inputs.g1),
                2: parseField(inputs.g2),
                3: parseField(inputs.g3),
                4: parseField(inputs.g4),
                5: parseField(inputs.g5),
                6: parseField(inputs.g6),
                fail: parseField(inputs.gfail)
            }
        };
    }

    updateAdjustStatsPreview(inputs, preview) {
        var totals = this.getAdjustTotalsFromInputs(inputs);
        var validationError = this.historyManager.validateAdjustTotals(totals);
        var winPct = 0;
        var avgGuesses = 0;

        if (!validationError) {
            var derived = this.historyManager.computeDerivedFromTotals(totals);
            winPct = derived.winPercentage;
            avgGuesses = derived.averageGuesses;
        }

        if (preview.winPercentage) preview.winPercentage.textContent = String(winPct);
        if (preview.averageGuesses) preview.averageGuesses.textContent = String(avgGuesses);
    }

    wireAdjustStatsModal(statusElement) {
        var self = this;
        var openButton = document.getElementById("adjustStatsButton");
        var applyButton = document.getElementById("adjust-stats-apply");
        var cancelButton = document.getElementById("adjust-stats-cancel");
        var errorEl = document.getElementById("adjust-stats-error");

        var inputs = {
            gamesPlayed: document.getElementById("adjust-gamesPlayed"),
            gamesWon: document.getElementById("adjust-gamesWon"),
            currentStreak: document.getElementById("adjust-currentStreak"),
            maxStreak: document.getElementById("adjust-maxStreak"),
            g1: document.getElementById("adjust-g1"),
            g2: document.getElementById("adjust-g2"),
            g3: document.getElementById("adjust-g3"),
            g4: document.getElementById("adjust-g4"),
            g5: document.getElementById("adjust-g5"),
            g6: document.getElementById("adjust-g6"),
            gfail: document.getElementById("adjust-gfail")
        };
        var preview = {
            winPercentage: document.getElementById("adjust-preview-winPercentage"),
            averageGuesses: document.getElementById("adjust-preview-averageGuesses")
        };

        function setError(message) {
            if (!errorEl) return;
            errorEl.textContent = message || "";
        }

        var inputList = Object.values(inputs).filter(Boolean);
        inputList.forEach(function(input) {
            input.addEventListener("input", function() {
                self.updateAdjustStatsPreview(inputs, preview);
                setError("");
            });
        });

        if (openButton) {
            openButton.addEventListener("click", function() {
                SaveMenu.flashElement(openButton);
                self.openAdjustStatsModal(statusElement);
            });
        }

        if (cancelButton) {
            cancelButton.addEventListener("click", function() {
                self.closeAdjustStatsModal();
                SaveMenu.showStatus(statusElement, "Adjustment cancelled", false);
            });
        }

        if (applyButton) {
            applyButton.addEventListener("click", function() {
                var targetTotals = self.getAdjustTotalsFromInputs(inputs);
                var validationError = self.historyManager.validateAdjustTotals(targetTotals);
                if (validationError) {
                    setError(validationError);
                    return;
                }

                var history = self.historyManager.getHistoryObject();
                var historyMinimums = self.historyManager.computeHistoryMinimums(history);
                if (self.historyManager.hasTargetBelowHistoryMinimums(targetTotals, historyMinimums)) {
                    setError(self.historyManager.formatHistoryMinimumsMessage(historyMinimums));
                    return;
                }

                var nextLegacy = self.historyManager.buildHistoryAuthoritativeLegacyFromTarget(historyMinimums, targetTotals);
                if (self.historyManager.hasNegativeTotalsDelta(nextLegacy)) {
                    setError("Values cannot be lower than history-derived totals.");
                    return;
                }
                self.historyManager.backupLegacyStatsIfNeeded(self.historyManager.getLegacyStatsObject());

                self.historyManager.setLegacyStatsObject(nextLegacy);
                self.historyManager.recomputeStatisticsAfterHistoryImport();
                self.closeAdjustStatsModal();
                SaveMenu.showStatus(statusElement, "Stats adjustment applied", false);
                self.openStatsModalFromSaveMenu();
            });
        }
    }

    wireStatsImportExport(statusElement) {
        var self = this;
        var saveButton = document.getElementById("saveButton");
        var loadInput = document.getElementById("inputload");

        if (saveButton) {
            saveButton.addEventListener("click", function() {
                SaveMenu.flashElement(saveButton);
                var statsObject = StorageController.statistics.getAll();
                if (!statsObject || !Object.keys(statsObject).length) statsObject = HistoryManager.toDefaultStats();
                var stats = JSON.stringify(statsObject);
                SaveMenu.createDownload(
                    "wordle_stats_" + self.resolver.formatLocalDate(new Date()) + ".json",
                    stats,
                    "application/json"
                );
                SaveMenu.showStatus(statusElement, "Statistics exported", false);
            });
        }

        if (loadInput) {
            loadInput.addEventListener("change", function() {
                var file = loadInput.files && loadInput.files[0];
                if (!file) return;

                file.text().then(function(text) {
                    var json = self.resolver.safeParseJSON(text, null);
                    if (!json) throw new Error("Invalid JSON");
                    StorageController.statistics.replace(json);
                    SaveMenu.showStatus(statusElement, "Statistics loaded. Reloading...", false);
                    window.location.reload();
                }).catch(function(err) {
                    console.error("Could not load stats", err);
                    SaveMenu.showStatus(statusElement, "Could not load stats", true);
                }).finally(function() {
                    loadInput.value = "";
                });
            });
        }
    }

    wireHistoryImportExport(statusElement) {
        var self = this;
        var exportJsonButton = document.getElementById("exportHistoryJsonButton");
        var exportCsvButton = document.getElementById("exportHistoryCsvButton");
        var loadHistoryButton = document.getElementById("loadHistoryButton");
        var loadHistoryInput = document.getElementById("inputHistoryLoad");

        if (exportJsonButton) {
            exportJsonButton.addEventListener("click", function() {
                SaveMenu.flashElement(exportJsonButton);
                var exportData = self.historyManager.exportAsJson();
                SaveMenu.createDownload(exportData.filename, exportData.content, exportData.mimeType);
                SaveMenu.showStatus(statusElement, "History exported (JSON)", false);
            });
        }

        if (exportCsvButton) {
            exportCsvButton.addEventListener("click", function() {
                SaveMenu.flashElement(exportCsvButton);
                var exportData = self.historyManager.exportAsCsv();
                SaveMenu.createDownload(exportData.filename, exportData.content, exportData.mimeType);
                SaveMenu.showStatus(statusElement, "History exported (CSV)", false);
            });
        }

        if (loadHistoryInput) {
            loadHistoryInput.addEventListener("change", function() {
                var file = loadHistoryInput.files && loadHistoryInput.files[0];
                if (!file) return;
                self.handleHistoryImportFile(file, statusElement, loadHistoryButton).finally(function() {
                    loadHistoryInput.value = "";
                });
            });
        }
    }

    collectAllSettings() {
        var data = {};
        for (var i = 0; i < window.localStorage.length; i++) {
            var key = window.localStorage.key(i);
            var raw = window.localStorage.getItem(key);
            try { data[key] = JSON.parse(raw); } catch (e) { data[key] = raw; }
        }
        return data;
    }

    wireTroubleshootingSection(statusElement) {
        var self = this;
        var downloadButton = document.getElementById("downloadAllSettingsButton");
        var sendButton = document.getElementById("sendSettingsToDevelopersButton");

        if (downloadButton) {
            downloadButton.addEventListener("click", function() {
                SaveMenu.flashElement(downloadButton);
                var data = self.collectAllSettings();
                var filename = "left_wordle_settings_" + self.resolver.formatLocalDate(new Date()) + ".json";
                SaveMenu.createDownload(filename, JSON.stringify(data, null, 2), "application/json");
                SaveMenu.showStatus(statusElement, "Settings downloaded", false);
            });
        }

        if (sendButton) {
            sendButton.addEventListener("click", function() {
                SaveMenu.flashElement(sendButton);
                sendButton.disabled = true;
                SaveMenu.showStatus(statusElement, "Sending settings...", false);
                var data = self.collectAllSettings();
                window.LeftWordleApi.client.submitDiagnostics(data)
                    .then(function() {
                        SaveMenu.showStatus(statusElement, "Settings sent to developers", false);
                    })
                    .catch(function(err) {
                        var msg = (err && err.status === 503)
                            ? "Unable to send — please use Download All Settings instead"
                            : "Failed to send — please try again or use Download All Settings";
                        SaveMenu.showStatus(statusElement, msg, true);
                    })
                    .finally(function() {
                        sendButton.disabled = false;
                    });
            });
        }
    }

    init() {
        var closeButton = document.getElementById("save-close");
        var saveModal = document.querySelector("#save");
        var statusElement = document.getElementById("save-status");

        if (closeButton && saveModal) {
            closeButton.addEventListener("click", function() {
                saveModal.classList.toggle("hidden");
            });
        }

        this.wireStatsImportExport(statusElement);
        this.wireHistoryImportExport(statusElement);
        this.wireHistoryImportSummaryModal();
        this.wireAdjustStatsModal(statusElement);
        this.wireTroubleshootingSection(statusElement);
    }
}


// Expose classes for testing
window.savemenuTestExports = {
    PuzzleResolver: PuzzleResolver,
    HistoryManager: HistoryManager,
    SaveMenu: SaveMenu
};

// Bootstrap
(function() {
    var resolver = new PuzzleResolver(window.answer_list, window.PUZZLE_START_DATE);
    var manager = new HistoryManager(resolver);
    var menu = new SaveMenu(manager);

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function() { menu.init(); });
    } else {
        menu.init();
    }
})();
