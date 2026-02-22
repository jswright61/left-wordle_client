const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const syncScriptPath = path.join(__dirname, '../supabase-sync.js');

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function makeDb(initial) {
    const db = {
        profiles: new Map(),
        games: new Map(),
        current_game_state: new Map()
    };

    (initial.profiles || []).forEach((row) => {
        db.profiles.set(row.user_id, deepClone(row));
    });

    (initial.games || []).forEach((row) => {
        db.games.set(`${row.user_id}:${row.puzzle_num}`, deepClone(row));
    });

    (initial.current_game_state || []).forEach((row) => {
        db.current_game_state.set(row.user_id, deepClone(row));
    });

    return db;
}

function createSupabaseMock(initialDb) {
    const db = makeDb(initialDb || {});
    const state = {
        session: null,
        authCallbacks: []
    };

    function listRows(table) {
        if (table === 'profiles') return Array.from(db.profiles.values());
        if (table === 'games') return Array.from(db.games.values());
        if (table === 'current_game_state') return Array.from(db.current_game_state.values());
        return [];
    }

    function upsertRows(table, payload) {
        const rows = Array.isArray(payload) ? payload : [payload];
        rows.forEach((row) => {
            if (!row) return;
            if (table === 'games') {
                db.games.set(`${row.user_id}:${row.puzzle_num}`, deepClone(row));
                return;
            }
            if (table === 'profiles') {
                db.profiles.set(row.user_id, deepClone(row));
                return;
            }
            if (table === 'current_game_state') {
                db.current_game_state.set(row.user_id, deepClone(row));
            }
        });
    }

    function compareGt(left, right) {
        if (left === null || left === undefined) return false;
        if (typeof left === 'number' || typeof right === 'number') {
            return Number(left) > Number(right);
        }
        const leftMs = Date.parse(left);
        const rightMs = Date.parse(right);
        if (!Number.isNaN(leftMs) && !Number.isNaN(rightMs)) {
            return leftMs > rightMs;
        }
        return String(left) > String(right);
    }

    class QueryBuilder {
        constructor(table) {
            this.table = table;
            this.filters = [];
        }

        select() {
            return this;
        }

        eq(field, value) {
            this.filters.push((row) => row[field] === value);
            return this;
        }

        in(field, values) {
            this.filters.push((row) => values.includes(row[field]));
            return this;
        }

        gt(field, value) {
            this.filters.push((row) => compareGt(row[field], value));
            return this;
        }

        _run() {
            return listRows(this.table).filter((row) => this.filters.every((fn) => fn(row)));
        }

        maybeSingle() {
            const rows = this._run();
            return Promise.resolve({ data: rows[0] ? deepClone(rows[0]) : null, error: null });
        }

        upsert(payload) {
            upsertRows(this.table, payload);
            return Promise.resolve({ data: null, error: null });
        }

        then(resolve, reject) {
            const result = { data: deepClone(this._run()), error: null };
            return Promise.resolve(result).then(resolve, reject);
        }
    }

    const client = {
        auth: {
            getSession: async () => ({ data: { session: state.session } }),
            onAuthStateChange: (cb) => {
                state.authCallbacks.push(cb);
                return { data: { subscription: { unsubscribe: function() {} } } };
            },
            signInWithOtp: async () => ({ error: null }),
            signOut: async () => {
                state.session = null;
                return { error: null };
            }
        },
        functions: {
            invoke: async () => ({ data: { success: true }, error: null })
        },
        from: (table) => new QueryBuilder(table)
    };

    return {
        client,
        state,
        setSession: function(userId, email) {
            state.session = {
                user: {
                    id: userId || 'user-1',
                    email: email || 'player@example.com'
                }
            };
        },
        clearSession: function() {
            state.session = null;
        },
        getRows: function(table) {
            return listRows(table).map((row) => deepClone(row));
        },
        getGame: function(userId, puzzleNum) {
            const row = db.games.get(`${userId}:${puzzleNum}`);
            return row ? deepClone(row) : null;
        },
        getCurrentGameState: function(userId) {
            const row = db.current_game_state.get(userId);
            return row ? deepClone(row) : null;
        }
    };
}

function setupSyncTest(options) {
    options = options || {};

    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', function() {
        // Suppress jsdom navigation warnings from window.location.reload in sync flow.
    });

    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        runScripts: 'outside-only',
        url: options.url || 'http://localhost/',
        virtualConsole
    });

    const mock = createSupabaseMock(options.remote || {});

    dom.window.SUPABASE_SYNC_ENABLED = true;
    dom.window.SUPABASE_URL = 'https://example.supabase.co';
    dom.window.SUPABASE_ANON_KEY = 'anon-key';
    dom.window.supabase = {
        createClient: function() {
            return mock.client;
        }
    };

    Object.entries(options.local || {}).forEach(([key, value]) => {
        dom.window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    });

    const code = fs.readFileSync(syncScriptPath, 'utf8');
    dom.window.eval(code);

    return {
        dom,
        mock,
        sync: dom.window.wordleSync
    };
}

