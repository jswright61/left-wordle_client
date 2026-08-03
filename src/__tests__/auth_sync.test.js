/**
 * Tests for auth.js server-history translation and sync overwrite.
 *
 * GET /api/v2/history rows carry game_status/guesses but no `result`;
 * everything local keys off `result`, so syncFromServerAndOverwriteLocal
 * must translate rows back into the local entry shape before storing.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function loadAuth(apiMock) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        runScripts: 'outside-only',
        url: 'http://localhost:3000/'
    });
    dom.window.LEFT_WORDLE_CONFIG = { passkeyAuthEnabled: false };
    if (apiMock) dom.window.LeftWordleApi = apiMock;
    const storageCode = fs.readFileSync(path.join(__dirname, '../storage-controller.js'), 'utf8');
    dom.window.eval(storageCode);
    const authCode = fs.readFileSync(path.join(__dirname, '../auth.js'), 'utf8');
    dom.window.eval(authCode);
    return dom;
}

describe('serverHistoryToLocalHistory', () => {
    test('derives result from game_status and guesses', () => {
        const dom = loadAuth();
        const local = dom.window.LeftWordleAuth.serverHistoryToLocalHistory({
            '100': {
                puzzle_num: 100,
                date: '2021-09-27',
                mode: 'hard',
                game_status: 'WIN',
                guesses: [['crane', '01001'], ['slate', '02222'], ['plate', '22222']],
                completed_at: '2021-09-27T14:00:00Z'
            },
            '101': {
                puzzle_num: 101,
                date: '2021-09-28',
                mode: 'regular',
                game_status: 'FAIL',
                guesses: [['crane', '00000'], ['moist', '00000'], ['gluey', '00000'],
                    ['ready', '00000'], ['pours', '00000'], ['light', '00000']],
                completed_at: '2021-09-28T14:00:00Z'
            }
        });

        expect(local['100']).toEqual({
            puzzle_num: 100,
            date: '2021-09-27',
            result: 3,
            answer: null,
            mode: 'hard',
            starter: 'crane',
            completed_at: '2021-09-27T14:00:00Z',
            updated_at: null,
            device_id: null,
            origin: 'server'
        });
        expect(local['101'].result).toBe(7);
        expect(local['101'].starter).toBe('crane');
    });

    test('leaves result null for a WIN with no recorded guesses', () => {
        const dom = loadAuth();
        const local = dom.window.LeftWordleAuth.serverHistoryToLocalHistory({
            '50': { puzzle_num: 50, date: '2021-08-08', game_status: 'WIN', guesses: null }
        });

        expect(local['50'].result).toBeNull();
        expect(local['50'].starter).toBeNull();
    });

    test('skips entries without a puzzle_num and handles empty input', () => {
        const dom = loadAuth();
        expect(dom.window.LeftWordleAuth.serverHistoryToLocalHistory(null)).toEqual({});
        expect(dom.window.LeftWordleAuth.serverHistoryToLocalHistory({
            bogus: null,
            other: { date: '2021-08-08', game_status: 'WIN' }
        })).toEqual({});
    });
});

describe('syncFromServerAndOverwriteLocal', () => {
    test('stores translated history entries readable by local result-based code', async () => {
        const apiMock = {
            client: {
                getProfile: async () => ({
                    email: 'a@b.c',
                    csrf_token: 'tok',
                    preferences: { hardMode: true },
                    game_state: {},
                    statistics: { gamesPlayed: 1, gamesWon: 1 }
                }),
                getHistory: async () => ({
                    '100': {
                        puzzle_num: 100,
                        date: '2021-09-27',
                        mode: 'regular',
                        game_status: 'WIN',
                        guesses: [['slate', '02222'], ['plate', '22222']],
                        completed_at: '2021-09-27T14:00:00Z'
                    }
                })
            }
        };
        const dom = loadAuth(apiMock);

        await dom.window.LeftWordleAuth.syncFromServerAndOverwriteLocal();

        const entry = dom.window.StorageController.history.getEntry(100);
        expect(entry.result).toBe(2);
        expect(entry.puzzle_num).toBe(100);
        expect(entry.origin).toBe('server');
        expect(dom.window.StorageController.preferences.get('hardMode')).toBe(true);
        expect(dom.window.StorageController.statistics.getAll().gamesPlayed).toBe(1);
    });
});

describe('syncPreferences', () => {
    test('does nothing when not logged in', () => {
        const putPreferences = jest.fn();
        const dom = loadAuth({ client: { putPreferences } });
        dom.window.StorageController.preferences.set('hardMode', true);
        expect(putPreferences).not.toHaveBeenCalled();
    });

    test('pushes the full local preferences object on set() when logged in', () => {
        const putPreferences = jest.fn(() => Promise.resolve({}));
        const dom = loadAuth({ client: { putPreferences } });
        dom.window.LeftWordleAuth.loggedIn = true;

        dom.window.StorageController.preferences.set('hardMode', true);

        expect(putPreferences).toHaveBeenCalledWith({ hardMode: true });
    });

    test('replace() (used by sync-down) does not re-trigger the sync-up push', () => {
        const putPreferences = jest.fn(() => Promise.resolve({}));
        const dom = loadAuth({ client: { putPreferences } });
        dom.window.LeftWordleAuth.loggedIn = true;

        dom.window.StorageController.preferences.replace({ hardMode: true });

        expect(putPreferences).not.toHaveBeenCalled();
    });

    test('swallows request failures without throwing', async () => {
        const putPreferences = jest.fn(() => Promise.reject(new Error('network down')));
        const dom = loadAuth({ client: { putPreferences } });
        dom.window.LeftWordleAuth.loggedIn = true;

        dom.window.StorageController.preferences.set('hardMode', true);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(putPreferences).toHaveBeenCalled();
    });
});

describe('syncStatistics', () => {
    test('does nothing when not logged in', () => {
        const putStatistics = jest.fn();
        const dom = loadAuth({ client: { putStatistics } });
        dom.window.LeftWordleAuth.syncStatistics({ gamesPlayed: 1 });
        expect(putStatistics).not.toHaveBeenCalled();
    });

    test('pushes the given statistics object when logged in', () => {
        const putStatistics = jest.fn(() => Promise.resolve({}));
        const dom = loadAuth({ client: { putStatistics } });
        dom.window.LeftWordleAuth.loggedIn = true;

        dom.window.LeftWordleAuth.syncStatistics({ gamesPlayed: 5, gamesWon: 3 });

        expect(putStatistics).toHaveBeenCalledWith({ gamesPlayed: 5, gamesWon: 3 });
    });
});

describe('syncHistoryEntry', () => {
    test('does nothing when not logged in', () => {
        const importHistory = jest.fn();
        const dom = loadAuth({ client: { importHistory } });
        dom.window.LeftWordleAuth.syncHistoryEntry({ puzzle_num: 100, date: '2021-09-27', result: 3 });
        expect(importHistory).not.toHaveBeenCalled();
    });

    test('translates a local entry into the /history/import payload shape', () => {
        const importHistory = jest.fn(() => Promise.resolve({}));
        const dom = loadAuth({ client: { importHistory } });
        dom.window.LeftWordleAuth.loggedIn = true;

        dom.window.LeftWordleAuth.syncHistoryEntry({
            puzzle_num: 100, date: '2021-09-27', result: 3, mode: 'hard', completed_at: 12345
        });

        expect(importHistory).toHaveBeenCalledWith([{
            puzzle_num: 100, date: '2021-09-27', mode: 'hard', game_status: 'WIN', completed_at: 12345
        }]);
    });

    test('maps a non-winning result (7) to game_status FAIL and defaults mode to regular', () => {
        const importHistory = jest.fn(() => Promise.resolve({}));
        const dom = loadAuth({ client: { importHistory } });
        dom.window.LeftWordleAuth.loggedIn = true;

        dom.window.LeftWordleAuth.syncHistoryEntry({ puzzle_num: 101, date: '2021-09-28', result: 7 });

        expect(importHistory).toHaveBeenCalledWith([{
            puzzle_num: 101, date: '2021-09-28', mode: 'regular', game_status: 'FAIL', completed_at: null
        }]);
    });
});

describe('syncHistoryEntries', () => {
    test('does nothing when not logged in', () => {
        const importHistory = jest.fn();
        const dom = loadAuth({ client: { importHistory } });
        dom.window.LeftWordleAuth.syncHistoryEntries([{ puzzle_num: 100, date: '2021-09-27', result: 3 }]);
        expect(importHistory).not.toHaveBeenCalled();
    });

    test('does nothing for an empty list', () => {
        const importHistory = jest.fn();
        const dom = loadAuth({ client: { importHistory } });
        dom.window.LeftWordleAuth.loggedIn = true;
        dom.window.LeftWordleAuth.syncHistoryEntries([]);
        expect(importHistory).not.toHaveBeenCalled();
    });

    test('translates every entry into the /history/import payload shape in one call', () => {
        const importHistory = jest.fn(() => Promise.resolve({}));
        const dom = loadAuth({ client: { importHistory } });
        dom.window.LeftWordleAuth.loggedIn = true;

        dom.window.LeftWordleAuth.syncHistoryEntries([
            { puzzle_num: 100, date: '2021-09-27', result: 3, mode: 'hard', completed_at: 12345 },
            { puzzle_num: 101, date: '2021-09-28', result: 7 }
        ]);

        expect(importHistory).toHaveBeenCalledTimes(1);
        expect(importHistory).toHaveBeenCalledWith([
            { puzzle_num: 100, date: '2021-09-27', mode: 'hard', game_status: 'WIN', completed_at: 12345 },
            { puzzle_num: 101, date: '2021-09-28', mode: 'regular', game_status: 'FAIL', completed_at: null }
        ]);
    });
});
