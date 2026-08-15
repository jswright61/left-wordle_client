/**
 * Tests for auth.js's sync-up pushes and server-history translation.
 *
 * GET /api/v2/history rows carry game_status/guesses but no `result`;
 * everything local keys off `result`, so serverHistoryToLocalHistory
 * translates rows back into the local entry shape (used by toolsmenu.js's
 * online "Download Backup" reshape, not by any local-storage overwrite --
 * online play no longer pulls server data down into local storage).
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

describe('retry-on-failure sync queue', () => {
    test('flushPendingSync retries a failed preference push and drops it once it succeeds', async () => {
        const putPreferences = jest.fn()
            .mockImplementationOnce(() => Promise.reject(new Error('network down')))
            .mockImplementationOnce(() => Promise.resolve({}));
        const dom = loadAuth({ client: { putPreferences } });
        dom.window.LeftWordleAuth.loggedIn = true;

        dom.window.StorageController.preferences.set('hardMode', true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(putPreferences).toHaveBeenCalledTimes(1);

        await dom.window.LeftWordleAuth.flushPendingSync();
        expect(putPreferences).toHaveBeenCalledTimes(2);

        // A third flush should be a no-op -- the job was dropped once it succeeded.
        await dom.window.LeftWordleAuth.flushPendingSync();
        expect(putPreferences).toHaveBeenCalledTimes(2);
    });

    test('a failed history entry sync is retried by the next successful sync call', async () => {
        const importHistory = jest.fn()
            .mockImplementationOnce(() => Promise.reject(new Error('network down')))
            .mockImplementation(() => Promise.resolve({}));
        const dom = loadAuth({ client: { importHistory } });
        dom.window.LeftWordleAuth.loggedIn = true;

        await dom.window.LeftWordleAuth.syncHistoryEntry({ puzzle_num: 100, date: '2021-09-27', result: 3 });
        expect(importHistory).toHaveBeenCalledTimes(1);

        // A second, unrelated successful sync call should flush the queue too --
        // there's no separate "reconnect" trigger, any successful call does it.
        await dom.window.LeftWordleAuth.syncHistoryEntry({ puzzle_num: 101, date: '2021-09-28', result: 4 });
        expect(importHistory).toHaveBeenCalledTimes(3); // puzzle 101, then retried puzzle 100
    });

    test('a failed preference push does not pile up duplicate queue entries', async () => {
        const putPreferences = jest.fn(() => Promise.reject(new Error('network down')));
        const dom = loadAuth({ client: { putPreferences } });
        dom.window.LeftWordleAuth.loggedIn = true;

        dom.window.StorageController.preferences.set('hardMode', true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        dom.window.StorageController.preferences.set('darkTheme', true);
        await new Promise((resolve) => setTimeout(resolve, 0));

        putPreferences.mockImplementationOnce(() => Promise.resolve({}));
        await dom.window.LeftWordleAuth.flushPendingSync();

        // Only one queued "preferences" job should exist regardless of how many
        // times the push failed before it was retried.
        expect(putPreferences).toHaveBeenCalledTimes(3);
    });
});

describe('syncGameStateOnce', () => {
    test('does nothing when not logged in', () => {
        const putGameState = jest.fn();
        const dom = loadAuth({ client: { putGameState } });
        dom.window.LeftWordleAuth.syncGameStateOnce();
        expect(putGameState).not.toHaveBeenCalled();
    });

    test('pushes the current local game state when logged in', () => {
        const putGameState = jest.fn(() => Promise.resolve({}));
        const dom = loadAuth({ client: { putGameState } });
        dom.window.LeftWordleAuth.loggedIn = true;
        dom.window.StorageController.gameState.replace({ puzzleNum: 42 });

        dom.window.LeftWordleAuth.syncGameStateOnce();

        expect(putGameState).toHaveBeenCalledWith({ puzzleNum: 42 });
    });
});

describe('pushGameState', () => {
    test('does nothing when not logged in', () => {
        const putGameState = jest.fn();
        const dom = loadAuth({ client: { putGameState } });
        dom.window.LeftWordleAuth.pushGameState({ puzzleNum: 42 });
        expect(putGameState).not.toHaveBeenCalled();
    });

    test('pushes the given blob directly, without reading local storage, when logged in', () => {
        const putGameState = jest.fn(() => Promise.resolve({}));
        const dom = loadAuth({ client: { putGameState } });
        dom.window.LeftWordleAuth.loggedIn = true;

        dom.window.LeftWordleAuth.pushGameState({ puzzleNum: 99, rowIndex: 2 });

        expect(putGameState).toHaveBeenCalledWith({ puzzleNum: 99, rowIndex: 2 });
    });
});

describe('pushGameProgress', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    test('fires and forgets when not logged in, swallowing failures', async () => {
        const reportProgress = jest.fn(() => Promise.reject(new Error('offline')));
        const dom = loadAuth({ client: { reportProgress } });

        await dom.window.LeftWordleAuth.pushGameProgress('2021-09-27', 'regular', [['crane', '01000']]);

        expect(reportProgress).toHaveBeenCalledTimes(1);
        expect(reportProgress).toHaveBeenCalledWith('2021-09-27', 'regular', [['crane', '01000']]);
    });

    test('resolves on the first success when logged in, with no retry', async () => {
        const reportProgress = jest.fn(() => Promise.resolve({ status: 'recorded' }));
        const dom = loadAuth({ client: { reportProgress } });
        dom.window.LeftWordleAuth.loggedIn = true;

        await dom.window.LeftWordleAuth.pushGameProgress('2021-09-27', 'regular', [['crane', '01000']]);

        expect(reportProgress).toHaveBeenCalledTimes(1);
    });

    test('retries a network failure in place until it lands, while logged in', async () => {
        jest.useFakeTimers();
        let attempt = 0;
        const reportProgress = jest.fn(() => {
            attempt += 1;
            return attempt < 3 ? Promise.reject(new Error('network down')) : Promise.resolve({ status: 'recorded' });
        });
        const dom = loadAuth({ client: { reportProgress } });
        dom.window.LeftWordleAuth.loggedIn = true;

        const pushPromise = dom.window.LeftWordleAuth.pushGameProgress('2021-09-27', 'regular', [['crane', '01000']]);
        await jest.advanceTimersByTimeAsync(2000);
        await jest.advanceTimersByTimeAsync(2000);
        await pushPromise;

        expect(reportProgress).toHaveBeenCalledTimes(3);
    });

    test('a 401 invalidates the session (with the given snapshot) instead of retrying, while logged in', async () => {
        const error = Object.assign(new Error('unauthorized'), { status: 401 });
        const reportProgress = jest.fn(() => Promise.reject(error));
        const dom = loadAuth({ client: { reportProgress } });
        dom.window.LeftWordleAuth.loggedIn = true;

        await dom.window.LeftWordleAuth.pushGameProgress(
            '2021-09-27', 'regular', [['crane', '01000']], { boardState: ['crane'] }
        );

        expect(reportProgress).toHaveBeenCalledTimes(1);
        expect(dom.window.LeftWordleAuth.isLoggedIn()).toBe(false);
        expect(dom.window.StorageController.gameState.getAll()).toEqual({ boardState: ['crane'] });
    });
});

describe('handleSessionInvalidated', () => {
    test('snapshots the given game state into local storage, clears session, and flags the unexpected end', () => {
        const dom = loadAuth();
        dom.window.LeftWordleAuth.loggedIn = true;
        dom.window.LeftWordleAuth.email = 'a@b.c';
        dom.window.LeftWordleAuth.csrfToken = 'tok';

        dom.window.LeftWordleAuth.handleSessionInvalidated({ rowIndex: 2, boardState: ['crane', 'moist'] });

        expect(dom.window.LeftWordleAuth.isLoggedIn()).toBe(false);
        expect(dom.window.LeftWordleAuth.email).toBeNull();
        expect(dom.window.LeftWordleAuth.csrfToken).toBeNull();
        expect(dom.window.LeftWordleAuth.consumeSessionUnexpectedlyEnded()).toBe(true);
        expect(dom.window.StorageController.gameState.getAll()).toEqual({ rowIndex: 2, boardState: ['crane', 'moist'] });
    });

    test('without a snapshot, still clears the session but leaves local storage untouched', () => {
        const dom = loadAuth();
        dom.window.LeftWordleAuth.loggedIn = true;

        dom.window.LeftWordleAuth.handleSessionInvalidated();

        expect(dom.window.LeftWordleAuth.isLoggedIn()).toBe(false);
        expect(dom.window.StorageController.gameState.getAll()).toEqual({});
    });
});

// wordle.js's boot gate (customElements.define("game-app", ...)) reads
// this directly to decide whether to wait for LeftWordleAuth.ready before
// the board renders -- see GameStateManager.getInitialGameState.
describe('wasPreviouslyLoggedIn', () => {
    test('is false on a device that has never logged in', () => {
        const dom = loadAuth();
        expect(dom.window.LeftWordleAuth.wasPreviouslyLoggedIn()).toBe(false);
    });

    test('is true once logged in, false again after an explicit logout', async () => {
        const logout = jest.fn(() => Promise.resolve());
        const dom = loadAuth({ client: { logout } });
        dom.window.localStorage.setItem('lastKnownAuthState', 'logged_in');

        expect(dom.window.LeftWordleAuth.wasPreviouslyLoggedIn()).toBe(true);

        await dom.window.LeftWordleAuth.logout();

        expect(dom.window.LeftWordleAuth.wasPreviouslyLoggedIn()).toBe(false);
    });
});

describe('syncNewUserSnapshot', () => {
    test('does nothing when not logged in', () => {
        const postLocalStorageSnapshot = jest.fn();
        const dom = loadAuth({ client: { postLocalStorageSnapshot } });
        dom.window.LeftWordleAuth.syncNewUserSnapshot({ statistics: '{}' });
        expect(postLocalStorageSnapshot).not.toHaveBeenCalled();
    });

    test('pushes the given dump under the "new user creation" event when logged in', () => {
        const postLocalStorageSnapshot = jest.fn(() => Promise.resolve({}));
        const dom = loadAuth({ client: { postLocalStorageSnapshot } });
        dom.window.LeftWordleAuth.loggedIn = true;

        dom.window.LeftWordleAuth.syncNewUserSnapshot({ statistics: '{"gamesPlayed":1}' });

        expect(postLocalStorageSnapshot).toHaveBeenCalledWith('new user creation', { statistics: '{"gamesPlayed":1}' });
    });
});

describe('statsDiscrepancyAfterPush', () => {
    test('returns null for a non-finite local count', async () => {
        const dom = loadAuth({ client: { getProfile: jest.fn() } });
        expect(await dom.window.LeftWordleAuth.statsDiscrepancyAfterPush(undefined)).toBeNull();
    });

    test('returns null when the local count is at or below the server-derived total', async () => {
        const getProfile = jest.fn(() => Promise.resolve({ statistics: { gamesPlayed: 10 } }));
        const dom = loadAuth({ client: { getProfile } });
        expect(await dom.window.LeftWordleAuth.statsDiscrepancyAfterPush(5)).toBeNull();
    });

    test('returns the gap when the local count exceeds what the server could derive', async () => {
        const getProfile = jest.fn(() => Promise.resolve({ statistics: { gamesPlayed: 2 } }));
        const dom = loadAuth({ client: { getProfile } });
        expect(await dom.window.LeftWordleAuth.statsDiscrepancyAfterPush(5)).toEqual({ local: 5, server: 2 });
    });

    test('treats a missing/malformed server statistics blob as zero games played', async () => {
        const getProfile = jest.fn(() => Promise.resolve({}));
        const dom = loadAuth({ client: { getProfile } });
        expect(await dom.window.LeftWordleAuth.statsDiscrepancyAfterPush(1)).toEqual({ local: 1, server: 0 });
    });

    test('returns null (does not throw) when the profile fetch fails', async () => {
        const getProfile = jest.fn(() => Promise.reject(new Error('network down')));
        const dom = loadAuth({ client: { getProfile } });
        expect(await dom.window.LeftWordleAuth.statsDiscrepancyAfterPush(5)).toBeNull();
    });
});
