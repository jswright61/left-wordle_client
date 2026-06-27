const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = `<!DOCTYPE html><html><head></head><body><div id="save"></div></body></html>`;

const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'http://localhost'
});

// Load answer_list so savemenu can use it
const answerListCode = fs.readFileSync(path.join(__dirname, '../answer_list.js'), 'utf8');
dom.window.eval(answerListCode);

// Set global constant that savemenu bootstrap expects (normally set by wordle.js)
dom.window.PUZZLE_START_DATE = new Date(2021, 5, 19);

const storageControllerCode = fs.readFileSync(path.join(__dirname, '../storage-controller.js'), 'utf8');
dom.window.eval(storageControllerCode);

// Load savemenu.js
const savemenuCode = fs.readFileSync(path.join(__dirname, '../savemenu.js'), 'utf8');
dom.window.eval(savemenuCode);

const { PuzzleResolver } = dom.window.savemenuTestExports;

var resolver = new PuzzleResolver(dom.window.answer_list, dom.window.PUZZLE_START_DATE);

// answer_list[0] = "cigar" (puzzle #0, date 2021-06-19)
// answer_list[1] = "rebut" (puzzle #1, date 2021-06-20)

describe('dateToPuzzleNum', () => {
    test('returns 0 for puzzle start date', () => {
        expect(resolver.dateToPuzzleNum('2021-06-19')).toBe(0);
    });

    test('returns 1 for day after start', () => {
        expect(resolver.dateToPuzzleNum('2021-06-20')).toBe(1);
    });

    test('returns null for date before start', () => {
        expect(resolver.dateToPuzzleNum('2021-06-18')).toBeNull();
    });

    test('returns null for invalid input', () => {
        expect(resolver.dateToPuzzleNum(null)).toBeNull();
        expect(resolver.dateToPuzzleNum('')).toBeNull();
        expect(resolver.dateToPuzzleNum('not-a-date')).toBeNull();
    });
});

describe('answerToPuzzleNum', () => {
    test('returns 0 for first answer', () => {
        expect(resolver.answerToPuzzleNum('cigar')).toBe(0);
    });

    test('is case-insensitive', () => {
        expect(resolver.answerToPuzzleNum('CIGAR')).toBe(0);
    });

    test('returns null for unknown word', () => {
        expect(resolver.answerToPuzzleNum('zzzzz')).toBeNull();
    });

    test('returns null for invalid input', () => {
        expect(resolver.answerToPuzzleNum(null)).toBeNull();
        expect(resolver.answerToPuzzleNum('')).toBeNull();
    });
});

describe('puzzleNumToAnswer', () => {
    test('returns first answer for puzzle 0', () => {
        expect(resolver.puzzleNumToAnswer(0)).toBe('cigar');
    });

    test('returns second answer for puzzle 1', () => {
        expect(resolver.puzzleNumToAnswer(1)).toBe('rebut');
    });

    test('wraps around answer list', () => {
        var listLen = dom.window.answer_list.length;
        expect(resolver.puzzleNumToAnswer(listLen)).toBe('cigar');
    });

    test('returns null for invalid input', () => {
        expect(resolver.puzzleNumToAnswer(-1)).toBeNull();
        expect(resolver.puzzleNumToAnswer(NaN)).toBeNull();
    });
});

