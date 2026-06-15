const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function response(options) {
    options = options || {};
    return {
        ok: options.ok !== false,
        status: options.status || 200,
        text: async function() {
            return options.body === undefined ? '{}' : options.body;
        }
    };
}

function loadClient(fetchImpl, config) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        runScripts: 'outside-only',
        url: 'http://localhost:3000/'
    });
    dom.window.fetch = fetchImpl;
    dom.window.LEFT_WORDLE_CONFIG = Object.assign({
        apiBaseUrl: 'http://localhost:9292',
        apiCredentials: 'omit',
        apiRequestTimeoutMs: 100
    }, config || {});
    const code = fs.readFileSync(path.join(__dirname, '../api_client.js'), 'utf8');
    dom.window.eval(code);
    return dom;
}

describe('LeftWordleApi', () => {
    test('requests API health with configured fetch options', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(response({ body: '{"status":"ok"}' }));
        const dom = loadClient(fetchImpl);

        await expect(dom.window.LeftWordleApi.client.health()).resolves.toEqual({ status: 'ok' });
        expect(fetchImpl).toHaveBeenCalledWith(
            'http://localhost:9292/api/health',
            expect.objectContaining({
                credentials: 'omit',
                headers: { Accept: 'application/json' },
                method: 'GET'
            })
        );
    });

    test('requests puzzle metadata for a date', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(response({
            body: '{"puzzle_num":0,"date":"2021-06-19","word_length":5}'
        }));
        const dom = loadClient(fetchImpl);

        await dom.window.LeftWordleApi.client.puzzleMetadata('2021-06-19');

        expect(fetchImpl.mock.calls[0][0]).toBe(
            'http://localhost:9292/api/game/today?date=2021-06-19'
        );
    });

    test('normalizes API error responses', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(response({
            body: '{"detail":"Origin not allowed"}',
            ok: false,
            status: 403
        }));
        const dom = loadClient(fetchImpl);

        await expect(dom.window.LeftWordleApi.client.health()).rejects.toMatchObject({
            code: 'http_error',
            detail: 'Origin not allowed',
            retryable: false,
            status: 403
        });
    });

    test('rejects invalid JSON responses', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(response({ body: '<html>Error</html>' }));
        const dom = loadClient(fetchImpl);

        await expect(dom.window.LeftWordleApi.client.health()).rejects.toMatchObject({
            code: 'invalid_response',
            status: 200
        });
    });

    test('times out slow requests', async () => {
        const fetchImpl = jest.fn(function(url, options) {
            return new Promise(function(resolve, reject) {
                options.signal.addEventListener('abort', function() {
                    reject(new dom.window.DOMException('Aborted', 'AbortError'));
                });
            });
        });
        const dom = loadClient(fetchImpl, { apiRequestTimeoutMs: 5 });

        await expect(dom.window.LeftWordleApi.client.health()).rejects.toMatchObject({
            code: 'timeout',
            retryable: true
        });
    });

    test('supports caller cancellation', async () => {
        const fetchImpl = jest.fn(function(url, options) {
            return new Promise(function(resolve, reject) {
                options.signal.addEventListener('abort', function() {
                    reject(new dom.window.DOMException('Aborted', 'AbortError'));
                });
            });
        });
        const dom = loadClient(fetchImpl);
        const controller = new dom.window.AbortController();
        const request = dom.window.LeftWordleApi.client.health({ signal: controller.signal });

        controller.abort();

        await expect(request).rejects.toMatchObject({ code: 'cancelled' });
    });
});
