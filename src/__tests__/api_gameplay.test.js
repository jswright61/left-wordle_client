const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function loadGameplay(client) {
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
    dom.window.LeftWordleApi = {
        ApiClientError: ApiClientError,
        client: client || { evaluateGuess: jest.fn() }
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

describe('ApiGameplayEvaluator', () => {
    test('evaluates via the API and returns a normalized result', async () => {
        const client = { evaluateGuess: jest.fn().mockResolvedValue(apiResponse()) };
        const dom = loadGameplay(client);

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request()))
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
        expect(client.evaluateGuess).toHaveBeenCalledTimes(1);
    });

    test('includes answers_remaining in result when provided', async () => {
        const client = { evaluateGuess: jest.fn().mockResolvedValue(apiResponse({ answers_remaining: 87 })) };
        const dom = loadGameplay(client);

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request()))
            .resolves.toMatchObject({ answersRemaining: 87 });
    });

    test('throws on API errors without fallback', async () => {
        const error = { code: 'timeout', retryable: true };
        const client = { evaluateGuess: jest.fn().mockRejectedValue(error) };
        const dom = loadGameplay(client);

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request()))
            .rejects.toBe(error);
    });

    test('throws on authoritative API validation errors', async () => {
        const error = { code: 'http_error', detail: 'Not in word list', retryable: false, status: 400 };
        const client = { evaluateGuess: jest.fn().mockRejectedValue(error) };
        const dom = loadGameplay(client);

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request()))
            .rejects.toBe(error);
    });

    test('throws when the API returns an invalid gameplay response', async () => {
        const client = { evaluateGuess: jest.fn().mockResolvedValue(apiResponse({ guess_number: 4 })) };
        const dom = loadGameplay(client);

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request()))
            .rejects.toMatchObject({ code: 'invalid_gameplay_response' });
    });

    test('requires a terminal solution', async () => {
        const client = { evaluateGuess: jest.fn().mockResolvedValue(apiResponse({
            evaluation: '22222',
            game_status: 'WIN'
        })) };
        const dom = loadGameplay(client);

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request()))
            .rejects.toMatchObject({ code: 'invalid_gameplay_response' });
    });

    test('requires status to agree with evaluation and row', async () => {
        const client = { evaluateGuess: jest.fn().mockResolvedValue(apiResponse({
            game_status: 'WIN',
            solution: 'crane'
        })) };
        const dom = loadGameplay(client);

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request()))
            .rejects.toMatchObject({ code: 'invalid_gameplay_response' });
    });

    test('does not reveal a solution for an in-progress response', async () => {
        const client = { evaluateGuess: jest.fn().mockResolvedValue(apiResponse({ solution: 'crane' })) };
        const dom = loadGameplay(client);

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request()))
            .rejects.toMatchObject({ code: 'invalid_gameplay_response' });
    });

    test('requires a winning solution to match the submitted guess', async () => {
        const client = { evaluateGuess: jest.fn().mockResolvedValue(apiResponse({
            evaluation: '22222',
            game_status: 'WIN',
            solution: 'cigar'
        })) };
        const dom = loadGameplay(client);

        await expect(dom.window.LeftWordleApi.gameplay.evaluate(request()))
            .rejects.toMatchObject({ code: 'invalid_gameplay_response' });
    });
});
