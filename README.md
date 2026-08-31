# local_wordle

## Local Development

Install the locked development dependencies and start the frontend server:

```zsh
npm ci
npx serve . -l 3000 --no-clipboard
```

The frontend is available at `http://localhost:3000`. Its default local API
configuration points to `http://localhost:9292`. Start `left_wordle_api`:

```zsh
rv run bundle exec rackup
```

The frontend origin must be in the API's CORS allow list. That list is read
from `api/config/app_config.yml` (`cors_origins:`) — there is no environment
variable for it.

Deployment-specific API settings live in `app_config.js`, which merges a
per-deployment override over its defaults. Gameplay is evaluated in the
browser: the app fetches one encrypted answer per game from
`/api/v1/game/answer`, decrypts it, and evaluates every guess locally.
`/api/v1/game/guess` is used only to compute remaining-answer counts.

## Tests

```zsh
npm test          # jest unit tests
npm run test:e2e  # playwright end-to-end tests
./test_runner.sh  # lint + unit + e2e, output tee'd to tmp/
```

The e2e suite drives the real app, so **the API must be running on 9292** —
without it the puzzle answer never loads and the gameplay tests fail. The
passkey spec additionally needs its own API instance and skips itself when
that isn't reachable; see the header comment in `e2e/passkey_login.spec.js`.

[wordle](https://www.powerlanguage.co.uk/wordle/), with a save and load button added, made into a single file (from `/src`) using [monolith](https://github.com/Y2Z/monolith)

mostly just unminifying the existing code, using some patterns from the original html/css, and exporting and loading the localStorage 'statistics' object.

# Exporting existing wordle stats

From the [wordle page](https://www.powerlanguage.co.uk/wordle/), Open your browser console (right click, inspect element or tools, open console or something), then load your stats like this:

**NYT Version**
```javascript
JSON.parse(window.localStorage.getItem('nyt-wordle-statistics'))
```

**Original Version**

```javascript
JSON.parse(window.localStorage.getItem('statistics'))
```

They should look something like this

```json
{
  "currentStreak": 0,
  "maxStreak": 0,
  "guesses": {
    "1": 1000,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
    "6": 0,
    "fail": 0
  },
  "winPercentage": 0,
  "gamesPlayed": 0,
  "gamesWon": 0,
  "averageGuesses": 0
}

```

and then copy the object into a text editor, save as `.json`
