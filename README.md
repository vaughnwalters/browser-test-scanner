# Browser Test Scanner

Scans Gerrit repositories for browser tests (WebdriverIO, Cypress) and outputs JSON files listing all test suites and test cases, grouped by spec file.

All results are written to the `results/` directory.

## Usage

By default, `scan.js` reads `repos.txt` and scans every repo in it:

```bash
node scan.js
```

Each repo gets its own JSON file in `results/`, along with a `summary.json` and a `browser-tests.wiki` that lists every test grouped by Core, Extensions, Skins, and Wikibase:

```
results/
  summary.json
  browser-tests.wiki
  mediawiki_core_tests.json
  mediawiki_extensions_CampaignEvents_tests.json
  mediawiki_extensions_GrowthExperiments_tests.json
```

Edit `repos.txt` to add or remove repos. One URL per line, lines starting with `#` are comments.

## Single repo

To scan just one repo at a time:

```bash
node scan.js <repo-url>
```

```bash
node scan.js https://gerrit.wikimedia.org/r/mediawiki/extensions/CampaignEvents
# -> results/mediawiki_extensions_CampaignEvents_tests.json
```

## Output format

Results are grouped by spec file. Each file maps its `describe()` blocks to arrays of `it()` test names. Nested describes are joined with ` > `.

```json
{
  "repository": "https://gerrit.wikimedia.org/r/mediawiki/extensions/CampaignEvents",
  "generatedAt": "2026-03-13T21:43:09.521Z",
  "totalFiles": 4,
  "totalSuites": 4,
  "totalTests": 12,
  "tests": {
    "tests/selenium/specs/editEventRegistration.js": {
      "Edit Event Registration": [
        "can allow organizer to update event page and dates",
        "can allow organizer to change the event to be in person"
      ]
    },
    "tests/selenium/specs/enableEventRegistration.js": {
      "Enable Event Registration @daily": [
        "is configured correctly",
        "requires event data",
        "can be enabled"
      ]
    }
  }
}
```

## Project structure

```
scan.js            # Scan all repos (default) or a single repo
parser.js          # Gitiles API, test parsing, and utilities
repos.txt          # Default repo list
```

## Requirements

- Node.js (no additional dependencies)