describe('supabase-sync merge process', () => {
    test('pushes local history on first sync when cloud games are empty', async () => {
        const userId = 'user-1';
        const env = setupSyncTest({
            local: {
                history: {
                    '1700': {
                        puzzle_num: 1700,
                        date: '2026-02-13',
                        result: 3,
                        completed_at: 1000,
                        updated_at: 1000,
                        answer: 'crisp',
                        mode: 'regular',
                        starter: 'grind'
                    },
                    '1701': {
                        puzzle_num: 1701,
                        date: '2026-02-14',
                        result: 7,
                        completed_at: 2000,
                        updated_at: 2000,
                        answer: 'vivid',
                        mode: 'hard',
                        starter: 'patsy'
                    }
                }
            }
        });

        env.mock.setSession(userId);
        await env.sync.performSync({ mode: 'full' });

        const cloudGames = env.mock.getRows('games').filter((row) => row.user_id === userId);
        expect(cloudGames).toHaveLength(2);
        expect(cloudGames.map((row) => row.puzzle_num).sort()).toEqual([1700, 1701]);
    });

    test('keeps cloud completed history row when local disagrees', async () => {
        const userId = 'user-1';
        const localCompletedAt = Date.parse('2026-02-13T10:00:00.000Z');
        const remoteCompletedAt = Date.parse('2026-02-13T13:00:00.000Z');

        const env = setupSyncTest({
            remote: {
                games: [
                    {
                        user_id: userId,
                        puzzle_num: 1700,
                        date: '2026-02-13',
                        result: 4,
                        completed_at: new Date(remoteCompletedAt).toISOString(),
                        updated_at: new Date(remoteCompletedAt).toISOString(),
                        answer: 'crisp',
                        mode: 'regular',
                        starter: 'trace'
                    }
                ]
            },
            local: {
                history: {
                    '1700': {
                        puzzle_num: 1700,
                        date: '2026-02-13',
                        result: 3,
                        completed_at: localCompletedAt,
                        updated_at: localCompletedAt,
                        answer: 'crisp',
                        mode: 'regular',
                        starter: 'grind'
                    }
                }
            }
        });

        env.mock.setSession(userId);
        await env.sync.performSync({ mode: 'full' });

        const cloud = env.mock.getGame(userId, 1700);
        expect(Date.parse(cloud.completed_at)).toBe(remoteCompletedAt);
        expect(cloud.result).toBe(4);

        const local = JSON.parse(env.dom.window.localStorage.getItem('history'));
        expect(local['1700'].result).toBe(4);
        expect(local['1700'].starter).toBe('trace');
    });

    test('accepts cloud completed row as-is without local metadata enrichment', async () => {
        const userId = 'user-1';
        const remoteCompletedAt = Date.parse('2026-02-13T09:00:00.000Z');
        const localCompletedAt = Date.parse('2026-02-13T11:00:00.000Z');

        const env = setupSyncTest({
            remote: {
                games: [
                    {
                        user_id: userId,
                        puzzle_num: 1700,
                        date: '2026-02-13',
                        result: 3,
                        completed_at: new Date(remoteCompletedAt).toISOString(),
                        updated_at: new Date(remoteCompletedAt).toISOString(),
                        answer: null,
                        mode: null,
                        starter: null
                    }
                ]
            },
            local: {
                history: {
                    '1700': {
                        puzzle_num: 1700,
                        date: '2026-02-13',
                        result: 4,
                        completed_at: localCompletedAt,
                        updated_at: localCompletedAt,
                        answer: 'crisp',
                        mode: 'hard',
                        starter: 'grind'
                    }
                }
            }
        });

        env.mock.setSession(userId);
        await env.sync.performSync({ mode: 'full' });

        const local = JSON.parse(env.dom.window.localStorage.getItem('history'));
        expect(local['1700'].result).toBe(3);
        expect(local['1700'].answer).toBeNull();
        expect(local['1700'].mode).toBeNull();
        expect(local['1700'].starter).toBeNull();
    });

    test('pulls remote current_game_state into a fresh browser for today', async () => {
        const userId = 'user-1';
        const today = formatLocalDate(new Date());

        const env = setupSyncTest({
            remote: {
                current_game_state: [
                    {
                        user_id: userId,
                        puzzle_num: 1700,
                        date: today,
                        row_index: 2,
                        board_state: ['grind', 'patsy', '', '', '', ''],
                        evaluations: [
                            ['absent', 'correct', 'correct', 'absent', 'absent'],
                            ['present', 'absent', 'absent', 'correct', 'absent'],
                            null, null, null, null
                        ],
                        solution: 'crisp',
                        game_status: 'IN_PROGRESS',
                        hard_mode: false,
                        last_played_at: new Date().toISOString(),
                        last_completed_at: null,
                        updated_at: new Date().toISOString(),
                        device_id: 'device-a',
                        schema_version: 1
                    }
                ]
            },
            local: {
                gameState: {
                    boardState: ['', '', '', '', '', ''],
                    evaluations: [null, null, null, null, null, null],
                    rowIndex: 0,
                    solution: 'crisp',
                    gameStatus: 'IN_PROGRESS',
                    lastPlayedTs: Date.now(),
                    lastCompletedTs: null,
                    hardMode: false,
                    puzzleNum: 1700,
                    date: today,
                    updatedAt: Date.now() + 100000
                }
            }
        });

        env.mock.setSession(userId);
        await env.sync.performSync({ mode: 'full' });

        const localState = JSON.parse(env.dom.window.localStorage.getItem('gameState'));
        expect(localState.rowIndex).toBe(2);
        expect(localState.boardState[0]).toBe('grind');
        expect(localState.boardState[1]).toBe('patsy');
    });

    test('pushes local current_game_state when local progress is ahead of cloud', async () => {
        const userId = 'user-1';
        const today = formatLocalDate(new Date());

        const env = setupSyncTest({
            remote: {
                current_game_state: [
                    {
                        user_id: userId,
                        puzzle_num: 1700,
                        date: today,
                        row_index: 1,
                        board_state: ['grind', '', '', '', '', ''],
                        evaluations: [
                            ['absent', 'correct', 'correct', 'absent', 'absent'],
                            null, null, null, null, null
                        ],
                        solution: 'crisp',
                        game_status: 'IN_PROGRESS',
                        hard_mode: false,
                        last_played_at: new Date().toISOString(),
                        last_completed_at: null,
                        updated_at: new Date(Date.now() - 3600000).toISOString(),
                        device_id: 'device-a',
                        schema_version: 1
                    }
                ]
            },
            local: {
                gameState: {
                    boardState: ['grind', 'patsy', 'c', '', '', ''],
                    evaluations: [
                        ['absent', 'correct', 'correct', 'absent', 'absent'],
                        ['present', 'absent', 'absent', 'correct', 'absent'],
                        null, null, null, null
                    ],
                    rowIndex: 2,
                    solution: 'crisp',
                    gameStatus: 'IN_PROGRESS',
                    lastPlayedTs: Date.now(),
                    lastCompletedTs: 0,
                    hardMode: false,
                    puzzleNum: 1700,
                    date: today,
                    updatedAt: Date.now()
                }
            }
        });

        env.mock.setSession(userId);
        await env.sync.performSync({ mode: 'full' });

        const cloudState = env.mock.getCurrentGameState(userId);
        expect(cloudState.row_index).toBe(2);
        expect(cloudState.board_state[1]).toBe('patsy');
        expect(cloudState.board_state[2]).toBe('c');
    });

    test('rejects divergent local in-progress state and restores cloud state', async () => {
        const userId = 'user-1';
        const today = formatLocalDate(new Date());

        const env = setupSyncTest({
            remote: {
                current_game_state: [
                    {
                        user_id: userId,
                        puzzle_num: 1700,
                        date: today,
                        row_index: 2,
                        board_state: ['grind', 'patsy', '', '', '', ''],
                        evaluations: [
                            ['absent', 'correct', 'correct', 'absent', 'absent'],
                            ['present', 'absent', 'absent', 'correct', 'absent'],
                            null, null, null, null
                        ],
                        solution: 'crisp',
                        game_status: 'IN_PROGRESS',
                        hard_mode: false,
                        last_played_at: new Date().toISOString(),
                        last_completed_at: null,
                        updated_at: new Date().toISOString(),
                        device_id: 'device-a',
                        schema_version: 1
                    }
                ]
            },
            local: {
                gameState: {
                    boardState: ['crane', '', '', '', '', ''],
                    evaluations: [
                        ['absent', 'absent', 'absent', 'present', 'absent'],
                        null, null, null, null, null
                    ],
                    rowIndex: 1,
                    solution: 'crisp',
                    gameStatus: 'IN_PROGRESS',
                    lastPlayedTs: Date.now(),
                    lastCompletedTs: 0,
                    hardMode: false,
                    puzzleNum: 1700,
                    date: today,
                    updatedAt: Date.now() + 1000
                }
            }
        });

        env.mock.setSession(userId);
        await env.sync.performSync({ mode: 'full' });

        const localState = JSON.parse(env.dom.window.localStorage.getItem('gameState'));
        expect(localState.rowIndex).toBe(2);
        expect(localState.boardState[0]).toBe('grind');
        expect(localState.boardState[1]).toBe('patsy');

        const cloudState = env.mock.getCurrentGameState(userId);
        expect(cloudState.row_index).toBe(2);
        expect(cloudState.board_state[0]).toBe('grind');
        expect(cloudState.board_state[1]).toBe('patsy');
    });
});
