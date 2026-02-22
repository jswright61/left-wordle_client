const { test, expect } = require('@playwright/test');

// Helper: clear localStorage and navigate to get a fresh game
async function freshGame(page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  // Wait for game-app to be ready
  await page.waitForFunction(() => {
    const app = document.querySelector('game-app');
    return app && app.querySelector('#board');
  });
}

// Helper: close the auto-opening help modal if present
async function dismissHelpModal(page) {
  // The help modal auto-opens on first visit (no lastPlayedTs).
  // It's a game-page inside game-app with [open] attribute.
  // Wait briefly for the modal to appear, then close it.
  try {
    const closeable = page.locator('game-page[open] game-icon[icon="close"]');
    await closeable.waitFor({ state: 'visible', timeout: 2000 });
    await closeable.click();
    // Wait for page to close (open attribute removed after SlideOut animation)
    await expect(page.locator('game-page[open]')).toHaveCount(0, { timeout: 2000 });
  } catch {
    // No help modal appeared — that's fine
  }
}

// Helper: get the solution from the game-app element
async function getSolution(page) {
  return page.evaluate(() => {
    const app = document.querySelector('game-app');
    return app.solution;
  });
}

// Helper: type a word using the keyboard
async function typeWord(page, word) {
  for (const letter of word) {
    await page.keyboard.press(letter.toUpperCase());
  }
}

// Helper: submit a word (type + Enter)
async function submitWord(page, word) {
  await typeWord(page, word);
  await page.keyboard.press('Enter');
}

// Helper: wait for row evaluation animations to finish.
// After submitting a guess, tiles flip with staggered 300ms delays (5 tiles).
// The last tile dispatches "game-last-tile-revealed-in-row" when done.
// We wait for canInput to become true (or game to end) as a reliable signal.
async function waitForRowEvaluation(page) {
  await page.waitForFunction(() => {
    const app = document.querySelector('game-app');
    return app.canInput || app.gameStatus !== 'IN_PROGRESS';
  }, { timeout: 10000 });
}

// Helper: wait for all tiles in a row to finish their flip animations
// and show their final evaluation states (correct/present/absent).
// The inner .tile div's data-state is only set to the evaluation state
// after the FlipOut animation completes.
async function waitForTileReveal(page, rowIndex) {
  await page.waitForFunction((ri) => {
    const app = document.querySelector('game-app');
    const rows = app.querySelectorAll('game-row');
    const row = rows[ri];
    if (!row) return false;
    const tiles = row.querySelectorAll('game-tile');
    return Array.from(tiles).every(tile => {
      const inner = tile.querySelector('.tile');
      return ['correct', 'present', 'absent'].includes(inner.dataset.state);
    });
  }, rowIndex, { timeout: 10000 });
}

// Helper: get all tile data-states for a given row (0-indexed)
async function getRowTileStates(page, rowIndex) {
  return page.evaluate((ri) => {
    const app = document.querySelector('game-app');
    const rows = app.querySelectorAll('game-row');
    const row = rows[ri];
    const tiles = row.querySelectorAll('game-tile');
    return Array.from(tiles).map(tile => {
      const inner = tile.querySelector('.tile');
      return inner.dataset.state;
    });
  }, rowIndex);
}

// Helper: get all tile letters for a given row (0-indexed)
async function getRowTileLetters(page, rowIndex) {
  return page.evaluate((ri) => {
    const app = document.querySelector('game-app');
    const rows = app.querySelectorAll('game-row');
    const row = rows[ri];
    const tiles = row.querySelectorAll('game-tile');
    return Array.from(tiles).map(tile => {
      const inner = tile.querySelector('.tile');
      return inner.textContent;
    });
  }, rowIndex);
}

// Known valid 5-letter words that are NOT likely to be the solution on any given day.
// These are from the valid_guesses list or answer_list.
const VALID_WORDS = ['crane', 'slate', 'trace', 'crate', 'adieu', 'raise'];


// ─── Test Suite ───────────────────────────────────────────────────────────────

