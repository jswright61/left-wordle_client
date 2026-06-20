const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function loadShadow(options) {
    options = options || {};
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        runScripts: 'outside-only',
        url: 'http://localhost:3000/'
    });
    dom.window.LEFT_WORDLE_CONFIG = {
        apiGameplayEnabled: options.gameplayEnabled === true,
        apiGameplayShadowMode: options.enabled !== false
    };
    dom.window.LeftWordleApi = { client: options.client || { evaluateGuess: jest.fn() } };
    const code = fs.readFileSync(path.join(__dirname, '../api_shadow.js'), 'utf8');
    dom.window.eval(code);
    return dom;
}

function expected(overrides) {
    return Object.assign({
        date: '2021-06-19',
        evaluation: ['correct', 'absent', 'present', 'absent', 'correct'],
        gameStatus: 'IN_PROGRESS',
        guess: 'crane',
        puzzleNum: 0,
        rowIndex: 1,
        solution: 'cigar'
    }, overrides || {});
}

function actual(overrides) {
    return Object.assign({
        date: '2021-06-19',
        evaluation: '20102',
        game_status: 'IN_PROGRESS',
        puzzle_num: 0,
        guess_number: 2,
        solution: null
    }, overrides || {});
}

describe('ApiShadowEvaluator', () => {
    test('finds no differences for matching evaluations', () => {
        const dom = loadShadow();

        expect(dom.window.LeftWordleApi.shadow.compare(expected(), actual())).toEqual([]);
    });

    test('reports mismatched contract fields without response values', () => {
        const dom = loadShadow();

        expect(dom.window.LeftWordleApi.shadow.compare(expected(), actual({
            evaluation: '00000',
            game_status: 'WIN',
            puzzle_num: 1
        }))).toEqual(['puzzle_num', 'evaluation', 'game_status']);
    });

    test('compares the solution only for terminal games', () => {
        const dom = loadShadow();

        expect(dom.window.LeftWordleApi.shadow.compare(
            expected({ gameStatus: 'WIN' }),
            actual({ game_status: 'WIN', solution: 'cigar' })
        )).toEqual([]);
        expect(dom.window.LeftWordleApi.shadow.compare(
            expected({ gameStatus: 'WIN' }),
            actual({ game_status: 'WIN', solution: 'other' })
        )).toEqual(['solution']);
    });

    test('submits enabled shadow evaluations and emits a match result', async () => {
        const client = { evaluateGuess: jest.fn().mockResolvedValue(actual()) };
        const dom = loadShadow({ client: client });
        const results = [];
        dom.window.addEventListener('left-wordle-api-shadow-result', function(event) {
            results.push(event.detail);
        });

        dom.window.LeftWordleApi.shadow.submit(expected());
        await Promise.resolve();
        await Promise.resolve();

        expect(client.evaluateGuess).toHaveBeenCalledWith('2021-06-19', 'crane', 1);
        expect(results).toEqual([{ fields: [], puzzleNum: 0, rowIndex: 1, type: 'match' }]);
    });

    test('does not submit when shadow mode is disabled', () => {
        const client = { evaluateGuess: jest.fn() };
        const dom = loadShadow({ client: client, enabled: false });

        dom.window.LeftWordleApi.shadow.submit(expected());

        expect(client.evaluateGuess).not.toHaveBeenCalled();
    });

    test('does not submit when API gameplay is authoritative', () => {
        const client = { evaluateGuess: jest.fn() };
        const dom = loadShadow({ client: client, gameplayEnabled: true });

        dom.window.LeftWordleApi.shadow.submit(expected());

        expect(client.evaluateGuess).not.toHaveBeenCalled();
    });
});
