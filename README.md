# local_wordle

## Local Development

Install the locked development dependencies and start the frontend server:

```zsh
npm ci
npx serve . -l 3000 --no-clipboard
```

The frontend is available at `http://localhost:3000`. Its default local API
configuration points to `http://localhost:9292`. Start `left_wordle_api` with
the frontend origin in its CORS allow list:

```zsh
CORS_ORIGINS=http://localhost:3000 rv run bundle exec rackup
```

Deployment-specific API settings and feature flags live in `app_config.js`.
API gameplay remains locally authoritative. Shadow mode defaults on for local
development and off for deployed hosts; it compares API evaluations in the
background without changing the result shown to the player.

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