describe('resolveAndValidateEntry', () => {
    test('resolves from puzzle_num only', () => {
        var res = resolver.resolveAndValidateEntry({ puzzle_num: 0, result: 3 }, 0);
        expect(res.flag).toBeNull();
        expect(res.entry.puzzle_num).toBe(0);
        expect(res.entry.date).toBe('2021-06-19');
        expect(res.entry.answer).toBe('cigar');
        expect(res.entry.result).toBe(3);
    });

    test('resolves from date only', () => {
        var res = resolver.resolveAndValidateEntry({ date: '2021-06-19', result: 4 }, 0);
        expect(res.flag).toBeNull();
        expect(res.entry.puzzle_num).toBe(0);
        expect(res.entry.answer).toBe('cigar');
    });

    test('resolves from answer only', () => {
        var res = resolver.resolveAndValidateEntry({ answer: 'cigar', result: 2 }, 0);
        expect(res.flag).toBeNull();
        expect(res.entry.puzzle_num).toBe(0);
        expect(res.entry.date).toBe('2021-06-19');
    });

    test('flags missing result', () => {
        var res = resolver.resolveAndValidateEntry({ puzzle_num: 0 }, 0);
        expect(res.flag).toBe('missing or invalid result');
    });

    test('flags when no deterministic field provided', () => {
        var res = resolver.resolveAndValidateEntry({ result: 3 }, 0);
        expect(res.flag).toBe('missing puzzle_num, date, and answer');
    });

    test('flags conflicting puzzle_num and date', () => {
        var res = resolver.resolveAndValidateEntry({ puzzle_num: 0, date: '2021-06-20', result: 3 }, 0);
        expect(res.flag).toContain('maps to');
        expect(res.flag).toContain('2021-06-19');
    });

    test('flags conflicting puzzle_num and answer', () => {
        var res = resolver.resolveAndValidateEntry({ puzzle_num: 0, answer: 'rebut', result: 3 }, 0);
        expect(res.flag).toContain('maps to answer');
        expect(res.flag).toContain('cigar');
    });

    test('flags conflicting date and answer', () => {
        // date 2021-06-19 = puzzle 0 = cigar, but answer says rebut
        var res = resolver.resolveAndValidateEntry({ date: '2021-06-19', answer: 'rebut', result: 3 }, 0);
        expect(res.flag).toContain('maps to answer');
    });

    test('accepts consistent puzzle_num and date', () => {
        var res = resolver.resolveAndValidateEntry({ puzzle_num: 0, date: '2021-06-19', result: 3 }, 0);
        expect(res.flag).toBeNull();
        expect(res.entry.puzzle_num).toBe(0);
    });

    test('accepts consistent puzzle_num and answer', () => {
        var res = resolver.resolveAndValidateEntry({ puzzle_num: 0, answer: 'cigar', result: 3 }, 0);
        expect(res.flag).toBeNull();
    });

    test('sets non-deterministic fields to null', () => {
        var res = resolver.resolveAndValidateEntry({ puzzle_num: 0, result: 3 }, 0);
        expect(res.entry.mode).toBeNull();
        expect(res.entry.starter).toBeNull();
        expect(res.entry.completed_at).toBeNull();
        expect(res.entry.updated_at).toBeNull();
        expect(res.entry.device_id).toBeNull();
        expect(res.entry.origin).toBeNull();
    });

    test('flags answer not in answer list', () => {
        var res = resolver.resolveAndValidateEntry({ answer: 'zzzzz', result: 3 }, 0);
        expect(res.flag).toContain('not found in answer list');
    });

    test('flags non-object input', () => {
        var res = resolver.resolveAndValidateEntry(null, 0);
        expect(res.flag).toBe('invalid row (not an object)');
    });

    test('normalizes result values (X -> 7)', () => {
        var res = resolver.resolveAndValidateEntry({ puzzle_num: 0, result: 'X' }, 0);
        expect(res.flag).toBeNull();
        expect(res.entry.result).toBe(7);
    });

    test('accepts alternative result field names', () => {
        var res = resolver.resolveAndValidateEntry({ puzzle_num: 0, guesses: 4 }, 0);
        expect(res.flag).toBeNull();
        expect(res.entry.result).toBe(4);
    });

    test('accepts alternative puzzle_num field names', () => {
        var res = resolver.resolveAndValidateEntry({ puzzleNum: 1, result: 3 }, 0);
        expect(res.flag).toBeNull();
        expect(res.entry.puzzle_num).toBe(1);
        expect(res.entry.answer).toBe('rebut');
    });

    test('flags date before puzzle start', () => {
        var res = resolver.resolveAndValidateEntry({ date: '2020-01-01', result: 3 }, 0);
        expect(res.flag).toContain('before puzzle start');
    });

    test('treats empty string puzzle_num as omitted, resolves from date', () => {
        var res = resolver.resolveAndValidateEntry({ puzzle_num: '', date: '2021-06-20', result: 4 }, 0);
        expect(res.flag).toBeNull();
        expect(res.entry.puzzle_num).toBe(1);
        expect(res.entry.answer).toBe('rebut');
    });

    test('treats empty string puzzle_num as omitted, resolves from answer', () => {
        var res = resolver.resolveAndValidateEntry({ puzzle_num: '', answer: 'rebut', result: 5 }, 0);
        expect(res.flag).toBeNull();
        expect(res.entry.puzzle_num).toBe(1);
        expect(res.entry.date).toBe('2021-06-20');
    });

    test('treats empty string date and puzzle_num as omitted, resolves from answer', () => {
        var res = resolver.resolveAndValidateEntry({ puzzle_num: '', date: '', answer: 'cigar', result: 3 }, 0);
        expect(res.flag).toBeNull();
        expect(res.entry.puzzle_num).toBe(0);
        expect(res.entry.date).toBe('2021-06-19');
    });

    test('flags empty string for all deterministic fields', () => {
        var res = resolver.resolveAndValidateEntry({ puzzle_num: '', date: '', answer: '', result: 3 }, 0);
        expect(res.flag).toBe('missing puzzle_num, date, and answer');
    });
});

