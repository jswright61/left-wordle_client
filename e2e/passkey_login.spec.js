const { test, expect } = require('@playwright/test');

// Points at a throwaway API instance (RACK_ENV=test, its own port, not the
// developer's normal local API). It is NOT part of `npm run test:e2e` --
// playwright's webServer only serves the static client -- so this spec
// needs that instance brought up separately, and skips itself when it
// isn't reachable rather than failing (see the beforeEach gate below; a
// permanently red suite is one nobody reads).
//
// Bringing it up takes more than `rackup -p 9377`: api/app.rb reads
// webauthn_origin from its one hardcoded config/app_config.yml, and a
// local dev setup normally has that set to the Caddy origin
// (https://left-wordle.test, see client/app_config.js). WebAuthn compares
// that against the *client* origin, so a ceremony driven from
// http://localhost:3000 fails on mismatch even once the port is listening.
// Running it therefore means a config whose webauthn_origin/webauthn_rp_id
// match wherever the client is served from.
//
// Longer term the cleaner home for this spec is the Caddy dev environment
// itself, where client and API share one HTTPS origin exactly as
// production does -- which would retire the port-9377/credentials-include
// workaround below instead of documenting it.
const API_BASE_URL = process.env.LEFT_WORDLE_E2E_API_BASE_URL || 'http://localhost:9377';

// Any HTTP response means the API is up and this spec should run. Status is
// deliberately ignored: an Origin-less request like this one is answered with
// 401 "Authorization required" (see api/app.rb's server-token check), so
// gating on response.ok would skip the whole spec against a perfectly healthy
// server -- making the gate permanent instead of conditional. Only a
// network-level failure (nothing listening, DNS, timeout) counts as absent.
async function apiIsReachable() {
    try {
        await fetch(API_BASE_URL + '/api/v1/health', { signal: AbortSignal.timeout(2000) });
        return true;
    } catch {
        return false;
    }
}

async function setupPasskeyPage(browser) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript((apiBaseUrl) => {
        window.LEFT_WORDLE_CONFIG = {
            apiBaseUrl: apiBaseUrl,
            // Real deployments serve client+API from one host, so the
            // shipped default is "same-origin" (see app_config.js). This
            // E2E harness serves them on different ports (client:3000,
            // API:9377) purely for local test convenience, which makes
            // them different origins -- "include" is a test-environment
            // concession so the session cookie still flows, not a change
            // to the shipped default.
            apiCredentials: 'include',
            passkeyAuthEnabled: true,
            serverSyncEnabled: true
        };
        // These tests drive the login overlay explicitly via the header
        // button; suppress the deferred auto-prompt (see wordle.js's
        // GameApp connectedCallback) so its full-screen backdrop can't
        // race with and intercept those clicks.
        localStorage.setItem('preferences', JSON.stringify({ suppressLoginPrompt: true }));
    }, API_BASE_URL);

    const client = await context.newCDPSession(page);
    await client.send('WebAuthn.enable');
    const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
        options: {
            protocol: 'ctap2',
            transport: 'internal',
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true
        }
    });

    return { context, page, client, authenticatorId };
}

async function freshLoad(page) {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/');
    await page.waitForFunction(() => {
        const app = document.querySelector('game-app');
        return app && app.querySelector('#board');
    });
}

async function dismissHelpModal(page) {
    try {
        const closeable = page.locator('game-page[open] game-icon[icon="close"]');
        await closeable.waitFor({ state: 'visible', timeout: 2000 });
        await closeable.click();
        await expect(page.locator('game-page[open]')).toHaveCount(0, { timeout: 2000 });
    } catch {
        // No help modal appeared -- fine.
    }
}

async function submitWord(page, word) {
    for (const letter of word) {
        await page.keyboard.press(letter.toUpperCase());
    }
    await page.keyboard.press('Enter');
}

// canInput alone isn't enough to know a guess is safely on the server --
// it flips true once the tile-flip animation finishes, independent of
// whether the online device's live progress push (which blocks input via
// the separate awaitingOnlineProgressSync flag) has actually landed yet.
async function waitForGuessToLand(page) {
    await page.waitForFunction(() => {
        const app = document.querySelector('game-app');
        return (app.canInput || app.gameStatus !== 'IN_PROGRESS') && !app.awaitingOnlineProgressSync;
    }, { timeout: 10000 });
}

