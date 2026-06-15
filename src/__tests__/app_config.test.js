const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function loadConfig(url, overrides) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        runScripts: 'outside-only',
        url: url
    });
    if (overrides) dom.window.LEFT_WORDLE_CONFIG = overrides;
    const code = fs.readFileSync(path.join(__dirname, '../../app_config.js'), 'utf8');
    dom.window.eval(code);
    return dom.window.LEFT_WORDLE_CONFIG;
}

describe('LEFT_WORDLE_CONFIG', () => {
    test('uses the local Sinatra API during local development', () => {
        const config = loadConfig('http://localhost:3000/');

        expect(config.apiBaseUrl).toBe('http://localhost:9292');
        expect(config.apiGameplayEnabled).toBe(false);
        expect(config.apiGameplayShadowMode).toBe(false);
        expect(config.localGameplayFallbackEnabled).toBe(true);
    });

    test('uses the public API host outside local development', () => {
        const config = loadConfig('https://left-wordle.com/');

        expect(config.apiBaseUrl).toBe('https://api.left-wordle.com');
    });

    test('preserves deployment overrides', () => {
        const config = loadConfig('https://staging.left-wordle.com/', {
            apiBaseUrl: 'https://staging-api.left-wordle.com',
            apiRequestTimeoutMs: 5000
        });

        expect(config.apiBaseUrl).toBe('https://staging-api.left-wordle.com');
        expect(config.apiRequestTimeoutMs).toBe(5000);
        expect(config.serverSyncEnabled).toBe(false);
    });
});
