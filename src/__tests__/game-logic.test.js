/**
 * Tests for wordle.js game logic functions
 *
 * These tests reference the obfuscated names via aliases.
 * As you refactor, update the alias assignments to use the new names.
 *
 * Example workflow:
 *   1. const getOrdinal = testExports.$a;  // current obfuscated name
 *   2. Rename $a to getOrdinal in wordle.js
 *   3. const getOrdinal = testExports.getOrdinal;  // updated reference
 *   4. Run tests - they should still pass
 */

const fs = require('fs');
const path = require('path');

// Set up minimal browser environment for wordle.js
const { JSDOM } = require('jsdom');

// Create a DOM with the required elements
const html = `
<!DOCTYPE html>
<html>
<head></head>
<body>
  <div id="header-container">
    <div id="game"></div>
  </div>
</body>
</html>
`;

const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'http://localhost'
});

// Set up globals that wordle.js expects
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.customElements = dom.window.customElements;
global.localStorage = {
    _data: {},
    getItem: function(key) { return this._data[key] || null; },
    setItem: function(key, value) { this._data[key] = value; },
    removeItem: function(key) { delete this._data[key]; },
    clear: function() { this._data = {}; }
};
global.window.localStorage = global.localStorage;

// Load answer_list.js and valid_guesses.js first
const answerListPath = path.join(__dirname, '../answer_list.js');
const validGuessesPath = path.join(__dirname, '../valid_guesses.js');
const wordleJsPath = path.join(__dirname, '../wordle.js');

// Execute answer_list.js to define global answer_list
const answerListCode = fs.readFileSync(answerListPath, 'utf8');
dom.window.eval(answerListCode);

// Execute valid_guesses.js to define global valid_guesses
const validGuessesCode = fs.readFileSync(validGuessesPath, 'utf8');
dom.window.eval(validGuessesCode);

const storageControllerCode = fs.readFileSync(path.join(__dirname, '../storage-controller.js'), 'utf8');
dom.window.eval(storageControllerCode);

// Now load wordle.js
const wordleCode = fs.readFileSync(wordleJsPath, 'utf8');
dom.window.eval(wordleCode);

// Get the test exports
const testExports = dom.window.wordleTestExports;

// ============================================================================
// ALIAS DEFINITIONS - Update these as you rename functions in wordle.js
// ============================================================================

// Constants
const PRESENT = testExports.PRESENT;           // Ia -> PRESENT
const CORRECT = testExports.CORRECT;           // Ma -> CORRECT
const ABSENT = testExports.ABSENT;            // Oa -> ABSENT
const STATE_PRECEDENCE = testExports.STATE_PRECEDENCE;  // Ra -> STATE_PRECEDENCE
const PUZZLE_START_DATE = testExports.PUZZLE_START_DATE; // Ha -> PUZZLE_START_DATE
const GAME_STATUS_IN_PROGRESS = testExports.GAME_STATUS_IN_PROGRESS; // Za -> GAME_STATUS_IN_PROGRESS
const GAME_STATUS_WIN = testExports.GAME_STATUS_WIN;   // es -> GAME_STATUS_WIN
const GAME_STATUS_FAIL = testExports.GAME_STATUS_FAIL;  // as -> GAME_STATUS_FAIL
const FAIL_KEY = testExports.FAIL_KEY;          // Ja -> FAIL_KEY
const DEFAULT_STATISTICS = testExports.DEFAULT_STATISTICS; // Ua -> DEFAULT_STATISTICS
const ICON_PATHS = testExports.ICON_PATHS;                // Bs -> ICON_PATHS

// Functions
const aggregateLetterEvaluations = testExports.aggregateLetterEvaluations; // Pa -> aggregateLetterEvaluations
const getOrdinal = testExports.getOrdinal;                 // $a -> getOrdinal
const calculateDaysBetween = testExports.calculateDaysBetween;       // Na -> calculateDaysBetween
const getSolution = testExports.getSolution;               // Da -> getSolution
const getDayOffset = testExports.getDayOffset;             // Ga -> getDayOffset
const encodeWord = testExports.encodeWord;                 // Wa -> encodeWord
const getStatistics = testExports.getStatistics;            // Xa -> getStatistics
const updateStatistics = testExports.updateStatistics;      // Va -> updateStatistics
const evaluateGuess = testExports.evaluateGuess;            // IIFE -> evaluateGuess
const buildShareText = testExports.buildShareText;          // IIFE -> buildShareText
const buildAccessibleRows = testExports.buildAccessibleRows; // ShareUtils.buildAccessibleRows