test.describe('Wordle E2E Tests', () => {

  // ─── 1. Initial Render ─────────────────────────────────────────────────────
  test.describe('Initial Render', () => {
    test('page loads without errors', async ({ page }) => {
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      await freshGame(page);
      await dismissHelpModal(page);
      expect(errors).toHaveLength(0);
    });

    test('game board has 6 rows with 5 tiles each', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      const rowCount = await page.evaluate(() => {
        const app = document.querySelector('game-app');
        return app.querySelectorAll('game-row').length;
      });
      expect(rowCount).toBe(6);

      const tileCounts = await page.evaluate(() => {
        const app = document.querySelector('game-app');
        const rows = app.querySelectorAll('game-row');
        return Array.from(rows).map(row =>
          row.querySelectorAll('game-tile').length
        );
      });
      expect(tileCounts).toEqual([5, 5, 5, 5, 5, 5]);
    });

    test('all tiles start in empty state', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      for (let row = 0; row < 6; row++) {
        const states = await getRowTileStates(page, row);
        expect(states).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
      }
    });

    test('on-screen keyboard has all letter keys plus Enter and Backspace', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      const keys = await page.evaluate(() => {
        const app = document.querySelector('game-app');
        const keyboard = app.querySelector('game-keyboard');
        const buttons = keyboard.querySelectorAll('button[data-key]');
        return Array.from(buttons).map(b => b.dataset.key);
      });

      // Check all 26 letters
      for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
        expect(keys).toContain(letter);
      }
      // Check special keys
      expect(keys).toContain('↵');
      expect(keys).toContain('←');
    });

    test('header shows title and 4 buttons', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      const title = await page.evaluate(() => {
        const app = document.querySelector('game-app');
        return app.querySelector('.title').textContent.trim();
      });
      expect(title).toBe('Wordle');

      const buttonIds = await page.evaluate(() => {
        const app = document.querySelector('game-app');
        const header = app.querySelector('header');
        const buttons = header.querySelectorAll('button');
        return Array.from(buttons).map(b => b.id);
      });
      expect(buttonIds).toContain('help-button');
      expect(buttonIds).toContain('save-button');
      expect(buttonIds).toContain('statistics-button');
      expect(buttonIds).toContain('settings-button');
    });
  });

  // ─── 2. Letter Input (physical keyboard) ──────────────────────────────────
  test.describe('Letter Input', () => {
    test('pressing a letter key fills the first tile', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      await page.keyboard.press('a');

      const letters = await getRowTileLetters(page, 0);
      expect(letters[0]).toBe('a');

      const states = await getRowTileStates(page, 0);
      expect(states[0]).toBe('tbd');
    });

    test('pressing 5 letters fills the entire first row', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      await typeWord(page, 'hello');

      const letters = await getRowTileLetters(page, 0);
      expect(letters).toEqual(['h', 'e', 'l', 'l', 'o']);

      const states = await getRowTileStates(page, 0);
      states.forEach(s => expect(s).toBe('tbd'));
    });

    test('pressing a 6th letter is ignored', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      await typeWord(page, 'hello');
      await page.keyboard.press('x');

      const letters = await getRowTileLetters(page, 0);
      expect(letters).toEqual(['h', 'e', 'l', 'l', 'o']);
    });
  });

  // ─── 3. Backspace ─────────────────────────────────────────────────────────
  test.describe('Backspace', () => {
    test('removes the last letter typed', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      await typeWord(page, 'hel');
      await page.keyboard.press('Backspace');

      const letters = await getRowTileLetters(page, 0);
      expect(letters[0]).toBe('h');
      expect(letters[1]).toBe('e');
      expect(letters[2]).toBe('');

      const states = await getRowTileStates(page, 0);
      expect(states[2]).toBe('empty');
    });

    test('tile returns to empty state after backspace', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      await page.keyboard.press('a');
      await page.keyboard.press('Backspace');

      const states = await getRowTileStates(page, 0);
      expect(states[0]).toBe('empty');

      const letters = await getRowTileLetters(page, 0);
      expect(letters[0]).toBe('');
    });
  });

  // ─── 4. Invalid Word Rejection ────────────────────────────────────────────
  test.describe('Invalid Word Rejection', () => {
    test('shows "Not in word list" toast for invalid word', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      await submitWord(page, 'zzzzz');

      // Check for toast
      const toastText = await page.evaluate(() => {
        const app = document.querySelector('game-app');
        const toast = app.querySelector('#game-toaster game-toast');
        return toast ? toast.getAttribute('text') : null;
      });
      expect(toastText).toBe('Not in word list');
    });

    test('row gets invalid attribute (shake animation)', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      await submitWord(page, 'zzzzz');

      const hasInvalid = await page.evaluate(() => {
        const app = document.querySelector('game-app');
        const row = app.querySelectorAll('game-row')[0];
        return row.hasAttribute('invalid');
      });
      expect(hasInvalid).toBe(true);
    });

    test('row does not advance after invalid word', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      await submitWord(page, 'zzzzz');

      const rowIndex = await page.evaluate(() => {
        const app = document.querySelector('game-app');
        return app.rowIndex;
      });
      expect(rowIndex).toBe(0);
    });
  });

  // ─── 5. Not Enough Letters ────────────────────────────────────────────────
  test.describe('Not Enough Letters', () => {
    test('shows toast when fewer than 5 letters submitted', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      await typeWord(page, 'abc');
      await page.keyboard.press('Enter');

      const toastText = await page.evaluate(() => {
        const app = document.querySelector('game-app');
        const toast = app.querySelector('#game-toaster game-toast');
        return toast ? toast.getAttribute('text') : null;
      });
      expect(toastText).toBe('Not enough letters');
    });
  });

  // ─── 6. Valid Guess Evaluation ────────────────────────────────────────────
  test.describe('Valid Guess Evaluation', () => {
    test('tiles get evaluation states after a valid non-solution guess', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      const solution = await getSolution(page);

      // Pick a valid word that is NOT the solution
      let guess = VALID_WORDS.find(w => w !== solution);

      await submitWord(page, guess);
      await waitForRowEvaluation(page);

      const states = await getRowTileStates(page, 0);
      // Each tile should be one of: correct, present, absent
      states.forEach(s => {
        expect(['correct', 'present', 'absent']).toContain(s);
      });
    });

    test('row advances after a valid guess', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      const solution = await getSolution(page);
      let guess = VALID_WORDS.find(w => w !== solution);

      await submitWord(page, guess);
      await waitForRowEvaluation(page);

      const rowIndex = await page.evaluate(() => {
        return document.querySelector('game-app').rowIndex;
      });
      expect(rowIndex).toBe(1);
    });
  });

  // ─── 7. Keyboard State Updates ────────────────────────────────────────────
  test.describe('Keyboard State Updates', () => {
    test('keyboard keys update data-state after guess', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      const solution = await getSolution(page);
      let guess = VALID_WORDS.find(w => w !== solution);

      await submitWord(page, guess);
      await waitForRowEvaluation(page);

      // Check that at least some keyboard keys have data-state set
      const keyStates = await page.evaluate((word) => {
        const app = document.querySelector('game-app');
        const keyboard = app.querySelector('game-keyboard');
        const results = {};
        for (const letter of word) {
          const btn = keyboard.querySelector(`button[data-key="${letter}"]`);
          results[letter] = btn ? btn.dataset.state : null;
        }
        return results;
      }, guess);

      // Each letter used in the guess should now have a state
      const uniqueLetters = [...new Set(guess.split(''))];
      for (const letter of uniqueLetters) {
        expect(['correct', 'present', 'absent']).toContain(keyStates[letter]);
      }
    });
  });

  // ─── 8. Win Condition ─────────────────────────────────────────────────────
  test.describe('Win Condition', () => {
    test('submitting the correct solution shows win toast and stats modal', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      const solution = await getSolution(page);

      await submitWord(page, solution);
      await waitForRowEvaluation(page);
      await waitForTileReveal(page, 0);

      // All tiles should be correct
      const states = await getRowTileStates(page, 0);
      expect(states).toEqual(['correct', 'correct', 'correct', 'correct', 'correct']);

      // Win toast should appear (one of the WIN_COMMENTS)
      const winComments = ['Genius', 'Magnificent', 'Impressive', 'Splendid', 'Great', 'Whew'];
      // Toast appears after tile animations complete; wait for it
      await page.waitForFunction(() => {
        const app = document.querySelector('game-app');
        return app.querySelector('#game-toaster game-toast') !== null;
      }, { timeout: 5000 });
      const toastText = await page.evaluate(() => {
        const app = document.querySelector('game-app');
        const toasts = app.querySelectorAll('#game-toaster game-toast');
        if (toasts.length === 0) return null;
        return toasts[0].getAttribute('text');
      });
      expect(winComments).toContain(toastText);

      // Stats modal should open after delay
      await page.waitForFunction(() => {
        const app = document.querySelector('game-app');
        const modal = app.querySelector('game-modal');
        return modal && modal.hasAttribute('open');
      }, { timeout: 5000 });
    });
  });

  // ─── 9. Loss Condition ────────────────────────────────────────────────────
  test.describe('Loss Condition', () => {
    test('after 6 wrong guesses, solution is shown and stats modal opens', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      const solution = await getSolution(page);

      // Pick 6 valid words that are NOT the solution
      const guesses = VALID_WORDS.filter(w => w !== solution).slice(0, 6);
      // If we don't have enough (unlikely), pad with more
      while (guesses.length < 6) {
        guesses.push('stare');
      }

      for (const guess of guesses) {
        await submitWord(page, guess);
        await waitForRowEvaluation(page);
      }

      // Game status should be FAIL
      const status = await page.evaluate(() => {
        return document.querySelector('game-app').gameStatus;
      });
      expect(status).toBe('FAIL');

      // Wait for the solution toast to appear (it's added after tile animations)
      await page.waitForFunction((expected) => {
        const app = document.querySelector('game-app');
        const toasts = app.querySelectorAll('#game-toaster game-toast');
        return Array.from(toasts).some(t => t.getAttribute('text') === expected);
      }, solution.toUpperCase(), { timeout: 10000 });

      // Solution should be shown in a toast (uppercase)
      const toastText = await page.evaluate(() => {
        const app = document.querySelector('game-app');
        const toasts = app.querySelectorAll('#game-toaster game-toast');
        for (const t of toasts) {
          if (t.getAttribute('text') === app.solution.toUpperCase()) return t.getAttribute('text');
        }
        return null;
      });
      expect(toastText).toBe(solution.toUpperCase());

      // Stats modal opens after delay
      await page.waitForFunction(() => {
        const app = document.querySelector('game-app');
        const modal = app.querySelector('game-modal');
        return modal && modal.hasAttribute('open');
      }, { timeout: 5000 });
    });
  });

  // ─── 9b. Toast Styling & Behavior ────────────────────────────────────────
  test.describe('Toast Styling', () => {
    test('toast has white-on-dark styling', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      await submitWord(page, 'zzzzz');

      const styles = await page.evaluate(() => {
        const app = document.querySelector('game-app');
        const toast = app.querySelector('#game-toaster game-toast');
        const toastDiv = toast.querySelector('.toast');
        const cs = getComputedStyle(toastDiv);
        return {
          backgroundColor: cs.backgroundColor,
          color: cs.color,
          fontWeight: cs.fontWeight
        };
      });

      // Dark background (--color-tone-1 = #1a1a1b in light mode)
      expect(styles.backgroundColor).toBe('rgb(26, 26, 27)');
      // White text (--color-tone-7 = #ffffff in light mode)
      expect(styles.color).toBe('rgb(255, 255, 255)');
      // Bold
      expect(styles.fontWeight).toBe('700');
    });

    test('toast auto-removes after default duration', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      await submitWord(page, 'zzzzz');

      // Toast should exist initially
      const hasToast = await page.evaluate(() => {
        const app = document.querySelector('game-app');
        return !!app.querySelector('#game-toaster game-toast');
      });
      expect(hasToast).toBe(true);

      // After default 1s duration + 300ms fade transition + buffer, toast should be gone
      await page.waitForFunction(() => {
        const app = document.querySelector('game-app');
        return !app.querySelector('#game-toaster game-toast');
      }, { timeout: 5000 });
    });
  });

  // ─── 10. UI Modals ────────────────────────────────────────────────────────
  test.describe('UI Modals', () => {
    test('help button opens help page and it can be closed', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      // Click help button
      await page.evaluate(() => {
        const app = document.querySelector('game-app');
        app.querySelector('#help-button').click();
      });

      // game-page should have [open] attribute
      await page.waitForFunction(() => {
        const app = document.querySelector('game-app');
        const gamePage = app.querySelector('game-page');
        return gamePage && gamePage.hasAttribute('open');
      }, { timeout: 3000 });

      // Close it by clicking the close icon
      await page.evaluate(() => {
        const app = document.querySelector('game-app');
        const gamePage = app.querySelector('game-page');
        const closeIcon = gamePage.querySelector('game-icon[icon="close"]');
        closeIcon.click();
      });

      // Wait for the page to close
      await page.waitForFunction(() => {
        const app = document.querySelector('game-app');
        const gamePage = app.querySelector('game-page');
        return gamePage && !gamePage.hasAttribute('open');
      }, { timeout: 3000 });
    });

    test('settings page shows 4 toggle switches with visible sliders', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      // Open settings
      await page.evaluate(() => {
        const app = document.querySelector('game-app');
        app.querySelector('#settings-button').click();
      });

      await page.waitForFunction(() => {
        const app = document.querySelector('game-app');
        const gamePage = app.querySelector('game-page');
        return gamePage && gamePage.hasAttribute('open');
      }, { timeout: 3000 });

      // Verify 3 game-switch elements exist with visible switch+knob structure
      const switchInfo = await page.evaluate(() => {
        const app = document.querySelector('game-app');
        const gamePage = app.querySelector('game-page');
        const settings = gamePage.querySelector('game-settings');
        const switches = settings.querySelectorAll('game-switch');
        return Array.from(switches).map(sw => {
          const switchDiv = sw.querySelector('.switch');
          const knob = sw.querySelector('.knob');
          return {
            id: sw.id,
            hasSwitchDiv: !!switchDiv,
            hasKnob: !!knob,
            switchVisible: switchDiv ? getComputedStyle(switchDiv).display !== 'none' : false,
            switchWidth: switchDiv ? getComputedStyle(switchDiv).width : '0px'
          };
        });
      });

      expect(switchInfo).toHaveLength(4);
      for (const sw of switchInfo) {
        expect(sw.hasSwitchDiv).toBe(true);
        expect(sw.hasKnob).toBe(true);
        expect(sw.switchVisible).toBe(true);
        expect(sw.switchWidth).toBe('32px');
      }
      expect(switchInfo.map(s => s.id)).toEqual([
        'hard-mode', 'dark-theme', 'color-blind-theme'
      ]);

      // Close settings
      await page.evaluate(() => {
        const app = document.querySelector('game-app');
        const gamePage = app.querySelector('game-page');
        const closeIcon = gamePage.querySelector('game-icon[icon="close"]');
        closeIcon.click();
      });

      await page.waitForFunction(() => {
        const app = document.querySelector('game-app');
        const gamePage = app.querySelector('game-page');
        return gamePage && !gamePage.hasAttribute('open');
      }, { timeout: 3000 });
    });

    test('settings button opens settings page and it can be closed', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      // Click settings button
      await page.evaluate(() => {
        const app = document.querySelector('game-app');
        app.querySelector('#settings-button').click();
      });

      // game-page should have [open] attribute
      await page.waitForFunction(() => {
        const app = document.querySelector('game-app');
        const gamePage = app.querySelector('game-page');
        return gamePage && gamePage.hasAttribute('open');
      }, { timeout: 3000 });

      // Close it
      await page.evaluate(() => {
        const app = document.querySelector('game-app');
        const gamePage = app.querySelector('game-page');
        const closeIcon = gamePage.querySelector('game-icon[icon="close"]');
        closeIcon.click();
      });

      await page.waitForFunction(() => {
        const app = document.querySelector('game-app');
        const gamePage = app.querySelector('game-page');
        return gamePage && !gamePage.hasAttribute('open');
      }, { timeout: 3000 });
    });

    test('statistics button opens stats modal and it can be closed', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      // Click statistics button
      await page.evaluate(() => {
        const app = document.querySelector('game-app');
        app.querySelector('#statistics-button').click();
      });

      // game-modal should have [open] attribute
      await page.waitForFunction(() => {
        const app = document.querySelector('game-app');
        const modal = app.querySelector('game-modal');
        return modal && modal.hasAttribute('open');
      }, { timeout: 3000 });

      // Close it by clicking the close icon inside game-modal
      await page.evaluate(() => {
        const app = document.querySelector('game-app');
        const modal = app.querySelector('game-modal');
        const closeIcon = modal.querySelector('game-icon[icon="close"]');
        closeIcon.click();
      });

      await page.waitForFunction(() => {
        const app = document.querySelector('game-app');
        const modal = app.querySelector('game-modal');
        return modal && !modal.hasAttribute('open');
      }, { timeout: 3000 });
    });
  });

  // ─── 11. Dark Mode ────────────────────────────────────────────────────────
  test.describe('Dark Mode', () => {
    test('toggling dark mode applies nightmode class', async ({ page }) => {
      await freshGame(page);
      await dismissHelpModal(page);

      // Open settings
      await page.evaluate(() => {
        const app = document.querySelector('game-app');
        app.querySelector('#settings-button').click();
      });

      await page.waitForFunction(() => {
        const app = document.querySelector('game-app');
        const gamePage = app.querySelector('game-page');
        return gamePage && gamePage.hasAttribute('open');
      }, { timeout: 3000 });

      // Find and click the dark mode toggle
      // game-settings contains game-switch elements; the dark theme switch
      // dispatches a game-setting-change event that triggers theme manager
      await page.evaluate(() => {
        const app = document.querySelector('game-app');
        const gamePage = app.querySelector('game-page');
        const settings = gamePage.querySelector('game-settings');
        const darkSwitch = settings.querySelector('#dark-theme');
        const container = darkSwitch.querySelector('.container');
        container.click();
      });

      // Check that nightmode class is applied to body
      const hasNightmode = await page.evaluate(() => {
        return document.body.classList.contains('nightmode');
      });
      expect(hasNightmode).toBe(true);
    });
  });

});