var { HistoryManager } = dom.window.savemenuTestExports;

describe('HISTORY_BASE_FIELDS', () => {
    test('includes origin', () => {
        expect(HistoryManager.HISTORY_BASE_FIELDS).toContain('origin');
    });
});

describe('importRecords', () => {
    var historyManager;

    beforeEach(() => {
        dom.window.localStorage.clear();
        historyManager = new HistoryManager(resolver);
        // Stub out recompute so imports do not depend on the game script.
        dom.window.wordleStats = { recompute: function() {} };
    });

    test('flags rows that duplicate an existing history entry', () => {
        // Pre-populate history with puzzle #0
        dom.window.localStorage.setItem('history', JSON.stringify({
            '0': { puzzle_num: 0, date: '2021-06-19', result: 3, answer: 'cigar' }
        }));
        var result = historyManager.importRecords([
            { puzzle_num: 0, result: 4 }
        ]);
        expect(result.addedCount).toBe(0);
        expect(result.flaggedRows).toHaveLength(1);
        expect(result.flaggedRows[0].reason).toContain('already exists in history');
    });

    test('flags rows that duplicate another row in the same file', () => {
        var result = historyManager.importRecords([
            { puzzle_num: 0, result: 3 },
            { puzzle_num: 0, result: 5 }
        ]);
        expect(result.addedCount).toBe(1);
        expect(result.flaggedRows).toHaveLength(1);
        expect(result.flaggedRows[0].reason).toContain('duplicate of another row');
        expect(result.flaggedRows[0].row).toBe(2);
    });

    test('imports all rows when no duplicates exist', () => {
        var result = historyManager.importRecords([
            { puzzle_num: 0, result: 3 },
            { puzzle_num: 1, result: 4 }
        ]);
        expect(result.addedCount).toBe(2);
        expect(result.flaggedRows).toHaveLength(0);
    });

    test('sets origin to "imported" on imported entries', () => {
        historyManager.importRecords([
            { puzzle_num: 0, result: 3 }
        ]);
        var history = JSON.parse(dom.window.localStorage.getItem('history'));
        expect(history['0'].origin).toBe('imported');
    });
});

describe('SaveMenu#collectAllSettings', () => {
    var { SaveMenu } = dom.window.savemenuTestExports;
    var saveMenu;

    beforeEach(() => {
        dom.window.localStorage.clear();
        delete dom.window.APP_VERSION;
        saveMenu = new SaveMenu(new HistoryManager(resolver));
    });

    test('includes a diagnostics key with server and version', () => {
        var data = saveMenu.collectAllSettings();
        expect(data.diagnostics).toBeDefined();
        expect(Object.keys(data.diagnostics)).toContain('server');
        expect(Object.keys(data.diagnostics)).toContain('version');
    });

    test('sets server to the current hostname', () => {
        var data = saveMenu.collectAllSettings();
        expect(data.diagnostics.server).toBe('localhost');
    });

    test('sets version to APP_VERSION when available', () => {
        dom.window.APP_VERSION = '1.2.3';
        var data = saveMenu.collectAllSettings();
        expect(data.diagnostics.version).toBe('1.2.3');
    });

    test('sets version to null when APP_VERSION is not defined', () => {
        var data = saveMenu.collectAllSettings();
        expect(data.diagnostics.version).toBeNull();
    });
});