// ============================================================================
// TESTS
// ============================================================================

describe('Constants', () => {
    test('letter evaluation constants are correct strings', () => {
        expect(PRESENT).toBe('present');
        expect(CORRECT).toBe('correct');
        expect(ABSENT).toBe('absent');
    });

    test('state precedence ordering is correct', () => {
        expect(STATE_PRECEDENCE.unknown).toBeLessThan(STATE_PRECEDENCE.absent);
        expect(STATE_PRECEDENCE.absent).toBeLessThan(STATE_PRECEDENCE.present);
        expect(STATE_PRECEDENCE.present).toBeLessThan(STATE_PRECEDENCE.correct);
    });

    test('game status constants are correct', () => {
        expect(GAME_STATUS_IN_PROGRESS).toBe('IN_PROGRESS');
        expect(GAME_STATUS_WIN).toBe('WIN');
        expect(GAME_STATUS_FAIL).toBe('FAIL');
    });

    test('puzzle start date is June 19, 2021', () => {
        expect(PUZZLE_START_DATE.getFullYear()).toBe(2021);
        expect(PUZZLE_START_DATE.getMonth()).toBe(5); // June (0-indexed)
        expect(PUZZLE_START_DATE.getDate()).toBe(19);
    });

    test('fail key is "fail"', () => {
        expect(FAIL_KEY).toBe('fail');
    });

    test('default statistics has correct structure', () => {
        expect(DEFAULT_STATISTICS.currentStreak).toBe(0);
        expect(DEFAULT_STATISTICS.maxStreak).toBe(0);
        expect(DEFAULT_STATISTICS.gamesPlayed).toBe(0);
        expect(DEFAULT_STATISTICS.gamesWon).toBe(0);
        expect(DEFAULT_STATISTICS.winPercentage).toBe(0);
        expect(DEFAULT_STATISTICS.averageGuesses).toBe(0);
        expect(DEFAULT_STATISTICS.guesses).toBeDefined();
        expect(DEFAULT_STATISTICS.guesses[1]).toBe(0);
        expect(DEFAULT_STATISTICS.guesses.fail).toBe(0);
    });
});

describe('ICON_PATHS (previously Bs)', () => {
    test('contains all expected icon keys', () => {
        const expectedKeys = ['help', 'download', 'settings', 'backspace', 'close', 'share', 'statistics', 'save'];
        expectedKeys.forEach(function(key) {
            expect(ICON_PATHS[key]).toBeDefined();
        });
    });

    test('all values are non-empty SVG path strings', () => {
        Object.values(ICON_PATHS).forEach(function(path) {
            expect(typeof path).toBe('string');
            expect(path.length).toBeGreaterThan(0);
            expect(path).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9\s.,\-]+$/);
        });
    });

    test('has no unexpected keys', () => {
        var keys = Object.keys(ICON_PATHS);
        expect(keys).toHaveLength(8);
    });
});

describe('getOrdinal (previously $a)', () => {
    test('1st', () => expect(getOrdinal(1)).toBe('1st'));
    test('2nd', () => expect(getOrdinal(2)).toBe('2nd'));
    test('3rd', () => expect(getOrdinal(3)).toBe('3rd'));
    test('4th', () => expect(getOrdinal(4)).toBe('4th'));
    test('5th', () => expect(getOrdinal(5)).toBe('5th'));
    test('11th (special case)', () => expect(getOrdinal(11)).toBe('11th'));
    test('12th (special case)', () => expect(getOrdinal(12)).toBe('12th'));
    test('13th (special case)', () => expect(getOrdinal(13)).toBe('13th'));
    test('21st', () => expect(getOrdinal(21)).toBe('21st'));
    test('22nd', () => expect(getOrdinal(22)).toBe('22nd'));
    test('23rd', () => expect(getOrdinal(23)).toBe('23rd'));
    test('100th', () => expect(getOrdinal(100)).toBe('100th'));
    test('101st', () => expect(getOrdinal(101)).toBe('101st'));
    test('111th (special case)', () => expect(getOrdinal(111)).toBe('111th'));
});

