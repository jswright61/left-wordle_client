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
    describe('schema versioning', () => {
        test('writes schema_version on fresh install', () => {
            const dom = loadController();
            expect(dom.window.localStorage.getItem('schema_version')).toBe('1');
        });

        test('does not overwrite an existing matching schema_version', () => {
            const dom = loadController((storage) => {
                storage.setItem('schema_version', '1');
            });
            expect(dom.window.localStorage.getItem('schema_version')).toBe('1');
        });

        test('warns on schema version mismatch', () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            loadController((storage) => {
                storage.setItem('schema_version', '0');
            });
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('schema version mismatch'));
            warnSpy.mockRestore();
        });

        test('exposes schemaVersion on StorageController', () => {
            const dom = loadController();
            expect(dom.window.StorageController.schemaVersion).toBe(1);
        });
    });

    describe('value type validation', () => {
        test('rejects a string stored in a boolean field', () => {
            const dom = loadController();
            expect(() => dom.window.StorageController.preferences.set('darkTheme', 'yes'))
                .toThrow('expected boolean, got string');
        });

        test('rejects a string stored in a number field', () => {
            const dom = loadController();
            expect(() => dom.window.StorageController.gameState.set('rowIndex', '2'))
                .toThrow('expected number, got string');
        });

        test('rejects a plain object stored in an array field', () => {
            const dom = loadController();
            expect(() => dom.window.StorageController.gameState.set('boardState', {}))
                .toThrow('expected array, got object');
        });

        test('rejects an array stored in an object field', () => {
            const dom = loadController();
            expect(() => dom.window.StorageController.statistics.set('guesses', []))
                .toThrow('expected object, got array');
        });

        test('allows null for any typed field', () => {
            const dom = loadController();
            expect(() => dom.window.StorageController.preferences.set('darkTheme', null)).not.toThrow();
            expect(() => dom.window.StorageController.gameState.set('boardState', null)).not.toThrow();
            expect(() => dom.window.StorageController.statistics.set('terminatedStreak', null)).not.toThrow();
        });

        test('accepts correctly typed values', () => {
            const dom = loadController();
            expect(() => dom.window.StorageController.preferences.set('darkTheme', true)).not.toThrow();
            expect(() => dom.window.StorageController.gameState.set('rowIndex', 3)).not.toThrow();
            expect(() => dom.window.StorageController.gameState.set('boardState', ['a', 'b'])).not.toThrow();
            expect(() => dom.window.StorageController.statistics.set('guesses', { 1: 0, fail: 0 })).not.toThrow();
        });

        test('rejects wrong types in merge', () => {
            const dom = loadController();
            expect(() => dom.window.StorageController.gameState.merge({ rowIndex: 'three' }))
                .toThrow('expected number, got string');
        });

        test('rejects wrong types in replace', () => {
            const dom = loadController();
            expect(() => dom.window.StorageController.statistics.replace({ gamesPlayed: 'ten' }))
                .toThrow('expected number, got string');
        });
    });

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
        test('uses appVersion-pre as key when no version is stored', () => {
            const dom = loadController((storage) => {
                storage.setItem('preferences', JSON.stringify({ darkTheme: true }));
                storage.setItem('device_id', 'abc123');
            });
            const { StorageController, localStorage } = dom.window;

            StorageController.settingsBackup.maybeBackup('v1.0.0');

            const backup = StorageController.settingsBackup.get();
            expect(backup['v1.0.0-pre']).toBeDefined();
            expect(backup['v1.0.0-pre'].ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
            expect(backup['v1.0.0-pre'].preferences).toBe(JSON.stringify({ darkTheme: true }));
            expect(backup['v1.0.0-pre'].device_id).toBe('abc123');
            expect(backup['v1.0.0-pre'].settingsBackup).toBeUndefined();
        });

        test('uses stored version as key when version is present', () => {
            const dom = loadController((storage) => {
                storage.setItem('version', 'v1.0.0');
                storage.setItem('device_id', 'abc123');
            });
            const { StorageController } = dom.window;

            StorageController.settingsBackup.maybeBackup('v1.0.1');

            const backup = StorageController.settingsBackup.get();
            expect(backup['v1.0.0']).toBeDefined();
            expect(backup['v1.0.1']).toBeUndefined();
        });

        test('sets the version key to appVersion after backup', () => {
            const dom = loadController();
            const { StorageController, localStorage } = dom.window;

            StorageController.settingsBackup.maybeBackup('v1.0.0');

            expect(localStorage.getItem('version')).toBe('v1.0.0');
        });

        test('updates version key to new appVersion on each call', () => {
            const dom = loadController((storage) => {
                storage.setItem('version', 'v1.0.0');
            });
            const { StorageController, localStorage } = dom.window;

            StorageController.settingsBackup.maybeBackup('v1.0.1');

            expect(localStorage.getItem('version')).toBe('v1.0.1');
        });

        test('does not create extra backups when version is unchanged', () => {
            const dom = loadController((storage) => {
                storage.setItem('version', 'v1.0.0');
            });
            const { StorageController } = dom.window;

            StorageController.settingsBackup.maybeBackup('v1.0.0');
            StorageController.settingsBackup.maybeBackup('v1.0.0');
            StorageController.settingsBackup.maybeBackup('v1.0.0');

            expect(StorageController.settingsBackup.get()).toBeNull();
        });

        test('appends .001 when collision occurs after downgrade-then-upgrade cycle', () => {
            const dom = loadController((storage) => {
                storage.setItem('version', 'v1.0.0');
            });
            const { StorageController, localStorage } = dom.window;

            StorageController.settingsBackup.maybeBackup('v1.0.1'); // backup v1.0.0, version → v1.0.1
            localStorage.setItem('version', 'v1.0.0');              // simulate downgrade
            StorageController.settingsBackup.maybeBackup('v1.0.1'); // backup v1.0.0 again → v1.0.0.001

            const backup = StorageController.settingsBackup.get();
            expect(backup['v1.0.0']).toBeDefined();
            expect(backup['v1.0.0.001']).toBeDefined();
        });

        test('captures pre-upgrade state using the stored version as key', () => {
            const dom = loadController((storage) => {
                storage.setItem('version', 'v1.0.0');
                storage.setItem('device_id', 'pre-upgrade-value');
            });
            const { StorageController, localStorage } = dom.window;

            StorageController.settingsBackup.maybeBackup('v1.0.1');
            localStorage.setItem('device_id', 'post-upgrade-value');
            StorageController.settingsBackup.maybeBackup('v1.0.1'); // no-op: version already updated

            const backup = StorageController.settingsBackup.get();
            expect(backup['v1.0.0'].device_id).toBe('pre-upgrade-value');
            expect(backup['v1.0.1']).toBeUndefined();
        });

        test('treats blank stored version the same as missing', () => {
            const dom = loadController((storage) => {
                storage.setItem('version', '   ');
            });
            const { StorageController } = dom.window;

            StorageController.settingsBackup.maybeBackup('v2.0.0');

            const backup = StorageController.settingsBackup.get();
            expect(backup['v2.0.0-pre']).toBeDefined();
        });

        test('does nothing when appVersion is falsy', () => {
            const dom = loadController();
            const { StorageController, localStorage } = dom.window;

            StorageController.settingsBackup.maybeBackup(null);
            StorageController.settingsBackup.maybeBackup('');
            StorageController.settingsBackup.maybeBackup(undefined);

            expect(StorageController.settingsBackup.get()).toBeNull();
            expect(localStorage.getItem('version')).toBeNull();
        });

        test('initializes gracefully from empty or corrupt settingsBackup', () => {
            const dom = loadController((storage) => {
                storage.setItem('settingsBackup', '');
            });
            const { StorageController } = dom.window;

            StorageController.settingsBackup.maybeBackup('v2.0.0');

            expect(StorageController.settingsBackup.get()['v2.0.0-pre']).toBeDefined();
        });
    });

    describe('settingsBackup.prune', () => {
        const recentTs = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();   // 5 days ago
        const oldTs    = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000).toISOString();  // 61 days ago

        function makeBackup(entries) {
            return JSON.stringify(Object.fromEntries(entries));
        }

        test('does nothing when two or fewer backups exist', () => {
            const dom = loadController((storage) => {
                storage.setItem('settingsBackup', makeBackup([
                    ['v1.0.0', { ts: oldTs }],
                    ['v1.0.1', { ts: oldTs }],
                ]));
            });
            const { StorageController } = dom.window;

            StorageController.settingsBackup.prune();

            const backup = StorageController.settingsBackup.get();
            expect(Object.keys(backup)).toHaveLength(2);
        });

        test('always keeps the two most recent even if older than 60 days', () => {
            const ts90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
            const ts75 = new Date(Date.now() - 75 * 24 * 60 * 60 * 1000).toISOString();
            const ts61 = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000).toISOString();
            const dom = loadController((storage) => {
                storage.setItem('settingsBackup', makeBackup([
                    ['v1.0.0', { ts: ts90 }],
                    ['v1.0.1', { ts: ts75 }],
                    ['v1.0.2', { ts: ts61 }],
                ]));
            });
            const { StorageController } = dom.window;

            StorageController.settingsBackup.prune();

            const backup = StorageController.settingsBackup.get();
            expect(backup['v1.0.2']).toBeDefined();
            expect(backup['v1.0.1']).toBeDefined();
            expect(backup['v1.0.0']).toBeUndefined();
        });

        test('keeps recent backups beyond the top two', () => {
            const dom = loadController((storage) => {
                storage.setItem('settingsBackup', makeBackup([
                    ['v1.0.0', { ts: recentTs }],
                    ['v1.0.1', { ts: recentTs }],
                    ['v1.0.2', { ts: recentTs }],
                ]));
            });
            const { StorageController } = dom.window;

            StorageController.settingsBackup.prune();

            const backup = StorageController.settingsBackup.get();
            expect(Object.keys(backup)).toHaveLength(3);
        });

        test('removes old backups beyond the top two', () => {
            const slightlyOlderRecent = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
            const dom = loadController((storage) => {
                storage.setItem('settingsBackup', makeBackup([
                    ['v1.0.0', { ts: oldTs }],
                    ['v1.0.1', { ts: slightlyOlderRecent }],
                    ['v1.0.2', { ts: recentTs }],
                ]));
            });
            const { StorageController } = dom.window;

            StorageController.settingsBackup.prune();

            const backup = StorageController.settingsBackup.get();
            expect(backup['v1.0.2']).toBeDefined();
            expect(backup['v1.0.1']).toBeDefined();
            expect(backup['v1.0.0']).toBeUndefined();
        });

        test('does nothing with missing or corrupt backup data', () => {
            const dom = loadController((storage) => {
                storage.setItem('settingsBackup', 'not-json');
            });
            const { StorageController } = dom.window;

            expect(() => StorageController.settingsBackup.prune()).not.toThrow();
        });
    });
});
