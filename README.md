# Browser Test Scanner

Scans git repositories for WebdriverIO and Cypress tests and outputs JSON files listing all test suites and test cases, grouped by spec file.

## Scripts

| Script | Purpose | Default output |
|---|---|---|
| `list-wdio-tests.js` | Scan a single repo for WebdriverIO tests | `wdio-tests.json` |
| `list-cypress-tests.js` | Scan a single repo for Cypress tests | `cypress-tests.json` |
| `scan-repos.js` | Scan multiple repos, auto-detect framework | `results/` directory |

## Single repo

```bash
node list-wdio-tests.js <repo-url-or-path> [--output <file>]
node list-cypress-tests.js <repo-url-or-path> [--output <file>]
```

### Examples

```bash
# WebdriverIO tests from a remote Gerrit repo
node list-wdio-tests.js https://gerrit.wikimedia.org/r/mediawiki/extensions/CampaignEvents

# Cypress tests from a remote Gerrit repo
node list-cypress-tests.js https://gerrit.wikimedia.org/r/mediawiki/extensions/GrowthExperiments

# Local repo with custom output file
node list-wdio-tests.js ./my-project --output my-tests.json
```

### Output

Results are grouped by spec file. Each file maps its `describe()` blocks to arrays of `it()` test names. Nested describes are joined with ` > `.

```json
{
  "repository": "https://gerrit.wikimedia.org/r/mediawiki/extensions/CampaignEvents",
  "generatedAt": "2026-03-13T20:33:40.255Z",
  "totalFiles": 4,
  "totalSuites": 4,
  "totalTests": 12,
  "tests": {
    "tests/selenium/specs/editEventRegistration.js": {
      "Edit Event Registration": [
        "can allow organizer to update event page and dates",
        "can allow organizer to change the event to be in person",
        "can allow organizer to change the event to be online and in-person",
        "can allow organizer to add an additional organizer"
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

## Batch scanning

Scan multiple repos at once. Create a text file with one repo URL per line (lines starting with `#` are comments):

```
# repos.txt
https://gerrit.wikimedia.org/r/mediawiki/core
https://gerrit.wikimedia.org/r/mediawiki/extensions/CampaignEvents
https://gerrit.wikimedia.org/r/mediawiki/extensions/GrowthExperiments
https://gerrit.wikimedia.org/r/mediawiki/extensions/WikiLambda
```

Then run:

```bash
node scan-repos.js repos.txt
node scan-repos.js repos.txt --output-dir my-results/
```

This auto-detects whether each repo uses WebdriverIO, Cypress, both, or neither, then runs the appropriate scanner. Output goes to `results/` by default:

```
results/
  summary.json                                          # Overview of all repos
  gerrit_wikimedia_org_r_mediawiki_core_wdio.json       # Per-repo test listings
  gerrit_wikimedia_org_r_mediawiki_extensions_GrowthExperiments_cypress.json
  ...
```

The `summary.json` includes counts per repo and totals:

```json
{
  "generatedAt": "2026-03-13T20:26:12.576Z",
  "totalRepos": 4,
  "withWdio": 3,
  "withCypress": 1,
  "withBoth": 0,
  "withNone": 0,
  "repos": [
    {
      "repository": "https://gerrit.wikimedia.org/r/mediawiki/core",
      "wdio": { "totalFiles": 10, "totalSuites": 10, "totalTests": 23 },
      "framework": "wdio"
    }
  ]
}
```

## Project structure

```
parser.js              # Shared parsing, API providers, and utility functions
list-wdio-tests.js     # WebdriverIO test scanner
list-cypress-tests.js  # Cypress test scanner
scan-repos.js          # Batch scanner with auto-detection
repos.example.txt      # Example repo list
```

## Requirements

- Node.js (no additional dependencies)
