(function() {
    "use strict";

    var ANSWER_KEY = "xQ7mN2vK9pL4wR8tY1sB6dF3hJ0cG5eA";

    function decryptAnswer(hex) {
        var bytes = [];
        for (var i = 0; i < hex.length; i += 2) {
            bytes.push(parseInt(hex.substr(i, 2), 16));
        }
        return bytes.map(function(b, i) {
            return String.fromCharCode(b ^ ANSWER_KEY.charCodeAt(i % ANSWER_KEY.length));
        }).join("");
    }

    var _allValidWordsSet = null;
    function getAllValidWordsSet() {
        if (!_allValidWordsSet) {
            _allValidWordsSet = new Set(typeof valid_guesses !== "undefined" ? valid_guesses : []);
        }
        return _allValidWordsSet;
    }

    class GameTile extends HTMLElement {
        _letter = "";
        _state = "empty";
        _animation = "idle";
        _last = false;
        _reveal = false;

        set last(value) {
            this._last = value;
        }

        connectedCallback() {
            if (!this.$tile) {
                var tileDiv = document.createElement("div");
                tileDiv.classList.add("tile");
                tileDiv.dataset.state = "empty";
                tileDiv.dataset.animation = "idle";
                this.appendChild(tileDiv);
                this.$tile = tileDiv;
                this.$tile.addEventListener("animationend", (event) => {
                    if (event.animationName === "PopIn") {
                        this._animation = "idle";
                    }
                    if (event.animationName === "FlipIn") {
                        this.$tile.dataset.state = this._state;
                        this._animation = "flip-out";
                    }
                    if (event.animationName === "FlipOut") {
                        this._animation = "idle";
                        if (this._last) {
                            this.dispatchEvent(new CustomEvent("game-last-tile-revealed-in-row", {
                                bubbles: true
                            }));
                        }
                    }
                    this._render();
                });
            }
            this._render();
        }

        attributeChangedCallback(name, oldValue, newValue) {
            switch (name) {
            case "letter":
                if (newValue === oldValue) break;
                var letter = "null" === newValue ? "" : newValue;
                this._letter = letter;
                this._state = letter ? "tbd" : "empty";
                this._animation = letter ? "pop" : "idle";
                break;
            case "evaluation":
                if (!newValue) break;
                this._state = newValue;
                break;
            case "reveal":
                this._animation = "flip-in";
                this._reveal = true;
            }
            this._render();
        }

        _render() {
            if (!this.$tile) return;

            this.$tile.textContent = this._letter;

            if (this._state === "empty" || this._state === "tbd") {
                this.$tile.dataset.state = this._state;
            }

            var shouldAnimate = this._state === "empty" || this._state === "tbd" || this._reveal;
            if (shouldAnimate && this.$tile.dataset.animation !== this._animation) {
                this.$tile.dataset.animation = this._animation;
            }
        }

        static get observedAttributes() {
            return ["letter", "evaluation", "reveal"];
        }
    }
    customElements.define("game-tile", GameTile);

    class GameRow extends HTMLElement {
        _letters = "";
        _evaluation = [];
        _length;

        get evaluation() {
            return this._evaluation;
        }

        set evaluation(value) {
            this._evaluation = value;
            this.$tiles && this.$tiles.forEach((tile, idx) => {
                tile.setAttribute("evaluation", this._evaluation[idx]);
                setTimeout(() => {
                    tile.setAttribute("reveal", "");
                }, 300 * idx);
            });
        }

        connectedCallback() {
            var rowDiv = document.createElement("div");
            rowDiv.classList.add("row");
            this.appendChild(rowDiv);
            this.$row = rowDiv;
            var createTile = (i) => {
                var tile = document.createElement("game-tile");
                var letter = this._letters[i];
                if (letter) {
                    tile.setAttribute("letter", letter);
                }
                if (this._evaluation[i]) {
                    tile.setAttribute("evaluation", this._evaluation[i]);
                    setTimeout(() => {
                        tile.setAttribute("reveal", "");
                    }, 100 * i);
                }
                if (i === this._length - 1) {
                    tile.last = true;
                }
                this.$row.appendChild(tile);
            };
            for (var idx = 0; idx < this._length; idx++) {
                createTile(idx);
            }
            this.$tiles = this.querySelectorAll("game-tile");
            this.addEventListener("animationend", (event) => {
                "Shake" === event.animationName && this.removeAttribute("invalid");
            });
        }

        attributeChangedCallback(name, oldValue, newValue) {
            switch (name) {
            case "letters":
                this._letters = newValue || "";
                break;
            case "length":
                this._length = parseInt(newValue, 10);
                break;
            case "win":
                if (null === newValue) {
                    this.$tiles.forEach(function(tile) {
                        tile.classList.remove("win");
                    });
                    break;
                }
                this.$tiles.forEach(function(tile, idx) {
                    tile.classList.add("win");
                    tile.style.animationDelay = "".concat(100 * idx, "ms");
                });
            }
            this._render();
        }

        _render() {
            this.$row && this.$tiles.forEach((tile, idx) => {
                var letter = this._letters[idx];
                letter ? tile.setAttribute("letter", letter) : tile.removeAttribute("letter");
            });
        }

        static get observedAttributes() {
            return ["letters", "length", "invalid", "win"];
        }
    }
    customElements.define("game-row", GameRow);

    var DEFAULT_SHARE_TEXT_ADDITIONS = { preHeader: "", header: "(Left Wordle)", afterGrid: "" },
        DEFAULT_SHARE_FORMAT = "grid";

    class GameStateManager {
        static DEFAULT_GAME_STATE = {
            boardState: null,
            evaluations: null,
            rowIndex: null,
            solution: null,
            gameStatus: null,
            lastPlayedTs: null,
            lastCompletedTs: null,
            puzzleNum: null,
            date: null,
            updatedAt: null,
            restoringFromLocalStorage: null,
            hardMode: false,
            insaneMode: false,
            goofProtectionMode: true,
            answersRemaining: null,
            encryptedAnswer: null
        };

        static deepMerge(target, source) {
            var result = Object.assign({}, target);
            for (var key in source) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
                    && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
                    result[key] = GameStateManager.deepMerge(target[key], source[key]);
                } else {
                    result[key] = source[key];
                }
            }
            return result;
        }

        static isNewUser() {
            if (StorageController.deviceId.get() !== null) return false;
            if (Object.keys(StorageController.gameState.getAll()).length) return false;
            if (Object.keys(StorageController.history.getAll()).length) return false;
            if (Object.keys(StorageController.statistics.getAll()).length) return false;
            return true;
        }

        static getGameState() {
            var stored = StorageController.gameState.getAll();
            if (!stored || !Object.keys(stored).length) return Object.assign({}, GameStateManager.DEFAULT_GAME_STATE);
            return stored;
        }

        static saveGameState(updates) {
            var current = GameStateManager.getGameState();
            var merged = GameStateManager.deepMerge(current, updates);
            merged.updatedAt = Date.now();
            StorageController.gameState.replace(merged);
        }

        static getDeviceId() {
            var existing = StorageController.deviceId.get();
            if (existing) return existing;
            var generated = (typeof crypto !== "undefined" && crypto.randomUUID) ?
                crypto.randomUUID() :
                Math.random().toString(36).slice(2) + Date.now().toString(36);
            StorageController.deviceId.set(generated);
            return generated;
        }
    }

    class GameThemeManager extends HTMLElement {
        isDarkTheme = false;
        isColorBlindTheme = false;

        constructor() {
            super();
            var darkStored = StorageController.preferences.get("darkTheme");
            var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
            var cbStored = StorageController.preferences.get("colorBlindTheme");

            if (darkStored === true || darkStored === false) {
                this.setDarkTheme(darkStored);
            } else if (prefersDark) {
                this.setDarkTheme(true);
            }

            if (cbStored === true || cbStored === false) {
                this.setColorBlindTheme(cbStored);
            }
        }

        setDarkTheme(enabled) {
            var body = document.querySelector("body");
            if (enabled) {
                body.classList.add("nightmode");
            } else {
                body.classList.remove("nightmode");
            }
            this.isDarkTheme = enabled;
            StorageController.preferences.set("darkTheme", enabled);
        }

        setColorBlindTheme(enabled) {
            var body = document.querySelector("body");
            if (enabled) {
                body.classList.add("colorblind");
            } else {
                body.classList.remove("colorblind");
            }
            this.isColorBlindTheme = enabled;
            StorageController.preferences.set("colorBlindTheme", enabled);
        }

        connectedCallback() {
            this.addEventListener("game-setting-change", (event) => {
                var detail = event.detail,
                    name = detail.name,
                    checked = detail.checked;
                switch (name) {
                case "dark-theme":
                    return void this.setDarkTheme(checked);
                case "color-blind-theme":
                    return void this.setColorBlindTheme(checked);
                }
            });
        }
    }
    customElements.define("game-theme-manager", GameThemeManager);


    var gameSettingsTemplate = document.getElementById("settings-template");

    class GameSettings extends HTMLElement {
        gameApp;

        connectedCallback() {
            this.appendChild(gameSettingsTemplate.content.cloneNode(true));
            var wordleHash = window.wordle;
            this.querySelector("#hash").textContent = wordleHash ? wordleHash.hash : undefined;
            this.querySelector("#puzzle-number").textContent = "#".concat(this.gameApp.dayOffset);
            this.addEventListener("game-switch-change", (event) => {
                event.stopPropagation();
                var detail = event.detail,
                    name = detail.name,
                    checked = detail.checked,
                    disabled = detail.disabled;
                this.dispatchEvent(new CustomEvent("game-setting-change", {
                    bubbles: true,
                    detail: { name: name, checked: checked, disabled: disabled }
                }));
                this.render();
            });
            // Handle text input changes for share text additions
            this.querySelector("#share-pre-header").addEventListener("input", (event) => {
                this.saveShareTextAdditions();
            });
            this.querySelector("#share-header-append").addEventListener("input", (event) => {
                this.saveShareTextAdditions();
            });
            this.querySelector("#share-after-grid").addEventListener("input", (event) => {
                this.saveShareTextAdditions();
            });
            // Handle share format radio changes
            this.querySelectorAll('input[name="share-format"]').forEach((radio) => {
                radio.addEventListener("change", (event) => {
                    this.saveShareFormat(event.target.value);
                });
            });
            // Handle gameplay mode radio changes
            this.querySelectorAll('input[name="gameplay-mode"]').forEach((radio) => {
                radio.addEventListener("change", (event) => {
                    this.dispatchEvent(new CustomEvent("game-setting-change", {
                        bubbles: true,
                        detail: { name: "gameplay-mode", value: event.target.value }
                    }));
                    this.render();
                });
            });
            this.render();
        }

        saveShareFormat(value) {
            StorageController.preferences.set("shareFormat", value);
        }

        saveShareTextAdditions() {
            var preHeaderVal = this.querySelector("#share-pre-header").value;
            var headerVal = this.querySelector("#share-header-append").value;
            var afterGridVal = this.querySelector("#share-after-grid").value;
            var additions = {
                preHeader: preHeaderVal,
                header: headerVal,
                afterGrid: afterGridVal
            };
            StorageController.preferences.set("shareTextAdditions", additions);
        }

        render() {
            var body = document.querySelector("body");
            if (body.classList.contains("nightmode")) {
                this.querySelector("#dark-theme").setAttribute("checked", "");
            }
            if (body.classList.contains("colorblind")) {
                this.querySelector("#color-blind-theme").setAttribute("checked", "");
            }
            var modeValue = StorageController.preferences.get("insaneMode") ? "insane"
                : StorageController.preferences.get("hardMode") ? "hard"
                : "regular";
            var modeRadio = this.querySelector('input[name="gameplay-mode"][value="' + modeValue + '"]');
            if (modeRadio) modeRadio.checked = true;
            StorageController.preferences.get("goofProtectionMode") !== false
                ? this.querySelector("#goof-protection-mode").setAttribute("checked", "")
                : this.querySelector("#goof-protection-mode").removeAttribute("checked");
            // Share format preference
            var shareFormat = StorageController.preferences.get("shareFormat") || DEFAULT_SHARE_FORMAT;
            var formatRadio = this.querySelector('input[name="share-format"][value="' + shareFormat + '"]');
            if (formatRadio) formatRadio.checked = true;
            // Share text additions - use stored values or defaults
            var shareAdditions = StorageController.preferences.get("shareTextAdditions") || DEFAULT_SHARE_TEXT_ADDITIONS;
            this.querySelector("#share-pre-header").value = shareAdditions.preHeader || "";
            this.querySelector("#share-header-append").value = shareAdditions.header || "";
            this.querySelector("#share-after-grid").value = shareAdditions.afterGrid || "";
            // Hide date in share header preference (default off; normalize null to false)
            var hideDateInShareHeader = StorageController.preferences.get("hideDateInShareHeader");
            if (hideDateInShareHeader === null) {
                hideDateInShareHeader = false;
                StorageController.preferences.set("hideDateInShareHeader", false);
            }
            hideDateInShareHeader
                ? this.querySelector("#hide-date-in-share-header").setAttribute("checked", "")
                : this.querySelector("#hide-date-in-share-header").removeAttribute("checked");
            // Show Remaining Guesses in Share Text preference (default true)
            var showRemaining = StorageController.preferences.get("showRemainingInShareText");
            if (showRemaining === null) {
                var oldMode = StorageController.preferences.get("remainingAnswersMode");
                showRemaining = oldMode === null || oldMode === "sharetext" || oldMode === "both";
                StorageController.preferences.set("showRemainingInShareText", showRemaining);
            }
            showRemaining
                ? this.querySelector("#show-remaining-in-share-text").setAttribute("checked", "")
                : this.querySelector("#show-remaining-in-share-text").removeAttribute("checked");
        }
    }
    customElements.define("game-settings", GameSettings);

    class GameToast extends HTMLElement {
        _duration;

        connectedCallback() {
            var toastDiv = document.createElement("div");
            toastDiv.classList.add("toast");
            this.appendChild(toastDiv);
            toastDiv.textContent = this.getAttribute("text");
            this._duration = this.getAttribute("duration") || 1e3;
            "Infinity" !== this._duration && setTimeout(() => {
                toastDiv.classList.add("fade");
            }, this._duration);
            toastDiv.addEventListener("transitionend", () => {
                this.parentNode.removeChild(this);
            });
        }
    }

    function gtag() {
        dataLayer.push(arguments);
    }
    customElements.define("game-toast", GameToast);
    window.dataLayer = window.dataLayer || [];
    gtag("js", new Date);
    var wordleRef = window.wordle;
    gtag("config", "G-2SSGMHY3NP", {
        app_version: wordleRef ? wordleRef.hash : undefined,
        debug_mode: false
    });

    class GameEvaluator {
        static PRESENT = "present";
        static CORRECT = "correct";
        static ABSENT = "absent";
        static STATE_PRECEDENCE = {
            unknown: 0,
            absent: 1,
            present: 2,
            correct: 3
        };

        static aggregateLetterEvaluations(boardState, evaluations) {
            var result = {};
            boardState.forEach(function(word, rowIdx) {
                if (evaluations[rowIdx])
                    for (var i = 0; i < word.length; i++) {
                        var letter = word[i],
                            evaluation = evaluations[rowIdx][i],
                            current = result[letter] || "unknown";
                        GameEvaluator.STATE_PRECEDENCE[evaluation] > GameEvaluator.STATE_PRECEDENCE[current] && (result[letter] = evaluation);
                    }
            });
            return result;
        }

        static getOrdinal(num) {
            var suffixes = ["th", "st", "nd", "rd"],
                mod100 = num % 100;
            return num + (suffixes[(mod100 - 20) % 10] || suffixes[mod100] || suffixes[0]);
        }

        static evaluateGuess(guessed_wd, ans_wd) {
            var result = Array(ans_wd.length).fill(GameEvaluator.ABSENT);
            var guessUnmatched = Array(ans_wd.length).fill(true);
            var solutionUnmatched = Array(ans_wd.length).fill(true);

            // First pass: mark exact matches
            for (var idx = 0; idx < guessed_wd.length; idx++) {
                if (guessed_wd[idx] === ans_wd[idx] && solutionUnmatched[idx]) {
                    result[idx] = GameEvaluator.CORRECT;
                    guessUnmatched[idx] = false;
                    solutionUnmatched[idx] = false;
                }
            }

            // Second pass: mark present (right letter, wrong position)
            for (var idx = 0; idx < guessed_wd.length; idx++) {
                if (guessUnmatched[idx]) {
                    var guessChar = guessed_wd[idx];
                    for (var ans_idx = 0; ans_idx < ans_wd.length; ans_idx++) {
                        if (solutionUnmatched[ans_idx] && guessChar === ans_wd[ans_idx]) {
                            result[idx] = GameEvaluator.PRESENT;
                            solutionUnmatched[ans_idx] = false;
                            break;
                        }
                    }
                }
            }

            return result;
        }

        static validateHardMode(guess, prevGuesses) {
            if (!prevGuesses || !prevGuesses.length) return null;
            var lastPair = prevGuesses[prevGuesses.length - 1];
            var lastWord = String(lastPair[0]).toLowerCase();
            var lastMask = String(lastPair[1]);
            for (var i = 0; i < lastMask.length; i++) {
                if (lastMask[i] === "2" && guess[i] !== lastWord[i]) {
                    return GameEvaluator.getOrdinal(i + 1) + " letter must be " + lastWord[i].toUpperCase();
                }
            }
            var required = {};
            for (var i = 0; i < lastMask.length; i++) {
                if (lastMask[i] === "1" || lastMask[i] === "2") {
                    required[lastWord[i]] = (required[lastWord[i]] || 0) + 1;
                }
            }
            var guessCounts = {};
            for (var i = 0; i < guess.length; i++) {
                guessCounts[guess[i]] = (guessCounts[guess[i]] || 0) + 1;
            }
            for (var letter in required) {
                if ((guessCounts[letter] || 0) < required[letter]) {
                    return "Guess must contain " + letter.toUpperCase();
                }
            }
            return null;
        }

        static validateInsaneMode(guess, prevGuesses) {
            var hardError = GameEvaluator.validateHardMode(guess, prevGuesses);
            if (hardError) return hardError;
            if (!prevGuesses || !prevGuesses.length) return null;
            var forbiddenPositions = {};
            var knownAbsent = {};
            var maxCounts = {};
            for (var pi = 0; pi < prevGuesses.length; pi++) {
                var word = String(prevGuesses[pi][0]).toLowerCase();
                var mask = String(prevGuesses[pi][1]);
                var absCount = {};
                var presCorrCount = {};
                for (var i = 0; i < mask.length; i++) {
                    var letter = word[i];
                    if (mask[i] === "1") {
                        if (!forbiddenPositions[letter]) forbiddenPositions[letter] = [];
                        forbiddenPositions[letter].push(i);
                        presCorrCount[letter] = (presCorrCount[letter] || 0) + 1;
                    } else if (mask[i] === "2") {
                        presCorrCount[letter] = (presCorrCount[letter] || 0) + 1;
                    } else {
                        absCount[letter] = (absCount[letter] || 0) + 1;
                    }
                }
                for (var l in absCount) {
                    if (!presCorrCount[l]) {
                        knownAbsent[l] = true;
                    } else {
                        var maxAllowed = presCorrCount[l];
                        maxCounts[l] = maxCounts[l] === undefined ? maxAllowed : Math.min(maxCounts[l], maxAllowed);
                    }
                }
            }
            for (var i = 0; i < guess.length; i++) {
                var letter = guess[i];
                if (forbiddenPositions[letter] && forbiddenPositions[letter].includes(i)) {
                    return letter.toUpperCase() + " can't be in " + GameEvaluator.getOrdinal(i + 1) + " position";
                }
            }
            var guessCounts = {};
            for (var i = 0; i < guess.length; i++) {
                guessCounts[guess[i]] = (guessCounts[guess[i]] || 0) + 1;
            }
            for (var l in knownAbsent) {
                if (guessCounts[l]) return "Guess cannot contain " + l.toUpperCase();
            }
            for (var l in maxCounts) {
                if ((guessCounts[l] || 0) > maxCounts[l]) return "Too many " + l.toUpperCase() + "s";
            }
            return null;
        }

    }

    class DateUtils {
        static PUZZLE_START_DATE = new Date(2021, 5, 19); // FUCKING JS 0 Index Month, 5 is JUNE

        static calculateDaysBetween(start, end) {
            var startDate = new Date(start);
            var endDate = new Date(end);
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(0, 0, 0, 0);
            var diffMs = endDate - startDate;
            return Math.round(diffMs / 86_400_000);
        }

        static formatLocalDate(date) {
            var year = date.getFullYear();
            var month = String(date.getMonth() + 1).padStart(2, "0");
            var day = String(date.getDate()).padStart(2, "0");
            return "".concat(year, "-").concat(month, "-").concat(day);
        }

        static parseLocalDateString(dateStr) {
            if (!dateStr || typeof dateStr !== "string") return null;
            var parts = dateStr.split("-");
            if (parts.length !== 3) return null;
            var year = parseInt(parts[0], 10);
            var month = parseInt(parts[1], 10);
            var day = parseInt(parts[2], 10);
            if (!year || !month || !day) return null;
            return new Date(year, month - 1, day);
        }

        static getCutoffDateString(dateStr) {
            var date = DateUtils.parseLocalDateString(dateStr);
            if (!date) return null;
            date.setDate(date.getDate() - 1);
            return DateUtils.formatLocalDate(date);
        }

        static getDateFromDayOffset(dayOffset) {
            var d = new Date(DateUtils.PUZZLE_START_DATE);
            d.setDate(d.getDate() + dayOffset);
            return d;
        }
    }
    window.PUZZLE_START_DATE = DateUtils.PUZZLE_START_DATE;

    class PuzzleUtils {
        static getDayOffset(date) {
            return DateUtils.calculateDaysBetween(DateUtils.PUZZLE_START_DATE, date);
        }
    }

    class StringUtils {
        static ALPHABET = "abcdefghijklmnopqrstuvwxyz";
        static ROT13_MAP = [].concat(
            Array.from(StringUtils.ALPHABET.split("").slice(13)),
            Array.from(StringUtils.ALPHABET.split("").slice(0, 13))
        );

        static encodeWord(word) {
            for (var result = "", i = 0; i < word.length; i++) {
                var idx = StringUtils.ALPHABET.indexOf(word[i]);
                result += idx >= 0 ? StringUtils.ROT13_MAP[idx] : "_";
            }
            return result;
        }

        static normalizeAnswer(value) {
            if (value === undefined || value === null) return null;
            var str = String(value).trim();
            if (!str) return null;
            return str.toLowerCase();
        }

        static normalizeStarter(value) {
            if (value === undefined || value === null) return null;
            var str = String(value).trim();
            if (!str) return null;
            return str.toLowerCase();
        }

        static normalizeMode(value, fallbackHardMode) {
            if (value === undefined || value === null || value === "") {
                if (fallbackHardMode === true) return "hard";
                if (fallbackHardMode === false) return "regular";
                return null;
            }
            var str = String(value).trim().toLowerCase();
            if (!str) return null;
            if (str === "normal" || str === "standard" || str === "classic") return "regular";
            return str;
        }
    }

    class StatisticsEngine {
        static FAIL_KEY = "fail";
        static DEFAULT_STATISTICS = {
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

        static getStatistics() {
            var stored = StorageController.statistics.getAll();
            if (!stored || !Object.keys(stored).length) return JSON.parse(JSON.stringify(StatisticsEngine.DEFAULT_STATISTICS));
            return stored;
        }

        static isCurrentStreakAdjustmentActive(entries, streakAdjustment) {
            if (!streakAdjustment || streakAdjustment.delta <= 0) return false;
            var nextExpected = streakAdjustment.anchorPuzzleNum + 1;
            for (var i = 0; i < entries.length; i++) {
                var entry = entries[i];
                if (entry.puzzle_num <= streakAdjustment.anchorPuzzleNum) continue;
                if (entry.puzzle_num !== nextExpected) return false;
                var isWin = entry.result >= 1 && entry.result <= 6;
                if (!isWin) return false;
                nextExpected += 1;
            }
            return true;
        }

        static applyFinalRateStats(stats) {
            var guessSum = 0;
            for (var i = 1; i <= 6; i++) {
                guessSum += i * (stats.guesses[i] || 0);
            }
            stats.winPercentage = stats.gamesPlayed ? Math.round(stats.gamesWon / stats.gamesPlayed * 100) : 0;
            stats.averageGuesses = stats.gamesWon ? Math.round(guessSum / stats.gamesWon * 100) / 100 : 0;
        }

        static computeHistoryOnlyStatistics() {
            var historyStats = StatisticsEngine.computeHistoryStats(HistoryManager.getHistory(), null);
            var stats = historyStats.stats;
            stats.currentStreak = historyStats.currentStreak;
            stats.maxStreak = historyStats.maxStreak;
            return stats;
        }

        static computeHistoryStats(history, cutoffDateStr) {
            var stats = JSON.parse(JSON.stringify(StatisticsEngine.DEFAULT_STATISTICS));
            var cutoffDate = DateUtils.parseLocalDateString(cutoffDateStr);
            var entries = Object.values(history).map(function(entry) {
                if (!entry) return null;
                var puzzleNum = Number(entry.puzzle_num);
                var resultNum = Number(entry.result);
                if (!Number.isFinite(puzzleNum) || !Number.isFinite(resultNum)) return null;
                var dateObj = entry.date ? DateUtils.parseLocalDateString(entry.date) : DateUtils.getDateFromDayOffset(puzzleNum);
                if (cutoffDate && dateObj && DateUtils.calculateDaysBetween(cutoffDate, dateObj) <= 0) {
                    return null;
                }
                return Object.assign({}, entry, { puzzle_num: puzzleNum, result: resultNum, dateObj: dateObj });
            }).filter(Boolean).sort(function(a, b) {
                return a.puzzle_num - b.puzzle_num;
            });

            var guessSum = 0;
            entries.forEach(function(entry) {
                if (entry.result >= 1 && entry.result <= 6) {
                    stats.guesses[entry.result] += 1;
                    stats.gamesWon += 1;
                    guessSum += entry.result;
                } else {
                    stats.guesses.fail += 1;
                }
                stats.gamesPlayed += 1;
            });

            stats.winPercentage = stats.gamesPlayed ? Math.round(stats.gamesWon / stats.gamesPlayed * 100) : 0;
            stats.averageGuesses = stats.gamesWon ? Math.round(guessSum / stats.gamesWon * 100) / 100 : 0;

            var currentStreak = 0;
            var maxStreak = 0;
            var lastPuzzle = null;
            var lastWasWin = false;

            entries.forEach(function(entry) {
                var isWin = entry.result >= 1 && entry.result <= 6;
                if (!isWin) {
                    currentStreak = 0;
                    lastWasWin = false;
                    lastPuzzle = entry.puzzle_num;
                    return;
                }
                if (lastWasWin && lastPuzzle !== null && entry.puzzle_num === lastPuzzle + 1) {
                    currentStreak += 1;
                } else {
                    currentStreak = 1;
                }
                maxStreak = Math.max(maxStreak, currentStreak);
                lastWasWin = true;
                lastPuzzle = entry.puzzle_num;
            });

            var startWinStreak = 0;
            for (var idx = 0; idx < entries.length; idx++) {
                var row = entries[idx];
                var rowIsWin = row.result >= 1 && row.result <= 6;
                if (!rowIsWin) break;
                if (idx > 0 && row.puzzle_num !== entries[idx - 1].puzzle_num + 1) break;
                startWinStreak += 1;
            }

            return {
                stats: stats,
                guessSum: guessSum,
                currentStreak: currentStreak,
                maxStreak: maxStreak,
                startWinStreak: startWinStreak,
                firstEntry: entries.length ? entries[0] : null,
                entries: entries
            };
        }

        static computeStatisticsFromHistoryAndLegacy() {
            var history = HistoryManager.getHistory();
            var legacy = HistoryManager.getLegacyStats() || {};

            if (legacy.model === HistoryManager.HISTORY_AUTHORITATIVE_MODEL) {
                var historyOnly = StatisticsEngine.computeHistoryStats(history, null);
                var historyTotals = historyOnly.stats;
                var delta = HistoryManager.normalizeHistoryAuthoritativeDelta(legacy);
                var streakAdjustment = HistoryManager.normalizeCurrentStreakAdjustment(legacy);
                var statsFromHistory = JSON.parse(JSON.stringify(StatisticsEngine.DEFAULT_STATISTICS));

                statsFromHistory.gamesPlayed = historyTotals.gamesPlayed + delta.gamesPlayed;
                statsFromHistory.gamesWon = historyTotals.gamesWon + delta.gamesWon;
                statsFromHistory.guesses.fail = historyTotals.guesses.fail + delta.guesses.fail;
                for (var n = 1; n <= 6; n++) {
                    statsFromHistory.guesses[n] = historyTotals.guesses[n] + delta.guesses[n];
                }

                statsFromHistory.gamesPlayed = Math.max(statsFromHistory.gamesPlayed, historyTotals.gamesPlayed);
                statsFromHistory.gamesWon = Math.max(statsFromHistory.gamesWon, historyTotals.gamesWon);
                statsFromHistory.guesses.fail = Math.max(statsFromHistory.guesses.fail, historyTotals.guesses.fail);
                for (var m = 1; m <= 6; m++) {
                    statsFromHistory.guesses[m] = Math.max(statsFromHistory.guesses[m], historyTotals.guesses[m]);
                }

                var maxStreakFloor = Math.max(0, parseInt(legacy.max_streak_floor, 10) || 0);
                var currentStreak = historyOnly.currentStreak;
                if (StatisticsEngine.isCurrentStreakAdjustmentActive(historyOnly.entries || [], streakAdjustment)) {
                    currentStreak += streakAdjustment.delta;
                }

                statsFromHistory.currentStreak = currentStreak;
                statsFromHistory.maxStreak = Math.max(historyOnly.maxStreak, maxStreakFloor, currentStreak);

                StatisticsEngine.applyFinalRateStats(statsFromHistory);
                return statsFromHistory;
            }

            var historyStats = StatisticsEngine.computeHistoryStats(history, legacy.cutoff_date || null);
            var stats = historyStats.stats;

            var legacyGuesses = HistoryManager.normalizeLegacyGuesses(legacy);
            var legacyGuessSum = 0;
            for (var i = 1; i <= 6; i++) {
                legacyGuessSum += i * (legacyGuesses[i] || 0);
            }

            var legacyGamesWon = Number.isFinite(Number(legacy.gamesWon)) ? Number(legacy.gamesWon) :
                (legacyGuesses[1] + legacyGuesses[2] + legacyGuesses[3] + legacyGuesses[4] + legacyGuesses[5] + legacyGuesses[6]);
            var legacyGamesPlayed = Number.isFinite(Number(legacy.gamesPlayed)) ? Number(legacy.gamesPlayed) :
                legacyGamesWon + legacyGuesses.fail;

            stats.gamesPlayed += legacyGamesPlayed;
            stats.gamesWon += legacyGamesWon;
            stats.guesses.fail += legacyGuesses.fail;
            for (var j = 1; j <= 6; j++) {
                stats.guesses[j] += legacyGuesses[j];
            }

            var totalGuessSum = historyStats.guessSum + legacyGuessSum;
            stats.winPercentage = stats.gamesPlayed ? Math.round(stats.gamesWon / stats.gamesPlayed * 100) : 0;
            stats.averageGuesses = stats.gamesWon ? Math.round(totalGuessSum / stats.gamesWon * 100) / 100 : 0;
            stats.maxStreak = Math.max(historyStats.maxStreak, legacy.maxStreak || 0);

            var legacyCurrent = parseInt(legacy.current_streak_length, 10) || 0;
            var legacyEndDate = legacy.current_streak_end_date;
            var hasHistory = !!historyStats.firstEntry;
            if (!hasHistory) {
                stats.currentStreak = legacyCurrent;
            } else {
                stats.currentStreak = historyStats.currentStreak;
                if (legacyCurrent > 0 && legacyEndDate && historyStats.startWinStreak > 0) {
                    var firstEntryDate = historyStats.firstEntry && historyStats.firstEntry.dateObj ? historyStats.firstEntry.dateObj : null;
                    var legacyEnd = DateUtils.parseLocalDateString(legacyEndDate);
                    if (legacyEnd && firstEntryDate &&
                        DateUtils.calculateDaysBetween(legacyEnd, firstEntryDate) === 1 &&
                        historyStats.currentStreak === historyStats.startWinStreak) {
                        stats.currentStreak = legacyCurrent + historyStats.currentStreak;
                    }
                }
            }

            return stats;
        }

        static recomputeAndPersistStatistics() {
            var stats = StatisticsEngine.computeStatisticsFromHistoryAndLegacy();
            StorageController.statistics.replace(stats);
            return stats;
        }

        static updateStatistics(gameResults) {
            var stats = StatisticsEngine.getStatistics();
            var history = HistoryManager.getHistory();
            var legacy = HistoryManager.getLegacyStats();
            var now = new Date();
            var hasExplicitPuzzleNum = !!(gameResults && gameResults.puzzleNum !== undefined && gameResults.puzzleNum !== null);
            var puzzleNum = hasExplicitPuzzleNum ? gameResults.puzzleNum : PuzzleUtils.getDayOffset(now);
            var dateStr = (gameResults && gameResults.date) ? gameResults.date : DateUtils.formatLocalDate(now);
            var existingCompletion = hasExplicitPuzzleNum ? HistoryManager.getHistoryCompletionForPuzzle(puzzleNum) : null;

            if (existingCompletion) {
                // Keep history metadata fresh but avoid double-counting the same puzzle in stats.
                HistoryManager.recordHistoryEntry({
                    puzzleNum: puzzleNum,
                    date: dateStr,
                    result: existingCompletion.result,
                    completedAt: existingCompletion.completedAt || Date.now(),
                    answer: gameResults ? gameResults.answer : null,
                    mode: gameResults && gameResults.mode ? gameResults.mode : (gameResults && gameResults.hardMode ? "hard" : "regular"),
                    hardMode: gameResults && gameResults.hardMode,
                    starter: gameResults && gameResults.starter
                });
                StatisticsEngine.recomputeAndPersistStatistics();
                return;
            }

            if ((!history || Object.keys(history).length === 0) && !legacy) {
                var cutoffDate = DateUtils.getCutoffDateString(dateStr);
                HistoryManager.setLegacyStats(HistoryManager.buildLegacySnapshot(stats, cutoffDate));
            }

            // Update guesses and streak
            if (gameResults.isWin) {
                stats.guesses[gameResults.numGuesses] += 1;
                stats.currentStreak = gameResults.isStreak ? stats.currentStreak + 1 : 1;
            } else {
                stats.currentStreak = 0;
                stats.guesses.fail += 1;
            }

            stats.maxStreak = Math.max(stats.currentStreak, stats.maxStreak);
            stats.gamesPlayed += 1;
            stats.gamesWon += gameResults.isWin ? 1 : 0;
            stats.winPercentage = Math.round(stats.gamesWon / stats.gamesPlayed * 100);

            // Calculate average guesses (excluding failures)
            stats.averageGuesses = stats.gamesWon ? Math.round(
                Object.entries(stats.guesses).reduce(function(total, entry) {
                    var key = entry[0];
                    var count = entry[1];
                    return key !== StatisticsEngine.FAIL_KEY ? total + key * count : total;
                }, 0) / stats.gamesWon * 100
            ) / 100 : 0;

            StorageController.statistics.replace(stats);

            var result = gameResults.isWin ? gameResults.numGuesses : 7;
            HistoryManager.recordHistoryEntry({
                puzzleNum: puzzleNum,
                date: dateStr,
                result: result,
                completedAt: Date.now(),
                answer: gameResults ? gameResults.answer : null,
                mode: gameResults && gameResults.mode ? gameResults.mode : (gameResults && gameResults.hardMode ? "hard" : "regular"),
                hardMode: gameResults && gameResults.hardMode,
                starter: gameResults && gameResults.starter
            });
        }
    }

    class HistoryManager {
        static HISTORY_AUTHORITATIVE_MODEL = "history_authoritative_v1";

        static getHistory() {
            return StorageController.history.getAll();
        }

        static saveHistory(history) {
            StorageController.history.replace(history);
        }

        static getLegacyStats() {
            return StorageController.legacyStats.get();
        }

        static setLegacyStats(legacy) {
            StorageController.legacyStats.set(legacy || {});
        }

        static buildLegacySnapshot(stats, cutoffDateStr) {
            var guesses = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
            if (stats && stats.guesses) {
                for (var i = 1; i <= 6; i++) {
                    guesses[i] = stats.guesses[i] || 0;
                }
                guesses[7] = stats.guesses.fail || 0;
            }
            var state = GameStateManager.getGameState();
            var lastCompletedDate = null;
            if (state && state.lastCompletedTs) {
                lastCompletedDate = DateUtils.formatLocalDate(new Date(state.lastCompletedTs));
            }
            return {
                gamesPlayed: stats && stats.gamesPlayed || 0,
                gamesWon: stats && stats.gamesWon || 0,
                guesses: guesses,
                maxStreak: stats && stats.maxStreak || 0,
                current_streak_length: stats && stats.currentStreak || 0,
                current_streak_end_date: lastCompletedDate,
                recorded_on: DateUtils.formatLocalDate(new Date()),
                cutoff_date: cutoffDateStr
            };
        }

        static normalizeLegacyGuesses(legacy) {
            var guesses = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, fail: 0 };
            if (!legacy || !legacy.guesses) return guesses;
            for (var i = 1; i <= 6; i++) {
                guesses[i] = parseInt(legacy.guesses[i], 10) || 0;
            }
            guesses.fail = parseInt(legacy.guesses[7], 10) || parseInt(legacy.guesses.fail, 10) || 0;
            return guesses;
        }

        static normalizeHistoryAuthoritativeDelta(legacy) {
            var delta = legacy && legacy.totals_delta ? legacy.totals_delta : {};
            var guesses = delta.guesses || {};
            return {
                gamesPlayed: Math.max(0, parseInt(delta.gamesPlayed, 10) || 0),
                gamesWon: Math.max(0, parseInt(delta.gamesWon, 10) || 0),
                guesses: {
                    1: Math.max(0, parseInt(guesses[1], 10) || 0),
                    2: Math.max(0, parseInt(guesses[2], 10) || 0),
                    3: Math.max(0, parseInt(guesses[3], 10) || 0),
                    4: Math.max(0, parseInt(guesses[4], 10) || 0),
                    5: Math.max(0, parseInt(guesses[5], 10) || 0),
                    6: Math.max(0, parseInt(guesses[6], 10) || 0),
                    fail: Math.max(0, parseInt(guesses.fail, 10) || 0)
                }
            };
        }

        static normalizeCurrentStreakAdjustment(legacy) {
            var adjustment = legacy && legacy.current_streak_adjustment ? legacy.current_streak_adjustment : {};
            var anchor = Number(adjustment.anchor_puzzle_num);
            return {
                delta: Math.max(0, parseInt(adjustment.delta, 10) || 0),
                anchorPuzzleNum: Number.isFinite(anchor) ? Math.floor(anchor) : -1
            };
        }

        static recordHistoryEntry(params) {
            if (!params || params.puzzleNum === undefined || params.puzzleNum === null) return;
            if (typeof params.result !== "number") return;
            var puzzleNum = Number(params.puzzleNum);
            if (!Number.isFinite(puzzleNum)) return;
            var history = HistoryManager.getHistory();
            var key = String(puzzleNum);
            var completedAt = params.completedAt || Date.now();
            var entry = {
                puzzle_num: puzzleNum,
                date: params.date || DateUtils.formatLocalDate(new Date()),
                result: params.result,
                answer: StringUtils.normalizeAnswer(params.answer),
                mode: StringUtils.normalizeMode(params.mode, params.hardMode),
                starter: StringUtils.normalizeStarter(params.starter),
                completed_at: completedAt,
                updated_at: Date.now(),
                device_id: GameStateManager.getDeviceId(),
                origin: "played"
            };

            var existing = history[key];
            var shouldWrite = !existing;
            if (!shouldWrite && existing) {
                if (existing.completed_at === undefined || existing.completed_at === null) {
                    shouldWrite = true;
                } else {
                    var existingCompleted = typeof existing.completed_at === "number" ?
                        existing.completed_at :
                        Date.parse(existing.completed_at);
                    if (!existingCompleted || Number.isNaN(existingCompleted)) {
                        shouldWrite = true;
                    } else {
                        shouldWrite = completedAt < existingCompleted;
                    }
                }
            }

            if (shouldWrite) {
                history[key] = entry;
                HistoryManager.saveHistory(history);
            } else if (existing) {
                var updated = false;
                if (!existing.answer && entry.answer) {
                    existing.answer = entry.answer;
                    updated = true;
                }
                if (!existing.mode && entry.mode) {
                    existing.mode = entry.mode;
                    updated = true;
                }
                if (!existing.starter && entry.starter) {
                    existing.starter = entry.starter;
                    updated = true;
                }
                if (updated) {
                    existing.updated_at = Date.now();
                    history[key] = existing;
                    HistoryManager.saveHistory(history);
                }
            }
        }

        static getHistoryCompletionForPuzzle(puzzleNum) {
            var history = HistoryManager.getHistory();
            var entry = history[String(puzzleNum)];
            if (!entry) return null;

            var result = Number(entry.result);
            if (!Number.isFinite(result) || result < 1 || result > 7) return null;

            var completedAt = null;
            if (entry.completed_at !== undefined && entry.completed_at !== null) {
                if (typeof entry.completed_at === "number") {
                    completedAt = entry.completed_at;
                } else {
                    var parsed = Date.parse(entry.completed_at);
                    if (!Number.isNaN(parsed)) completedAt = parsed;
                }
            }

            return {
                result: result,
                isWin: result >= 1 && result <= 6,
                status: result >= 1 && result <= 6 ? GAME_STATUS_WIN : GAME_STATUS_FAIL,
                rowIndex: result >= 1 && result <= 6 ? result : 6,
                completedAt: completedAt
            };
        }
    }

    var gameAppTemplate = document.createElement("template");
    gameAppTemplate.innerHTML = document.getElementById('header-container').innerHTML;

    var qaButtons = document.createElement("template");
    qaButtons.innerHTML = `
<button id="reveal">reveal</button>
<button id="shake">shake</button>
<button id="bounce">bounce</button>
<button id="toast">toast</button>
<button id="modal">modal</button>
`;

    function getEnvironmentLabel(hostname) {
        if (hostname === "left-wordle.com") return null;
        if (hostname === "localhost" ||
            /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
            hostname.includes(":") ||
            hostname.endsWith(".local")) return "development";
        return hostname.split(".")[0];
    }

    const GAME_STATUS_IN_PROGRESS = "IN_PROGRESS";
    const GAME_STATUS_WIN = "WIN";
    const GAME_STATUS_FAIL = "FAIL";
    const WIN_COMMENTS = ["Genius", "Magnificent", "Impressive", "Splendid", "Great", "Whew"];

    class GameApp extends HTMLElement {
        tileIndex = 0;
        rowIndex = 0;
        solution;
        boardState;
        evaluations;
        answersRemaining = new Array(6).fill(null);
        canInput = true;
        gameStatus = GAME_STATUS_IN_PROGRESS;
        letterEvaluations = {};
        $board;
        $keyboard;
        $game;
        today;
        lastPlayedTs;
        lastCompletedTs;
        hardMode;
        insaneMode;
        goofProtection;
        dayOffset;
        encryptedAnswer = null;
        answer = null;

        constructor() {
            super();
            this.today = new Date;
            var state = GameStateManager.getGameState();
            this.lastPlayedTs = state.lastPlayedTs;
            if (!this.lastPlayedTs || DateUtils.calculateDaysBetween(new Date(this.lastPlayedTs), this.today) >= 1) {
                this.boardState = new Array(6).fill("");
                this.evaluations = new Array(6).fill(null);
                this.solution = null;
                this.dayOffset = PuzzleUtils.getDayOffset(this.today);
                this.lastCompletedTs = state.lastCompletedTs;
                var prefHard = StorageController.preferences.get("hardMode");
                var prefInsane = StorageController.preferences.get("insaneMode");
                var prefGoof = StorageController.preferences.get("goofProtectionMode");
                this.hardMode = prefHard !== null ? prefHard : (state.hardMode || false);
                this.insaneMode = prefInsane !== null ? prefInsane : (state.insaneMode || false);
                this.goofProtection = prefGoof !== null ? prefGoof : true;
                this.restoringFromLocalStorage = false;
                this.canInput = false;
                GameStateManager.saveGameState({
                    rowIndex: this.rowIndex,
                    boardState: this.boardState,
                    evaluations: this.evaluations,
                    gameStatus: this.gameStatus,
                    hardMode: this.hardMode,
                    insaneMode: this.insaneMode,
                    goofProtectionMode: this.goofProtection,
                    puzzleNum: this.dayOffset,
                    date: DateUtils.formatLocalDate(this.today)
                });
                gtag("event", "level_start", {
                    level_name: String(this.dayOffset)
                });
            } else {
                this.boardState = state.boardState;
                this.evaluations = state.evaluations;
                this.rowIndex = state.rowIndex;
                this.solution = state.solution;
                this.dayOffset = PuzzleUtils.getDayOffset(this.today);
                this.letterEvaluations = GameEvaluator.aggregateLetterEvaluations(this.boardState, this.evaluations);
                this.gameStatus = state.gameStatus;
                this.lastCompletedTs = state.lastCompletedTs;
                this.hardMode = state.hardMode;
                this.insaneMode = state.insaneMode;
                this.goofProtection = state.goofProtectionMode != null ? state.goofProtectionMode : true;
                this.answersRemaining = state.answersRemaining || new Array(6).fill(null);
                this.encryptedAnswer = state.encryptedAnswer || null;
                this.answer = this.encryptedAnswer ? decryptAnswer(this.encryptedAnswer) : null;
                this.gameStatus !== GAME_STATUS_IN_PROGRESS && (this.canInput = false);
                this.restoringFromLocalStorage = true;
            }

            var historyCompletion = HistoryManager.getHistoryCompletionForPuzzle(this.dayOffset);
            if (historyCompletion && this.gameStatus === GAME_STATUS_IN_PROGRESS) {
                this.boardState = new Array(6).fill("");
                this.evaluations = new Array(6).fill(null);
                this.letterEvaluations = {};
                this.rowIndex = historyCompletion.rowIndex;
                this.gameStatus = historyCompletion.status;
                this.canInput = false;
                this.restoringFromLocalStorage = true;
                this.lastCompletedTs = historyCompletion.completedAt || this.lastCompletedTs || Date.now();
                this.lastPlayedTs = historyCompletion.completedAt || this.lastPlayedTs || Date.now();
                GameStateManager.saveGameState({
                    rowIndex: this.rowIndex,
                    boardState: this.boardState,
                    evaluations: this.evaluations,
                    solution: this.solution,
                    gameStatus: this.gameStatus,
                    lastPlayedTs: this.lastPlayedTs,
                    lastCompletedTs: this.lastCompletedTs,
                    puzzleNum: this.dayOffset,
                    date: DateUtils.formatLocalDate(this.today)
                });
            }
        }

        applyEvaluation(row, guess, evaluatedRowIndex, result) {
            var evaluation = result.evaluation;
            this.evaluations[evaluatedRowIndex] = evaluation;
            this.letterEvaluations = GameEvaluator.aggregateLetterEvaluations(this.boardState, this.evaluations);
            row.evaluation = evaluation;
            this.rowIndex = result.rowIndex;
            this.gameStatus = result.gameStatus;
            if (typeof result.answersRemaining === "number") {
                this.answersRemaining[evaluatedRowIndex] = result.answersRemaining;
            }

            var gameOver = this.gameStatus === GAME_STATUS_WIN || this.gameStatus === GAME_STATUS_FAIL;
            if (gameOver) {
                this.solution = result.solution;
                var isCorrect = this.gameStatus === GAME_STATUS_WIN;
                var isStreak = !!this.lastCompletedTs &&
                    DateUtils.calculateDaysBetween(new Date(this.lastCompletedTs), new Date) === 1;
                StatisticsEngine.updateStatistics({
                    isWin: isCorrect,
                    isStreak: isStreak,
                    numGuesses: this.rowIndex,
                    puzzleNum: this.dayOffset,
                    date: DateUtils.formatLocalDate(this.today),
                    answer: this.solution,
                    mode: this.hardMode ? "hard" : "regular",
                    hardMode: this.hardMode,
                    starter: this.boardState && this.boardState[0] ? this.boardState[0] : null
                });
                GameStateManager.saveGameState({
                    lastCompletedTs: Date.now(),
                    puzzleNum: this.dayOffset,
                    date: DateUtils.formatLocalDate(this.today)
                });
                gtag("event", "level_end", {
                    level_name: StringUtils.encodeWord(this.solution),
                    num_guesses: this.rowIndex,
                    success: isCorrect
                });
            }

            this.tileIndex = 0;
            var saveData = {
                rowIndex: this.rowIndex,
                boardState: this.boardState,
                evaluations: this.evaluations,
                solution: this.solution,
                gameStatus: this.gameStatus,
                lastPlayedTs: Date.now(),
                hardMode: this.hardMode,
                puzzleNum: this.dayOffset,
                date: DateUtils.formatLocalDate(this.today),
                answersRemaining: this.answersRemaining
            };
            if (gameOver) {
                saveData.completedInHardMode = this.hardMode;
                saveData.completedInInsaneMode = this.insaneMode;
            }
            GameStateManager.saveGameState(saveData);

        }

        evaluateRow() {
            if (this.tileIndex !== 5 || this.rowIndex >= 6) return;
            if (!this.answer) return;

            var evaluatedRowIndex = this.rowIndex;
            var row = this.$board.querySelectorAll("game-row")[evaluatedRowIndex];
            var guess = this.boardState[evaluatedRowIndex];

            if (this.goofProtection && this.boardState.slice(0, evaluatedRowIndex).includes(guess)) {
                row.setAttribute("invalid", "");
                this.addToast("You already guessed that!");
                return;
            }

            if (!getAllValidWordsSet().has(guess)) {
                row.setAttribute("invalid", "");
                this.addToast("Not in word list");
                return;
            }

            var prevGuesses = this.buildPrevGuesses(evaluatedRowIndex);
            var mode = this.insaneMode ? "insane" : this.hardMode ? "hard" : "regular";
            if (mode !== "regular") {
                var modeError = mode === "insane"
                    ? GameEvaluator.validateInsaneMode(guess, prevGuesses)
                    : GameEvaluator.validateHardMode(guess, prevGuesses);
                if (modeError) {
                    row.setAttribute("invalid", "");
                    this.addToast(modeError);
                    return;
                }
            }

            this.canInput = false;

            var rawEvaluation = GameEvaluator.evaluateGuess(guess, this.answer);
            var evalStr = rawEvaluation.map(function(v) {
                return v === GameEvaluator.CORRECT ? "2" : v === GameEvaluator.PRESENT ? "1" : "0";
            }).join("");
            var rowNumber = evaluatedRowIndex + 1;
            var gameStatus = evalStr === "22222" ? GAME_STATUS_WIN
                : rowNumber >= 6 ? GAME_STATUS_FAIL
                : GAME_STATUS_IN_PROGRESS;

            var result = {
                date: DateUtils.formatLocalDate(this.today),
                evaluation: rawEvaluation,
                gameStatus: gameStatus,
                puzzleNum: this.dayOffset,
                rowIndex: rowNumber,
                solution: gameStatus !== GAME_STATUS_IN_PROGRESS ? this.answer : null,
                source: "local",
                answersRemaining: null
            };

            this.applyEvaluation(row, guess, evaluatedRowIndex, result);

            var showRemainingInShareText = StorageController.preferences.get("showRemainingInShareText");
            if (showRemainingInShareText === null) showRemainingInShareText = true;
            if ((gameStatus === GAME_STATUS_WIN || gameStatus === GAME_STATUS_FAIL) &&
                showRemainingInShareText) {
                this._fetchRemainingCounts();
            }
        }



        buildPrevGuesses(upToRow) {
            var prevGuesses = [];
            var map = { absent: "0", present: "1", correct: "2" };
            for (var i = 0; i < upToRow; i++) {
                var word = this.boardState[i];
                var eval_ = this.evaluations[i];
                if (word && eval_) {
                    var pattern = eval_.map(function(v) { return map[v]; }).join("");
                    prevGuesses.push([word, pattern]);
                }
            }
            return prevGuesses;
        }

        positionRowCounts() {
            var boardRect = this.$board.getBoundingClientRect();
            var rows = this.$board.querySelectorAll("game-row");
            var counts = this.$board.querySelectorAll(".gameplay-row-count");
            rows.forEach(function(row, i) {
                if (!counts[i]) return;
                var rowRect = row.getBoundingClientRect();
                counts[i].style.top = (rowRect.top - boardRect.top) + "px";
                counts[i].style.height = rowRect.height + "px";
            });
        }

        updateRowCount(rowIdx, count) {
            var counts = this.$board.querySelectorAll(".gameplay-row-count");
            var el = counts[rowIdx];
            if (!el) return;
            el.textContent = typeof count === "number" ? count : "";
        }

        addLetter(letter) {
            if (this.gameStatus !== GAME_STATUS_IN_PROGRESS) return;
            if (!this.canInput) return;
            if (this.tileIndex >= 5) return;
            this.boardState[this.rowIndex] += letter;
            var row = this.$board.querySelectorAll("game-row")[this.rowIndex];
            row.setAttribute("letters", this.boardState[this.rowIndex]);
            this.tileIndex += 1;
        }

        removeLetter() {
            if (this.gameStatus !== GAME_STATUS_IN_PROGRESS) return;
            if (!this.canInput) return;
            if (this.tileIndex <= 0) return;

            this.boardState[this.rowIndex] = this.boardState[this.rowIndex].slice(0, -1);
            var row = this.$board.querySelectorAll("game-row")[this.rowIndex];
            if (this.boardState[this.rowIndex]) {
                row.setAttribute("letters", this.boardState[this.rowIndex]);
            } else {
                row.removeAttribute("letters");
            }
            row.removeAttribute("invalid");
            this.tileIndex -= 1;
        }

        submitGuess() {
            if (this.gameStatus !== GAME_STATUS_IN_PROGRESS) return;
            if (!this.canInput) return;

            if (this.tileIndex !== 5) {
                this.$board.querySelectorAll("game-row")[this.rowIndex].setAttribute("invalid", "");
                this.addToast("Not enough letters");
                return;
            }
            this.evaluateRow();
        }

        addToast(text, duration, isSystem) {
            isSystem = isSystem || false;
            var toast = document.createElement("game-toast");
            toast.setAttribute("text", text);
            duration && toast.setAttribute("duration", duration);
            if (isSystem){
                this.querySelector("#system-toaster").prepend(toast);
            } else {
                this.querySelector("#game-toaster").prepend(toast);
            }
        }

        sizeBoard() {
            var container = this.querySelector("#board-container"),
                maxBoardWidth = window.innerWidth < 331 ? 268 : window.innerWidth < 560 ? 315 : 350,
                boardWidth = Math.min(Math.floor(container.clientHeight * (5 / 6)), maxBoardWidth),
                boardHeight = 6 * Math.floor(boardWidth / 5);
            this.$board.style.width = "".concat(boardWidth, "px");
            this.$board.style.height = "".concat(boardHeight, "px");
        }

        showStatsModal() {
            var modal = this.$game.querySelector("game-modal"),
                stats = document.createElement("game-stats");
            this.gameStatus === GAME_STATUS_WIN
                && this.rowIndex <= 6
                && stats.setAttribute("highlight-guess", this.rowIndex);
            stats.gameApp = this;
            modal.appendChild(stats);
            modal.setAttribute("open", "");
        }

        showHelpModal() {
            var modal = this.$game.querySelector("game-modal");
            modal.appendChild(document.createElement("game-help"));
            modal.setAttribute("open", "");
        }

        connectedCallback() {
            this.appendChild(gameAppTemplate.content.cloneNode(true));
            this.$game = this.querySelector("#game");
            this.$board = this.querySelector("#board");
            this.$keyboard = this.querySelector("game-keyboard");
            this.sizeBoard();
            var willShowStatsModal = this.restoringFromLocalStorage &&
                (this.gameStatus === GAME_STATUS_WIN || this.gameStatus === GAME_STATUS_FAIL);
            var isNewUser = GameStateManager.isNewUser();
            if (isNewUser && StorageController.preferences.get("shareFormat") === null) {
                StorageController.preferences.set("shareFormat", "both");
            }
            if (!willShowStatsModal && isNewUser) {
                setTimeout(() => {
                    this.showHelpModal();
                }, 100);
            }
            for (var i = 0; i < 6; i++) {
                var row = document.createElement("game-row");
                row.setAttribute("letters", this.boardState[i]);
                row.setAttribute("length", 5);
                this.evaluations[i] && (row.evaluation = this.evaluations[i]);
                this.$board.appendChild(row);
                var countEl = document.createElement("div");
                countEl.classList.add("gameplay-row-count");
                this.$board.appendChild(countEl);
            }
            this.positionRowCounts();
            if (this.gameStatus === GAME_STATUS_IN_PROGRESS && !this.answer) {
                this._fetchAnswer();
            }
            this.$game.addEventListener("game-key-press", (event) => {
                var key = event.detail.key;
                if (key === "←" || key === "Backspace") {
                    this.removeLetter();
                } else if (key === "↵" || key === "Enter") {
                    this.submitGuess();
                } else if (StringUtils.ALPHABET.includes(key.toLowerCase())) {
                    this.addLetter(key.toLowerCase());
                }
            });
            this.$game.addEventListener("game-last-tile-revealed-in-row", (event) => {
                this.$keyboard.letterEvaluations = this.letterEvaluations;
                if (this.rowIndex < 6) {
                    this.canInput = true;
                }
                var lastRow = this.$board.querySelectorAll("game-row")[this.rowIndex - 1];
                var eventPath = event.path || (event.composedPath && event.composedPath());
                if (!eventPath || !eventPath.includes(lastRow)) return;

                var gameOver = this.gameStatus === GAME_STATUS_WIN ||
                    this.gameStatus === GAME_STATUS_FAIL;
                if (gameOver) {
                    if (this.restoringFromLocalStorage) {
                        this.showStatsModal();
                    } else {
                        if (this.gameStatus === GAME_STATUS_WIN) {
                            lastRow.setAttribute("win", "");
                            this.addToast(WIN_COMMENTS[this.rowIndex - 1], 2000);
                        }
                        if (this.gameStatus === GAME_STATUS_FAIL) {
                            this.addToast(this.solution.toUpperCase(), Infinity);
                        }
                        setTimeout(() => {
                            this.showStatsModal();
                        }, 2500);
                    }
                }
                this.restoringFromLocalStorage = false;
                if (this._pendingQueryGuesses && this.gameStatus === GAME_STATUS_IN_PROGRESS) {
                    this._submitNextQueryStringGuess();
                }
            });
            this.addEventListener("game-setting-change", (event) => {
                var detail = event.detail;
                var name = detail.name;
                var checked = detail.checked;
                var value = detail.value;
                var gameLocked = this.rowIndex > 0;
                switch (name) {
                case "gameplay-mode":
                    var isHard = value === "hard";
                    var isInsane = value === "insane";
                    StorageController.preferences.set("hardMode", isHard);
                    StorageController.preferences.set("insaneMode", isInsane);
                    if (gameLocked) {
                        this.addToast("Mode change will take effect with the next game", 2000, true);
                        return;
                    }
                    this.hardMode = isHard;
                    this.insaneMode = isInsane;
                    GameStateManager.saveGameState({
                        hardMode: isHard,
                        insaneMode: isInsane,
                        puzzleNum: this.dayOffset,
                        date: DateUtils.formatLocalDate(this.today)
                    });
                    return;
                case "goof-protection-mode":
                    StorageController.preferences.set("goofProtectionMode", checked);
                    if (gameLocked) {
                        this.addToast("Mode change will take effect with the next game", 2000, true);
                        return;
                    }
                    this.goofProtection = checked;
                    GameStateManager.saveGameState({
                        goofProtectionMode: checked,
                        puzzleNum: this.dayOffset,
                        date: DateUtils.formatLocalDate(this.today)
                    });
                    return;
                case "hide-date-in-share-header":
                    StorageController.preferences.set("hideDateInShareHeader", checked);
                    return;
                case "show-remaining-in-share-text":
                    StorageController.preferences.set("showRemainingInShareText", checked);
                    return;
                }
            });
            this.querySelector("#settings-button").addEventListener("click", () => {
                var page = this.$game.querySelector("game-page"),
                    title = document.createTextNode("Settings");
                page.appendChild(title);
                var settings = document.createElement("game-settings");
                settings.setAttribute("slot", "content");
                settings.gameApp = this;
                page.appendChild(settings);
                page.setAttribute("open", "");
            });
            this.querySelector("#help-button").addEventListener("click", () => {
                var page = this.$game.querySelector("game-page"),
                    title = document.createTextNode("How to play");
                page.appendChild(title);
                var help = document.createElement("game-help");
                help.setAttribute("page", "");
                help.setAttribute("slot", "content");
                page.appendChild(help);
                page.setAttribute("open", "");
            });
            this.querySelector("#downloads-button").addEventListener("click", () => {
                var page = this.$game.querySelector("game-page"),
                    title = document.createTextNode("Downloads");
                page.appendChild(title);
                var downloads = document.createElement("game-downloads");
                downloads.setAttribute("slot", "content");
                page.appendChild(downloads);
                page.setAttribute("open", "");
            });
            this.querySelector("#statistics-button").addEventListener("click", () => {
                this.showStatsModal();
            });
            this.querySelector("#save-button").addEventListener("click", () => {
                var saveDialog = document.querySelector('#save');
                saveDialog.classList.toggle('hidden');
            });
            window.addEventListener("resize", () => { this.sizeBoard(); this.positionRowCounts(); });
            this._pendingQueryGuesses = this._parseQueryGuesses();
            if (!this.restoringFromLocalStorage && this.gameStatus === GAME_STATUS_IN_PROGRESS &&
                    this._pendingQueryGuesses.some(Boolean) && this.answer) {
                setTimeout(() => this._submitNextQueryStringGuess(), 0);
            }
            var envLabel = getEnvironmentLabel(window.location.hostname);
            if (envLabel) {
                var envBanner = document.createElement("div");
                envBanner.id = "env-banner";
                var bannerText = document.createElement("span");
                bannerText.textContent = envLabel + " — stats & history are not shared with left-wordle.com";
                var dismissBtn = document.createElement("button");
                dismissBtn.id = "env-banner-dismiss";
                dismissBtn.setAttribute("aria-label", "Dismiss");
                dismissBtn.textContent = "✕";
                dismissBtn.addEventListener("click", () => envBanner.remove());
                envBanner.appendChild(bannerText);
                envBanner.appendChild(dismissBtn);
                this.$game.insertBefore(envBanner, this.$game.querySelector("#board-container"));
            }
        }

        disconnectedCallback() {}

        _parseQueryGuesses() {
            var params = new URLSearchParams(window.location.search);
            var guesses = new Array(6).fill(null);
            for (var i = 1; i <= 6; i++) {
                var word = params.get("guess" + i) || params.get("g" + i);
                if (word && /^[a-zA-Z]{5}$/.test(word)) {
                    guesses[i - 1] = word.toLowerCase();
                }
            }
            return guesses;
        }

        async _submitNextQueryStringGuess() {
            if (!this._pendingQueryGuesses) return;
            if (this.gameStatus !== GAME_STATUS_IN_PROGRESS) return;
            if (this.rowIndex >= 6) return;
            var word = this._pendingQueryGuesses[this.rowIndex];
            if (!word) return;
            var rowIdxBefore = this.rowIndex;
            this.boardState[this.rowIndex] = word;
            this.$board.querySelectorAll("game-row")[this.rowIndex].setAttribute("letters", word);
            this.tileIndex = 5;
            await this.evaluateRow();
            if (this.rowIndex === rowIdxBefore) {
                this._pendingQueryGuesses = null;
                setTimeout(() => {
                    this.boardState[rowIdxBefore] = "";
                    var row = this.$board.querySelectorAll("game-row")[rowIdxBefore];
                    row.setAttribute("letters", "");
                    row.removeAttribute("invalid");
                    this.tileIndex = 0;
                }, 800);
            }
        }

        async _fetchAnswer() {
            this.canInput = false;
            try {
                var dateStr = DateUtils.formatLocalDate(this.today);
                var response = await window.LeftWordleApi.client.fetchAnswer(dateStr);
                if (!response || typeof response.encrypted_answer !== "string" ||
                    response.puzzle_num !== this.dayOffset) {
                    throw new Error("Invalid answer response");
                }
                this.encryptedAnswer = response.encrypted_answer;
                this.answer = decryptAnswer(this.encryptedAnswer);
                GameStateManager.saveGameState({ encryptedAnswer: this.encryptedAnswer });
                if (this.gameStatus === GAME_STATUS_IN_PROGRESS) {
                    this.canInput = true;
                }
                if (!this.restoringFromLocalStorage && this._pendingQueryGuesses &&
                    this._pendingQueryGuesses.some(Boolean)) {
                    setTimeout(() => this._submitNextQueryStringGuess(), 0);
                }
            } catch (error) {
                this.addToast("Unable to load puzzle. Please refresh.", Infinity, true);
                console.error("Failed to fetch answer:", error);
            }
        }

        async _fetchRemainingCounts() {
            try {
                var allGuesses = this.buildPrevGuesses(this.rowIndex);
                if (!allGuesses.length) return;
                var dateStr = DateUtils.formatLocalDate(this.today);
                var response = await window.LeftWordleApi.client.fetchRemainingCounts(dateStr, allGuesses);
                if (!response || !Array.isArray(response.remaining_counts)) return;
                response.remaining_counts.forEach((count, i) => {
                    if (typeof count === "number") this.answersRemaining[i] = count;
                });
                GameStateManager.saveGameState({ answersRemaining: this.answersRemaining });
            } catch (error) {
                console.warn("Failed to fetch remaining counts", error);
            }
        }

        debugTools() {
            this.querySelector("#debug-tools").appendChild(qaButtons.content.cloneNode(true));
            this.querySelector("#toast").addEventListener("click", () => {
                this.addToast("hello world");
            });
            this.querySelector("#modal").addEventListener("click", () => {
                var modal = this.$game.querySelector("game-modal");
                modal.textContent = "hello plz";
                modal.setAttribute("open", "");
            });
            this.querySelector("#reveal").addEventListener("click", () => {
                this.evaluateRow();
            });
            this.querySelector("#shake").addEventListener("click", () => {
                this.$board.querySelectorAll("game-row")[this.rowIndex].setAttribute("invalid", "");
            });
            this.querySelector("#bounce").addEventListener("click", () => {
                var row = this.$board.querySelectorAll("game-row")[this.rowIndex - 1];
                "" === row.getAttribute("win") ? row.removeAttribute("win") : row.setAttribute("win", "");
            });
        }
    }
    customElements.define("game-app", GameApp);

    var modalOverlayTemplate = document.getElementById("modal-overlay-template");

    class GameModal extends HTMLElement {
        connectedCallback() {
            this.appendChild(modalOverlayTemplate.content.cloneNode(true));
            this.$overlay = this.querySelector(".modal-overlay");
            this.$content = this.querySelector(".modal-content");
            this.addEventListener("click", () => {
                this.$content.classList.add("closing");
            });
            this.addEventListener("animationend", (event) => {
                "SlideOut" === event.animationName && (this.$content.classList.remove("closing"), this.removeAttribute("open"),
                Array.from(this.$content.childNodes).forEach((node) => {
                    if (!node.classList || !node.classList.contains("close-icon")) {
                        this.$content.removeChild(node);
                    }
                }));
                document.dispatchEvent(new CustomEvent("game-modal-closed"));
            });
        }

        appendChild(child) {
            if (this.$content && child !== this.$overlay) {
                var closeIcon = this.$content.querySelector(".close-icon");
                this.$content.insertBefore(child, closeIcon);
            } else {
                HTMLElement.prototype.appendChild.call(this, child);
            }
            return child;
        }
    }
    customElements.define("game-modal", GameModal);

    var keyButtonTemplate = document.createElement("template");
    keyButtonTemplate.innerHTML = `<button>key</button>`;
    var spacerTemplate = document.createElement("template");
    spacerTemplate.innerHTML = `<div class="spacer"></div>`;
    var KEYBOARD_LAYOUT = [["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
        ["-", "a", "s", "d", "f", "g", "h", "j", "k", "l", "-"],
        ["↵", "z", "x", "c", "v", "b", "n", "m", "←"]];

    class GameKeyboard extends HTMLElement {
        _letterEvaluations = {};

        set letterEvaluations(value) {
            this._letterEvaluations = value;
            this._render();
        }

        dispatchKeyPressEvent(key) {
            this.dispatchEvent(new CustomEvent("game-key-press", {
                bubbles: true,
                detail: { key: key }
            }));
        }

        connectedCallback() {
            var kbDiv = document.createElement("div");
            kbDiv.id = "keyboard";
            this.appendChild(kbDiv);
            this.$keyboard = kbDiv;
            this.$keyboard.addEventListener("click", (event) => {
                var btn = event.target.closest("button");
                btn && this.$keyboard.contains(btn) && this.dispatchKeyPressEvent(btn.dataset.key);
            });
            window.addEventListener("keydown", (event) => {
                if (event.repeat) return;
                // Ignore keyboard input when typing in a text field
                var target = event.target;
                if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
                var key = event.key;
                var meta = event.metaKey;
                var ctrl = event.ctrlKey;
                if (meta || ctrl) return;
                var isLetter = StringUtils.ALPHABET.includes(key.toLowerCase());
                var isBackspace = key === "Backspace";
                var isEnter = key === "Enter";
                if (isLetter || isBackspace || isEnter) {
                    this.dispatchKeyPressEvent(key);
                }
            });
            this.$keyboard.addEventListener("transitionend", (event) => {
                var btn = event.target.closest("button");
                btn && this.$keyboard.contains(btn) && btn.classList.remove("fade");
            });
            KEYBOARD_LAYOUT.forEach((row) => {
                var rowDiv = document.createElement("div");
                rowDiv.classList.add("row");
                row.forEach((keyLabel) => {
                    var el;
                    if (keyLabel >= "a" && keyLabel <= "z" || "←" === keyLabel || "↵" === keyLabel) {
                        el = keyButtonTemplate.content.cloneNode(true).firstElementChild;
                        el.dataset.key = keyLabel;
                        el.textContent = keyLabel;
                        if ("←" === keyLabel) {
                            var icon = document.createElement("game-icon");
                            icon.setAttribute("icon", "backspace");
                            el.textContent = "";
                            el.appendChild(icon);
                            el.classList.add("one-and-a-half");
                        }
                        "↵" == keyLabel && (el.textContent = "enter", el.classList.add("one-and-a-half"));
                    } else {
                        el = spacerTemplate.content.cloneNode(true).firstElementChild;
                        el.classList.add(1 === keyLabel.length ? "half" : "one");
                    }
                    rowDiv.appendChild(el);
                });
                this.$keyboard.appendChild(rowDiv);
            });
            this._render();
        }

        _render() {
            for (var key in this._letterEvaluations) {
                var btn = this.$keyboard.querySelector('[data-key="'.concat(key, '"]'));
                btn.dataset.state = this._letterEvaluations[key];
                btn.classList.add("fade");
            }
        }
    }
    customElements.define("game-keyboard", GameKeyboard);

    class ShareUtils {
        // Share results via native share API or fall back to clipboard
        static async shareOrCopy(data, onSuccess, onError) {
            try {
                // Try native share if available and supported
                if (navigator.canShare?.(data)) {
                    await navigator.share(data);
                    onSuccess();
                    return;
                }
            } catch (err) {
                console.error('Native share failed:', err.name, err.message, err);
                // User cancelled share or share failed - fall through to clipboard
                if (err.name === 'AbortError') {
                    // User cancelled - don't show error, just return
                    return;
                }
                Sentry.captureException(err, { tags: { shareMethod: "native" } });
            }

            // Clipboard fallback
            if (navigator.clipboard?.writeText) {
                try {
                    await navigator.clipboard.writeText(data.text);
                    onSuccess();
                    return;
                } catch (err) {
                    Sentry.captureException(err, { tags: { shareMethod: "clipboard" } });
                    console.error('Clipboard fallback failed:', err.name, err.message, err);
                }
            }

            // Legacy textarea fallback (iOS Chrome, non-secure contexts, etc.)
            try {
                var ta = document.createElement('textarea');
                ta.value = data.text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                var ok = document.execCommand('copy');
                document.body.removeChild(ta);
                if (ok) {
                    onSuccess();
                } else {
                    onError();
                }
            } catch (err) {
                Sentry.captureException(err, { tags: { shareMethod: "execCommand" } });
                console.error('execCommand copy failed:', err.name, err.message, err);
                onError();
            }
        }

        static buildAccessibleRows(evaluations) {
            function toList(items) {
                if (items.length === 1) return items[0];
                if (items.length === 2) return items[0] + " & " + items[1];
                return items.slice(0, -1).join(", ") + " & " + items[items.length - 1];
            }
            var rows = [];
            evaluations.forEach(function (row) {
                if (!row) return;
                var corrects = [];
                var presents = [];
                var allCorrect = true;
                row.forEach(function (tile, i) {
                    if (tile === GameEvaluator.CORRECT) {
                        corrects.push(GameEvaluator.getOrdinal(i + 1));
                    } else {
                        allCorrect = false;
                        if (tile === GameEvaluator.PRESENT) {
                            presents.push(GameEvaluator.getOrdinal(i + 1));
                        }
                    }
                });
                if (allCorrect) {
                    rows.push("Won!");
                } else if (corrects.length === 0 && presents.length === 0) {
                    rows.push("Nothing.");
                } else {
                    var parts = [];
                    if (corrects.length > 0) parts.push(toList(corrects) + " perfect.");
                    if (presents.length > 0) parts.push(toList(presents) + " wrong.");
                    rows.push(parts.join(" "));
                }
            });
            return rows;
        }

        static buildShareText(gameResults) {
            var evaluations = gameResults.evaluations;
            var dayOffset = gameResults.dayOffset;
            var rowIndex = gameResults.rowIndex;
            var isHardMode = gameResults.isHardMode;
            var isInsaneMode = gameResults.isInsaneMode;
            var isWin = gameResults.isWin;
            var answersRemaining = gameResults.answersRemaining || [];
            var isDarkTheme = StorageController.preferences.get("darkTheme");
            var isColorBlind = StorageController.preferences.get("colorBlindTheme");
            var shareAdditions = StorageController.preferences.get("shareTextAdditions") || DEFAULT_SHARE_TEXT_ADDITIONS;
            var shareFormat = StorageController.preferences.get("shareFormat") || DEFAULT_SHARE_FORMAT;
            var hideDateInShareHeader = StorageController.preferences.get("hideDateInShareHeader");
            if (hideDateInShareHeader === null) {
                hideDateInShareHeader = false;
                StorageController.preferences.set("hideDateInShareHeader", false);
            }

            // Build header line: "Wordle 123 4/6 (1995p)" or "Wordle 123 X/6* (1995p)"
            var header = (shareAdditions.preHeader || "") + "Wordle " + dayOffset.toLocaleString();
            header += " " + (isWin ? rowIndex : "X") + "/6";
            if (isInsaneMode) {
                header += "**";
            } else if (isHardMode) {
                header += "*";
            }
            // header += " (1995p)";
            if (!hideDateInShareHeader) {
                var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
                var puzzleDate = new Date(2021, 5, 19 + dayOffset);
                header += " for " + puzzleDate.getDate() + " " + MONTHS[puzzleDate.getMonth()] + ", " + puzzleDate.getFullYear();
            }
            if (shareAdditions.header) {
                header += " " + shareAdditions.header.replace(/\\n/g, "\n");
            }

            // Build emoji grid
            var grid = "";
            evaluations.forEach(function (row, rowIdx) {
                if (row) {
                    row.forEach(function (tile) {
                        if (tile) {
                            switch (tile) {
                            case GameEvaluator.CORRECT:
                                grid += isColorBlind ? "🟧" : "🟩";
                                break;
                            case GameEvaluator.PRESENT:
                                grid += isColorBlind ? "🟦" : "🟨";
                                break;
                            case GameEvaluator.ABSENT:
                                grid += isDarkTheme ? "⬛" : "⬜";
                                break;
                            }
                        }
                    });
                    if (typeof answersRemaining[rowIdx] === "number") {
                        grid += " " + answersRemaining[rowIdx];
                    }
                    grid += "\n";
                }
            });
            grid = grid.trimEnd();

            // Build accessible text
            var accessibleRows = ShareUtils.buildAccessibleRows(evaluations);
            var accessibleText = accessibleRows.map(function (row, i) {
                var line = (i + 1) + ". " + row;
                if (typeof answersRemaining[i] === "number") {
                    if (answersRemaining[i] === 1) {
                        line += " (" + answersRemaining[i] + " answer remains after guess.)";
                    } else{
                        line += " (" + answersRemaining[i] + " answers remain after guess.)";
                    }
                }
                return line;
            }).join("\n");

            var body;
            if (shareFormat === "accessible") {
                body = accessibleText;
            } else if (shareFormat === "both") {
                body = grid + "\n\n" + accessibleText;
            } else {
                body = grid;
            }

            var result = header + "\n\n" + body;
            if (shareAdditions.afterGrid) {
                var afterGridSep = (shareFormat === "accessible" || shareFormat === "both") ? "\n\n" : "\n";
                result += afterGridSep + shareAdditions.afterGrid.replace(/\\n/g, "\n");
            }
            return { text: result };
        }
    }

    // Sentry test trigger — only fires when ?test-sentry=true with correct pwd
    (async function() {
        // leaving code in place should it be necessary later, but it's not needed now.
        // return;
        var params = new URLSearchParams(window.location.search);
        if (params.get('test-sentry') !== 'true') return;
        if (btoa(params.get("pwd")) !== "QmVydGhhQDYx") return;
          try {
            try {
              myUndefinedFunction();
            } catch (err) {
              Sentry.captureException(err);
              console.log("Sentry test exception sent:", err.message);
            }
          } catch (err) {
            console.error("Sentry test trigger failed:", err);
          }
    })();

    var statsContainerTemplate = document.getElementById("stats-container-template");
    var statisticItemTemplate = document.getElementById("statistic-item-template");
    var graphBarTemplate = document.getElementById("graph-bar-template");
    var countdownTemplate = document.getElementById("countdown-template");
    var STATISTIC_LABELS = {
        currentStreak: "Current Streak",
        maxStreak: "Max Streak",
        winPercentage: "Win %",
        gamesPlayed: "Played",
        gamesWon: "Won",
        averageGuesses: "Average Guesses"
    };

    class GameStats extends HTMLElement {
        stats = {};
        gameApp;

        constructor() {
            super();
            this.stats = StatisticsEngine.getStatistics();
        }

        connectedCallback() {
            this.appendChild(statsContainerTemplate.content.cloneNode(true));
            var statisticsEl = this.querySelector("#statistics"),
                distributionEl = this.querySelector("#guess-distribution"),
                maxGuesses = Math.max.apply(Math, Array.from(Object.values(this.stats.guesses)));
            if (Object.values(this.stats.guesses).every((v) => 0 === v)) {
                var noData = document.createElement("div");
                noData.classList.add("no-data");
                noData.innerText = "No Data";
                distributionEl.appendChild(noData);
            } else
                for (var i = 1; i < Object.keys(this.stats.guesses).length; i++) {
                    var guessNum = i,
                        count = this.stats.guesses[i],
                        barFragment = graphBarTemplate.content.cloneNode(true),
                        barWidth = Math.max(7, Math.round(count / maxGuesses * 100));
                    barFragment.querySelector(".guess").textContent = guessNum;
                    var bar = barFragment.querySelector(".graph-bar");
                    bar.style.width = "".concat(barWidth, "%");
                    if ("number" == typeof count) {
                        barFragment.querySelector(".num-guesses").textContent = count;
                        count > 0 && bar.classList.add("align-right");
                        var highlightGuess = parseInt(this.getAttribute("highlight-guess"), 10);
                        highlightGuess && i === highlightGuess && bar.classList.add("highlight");
                    }
                    distributionEl.appendChild(barFragment);
                }
            ["gamesPlayed", "winPercentage", "currentStreak", "maxStreak", "averageGuesses"].forEach((statKey) => {
                if (statKey === "averageGuesses") {
                    var spacer = document.createElement("div");
                    spacer.classList.add("statistic-spacer");
                    statisticsEl.appendChild(spacer);
                }
                var label = STATISTIC_LABELS[statKey],
                    value = this.stats[statKey],
                    itemFragment = statisticItemTemplate.content.cloneNode(true);
                itemFragment.querySelector(".label").textContent = label;
                itemFragment.querySelector(".statistic").textContent = statKey === "averageGuesses" ? Number(value).toFixed(2) : value;
                statisticsEl.appendChild(itemFragment);
            });
            if (this.gameApp.gameStatus !== GAME_STATUS_IN_PROGRESS) {
                var footer = this.querySelector(".stats-footer"),
                    countdownFragment = countdownTemplate.content.cloneNode(true);
                footer.appendChild(countdownFragment);
                this.querySelector("button#share-button").addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    var completedState = GameStateManager.getGameState();
                    var showRemainingInShareText = StorageController.preferences.get("showRemainingInShareText");
                    if (showRemainingInShareText === null) showRemainingInShareText = true;
                    var shareAnswersRemaining = showRemainingInShareText ? this.gameApp.answersRemaining : null;
                    ShareUtils.shareOrCopy(ShareUtils.buildShareText({
                        evaluations: this.gameApp.evaluations,
                        dayOffset: this.gameApp.dayOffset,
                        rowIndex: this.gameApp.rowIndex,
                        isHardMode: completedState.completedInHardMode != null ? completedState.completedInHardMode : this.gameApp.hardMode,
                        isInsaneMode: completedState.completedInInsaneMode != null ? completedState.completedInInsaneMode : this.gameApp.insaneMode,
                        isWin: this.gameApp.gameStatus === GAME_STATUS_WIN,
                        answersRemaining: shareAnswersRemaining
                    }), () => {
                        this.gameApp.addToast("Copied results to clipboard", 2000, true);
                    }, () => {
                        this.gameApp.addToast("Share failed", 2000, true);
                    });
                });
            }
        }
    }
    customElements.define("game-stats", GameStats);

    class GameSwitch extends HTMLElement {
        connectedCallback() {
            var container = document.createElement("div");
            container.classList.add("container");
            container.innerHTML = '<label></label><div class="switch"><span class="knob"></span></div>';
            this.appendChild(container);
            container.addEventListener("click", (event) => {
                event.stopPropagation();
                this.hasAttribute("checked") ? this.removeAttribute("checked") : this.setAttribute("checked", "");
                this.dispatchEvent(new CustomEvent("game-switch-change", {
                    bubbles: true,
                    composed: true,
                    detail: {
                        name: this.getAttribute("name"),
                        checked: this.hasAttribute("checked"),
                        disabled: this.hasAttribute("disabled")
                    }
                }));
            });
        }

        static get observedAttributes() {
            return ["checked"];
        }
    }
    customElements.define("game-switch", GameSwitch);

    var helpTemplate = document.getElementById("help-template");

    class GameHelp extends HTMLElement {
        connectedCallback() {
            this.appendChild(helpTemplate.content.cloneNode(true));
        }
    }
    customElements.define("game-help", GameHelp);

    var pageOverlayTemplate = document.getElementById("page-overlay-template");

    class GamePage extends HTMLElement {
        connectedCallback() {
            this.appendChild(pageOverlayTemplate.content.cloneNode(true));
            this.$overlay = this.querySelector(".page-overlay");
            this.$content = this.querySelector(".page-content");
            this.$title = this.querySelector(".page-title");
            this.$contentContainer = this.querySelector(".page-content-container");
            this.querySelector("game-icon").addEventListener("click", () => {
                this.$overlay.classList.add("closing");
            });
            this.addEventListener("animationend", (event) => {
                "SlideOut" === event.animationName && (this.$overlay.classList.remove("closing"),
                this.$title.textContent = "",
                Array.from(this.$contentContainer.childNodes).forEach((node) => {
                    this.$contentContainer.removeChild(node);
                }), this.removeAttribute("open"));
            });
        }

        appendChild(child) {
            if (this.$contentContainer && child !== this.$overlay) {
                if (child.nodeType === Node.TEXT_NODE) {
                    this.$title.textContent = child.textContent;
                } else {
                    this.$contentContainer.appendChild(child);
                }
            } else {
                HTMLElement.prototype.appendChild.call(this, child);
            }
            return child;
        }
    }
    customElements.define("game-page", GamePage);

    var ICON_PATHS = {
        help: "M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z",
        download: "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z",
        settings: "M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z",
        backspace: "M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H7.07L2.4 12l4.66-7H22v14zm-11.59-2L14 13.41 17.59 17 19 15.59 15.41 12 19 8.41 17.59 7 14 10.59 10.41 7 9 8.41 12.59 12 9 15.59z",
        close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
        share: "M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92c0-1.61-1.31-2.92-2.92-2.92zM18 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM6 13c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm12 7.02c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z",
        statistics: "M16,11V3H8v6H2v12h20V11H16z M10,5h4v14h-4V5z M4,11h4v8H4V11z M20,19h-4v-6h4V19z",
        save: "M3,20.05V3.72H17.48L21,7.58V20.05ZM6.85,9.64m0-5.92V9.64h8.23V3.72m-2.76,0v4M6.85,13.11h8.23M6.85,16.46H17.13"
    };

    class GameIcon extends HTMLElement {
        connectedCallback() {
            if (!this.querySelector("svg")) {
                var iconName = this.getAttribute("icon");
                var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svg.setAttribute("height", "24");
                svg.setAttribute("viewBox", "0 0 24 24");
                svg.setAttribute("width", "24");
                var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                var fillColor = "var(--color-tone-3)";
                if (iconName === "backspace") fillColor = "var(--color-tone-1)";
                if (iconName === "share") fillColor = "var(--white)";
                path.setAttribute("fill", fillColor);
                path.setAttribute("d", ICON_PATHS[iconName]);
                svg.appendChild(path);
                this.appendChild(svg);
            }
        }
    }
    customElements.define("game-icon", GameIcon);

    var MS_PER_MINUTE = 6e4,
        MS_PER_HOUR = 36e5;

    class CountdownTimer extends HTMLElement {
        targetEpochMS;
        intervalId;
        $timer;

        constructor() {
            super();
            var tomorrow = new Date;
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(0, 0, 0, 0);
            this.targetEpochMS = tomorrow.getTime();
        }

        padDigit(num) {
            return num.toString().padStart(2, "0");
        }

        updateTimer() {
            var display,
                now = (new Date).getTime(),
                remaining = Math.floor(this.targetEpochMS - now);
            if (remaining <= 0)
                display = "00:00:00";
            else {
                var hours = Math.floor(remaining % 864e5 / MS_PER_HOUR),
                    minutes = Math.floor(remaining % MS_PER_HOUR / MS_PER_MINUTE),
                    seconds = Math.floor(remaining % MS_PER_MINUTE / 1e3);
                display = "".concat(this.padDigit(hours), ":").concat(this.padDigit(minutes), ":").concat(this.padDigit(seconds));
            }
            this.$timer.textContent = display;
        }

        connectedCallback() {
            var timerDiv = document.createElement("div");
            timerDiv.id = "countdown-timer-display";
            this.appendChild(timerDiv);
            this.$timer = timerDiv;
            this.intervalId = setInterval(() => {
                this.updateTimer();
            }, 200);
        }

        disconnectedCallback() {
            clearInterval(this.intervalId);
        }
    }
    customElements.define("countdown-timer", CountdownTimer);

    window.wordleStats = {
        recompute: StatisticsEngine.recomputeAndPersistStatistics,
        compute: StatisticsEngine.computeStatisticsFromHistoryAndLegacy,
        computeHistoryOnly: StatisticsEngine.computeHistoryOnlyStatistics
    };

    // Export pure functions for testing
    window.wordleTestExports = {
        PRESENT: GameEvaluator.PRESENT,
        CORRECT: GameEvaluator.CORRECT,
        ABSENT: GameEvaluator.ABSENT,
        STATE_PRECEDENCE: GameEvaluator.STATE_PRECEDENCE,
        PUZZLE_START_DATE: DateUtils.PUZZLE_START_DATE,
        GAME_STATUS_IN_PROGRESS: GAME_STATUS_IN_PROGRESS,
        GAME_STATUS_WIN: GAME_STATUS_WIN,
        GAME_STATUS_FAIL: GAME_STATUS_FAIL,
        FAIL_KEY: StatisticsEngine.FAIL_KEY,
        DEFAULT_STATISTICS: StatisticsEngine.DEFAULT_STATISTICS,
        ICON_PATHS: ICON_PATHS,
        aggregateLetterEvaluations: GameEvaluator.aggregateLetterEvaluations,
        getOrdinal: GameEvaluator.getOrdinal,
        calculateDaysBetween: DateUtils.calculateDaysBetween,
        getDayOffset: PuzzleUtils.getDayOffset,
        encodeWord: StringUtils.encodeWord,
        getStatistics: StatisticsEngine.getStatistics,
        updateStatistics: StatisticsEngine.updateStatistics,
        computeHistoryOnlyStatistics: StatisticsEngine.computeHistoryOnlyStatistics,
        computeStatisticsFromHistoryAndLegacy: StatisticsEngine.computeStatisticsFromHistoryAndLegacy,
        recomputeAndPersistStatistics: StatisticsEngine.recomputeAndPersistStatistics,
        evaluateGuess: GameEvaluator.evaluateGuess,
        validateHardMode: GameEvaluator.validateHardMode,
        validateInsaneMode: GameEvaluator.validateInsaneMode,
        decryptAnswer: decryptAnswer,
        buildShareText: ShareUtils.buildShareText,
        buildAccessibleRows: ShareUtils.buildAccessibleRows,
    };
})();