test.describe('Passkey login', () => {
    let reachable = false;

    test.beforeAll(async () => {
        reachable = await apiIsReachable();
    });

    test.beforeEach(() => {
        test.skip(!reachable,
            `Passkey API not reachable at ${API_BASE_URL} — see this file's header for what it needs. ` +
            'Override with LEFT_WORDLE_E2E_API_BASE_URL.');
    });

    test('register a new passkey, log out, and log back in on the same device', async ({ browser }) => {
        const { context, page } = await setupPasskeyPage(browser);
        await freshLoad(page);
        await dismissHelpModal(page);

        await expect(page.locator('game-app #login-button')).not.toHaveClass(/hidden/, { timeout: 10000 });
        await page.click('game-app #login-button');
        await expect(page.locator('#login')).not.toHaveClass(/hidden/);

        await page.click('#login-register-button');
        await expect(page.locator('#login-logged-in-section')).not.toHaveClass(/hidden/, { timeout: 10000 });

        const isLoggedIn = await page.evaluate(() => window.LeftWordleAuth.isLoggedIn());
        expect(isLoggedIn).toBe(true);

        await page.click('#login-logout-button');
        await expect(page.locator('#login-logged-out-section')).not.toHaveClass(/hidden/, { timeout: 10000 });

        await page.click('#login-signin-button');
        await expect(page.locator('#login-logged-in-section')).not.toHaveClass(/hidden/, { timeout: 10000 });

        const loggedInAgain = await page.evaluate(() => window.LeftWordleAuth.isLoggedIn());
        expect(loggedInAgain).toBe(true);

        await context.close();
    });

    test('device-link token lets a second simulated device join the account', async ({ browser }) => {
        const first = await setupPasskeyPage(browser);
        await freshLoad(first.page);
        await dismissHelpModal(first.page);

        await first.page.click('game-app #login-button');
        await first.page.click('#login-register-button');
        await expect(first.page.locator('#login-logged-in-section')).not.toHaveClass(/hidden/, { timeout: 10000 });
        const firstUserId = await first.page.evaluate(() => window.LeftWordleAuth.email !== undefined && window.leftWordleLoginUI && true);
        expect(firstUserId).toBe(true);

        await first.page.click('#login-add-device-link-button');
        await expect(first.page.locator('#login-device-link-modal')).not.toHaveClass(/hidden/, { timeout: 10000 });
        const linkUrl = await first.page.locator('#login-device-link-url').inputValue();
        expect(linkUrl).toContain('link_token=');

        const second = await setupPasskeyPage(browser);
        await second.page.goto(linkUrl.replace(/^https?:\/\/[^/]+/, ''));
        await second.page.waitForSelector('#login-link-landing:not(.hidden)', { timeout: 10000 });
        await second.page.click('#login-link-landing-button');
        // A successful join reloads the page (see login_ui.js
        // maybeHandleDeviceLinkLanding) to drop ?link_token= and pick up
        // the freshly-synced session -- wait for that navigation, then
        // confirm the reloaded page is authenticated.
        await second.page.waitForURL((url) => !url.searchParams.has('link_token'), { timeout: 10000 });
        await second.page.waitForFunction(() => window.LeftWordleAuth && window.LeftWordleAuth.isLoggedIn(), { timeout: 10000 });

        await first.context.close();
        await second.context.close();
    });

    // Regression test for the bug behind this whole spec's existence:
    // syncFromServerAndOverwriteLocal used to pull the server down and
    // overwrite local storage on join, silently discarding a second
    // device's own pre-existing history with no warning (manual_testing/
    // README.md's Scenario 1). Under online_play_redesign.md there's no
    // more pull-and-overwrite at all -- joining an account is pure
    // authentication, so a device's local history should survive
    // untouched.
    test('a second device joining via link keeps its own pre-existing local history', async ({ browser }) => {
        const first = await setupPasskeyPage(browser);
        await freshLoad(first.page);
        await dismissHelpModal(first.page);

        await first.page.click('game-app #login-button');
        await first.page.click('#login-register-button');
        await expect(first.page.locator('#login-logged-in-section')).not.toHaveClass(/hidden/, { timeout: 10000 });

        await first.page.click('#login-add-device-link-button');
        await expect(first.page.locator('#login-device-link-modal')).not.toHaveClass(/hidden/, { timeout: 10000 });
        const linkUrl = await first.page.locator('#login-device-link-url').inputValue();

        const second = await setupPasskeyPage(browser);
        await freshLoad(second.page);
        await dismissHelpModal(second.page);

        // This device's own offline play, seeded before it ever joins the
        // account -- exactly what the old pull-and-overwrite discarded.
        const seededHistory = {
            50: {
                puzzle_num: 50, date: '2021-08-08', result: 3, answer: 'CRANE',
                mode: 'regular', starter: 'crane', completed_at: Date.now(),
                updated_at: Date.now(), device_id: null, origin: 'played'
            }
        };
        await second.page.evaluate((history) => {
            localStorage.setItem('history', JSON.stringify(history));
        }, seededHistory);

        await second.page.goto(linkUrl.replace(/^https?:\/\/[^/]+/, ''));
        await second.page.waitForSelector('#login-link-landing:not(.hidden)', { timeout: 10000 });
        await second.page.click('#login-link-landing-button');
        await second.page.waitForURL((url) => !url.searchParams.has('link_token'), { timeout: 10000 });
        await second.page.waitForFunction(() => window.LeftWordleAuth && window.LeftWordleAuth.isLoggedIn(), { timeout: 10000 });

        const historyAfterJoin = await second.page.evaluate(() => JSON.parse(localStorage.getItem('history') || '{}'));
        expect(historyAfterJoin['50']).toBeDefined();
        expect(historyAfterJoin['50'].result).toBe(3);
        expect(historyAfterJoin['50'].starter).toBe('crane');

        await first.context.close();
        await second.context.close();
    });

    // Proves the read side of cross-device resume (the write side --
    // every guess pushing live -- already landed in the prior phase).
    // wordle.js's customElements.define gate (GameStateManager.
    // getInitialGameState) is what makes this possible: a device that's
    // logged in before waits for its profile fetch before the board
    // renders, so it reads the account's real in-progress game instead of
    // its own empty local storage.
    test('a guess made on one device appears on another device that loads afterward', async ({ browser }) => {
        const first = await setupPasskeyPage(browser);
        await freshLoad(first.page);
        await dismissHelpModal(first.page);

        await first.page.click('game-app #login-button');
        await first.page.click('#login-register-button');
        await expect(first.page.locator('#login-logged-in-section')).not.toHaveClass(/hidden/, { timeout: 10000 });

        await first.page.click('#login-add-device-link-button');
        await expect(first.page.locator('#login-device-link-modal')).not.toHaveClass(/hidden/, { timeout: 10000 });
        const linkUrl = await first.page.locator('#login-device-link-url').inputValue();

        const second = await setupPasskeyPage(browser);
        await second.page.goto(linkUrl.replace(/^https?:\/\/[^/]+/, ''));
        await second.page.waitForSelector('#login-link-landing:not(.hidden)', { timeout: 10000 });
        await second.page.click('#login-link-landing-button');
        await second.page.waitForURL((url) => !url.searchParams.has('link_token'), { timeout: 10000 });
        await second.page.waitForFunction(() => window.LeftWordleAuth && window.LeftWordleAuth.isLoggedIn(), { timeout: 10000 });

        // Device A submits one guess -- doesn't need to win, just needs to
        // land on the server (Phase 1's live per-guess push).
        const guess = 'crane';
        await submitWord(first.page, guess);
        await waitForGuessToLand(first.page);

        // Device B loads fresh -- a new navigation, not a new context, so
        // its lastKnownAuthState: logged_in flag from joining above is
        // still there to trigger the gate.
        await second.page.goto('/');
        await second.page.waitForFunction(() => {
            const app = document.querySelector('game-app');
            return app && app.querySelector('#board');
        }, { timeout: 10000 });

        const firstRowOnSecond = await second.page.evaluate(() => document.querySelector('game-app').boardState[0]);
        expect(firstRowOnSecond).toBe(guess);

        await first.context.close();
        await second.context.close();
    });
});