describe('calculateDaysBetween (previously Na)', () => {
    test('same day returns 0', () => {
        const date = new Date(2023, 5, 15);
        expect(calculateDaysBetween(date, date)).toBe(0);
    });

    test('one day apart', () => {
        const start = new Date(2023, 5, 15);
        const end = new Date(2023, 5, 16);
        expect(calculateDaysBetween(start, end)).toBe(1);
    });

    test('multiple days apart', () => {
        const start = new Date(2023, 5, 15);
        const end = new Date(2023, 5, 25);
        expect(calculateDaysBetween(start, end)).toBe(10);
    });

    test('across month boundary', () => {
        const start = new Date(2023, 5, 30);
        const end = new Date(2023, 6, 5);
        expect(calculateDaysBetween(start, end)).toBe(5);
    });

    test('ignores time of day', () => {
        const start = new Date(2023, 5, 15, 23, 59, 59);
        const end = new Date(2023, 5, 16, 0, 0, 1);
        expect(calculateDaysBetween(start, end)).toBe(1);
    });
});

describe('getDayOffset (previously Ga)', () => {
    test('puzzle start date returns 0', () => {
        expect(getDayOffset(PUZZLE_START_DATE)).toBe(0);
    });

    test('one day after start returns 1', () => {
        const date = new Date(2021, 5, 20);
        expect(getDayOffset(date)).toBe(1);
    });

    test('one year after start', () => {
        const date = new Date(2022, 5, 19);
        expect(getDayOffset(date)).toBe(365);
    });
});

describe('getSolution (previously Da)', () => {
    test('returns a 5-letter word', () => {
        const solution = getSolution(new Date(2023, 5, 15));
        expect(solution).toHaveLength(5);
    });

    test('same date returns same word', () => {
        const date1 = new Date(2023, 5, 15, 10, 30);
        const date2 = new Date(2023, 5, 15, 22, 45);
        expect(getSolution(date1)).toBe(getSolution(date2));
    });

    test('different dates return different words (usually)', () => {
        const word1 = getSolution(new Date(2023, 5, 15));
        const word2 = getSolution(new Date(2023, 5, 16));
        // They could theoretically be the same if answer_list repeats, but very unlikely
        expect(word1).not.toBe(word2);
    });

    test('puzzle start date returns first word in answer list', () => {
        const solution = getSolution(PUZZLE_START_DATE);
        expect(solution).toBe(dom.window.answer_list[0]);
    });
});

describe('aggregateLetterEvaluations (previously Pa)', () => {
    test('empty board returns empty object', () => {
        const result = aggregateLetterEvaluations(
            ['', '', '', '', '', ''],
            [null, null, null, null, null, null]
        );
        expect(result).toEqual({});
    });

    test('single guess aggregates correctly', () => {
        const boardState = ['crane', '', '', '', '', ''];
        const evaluations = [
            [CORRECT, ABSENT, PRESENT, ABSENT, ABSENT],
            null, null, null, null, null
        ];
        const result = aggregateLetterEvaluations(boardState, evaluations);
        expect(result.c).toBe(CORRECT);
        expect(result.r).toBe(ABSENT);
        expect(result.a).toBe(PRESENT);
        expect(result.n).toBe(ABSENT);
        expect(result.e).toBe(ABSENT);
    });

    test('upgrades letter state with better evaluation', () => {
        const boardState = ['crane', 'catch', '', '', '', ''];
        const evaluations = [
            [CORRECT, ABSENT, ABSENT, ABSENT, ABSENT],  // 'a' is absent
            [CORRECT, PRESENT, ABSENT, ABSENT, ABSENT], // 'a' is present (better)
            null, null, null, null
        ];
        const result = aggregateLetterEvaluations(boardState, evaluations);
        expect(result.a).toBe(PRESENT); // Upgraded from absent to present
    });

    test('does not downgrade letter state', () => {
        const boardState = ['crane', 'xxxcx', '', '', '', ''];
        const evaluations = [
            [CORRECT, ABSENT, ABSENT, ABSENT, ABSENT], // 'c' is correct
            [ABSENT, ABSENT, ABSENT, PRESENT, ABSENT], // 'c' is present (worse)
            null, null, null, null
        ];
        const result = aggregateLetterEvaluations(boardState, evaluations);
        expect(result.c).toBe(CORRECT); // Should stay correct, not downgrade
    });
});

