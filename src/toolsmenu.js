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
        var cleaned = text.replace(/^﻿/, "").trim();
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

    getHistoryObject() {
        return StorageController.history.getAll();
    }

    setHistoryObject(history) {
        StorageController.history.replace(history || {});
    }

    getCurrentStatsForAdjustment() {
        var raw = StorageController.statistics.getAll();
        if (!raw || !Object.keys(raw).length) {
            return { currentStreak: 0, maxStreak: 0, guesses: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, fail: 0 }, winPercentage: 0, gamesPlayed: 0, gamesWon: 0, averageGuesses: 0 };
        }
        return raw;
    }

    computeDerivedFromTotals(totals) {
        var guessSum = 0;
        for (var i = 1; i <= 6; i += 1) {
            guessSum += i * (totals.guesses[i] || 0);
        }
        return {
            winPercentage: totals.gamesPlayed ? Math.round(totals.gamesWon / totals.gamesPlayed * 100) : 0,
            averageGuesses: totals.gamesWon ? Math.round(guessSum / totals.gamesWon * 100) / 100 : 0
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
        return this.exportEntriesAsJson(Object.values(history).filter(Boolean), "");
    }

    // Factored out of exportAsJson so ToolsMenu can build the same export
    // shape from server-fetched history entries when the user is logged in
    // (see ToolsMenu#exportHistory) without duplicating the row-shaping logic.
    exportEntriesAsJson(entries, filenameSuffix) {
        var sorted = entries.slice().sort(function(a, b) {
            return (Number(a.puzzle_num) || 0) - (Number(b.puzzle_num) || 0);
        });
        var fields = this.getHistoryExportShape(sorted);
        var self = this;
        var rows = sorted.map(function(entry) {
            return self.normalizeEntryForExport(entry, fields);
        });

        return {
            filename: "wordle_history_" + this.resolver.formatLocalDate(new Date()) + (filenameSuffix || "") + ".json",
            content: JSON.stringify(rows, null, 2),
            mimeType: "application/json"
        };
    }

    exportAsCsv() {
        var history = this.getHistoryObject();
        return this.exportEntriesAsCsv(Object.values(history).filter(Boolean), "");
    }

    exportEntriesAsCsv(entries, filenameSuffix) {
        var sorted = entries.slice().sort(function(a, b) {
            return (Number(a.puzzle_num) || 0) - (Number(b.puzzle_num) || 0);
        });
        var fields = this.getHistoryExportShape(sorted);
        var self = this;

        var lines = [];
        lines.push(fields.join(","));

        sorted.forEach(function(entry) {
            var normalized = self.normalizeEntryForExport(entry, fields);
            var row = fields.map(function(field) {
                return self.resolver.escapeCsvValue(normalized[field]);
            });
            lines.push(row.join(","));
        });

        return {
            filename: "wordle_history_" + this.resolver.formatLocalDate(new Date()) + (filenameSuffix || "") + ".csv",
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

        return {
            addedCount: addedCount,
            validCount: validCount,
            flaggedRows: flaggedRows,
            changedPuzzleNums: changedPuzzleNums
        };
    }
}


class ToolsMenu {
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
        this.setImportSummaryLine("history-import-summary-line3", n + (n === 1 ? " new game was" : " new games were") + " added to your history.");
        this.setImportSummaryLine("history-import-summary-line4", "Use Adjust Stats from the Statistics screen if your totals need correction.");

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
                        ToolsMenu.createDownload(
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

        ToolsMenu.showStatus(statusElement, "Importing history...", false);
        ToolsMenu.flashElement(loadButtonElement);

        try {
            var text = await file.text();
            var rawRecords = this.resolver.parseImportRecords(text, file.name);
            if (!rawRecords.length) {
                ToolsMenu.showStatus(statusElement, "No history rows found in file", true);
                return;
            }

            if (this.isLoggedIn()) {
                await this.importHistoryToServer(rawRecords, statusElement);
                return;
            }

            var result = this.historyManager.importRecords(rawRecords);

            if (!result.changedPuzzleNums.length) {
                var noChangeMessage = "Import complete: no new games added";
                if (result.flaggedRows.length) {
                    noChangeMessage += " (" + result.flaggedRows.length + " flagged rows skipped)";
                }
                if (!result.validCount) {
                    ToolsMenu.showStatus(statusElement, noChangeMessage, false);
                    if (result.flaggedRows.length) {
                        this.openHistoryImportSummaryModal({
                            processed: rawRecords.length,
                            newGames: 0,
                            flaggedRows: result.flaggedRows
                        });
                    }
                    return;
                }
                ToolsMenu.showStatus(statusElement, noChangeMessage, false);
                this.openHistoryImportSummaryModal({
                    processed: rawRecords.length,
                    newGames: 0,
                    flaggedRows: result.flaggedRows
                });
                return;
            }

            var statusMessage = "Import complete: " + result.addedCount + " new games added";
            if (result.flaggedRows.length) statusMessage += ", " + result.flaggedRows.length + " flagged";
            ToolsMenu.showStatus(statusElement, statusMessage, false);

            this.openHistoryImportSummaryModal({
                processed: rawRecords.length,
                newGames: result.addedCount,
                flaggedRows: result.flaggedRows
            });
        } catch (err) {
            console.error("History import failed", err);
            ToolsMenu.showStatus(statusElement, "History import failed: " + (err && err.message ? err.message : "unknown error"), true);
        }
    }

    async openAdjustStatsModal(statusElement) {
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

        var stats;
        if (this.isLoggedIn()) {
            try {
                var profile = await window.LeftWordleApi.client.getProfile();
                stats = (profile && Object.keys(profile.statistics || {}).length)
                    ? profile.statistics
                    : this.historyManager.getCurrentStatsForAdjustment();
            } catch (err) {
                ToolsMenu.showStatus(statusElement, "Couldn't load account stats — showing local stats instead", true);
                stats = this.historyManager.getCurrentStatsForAdjustment();
            }
        } else {
            stats = this.historyManager.getCurrentStatsForAdjustment();
        }

        inputs.gamesPlayed.value = stats.gamesPlayed || 0;
        inputs.gamesWon.value = stats.gamesWon || 0;
        inputs.currentStreak.value = stats.currentStreak || 0;
        inputs.maxStreak.value = stats.maxStreak || 0;
        for (var i = 1; i <= 6; i += 1) {
            inputs["g" + i].value = (stats.guesses && stats.guesses[i]) || 0;
        }
        inputs.gfail.value = (stats.guesses && stats.guesses.fail) || 0;

        if (errorEl) errorEl.textContent = "";

        this.updateAdjustStatsPreview(inputs, preview);
        modal.classList.remove("hidden");
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

        if (cancelButton) {
            cancelButton.addEventListener("click", function() {
                self.closeAdjustStatsModal();
                ToolsMenu.showStatus(statusElement, "Adjustment cancelled", false);
            });
        }

        if (applyButton) {
            applyButton.addEventListener("click", async function() {
                var targetTotals = self.getAdjustTotalsFromInputs(inputs);
                var validationError = self.historyManager.validateAdjustTotals(targetTotals);
                if (validationError) {
                    setError(validationError);
                    return;
                }

                var derived = self.historyManager.computeDerivedFromTotals(targetTotals);
                targetTotals.winPercentage = derived.winPercentage;
                targetTotals.averageGuesses = derived.averageGuesses;
                targetTotals.versionNumber = 1;

                if (self.isLoggedIn()) {
                    try {
                        // Server keeps a before/after audit snapshot of every
                        // manual adjustment (see api/app.rb stats_adjust_response).
                        await window.LeftWordleApi.client.adjustStats(targetTotals);
                    } catch (err) {
                        setError("Failed to save to your account: " + (err && err.message ? err.message : "unknown error"));
                        return;
                    }
                }
                // Keep the local cache in step too, so the stats screen
                // shown immediately after doesn't look like a no-op --
                // drift vs. the server is expected over time, not right
                // after the device that made the edit applies it.
                StorageController.statistics.replace(targetTotals);

                self.closeAdjustStatsModal();
                ToolsMenu.showStatus(statusElement, "Stats adjustment applied" + (self.isLoggedIn() ? " to your account" : ""), false);
                self.openStatsModalFromSaveMenu();
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
                ToolsMenu.flashElement(exportJsonButton);
                self.exportHistory("json", statusElement);
            });
        }

        if (exportCsvButton) {
            exportCsvButton.addEventListener("click", function() {
                ToolsMenu.flashElement(exportCsvButton);
                self.exportHistory("csv", statusElement);
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

    // True whenever the Tools modal should read/write server data instead
    // of (or in addition to) localStorage -- see api/app.rb's /api/v2/*
    // endpoints and client/src/auth.js.
    isLoggedIn() {
        return !!(window.LeftWordleAuth && window.LeftWordleAuth.isLoggedIn());
    }

    // Translates server played_games rows (see GET /api/v2/history) into
    // the same export-entry shape local history entries use, so
    // HistoryManager's existing field-shaping logic can be reused as-is.
    // The server doesn't store `answer`/`starter` directly -- `answer` is
    // re-derived from puzzle_num (deterministic), `starter` from the first
    // recorded guess when available.
    serverHistoryToExportEntries(serverHistory) {
        var resolver = this.resolver;
        return Object.values(serverHistory || {}).filter(Boolean).map(function(entry) {
            var guesses = Array.isArray(entry.guesses) ? entry.guesses : [];
            var result = entry.game_status === "WIN" ? (guesses.length || null)
                : (entry.game_status === "FAIL" ? 7 : null);
            return {
                puzzle_num: entry.puzzle_num,
                date: entry.date,
                result: result,
                answer: resolver.puzzleNumToAnswer(entry.puzzle_num),
                mode: entry.mode || null,
                starter: guesses.length ? guesses[0][0] : null,
                completed_at: entry.completed_at || null,
                updated_at: null,
                device_id: null,
                origin: "server"
            };
        });
    }

    async exportHistory(format, statusElement) {
        try {
            var loggedIn = this.isLoggedIn();
            var exportData;
            if (loggedIn) {
                var serverHistory = await window.LeftWordleApi.client.getHistory();
                var entries = this.serverHistoryToExportEntries(serverHistory);
                exportData = (format === "csv")
                    ? this.historyManager.exportEntriesAsCsv(entries, "_account")
                    : this.historyManager.exportEntriesAsJson(entries, "_account");
            } else {
                exportData = (format === "csv") ? this.historyManager.exportAsCsv() : this.historyManager.exportAsJson();
            }
            ToolsMenu.createDownload(exportData.filename, exportData.content, exportData.mimeType);
            ToolsMenu.showStatus(statusElement, "History exported (" + format.toUpperCase() + ")" + (loggedIn ? " from your account" : ""), false);
        } catch (err) {
            ToolsMenu.showStatus(statusElement, "Export failed: " + (err && err.message ? err.message : "unknown error"), true);
        }
    }

    // Repeatable "Tools > Import Games" while logged in -- distinct from
    // the one-time new-account import in auth.js#importLocalData. Format
    // validation happens client-side (same resolver used for local
    // imports); duplicate-vs-new detection is left entirely to the server
    // (POST /api/v2/history/import), which is the authoritative view of
    // this account's history.
    async importHistoryToServer(rawRecords, statusElement) {
        var self = this;
        var flaggedRows = [];
        var entries = [];

        rawRecords.forEach(function(raw, index) {
            var resolved = self.resolver.resolveAndValidateEntry(raw, index);
            if (resolved.flag) {
                flaggedRows.push({ row: index + 1, raw: raw, reason: resolved.flag });
                return;
            }
            var entry = resolved.entry;
            entries.push({
                puzzle_num: entry.puzzle_num,
                date: entry.date,
                mode: entry.mode || "regular",
                game_status: (entry.result >= 1 && entry.result <= 6) ? "WIN" : "FAIL",
                completed_at: entry.completed_at || null
            });
        });

        if (!entries.length) {
            var noneMessage = "Import complete: no valid rows found";
            if (flaggedRows.length) noneMessage += " (" + flaggedRows.length + " flagged rows skipped)";
            ToolsMenu.showStatus(statusElement, noneMessage, false);
            if (flaggedRows.length) {
                this.openHistoryImportSummaryModal({ processed: rawRecords.length, newGames: 0, flaggedRows: flaggedRows });
            }
            return;
        }

        var result = await window.LeftWordleApi.client.importHistory(entries);
        var statusMessage = "Import complete: " + result.imported + " new game(s) added to your account";
        if (result.skipped) statusMessage += ", " + result.skipped + " already recorded";
        if (flaggedRows.length) statusMessage += ", " + flaggedRows.length + " flagged";
        ToolsMenu.showStatus(statusElement, statusMessage, false);

        this.openHistoryImportSummaryModal({ processed: rawRecords.length, newGames: result.imported, flaggedRows: flaggedRows });
    }

    // Server data is additive here, never a replacement for the local dump
    // -- diagnosing local/server drift (expected once an account exists,
    // see auth.js) benefits from seeing both sides at once.
    async collectAllSettings() {
        var data = {};
        for (var i = 0; i < window.localStorage.length; i++) {
            var key = window.localStorage.key(i);
            var raw = window.localStorage.getItem(key);
            try { data[key] = JSON.parse(raw); } catch (e) { data[key] = raw; }
        }
        data.diagnostics = {
            server: window.location.hostname,
            version: window.APP_VERSION || null
        };

        if (this.isLoggedIn()) {
            try {
                var profile = await window.LeftWordleApi.client.getProfile();
                var history = await window.LeftWordleApi.client.getHistory();
                data.server = {
                    email: profile.email,
                    preferences: profile.preferences,
                    game_state: profile.game_state,
                    statistics: profile.statistics,
                    history: history
                };
            } catch (err) {
                data.server = { error: err && err.message ? err.message : "failed to load account data" };
            }
        }

        return data;
    }

    wireTroubleshootingSection(statusElement) {
        var self = this;
        var downloadButton = document.getElementById("downloadAllSettingsButton");
        var sendButton = document.getElementById("sendSettingsToDevelopersButton");
        var contactModal = document.getElementById("send-settings-contact-modal");
        var contactInput = document.getElementById("send-settings-contact-input");
        var contactSendButton = document.getElementById("send-settings-contact-send");
        var contactCancelButton = document.getElementById("send-settings-contact-cancel");

        if (downloadButton) {
            downloadButton.addEventListener("click", async function() {
                ToolsMenu.flashElement(downloadButton);
                var data = await self.collectAllSettings();
                var filename = "left_wordle_settings_" + self.resolver.formatLocalDate(new Date()) + ".json";
                ToolsMenu.createDownload(filename, JSON.stringify(data, null, 2), "application/json");
                ToolsMenu.showStatus(statusElement, "Settings downloaded", false);
            });
        }

        async function doSendSettings() {
            if (contactModal) contactModal.classList.add("hidden");
            sendButton.disabled = true;
            ToolsMenu.showStatus(statusElement, "Sending settings...", false);
            var settings = await self.collectAllSettings();
            var contactValue = contactInput ? contactInput.value.trim() : "";
            var data = contactValue
                ? Object.assign({ optional_id: contactValue }, settings)
                : settings;
            window.LeftWordleApi.client.submitDiagnostics(data)
                .then(function() {
                    ToolsMenu.showStatus(statusElement, "Settings sent to developers", false);
                })
                .catch(function(err) {
                    var msg = (err && err.status === 503)
                        ? "Unable to send — please use Download All Settings instead"
                        : "Failed to send — please try again or use Download All Settings";
                    ToolsMenu.showStatus(statusElement, msg, true);
                })
                .finally(function() {
                    sendButton.disabled = false;
                });
        }

        if (sendButton && contactModal) {
            sendButton.addEventListener("click", function() {
                ToolsMenu.flashElement(sendButton);
                if (contactInput) contactInput.value = "";
                contactModal.classList.remove("hidden");
                if (contactInput) contactInput.focus();
            });
        }

        if (contactSendButton) {
            contactSendButton.addEventListener("click", function() {
                doSendSettings();
            });
        }

        if (contactCancelButton) {
            contactCancelButton.addEventListener("click", function() {
                if (contactModal) contactModal.classList.add("hidden");
            });
        }
    }

    init() {
        var closeButton = document.getElementById("tools-close");
        var saveModal = document.querySelector("#tools");
        var statusElement = document.getElementById("tools-status");

        if (closeButton && saveModal) {
            closeButton.addEventListener("click", function() {
                saveModal.classList.toggle("hidden");
            });
        }

        this.wireHistoryImportExport(statusElement);
        this.wireHistoryImportSummaryModal();
        this.wireAdjustStatsModal(statusElement);
        this.wireTroubleshootingSection(statusElement);
    }
}


// Expose classes for testing
window.toolsmenuTestExports = {
    PuzzleResolver: PuzzleResolver,
    HistoryManager: HistoryManager,
    ToolsMenu: ToolsMenu
};

// Bootstrap
(function() {
    var resolver = new PuzzleResolver(window.answer_list, window.PUZZLE_START_DATE);
    var manager = new HistoryManager(resolver);
    var menu = new ToolsMenu(manager);

    window.leftWordleToolsMenu = menu;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function() { menu.init(); });
    } else {
        menu.init();
    }
})();
