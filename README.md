# Browser Test Scanner

Scans Gerrit repositories for browser tests (WebdriverIO, Cypress) and outputs JSON files listing all test suites and test cases, grouped by spec file.

All results are written to the `results/` directory.

## Usage

Scan all repos and generate the wikitext listing:

```bash
node scan.js && node wikitext.js
```

### Scan

`scan.js` reads `repos.txt` and scans every repo in it:

```bash
node scan.js
```

Each repo gets its own JSON file in `results/`, along with a `summary.json`:

```
results/
  summary.json
  mediawiki_core_tests.json
  mediawiki_extensions_CampaignEvents_tests.json
  mediawiki_extensions_GrowthExperiments_tests.json
```

Edit `repos.txt` to add or remove repos. One URL per line, lines starting with `#` are comments.

### Generate wikitext

`wikitext.js` reads the JSON results from `scan.js` and generates a wikitext file listing all tests grouped by Core, Extensions, Skins, and Wikibase. Requires `scan.js` to be run first.

```bash
node wikitext.js
# -> results/browser-tests.wiki
```

## Output format

### scan.js

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

### wikitext.js

Tests are listed under headings grouped by Core, Extensions, Skins, and Wikibase:

```
== Extensions ==

=== CampaignEvents (wdio) ===

* Edit Event Registration > can allow organizer to update event page and dates
* Edit Event Registration > can allow organizer to change the event to be in person
* Enable Event Registration @daily > is configured correctly
* Enable Event Registration @daily > requires event data
* Enable Event Registration @daily > can be enabled
```

## Project structure

```
scan.js            # Scan all repos in repos.txt
wikitext.js        # Generate wikitext from scan results
parser.js          # Gitiles API, test parsing, and utilities
repos.txt          # List of repos to scan for tests
```

## Requirements

- Node.js (no additional dependencies)