describe('getStatistics (currently Xa)', () => {
    beforeEach(() => {
        dom.window.localStorage.removeItem('statistics');
    });

    test('returns default statistics when nothing in localStorage', () => {
        const stats = getStatistics();
        expect(stats.currentStreak).toBe(0);
        expect(stats.maxStreak).toBe(0);
        expect(stats.gamesPlayed).toBe(0);
        expect(stats.gamesWon).toBe(0);
        expect(stats.winPercentage).toBe(0);
        expect(stats.averageGuesses).toBe(0);
        expect(stats.guesses).toBeDefined();
        expect(stats.guesses.fail).toBe(0);
    });

    test('returns saved statistics from localStorage', () => {
        const saved = {
            currentStreak: 3,
            maxStreak: 5,
            gamesPlayed: 10,
            gamesWon: 8,
            winPercentage: 80,
            averageGuesses: 4,
            guesses: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 1, 6: 1, fail: 2 }
        };
        dom.window.localStorage.setItem('statistics', JSON.stringify(saved));
        const stats = getStatistics();
        expect(stats.currentStreak).toBe(3);
        expect(stats.maxStreak).toBe(5);
        expect(stats.gamesPlayed).toBe(10);
        expect(stats.gamesWon).toBe(8);
    });

    test('returns a new object each call (not a reference)', () => {
        const stats1 = getStatistics();
        const stats2 = getStatistics();
        expect(stats1).toEqual(stats2);
        expect(stats1).not.toBe(stats2);
    });
});

describe('updateStatistics (currently Va)', () => {
    beforeEach(() => {
        dom.window.localStorage.removeItem('statistics');
    });

    test('records a win and increments streak', () => {
        updateStatistics({ isWin: true, isStreak: false, numGuesses: 3 });
        const stats = getStatistics();
        expect(stats.gamesPlayed).toBe(1);
        expect(stats.gamesWon).toBe(1);
        expect(stats.currentStreak).toBe(1);
        expect(stats.guesses[3]).toBe(1);
    });

    test('records a loss and resets streak', () => {
        updateStatistics({ isWin: true, isStreak: false, numGuesses: 4 });
        updateStatistics({ isWin: false, isStreak: false, numGuesses: 6 });
        const stats = getStatistics();
        expect(stats.gamesPlayed).toBe(2);
        expect(stats.gamesWon).toBe(1);
        expect(stats.currentStreak).toBe(0);
        expect(stats.guesses.fail).toBe(1);
    });

    test('continues streak when isStreak is true', () => {
        updateStatistics({ isWin: true, isStreak: false, numGuesses: 3 });
        updateStatistics({ isWin: true, isStreak: true, numGuesses: 4 });
        const stats = getStatistics();
        expect(stats.currentStreak).toBe(2);
    });

    test('tracks max streak', () => {
        updateStatistics({ isWin: true, isStreak: false, numGuesses: 3 });
        updateStatistics({ isWin: true, isStreak: true, numGuesses: 4 });
        updateStatistics({ isWin: true, isStreak: true, numGuesses: 2 });
        updateStatistics({ isWin: false, isStreak: false, numGuesses: 6 });
        const stats = getStatistics();
        expect(stats.maxStreak).toBe(3);
        expect(stats.currentStreak).toBe(0);
    });

    test('calculates win percentage', () => {
        updateStatistics({ isWin: true, isStreak: false, numGuesses: 3 });
        updateStatistics({ isWin: true, isStreak: true, numGuesses: 4 });
        updateStatistics({ isWin: false, isStreak: false, numGuesses: 6 });
        const stats = getStatistics();
        expect(stats.winPercentage).toBe(67); // Math.round(2/3 * 100)
    });

    test('calculates average guesses', () => {
        updateStatistics({ isWin: true, isStreak: false, numGuesses: 2 });
        updateStatistics({ isWin: true, isStreak: true, numGuesses: 4 });
        const stats = getStatistics();
        expect(stats.averageGuesses).toBe(3); // Math.round((2+4)/2)
    });

    test('persists to localStorage', () => {
        updateStatistics({ isWin: true, isStreak: false, numGuesses: 3 });
        const raw = dom.window.localStorage.getItem('statistics');
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw);
        expect(parsed.gamesPlayed).toBe(1);
    });
});

