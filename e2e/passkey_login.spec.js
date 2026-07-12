const { test, expect } = require('@playwright/test');

// Points at a throwaway API instance started for this verification run
// (RACK_ENV=test, its own port, not the developer's normal local API) --
// see the task notes for how it was started. Not part of the normal
// `npm run test:e2e` webServer (which only serves the static client);
// running this spec requires that API instance to be up separately.
const API_BASE_URL = process.env.LEFT_WORDLE_E2E_API_BASE_URL || 'http://localhost:9377';

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

test.describe('Passkey login', () => {
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
});
