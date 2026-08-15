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

// Load toolsmenu.js
const savemenuCode = fs.readFileSync(path.join(__dirname, '../toolsmenu.js'), 'utf8');
dom.window.eval(savemenuCode);

const { PuzzleResolver } = dom.window.toolsmenuTestExports;

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

var { HistoryManager } = dom.window.toolsmenuTestExports;

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

describe('ToolsMenu#collectAllSettings', () => {
    var { ToolsMenu } = dom.window.toolsmenuTestExports;
    var saveMenu;

    beforeEach(() => {
        dom.window.localStorage.clear();
        delete dom.window.APP_VERSION;
        saveMenu = new ToolsMenu(new HistoryManager(resolver));
    });

    test('includes a diagnostics key with server and version', async () => {
        var data = await saveMenu.collectAllSettings();
        expect(data.diagnostics).toBeDefined();
        expect(Object.keys(data.diagnostics)).toContain('server');
        expect(Object.keys(data.diagnostics)).toContain('version');
    });

    test('sets server to the current hostname', async () => {
        var data = await saveMenu.collectAllSettings();
        expect(data.diagnostics.server).toBe('localhost');
    });

    test('sets version to APP_VERSION when available', async () => {
        dom.window.APP_VERSION = '1.2.3';
        var data = await saveMenu.collectAllSettings();
        expect(data.diagnostics.version).toBe('1.2.3');
    });

    test('sets version to null when APP_VERSION is not defined', async () => {
        var data = await saveMenu.collectAllSettings();
        expect(data.diagnostics.version).toBeNull();
    });

    test('includes the raw local dump when not logged in', async () => {
        dom.window.localStorage.setItem('preferences', JSON.stringify({ hardMode: true }));
        var data = await saveMenu.collectAllSettings();
        expect(data.preferences).toEqual({ hardMode: true });
    });

    describe('while logged in', () => {
        var getProfile, getHistory;

        beforeEach(() => {
            getProfile = jest.fn(() => Promise.resolve({
                preferences: { hardMode: true },
                statistics: { gamesPlayed: 5 },
                game_state: { puzzleNum: 42 }
            }));
            getHistory = jest.fn(() => Promise.resolve({
                100: { puzzle_num: 100, date: '2021-09-27', mode: 'regular', game_status: 'WIN', guesses: [['crane', '22222']] }
            }));
            dom.window.LeftWordleAuth = {
                isLoggedIn: () => true,
                serverHistoryToLocalHistory: (h) => ({ 100: { puzzle_num: 100, result: 1 } })
            };
            dom.window.LeftWordleApi = { client: { getProfile, getHistory } };
        });

        afterEach(() => {
            delete dom.window.LeftWordleAuth;
            delete dom.window.LeftWordleApi;
        });

        // Same top-level keys applyRestore already consumes -- so a backup
        // downloaded online is directly restorable on a future offline
        // device through the existing restore path, no separate format.
        test('reshapes the account into the same {preferences, history, statistics, gameState} keys applyRestore expects', async () => {
            var data = await saveMenu.collectAllSettings();

            expect(data.preferences).toEqual({ hardMode: true });
            expect(data.statistics).toEqual({ gamesPlayed: 5 });
            expect(data.gameState).toEqual({ puzzleNum: 42 });
            expect(data.history).toEqual({ 100: { puzzle_num: 100, result: 1 } });
            expect(data.server).toBeUndefined();
        });

        test('does not include the raw local dump', async () => {
            dom.window.localStorage.setItem('device_id', 'abc-123');
            var data = await saveMenu.collectAllSettings();
            expect(data.device_id).toBeUndefined();
        });

        test('falls back to a data.server error block if the fetch fails', async () => {
            getProfile.mockRejectedValue(new Error('network down'));
            var data = await saveMenu.collectAllSettings();
            expect(data.server).toEqual({ error: 'network down' });
            expect(data.preferences).toBeUndefined();
        });
    });
});

describe('ToolsMenu#buildRestoreSummary', () => {
    var { ToolsMenu } = dom.window.toolsmenuTestExports;
    var saveMenu;

    beforeEach(() => {
        saveMenu = new ToolsMenu(new HistoryManager(resolver));
    });

    test('reports history entry count and games played', () => {
        var summary = saveMenu.buildRestoreSummary({
            history: { '0': {}, '1': {} },
            statistics: { gamesPlayed: 42 }
        });
        expect(summary).toContain('2 history entries');
        expect(summary).toContain('42 games played');
    });

    test('uses singular wording for exactly one history entry', () => {
        var summary = saveMenu.buildRestoreSummary({ history: { '0': {} } });
        expect(summary).toContain('1 history entry');
        expect(summary).not.toContain('1 history entries');
    });

    test('omits games played when statistics are missing', () => {
        var summary = saveMenu.buildRestoreSummary({ history: {} });
        expect(summary).not.toContain('games played');
    });
});

describe('ToolsMenu#applyRestore', () => {
    var { ToolsMenu } = dom.window.toolsmenuTestExports;
    var saveMenu;

    beforeEach(() => {
        dom.window.localStorage.clear();
        saveMenu = new ToolsMenu(new HistoryManager(resolver));
        jest.spyOn(saveMenu, 'reloadPage').mockImplementation(() => {});
    });

    test('writes each restored key back, re-serializing non-string values', () => {
        var data = {
            device_id: 'abc-123',
            statistics: { gamesPlayed: 5 },
            diagnostics: { server: 'localhost' }
        };
        saveMenu.applyRestore(data, ['device_id', 'statistics']);

        expect(dom.window.localStorage.getItem('device_id')).toBe('abc-123');
        expect(JSON.parse(dom.window.localStorage.getItem('statistics'))).toEqual({ gamesPlayed: 5 });
        expect(dom.window.localStorage.getItem('diagnostics')).toBeNull();
    });

    test('clears pre-existing keys not present in the restored file', () => {
        dom.window.localStorage.setItem('stale_key', 'leftover');
        saveMenu.applyRestore({ device_id: 'abc-123' }, ['device_id']);
        expect(dom.window.localStorage.getItem('stale_key')).toBeNull();
    });

    test('reloads the page after a successful restore', () => {
        saveMenu.applyRestore({ device_id: 'abc-123' }, ['device_id']);
        expect(saveMenu.reloadPage).toHaveBeenCalled();
    });
});

