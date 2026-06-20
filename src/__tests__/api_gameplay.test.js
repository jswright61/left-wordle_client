const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function loadGameplay(options) {
    options = options || {};
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        runScripts: 'outside-only',
        url: 'http://localhost:3000/'
    });
    class ApiClientError extends Error {
        constructor(message, errorOptions) {
            super(message);
            Object.assign(this, errorOptions || {});
        }
    }
    dom.window.LEFT_WORDLE_CONFIG = {
        apiGameplayEnabled: options.enabled === true,
        localGameplayFallbackEnabled: options.fallbackEnabled === true
    };
    dom.window.LeftWordleApi = {
        ApiClientError: ApiClientError,
        client: options.client || { evaluateGuess: jest.fn() }
    };
    const code = fs.readFileSync(path.join(__dirname, '../api_gameplay.js'), 'utf8');
    dom.window.eval(code);
    return dom;
}

function request() {
    return { date: '2021-06-19', guess: 'crane', puzzleNum: 0, rowIndex: 0 };
}

function apiResponse(overrides) {
    return Object.assign({
        date: '2021-06-19',
        evaluation: '00000',
        game_status: 'IN_PROGRESS',
        puzzle_num: 0,
        guess_number: 1,
        solution: null
    }, overrides || {});
}

function localResponse() {
    return {
        date: '2021-06-19',
        evaluation: ['correct', 'correct', 'correct', 'correct', 'correct'],
        gameStatus: 'WIN',
        puzzleNum: 0,
        rowIndex: 1,
        solution: 'crane'
    };
}

describe('ApiGameplayEvaluator', () => {
    test('uses local evaluation when API gameplay is disabled', async () => {
        const client = { evaluateGuess: jest.fn() };
        const dom = loadGameplay({ client: client });

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request(), localResponse))
            .resolves.toMatchObject({ source: 'local', gameStatus: 'WIN' });
        expect(client.evaluateGuess).not.toHaveBeenCalled();
    });

    test('uses validated API evaluation when enabled', async () => {
        const client = { evaluateGuess: jest.fn().mockResolvedValue(apiResponse()) };
        const dom = loadGameplay({ client: client, enabled: true, fallbackEnabled: true });

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request(), localResponse))
            .resolves.toEqual({
                date: '2021-06-19',
                evaluation: ['absent', 'absent', 'absent', 'absent', 'absent'],
                gameStatus: 'IN_PROGRESS',
                puzzleNum: 0,
                rowIndex: 1,
                solution: null,
                source: 'api',
                answersRemaining: null
            });
    });

    test('includes answers_remaining in result when provided', async () => {
        const client = { evaluateGuess: jest.fn().mockResolvedValue(apiResponse({ answers_remaining: 87 })) };
        const dom = loadGameplay({ client: client, enabled: true, fallbackEnabled: false });

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request(), localResponse))
            .resolves.toMatchObject({ answersRemaining: 87 });
    });

    test('falls back locally for retryable API failures', async () => {
        const error = { code: 'timeout', retryable: true };
        const client = { evaluateGuess: jest.fn().mockRejectedValue(error) };
        const dom = loadGameplay({ client: client, enabled: true, fallbackEnabled: true });

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request(), localResponse))
            .resolves.toMatchObject({ source: 'fallback', gameStatus: 'WIN' });
    });

    test('does not bypass authoritative validation errors', async () => {
        const error = { code: 'http_error', detail: 'Not in word list', retryable: false, status: 400 };
        const client = { evaluateGuess: jest.fn().mockRejectedValue(error) };
        const dom = loadGameplay({ client: client, enabled: true, fallbackEnabled: true });

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request(), localResponse))
            .rejects.toBe(error);
    });

    test('falls back when the API gameplay contract is invalid', async () => {
        const client = { evaluateGuess: jest.fn().mockResolvedValue(apiResponse({ guess_number: 4 })) };
        const dom = loadGameplay({ client: client, enabled: true, fallbackEnabled: true });

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request(), localResponse))
            .resolves.toMatchObject({ source: 'fallback', gameStatus: 'WIN' });
    });

    test('requires a terminal solution', async () => {
        const client = { evaluateGuess: jest.fn().mockResolvedValue(apiResponse({
            evaluation: '22222',
            game_status: 'WIN'
        })) };
        const dom = loadGameplay({ client: client, enabled: true, fallbackEnabled: false });

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request(), localResponse))
            .rejects.toMatchObject({ code: 'invalid_gameplay_response' });
    });

    test('requires status to agree with evaluation and row', async () => {
        const client = { evaluateGuess: jest.fn().mockResolvedValue(apiResponse({
            game_status: 'WIN',
            solution: 'crane'
        })) };
        const dom = loadGameplay({ client: client, enabled: true, fallbackEnabled: false });

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request(), localResponse))
            .rejects.toMatchObject({ code: 'invalid_gameplay_response' });
    });

    test('does not reveal a solution for an in-progress response', async () => {
        const client = { evaluateGuess: jest.fn().mockResolvedValue(apiResponse({ solution: 'crane' })) };
        const dom = loadGameplay({ client: client, enabled: true, fallbackEnabled: false });

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request(), localResponse))
            .rejects.toMatchObject({ code: 'invalid_gameplay_response' });
    });

    test('requires a winning solution to match the submitted guess', async () => {
        const client = { evaluateGuess: jest.fn().mockResolvedValue(apiResponse({
            evaluation: '22222',
            game_status: 'WIN',
            solution: 'cigar'
        })) };
        const dom = loadGameplay({ client: client, enabled: true, fallbackEnabled: false });

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request(), localResponse))
            .rejects.toMatchObject({ code: 'invalid_gameplay_response' });
    });
});