describe('evaluateGuess (extracted IIFE)', () => {
    test('all correct', () => {
        const result = evaluateGuess('crane', 'crane');
        expect(result).toEqual([CORRECT, CORRECT, CORRECT, CORRECT, CORRECT]);
    });

    test('all absent', () => {
        const result = evaluateGuess('xxxxx', 'crane');
        expect(result).toEqual([ABSENT, ABSENT, ABSENT, ABSENT, ABSENT]);
    });

    test('mixed correct, present, and absent', () => {
        // guess: cnxer, solution: crane
        // c=correct, n=present(pos3->pos3? no, n@1 vs r@1), n=present, x=absent, e=present, r=present
        const result = evaluateGuess('rnexa', 'crane');
        expect(result).toEqual([PRESENT, PRESENT, PRESENT, ABSENT, PRESENT]);
    });

    test('duplicate letter in guess, one correct', () => {
        const result = evaluateGuess('creep', 'crane');
        expect(result[0]).toBe(CORRECT); // c
        expect(result[1]).toBe(CORRECT); // r
        expect(result[2]).toBe(PRESENT); // e (present, not in position 2)
        expect(result[3]).toBe(ABSENT);  // e (duplicate, already accounted for)
        expect(result[4]).toBe(ABSENT);  // p
    });

    test('duplicate letter in guess, none in correct position', () => {
        const result = evaluateGuess('eexxx', 'crane');
        expect(result[0]).toBe(PRESENT); // first e is present
        expect(result[1]).toBe(ABSENT);  // second e, only one e in solution
    });

    test('returns array same length as solution', () => {
        const result = evaluateGuess('crane', 'crane');
        expect(result).toHaveLength(5);
    });
});