describe('ToolsMenu#handleRestoreFile', () => {
    var { ToolsMenu } = dom.window.toolsmenuTestExports;
    var saveMenu;

    beforeEach(() => {
        dom.window.localStorage.clear();
        saveMenu = new ToolsMenu(new HistoryManager(resolver));
    });

    function fileFor(contents) {
        return { text: () => Promise.resolve(contents) };
    }

    test('rejects a file that is not a JSON object', async () => {
        var statusEl = dom.window.document.createElement('div');
        await saveMenu.handleRestoreFile(fileFor('[1,2,3]'), statusEl);
        expect(statusEl.textContent).toContain('Restore failed');
    });

    test('rejects a file with no restorable keys', async () => {
        var statusEl = dom.window.document.createElement('div');
        await saveMenu.handleRestoreFile(fileFor(JSON.stringify({ diagnostics: {}, server: {} })), statusEl);
        expect(statusEl.textContent).toContain("doesn't contain any preferences");
    });

    test('rejects malformed JSON', async () => {
        var statusEl = dom.window.document.createElement('div');
        await saveMenu.handleRestoreFile(fileFor('{not json'), statusEl);
        expect(statusEl.textContent).toContain('Restore failed');
    });

    test('is unavailable while logged in, without reading the file', async () => {
        dom.window.LeftWordleAuth = { isLoggedIn: () => true };
        var statusEl = dom.window.document.createElement('div');
        var file = fileFor('{"preferences":{}}');
        var readSpy = jest.spyOn(file, 'text');

        await saveMenu.handleRestoreFile(file, statusEl);

        expect(statusEl.textContent).toMatch(/unavailable while playing online/);
        expect(readSpy).not.toHaveBeenCalled();
        delete dom.window.LeftWordleAuth;
    });
});

describe('ToolsMenu#handleHistoryImportFile', () => {
    var { ToolsMenu } = dom.window.toolsmenuTestExports;
    var saveMenu;

    beforeEach(() => {
        dom.window.localStorage.clear();
        saveMenu = new ToolsMenu(new HistoryManager(resolver));
    });

    afterEach(() => {
        delete dom.window.LeftWordleAuth;
    });

    function fileFor(contents) {
        return { text: () => Promise.resolve(contents) };
    }

    test('is unavailable while logged in, without parsing the file', async () => {
        dom.window.LeftWordleAuth = { isLoggedIn: () => true };
        var statusEl = dom.window.document.createElement('div');
        var file = fileFor('not,valid,csv,at,all');
        var readSpy = jest.spyOn(file, 'text');

        await saveMenu.handleHistoryImportFile(file, statusEl, dom.window.document.createElement('button'));

        expect(statusEl.textContent).toMatch(/unavailable while playing online/);
        expect(readSpy).not.toHaveBeenCalled();
    });
});

describe('ToolsMenu#refreshImportRestoreAvailability', () => {
    var { ToolsMenu } = dom.window.toolsmenuTestExports;
    var saveMenu, importInput, importLabel, restoreInput, restoreLabel;

    beforeEach(() => {
        dom.window.document.body.innerHTML =
            '<label id="loadHistoryButton"><input id="inputHistoryLoad" type="file"></label>' +
            '<label id="restoreBackupButton"><input id="inputRestoreBackup" type="file"></label>';
        importInput = dom.window.document.getElementById('inputHistoryLoad');
        importLabel = dom.window.document.getElementById('loadHistoryButton');
        restoreInput = dom.window.document.getElementById('inputRestoreBackup');
        restoreLabel = dom.window.document.getElementById('restoreBackupButton');
        saveMenu = new ToolsMenu(new HistoryManager(resolver));
    });

    afterEach(() => {
        delete dom.window.LeftWordleAuth;
        dom.window.document.body.innerHTML = '';
    });

    test('leaves both inputs enabled when logged out', () => {
        saveMenu.refreshImportRestoreAvailability();
        expect(importInput.disabled).toBe(false);
        expect(restoreInput.disabled).toBe(false);
    });

    test('disables both inputs, with an explanatory title, when logged in', () => {
        dom.window.LeftWordleAuth = { isLoggedIn: () => true };
        saveMenu.refreshImportRestoreAvailability();
        expect(importInput.disabled).toBe(true);
        expect(restoreInput.disabled).toBe(true);
        expect(importLabel.title).toMatch(/Unavailable while playing online/);
        expect(restoreLabel.title).toMatch(/Unavailable while playing online/);
    });

    test('re-enables both inputs after logging out again', () => {
        dom.window.LeftWordleAuth = { isLoggedIn: () => true };
        saveMenu.refreshImportRestoreAvailability();
        dom.window.LeftWordleAuth = { isLoggedIn: () => false };
        saveMenu.refreshImportRestoreAvailability();
        expect(importInput.disabled).toBe(false);
        expect(restoreInput.disabled).toBe(false);
        expect(importLabel.title).toBe('');
    });
});
