const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function loadController(setup) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        runScripts: 'outside-only',
        url: 'http://localhost/'
    });
    if (setup) setup(dom.window.localStorage);
    const code = fs.readFileSync(path.join(__dirname, '../storage-controller.js'), 'utf8');
    dom.window.eval(code);
    return dom;
}

describe('StorageController', () => {
    test('migrates legacy preference keys into the preferences namespace', () => {
        const dom = loadController((storage) => {
            storage.setItem('darkTheme', 'true');
            storage.setItem('shareFormat', 'accessible');
        });

        expect(dom.window.StorageController.preferences.get('darkTheme')).toBe(true);
        expect(dom.window.StorageController.preferences.get('shareFormat')).toBe('accessible');
        expect(dom.window.localStorage.getItem('darkTheme')).toBeNull();
        expect(dom.window.localStorage.getItem('shareFormat')).toBeNull();
    });

    test('converts legacy history arrays to a puzzle-keyed map', () => {
        const dom = loadController((storage) => {
            storage.setItem('history', JSON.stringify([
                { puzzle_num: 10, result: 3 },
                { puzzle_num: 11, result: 7 }
            ]));
        });

        expect(dom.window.StorageController.history.getAll()).toEqual({
            '10': { puzzle_num: 10, result: 3 },
            '11': { puzzle_num: 11, result: 7 }
        });
    });

    test('rejects unknown keys in namespaced storage', () => {
        const dom = loadController();

        expect(() => dom.window.StorageController.preferences.set('unknown', true))
            .toThrow('unknown key');
    });

    test('stores application data by namespace', () => {
        const storage = loadController().window.StorageController;

        storage.gameState.replace({ puzzleNum: 1, rowIndex: 2 });
        storage.statistics.replace({ gamesPlayed: 4, gamesWon: 3 });
        storage.legacyStats.set({ gamesPlayed: 10 });
        storage.deviceId.set('device-1');

        expect(storage.gameState.getAll()).toEqual({ puzzleNum: 1, rowIndex: 2 });
        expect(storage.statistics.getAll()).toEqual({ gamesPlayed: 4, gamesWon: 3 });
        expect(storage.legacyStats.get()).toEqual({ gamesPlayed: 10 });
        expect(storage.deviceId.get()).toBe('device-1');
    });

    describe('settingsBackup', () => {
        test('creates a versioned snapshot on first backup', () => {
            const dom = loadController((storage) => {
                storage.setItem('preferences', JSON.stringify({ darkTheme: true }));
                storage.setItem('device_id', 'abc123');
            });
            const { StorageController, localStorage } = dom.window;

            StorageController.settingsBackup.maybeBackup('1.0.0');

            const backup = StorageController.settingsBackup.get();
            expect(backup).not.toBeNull();
            expect(backup['v1.0.0']).toBeDefined();
            expect(backup['v1.0.0'].ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
            expect(backup['v1.0.0'].preferences).toBe(JSON.stringify({ darkTheme: true }));
            expect(backup['v1.0.0'].device_id).toBe('abc123');
            expect(backup['v1.0.0'].settingsBackup).toBeUndefined();
        });

        test('does not overwrite an existing version entry', () => {
            const dom = loadController((storage) => {
                storage.setItem('device_id', 'original');
            });
            const { StorageController, localStorage } = dom.window;

            StorageController.settingsBackup.maybeBackup('1.0.0');
            const firstTs = StorageController.settingsBackup.get()['v1.0.0'].ts;

            localStorage.setItem('device_id', 'changed');
            StorageController.settingsBackup.maybeBackup('1.0.0');

            const backup = StorageController.settingsBackup.get();
            expect(backup['v1.0.0'].ts).toBe(firstTs);
            expect(backup['v1.0.0'].device_id).toBe('original');
        });

        test('adds a new entry when version changes', () => {
            const dom = loadController((storage) => {
                storage.setItem('device_id', 'abc');
            });
            const { StorageController } = dom.window;

            StorageController.settingsBackup.maybeBackup('1.0.0');
            StorageController.settingsBackup.maybeBackup('1.0.1');

            const backup = StorageController.settingsBackup.get();
            expect(backup['v1.0.0']).toBeDefined();
            expect(backup['v1.0.1']).toBeDefined();
        });

        test('does nothing when version is falsy', () => {
            const dom = loadController();
            const { StorageController } = dom.window;

            StorageController.settingsBackup.maybeBackup(null);
            StorageController.settingsBackup.maybeBackup('');
            StorageController.settingsBackup.maybeBackup(undefined);

            expect(StorageController.settingsBackup.get()).toBeNull();
        });

        test('initializes from empty settingsBackup', () => {
            const dom = loadController((storage) => {
                storage.setItem('settingsBackup', '');
            });
            const { StorageController } = dom.window;

            StorageController.settingsBackup.maybeBackup('2.0.0');

            expect(StorageController.settingsBackup.get()['v2.0.0']).toBeDefined();
        });
    });
});