describe('buildShareText (extracted IIFE)', () => {
    beforeEach(() => {
        dom.window.StorageController.preferences.clear();
    });

    test('builds header with puzzle number and guess count', () => {
        var result = buildShareText({
            evaluations: [
                [CORRECT, CORRECT, CORRECT, CORRECT, CORRECT],
                null, null, null, null, null
            ],
            dayOffset: 123,
            rowIndex: 1,
            isHardMode: false,
            isWin: true
        });
        expect(result.text).toMatch(/^Wordle 123 1\/6/);
    });

    test('shows X for losses', () => {
        var result = buildShareText({
            evaluations: [
                [ABSENT, ABSENT, ABSENT, ABSENT, ABSENT],
                [ABSENT, ABSENT, ABSENT, ABSENT, ABSENT],
                [ABSENT, ABSENT, ABSENT, ABSENT, ABSENT],
                [ABSENT, ABSENT, ABSENT, ABSENT, ABSENT],
                [ABSENT, ABSENT, ABSENT, ABSENT, ABSENT],
                [ABSENT, ABSENT, ABSENT, ABSENT, ABSENT]
            ],
            dayOffset: 50,
            rowIndex: 6,
            isHardMode: false,
            isWin: false
        });
        expect(result.text).toMatch(/^Wordle 50 X\/6/);
    });

    test('appends asterisk for hard mode', () => {
        var result = buildShareText({
            evaluations: [
                [CORRECT, CORRECT, CORRECT, CORRECT, CORRECT],
                null, null, null, null, null
            ],
            dayOffset: 99,
            rowIndex: 1,
            isHardMode: true,
            isWin: true
        });
        expect(result.text).toMatch(/^Wordle 99 1\/6\*/);
    });

    test('uses green/yellow/white squares in normal mode', () => {
        var result = buildShareText({
            evaluations: [
                [CORRECT, PRESENT, ABSENT, ABSENT, ABSENT],
                null, null, null, null, null
            ],
            dayOffset: 1,
            rowIndex: 1,
            isHardMode: false,
            isWin: true
        });
        expect(result.text).toContain("🟩");
        expect(result.text).toContain("🟨");
        expect(result.text).toContain("⬜");
    });

    test('uses dark squares when dark theme is set', () => {
        dom.window.StorageController.preferences.set('darkTheme', true);
        var result = buildShareText({
            evaluations: [
                [ABSENT, ABSENT, ABSENT, ABSENT, ABSENT],
                null, null, null, null, null
            ],
            dayOffset: 1,
            rowIndex: 1,
            isHardMode: false,
            isWin: true
        });
        expect(result.text).toContain("⬛");
        expect(result.text).not.toContain("⬜");
    });

    test('uses colorblind squares when colorblind mode is set', () => {
        dom.window.StorageController.preferences.set('colorBlindTheme', true);
        var result = buildShareText({
            evaluations: [
                [CORRECT, PRESENT, ABSENT, ABSENT, ABSENT],
                null, null, null, null, null
            ],
            dayOffset: 1,
            rowIndex: 1,
            isHardMode: false,
            isWin: true
        });
        expect(result.text).toContain("🟧");
        expect(result.text).toContain("🟦");
    });

    test('skips null evaluation rows', () => {
        var result = buildShareText({
            evaluations: [
                [CORRECT, CORRECT, CORRECT, CORRECT, CORRECT],
                null, null, null, null, null
            ],
            dayOffset: 1,
            rowIndex: 1,
            isHardMode: false,
            isWin: true
        });
        var lines = result.text.split("\n");
        // Header, blank line, one grid row
        expect(lines).toHaveLength(3);
    });

    test('returns object with text property', () => {
        var result = buildShareText({
            evaluations: [
                [CORRECT, CORRECT, CORRECT, CORRECT, CORRECT],
                null, null, null, null, null
            ],
            dayOffset: 1,
            rowIndex: 1,
            isHardMode: false,
            isWin: true
        });
        expect(result).toHaveProperty('text');
        expect(typeof result.text).toBe('string');
    });

    test('appends answers_remaining count after each row when provided', () => {
        var result = buildShareText({
            evaluations: [
                [ABSENT, PRESENT, ABSENT, ABSENT, ABSENT],
                [CORRECT, CORRECT, CORRECT, CORRECT, CORRECT],
                null, null, null, null
            ],
            dayOffset: 10,
            rowIndex: 2,
            isHardMode: false,
            isWin: true,
            answersRemaining: [87, null, null, null, null, null]
        });
        var lines = result.text.split("\n");
        var gridLines = lines.filter(function(l) { return /[⬜⬛🟩🟨🟧🟦]/.test(l); });
        expect(gridLines[0]).toMatch(/ 87$/);
        expect(gridLines[1]).not.toMatch(/ \d/);
    });

    test('omits counts when answersRemaining not provided', () => {
        var result = buildShareText({
            evaluations: [
                [ABSENT, ABSENT, ABSENT, ABSENT, ABSENT],
                null, null, null, null, null
            ],
            dayOffset: 1,
            rowIndex: 1,
            isHardMode: false,
            isWin: false
        });
        var lines = result.text.split("\n");
        var gridLines = lines.filter(function(l) { return /[⬜⬛🟩🟨🟧🟦]/.test(l); });
        gridLines.forEach(function(line) {
            expect(line).not.toMatch(/ \d/);
        });
    });

    test('afterGrid is separated by one newline in emoji-only format', () => {
        dom.window.StorageController.preferences.set('shareTextAdditions', { header: '', afterGrid: 'extra' });
        var result = buildShareText({
            evaluations: [
                [CORRECT, CORRECT, CORRECT, CORRECT, CORRECT],
                null, null, null, null, null
            ],
            dayOffset: 1,
            rowIndex: 1,
            isHardMode: false,
            isWin: true
        });
        // body ends with emoji grid row; afterGrid follows with a single newline (no blank line)
        expect(result.text).toMatch(/[🟩⬜⬛🟨🟧🟦]\nextra$/);
    });

    test('afterGrid is separated by a blank line in accessible format', () => {
        dom.window.StorageController.preferences.set('shareFormat', 'accessible');
        dom.window.StorageController.preferences.set('shareTextAdditions', { header: '', afterGrid: 'extra' });
        var result = buildShareText({
            evaluations: [
                [CORRECT, CORRECT, CORRECT, CORRECT, CORRECT],
                null, null, null, null, null
            ],
            dayOffset: 1,
            rowIndex: 1,
            isHardMode: false,
            isWin: true
        });
        expect(result.text).toMatch(/Won!\n\nextra$/);
    });

    test('afterGrid is separated by a blank line in both format', () => {
        dom.window.StorageController.preferences.set('shareFormat', 'both');
        dom.window.StorageController.preferences.set('shareTextAdditions', { header: '', afterGrid: 'extra' });
        var result = buildShareText({
            evaluations: [
                [CORRECT, CORRECT, CORRECT, CORRECT, CORRECT],
                null, null, null, null, null
            ],
            dayOffset: 1,
            rowIndex: 1,
            isHardMode: false,
            isWin: true
        });
        expect(result.text).toMatch(/Won!\n\nextra$/);
    });
});

describe('buildAccessibleRows', () => {
    test('all correct returns Won!', () => {
        var rows = buildAccessibleRows([
            [CORRECT, CORRECT, CORRECT, CORRECT, CORRECT],
            null, null, null, null, null
        ]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toBe('Won!');
    });

    test('all absent returns Nothing.', () => {
        var rows = buildAccessibleRows([
            [ABSENT, ABSENT, ABSENT, ABSENT, ABSENT],
            null, null, null, null, null
        ]);
        expect(rows[0]).toBe('Nothing.');
    });

    test('single correct position', () => {
        var rows = buildAccessibleRows([
            [CORRECT, ABSENT, ABSENT, ABSENT, ABSENT],
            null, null, null, null, null
        ]);
        expect(rows[0]).toBe('1st perfect.');
    });

    test('single present position', () => {
        var rows = buildAccessibleRows([
            [ABSENT, ABSENT, ABSENT, ABSENT, PRESENT],
            null, null, null, null, null
        ]);
        expect(rows[0]).toBe('5th wrong.');
    });

    test('multiple corrects joined with &', () => {
        var rows = buildAccessibleRows([
            [CORRECT, CORRECT, ABSENT, ABSENT, ABSENT],
            null, null, null, null, null
        ]);
        expect(rows[0]).toBe('1st & 2nd perfect.');
    });

    test('three corrects use comma then &', () => {
        var rows = buildAccessibleRows([
            [CORRECT, CORRECT, CORRECT, ABSENT, ABSENT],
            null, null, null, null, null
        ]);
        expect(rows[0]).toBe('1st, 2nd & 3rd perfect.');
    });

    test('corrects and presents combined', () => {
        var rows = buildAccessibleRows([
            [CORRECT, ABSENT, ABSENT, PRESENT, ABSENT],
            null, null, null, null, null
        ]);
        expect(rows[0]).toBe('1st perfect. 4th wrong.');
    });

    test('skips null rows', () => {
        var rows = buildAccessibleRows([
            [CORRECT, CORRECT, CORRECT, CORRECT, CORRECT],
            null, null, null, null, null
        ]);
        expect(rows).toHaveLength(1);
    });

    test('multiple rows', () => {
        var rows = buildAccessibleRows([
            [CORRECT, ABSENT, ABSENT, ABSENT, ABSENT],
            [ABSENT, ABSENT, ABSENT, ABSENT, ABSENT],
            [CORRECT, CORRECT, CORRECT, CORRECT, CORRECT],
            null, null, null
        ]);
        expect(rows).toHaveLength(3);
        expect(rows[0]).toBe('1st perfect.');
        expect(rows[1]).toBe('Nothing.');
        expect(rows[2]).toBe('Won!');
    });
});

describe('encodeWord (previously Wa)', () => {
    test('encodes alphabetic characters', () => {
        const encoded = encodeWord('abc');
        expect(encoded).toHaveLength(3);
        expect(encoded).not.toBe('abc'); // Should be different
    });

    test('replaces non-alphabetic characters with underscore', () => {
        const encoded = encodeWord('a1b');
        expect(encoded[1]).toBe('_');
    });

    test('is consistent (same input = same output)', () => {
        expect(encodeWord('crane')).toBe(encodeWord('crane'));
    });

    test('encodes all letters to letters', () => {
        const encoded = encodeWord('abcdefghijklmnopqrstuvwxyz');
        expect(encoded).toMatch(/^[a-z]+$/);
    });
});
