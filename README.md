# Browser Test Scanner

Scans git repositories for browser tests (WebdriverIO, Cypress) and outputs JSON files listing all test suites and test cases, grouped by spec file.

All results are written to the `results/` directory.

## Single repo

```bash
node scan.js <repo-url-or-path>
```

### Examples

```bash
node scan.js https://gerrit.wikimedia.org/r/mediawiki/extensions/CampaignEvents
# -> results/gerrit_wikimedia_org_r_mediawiki_extensions_CampaignEvents_tests.json

node scan.js ./my-project
# -> results/my-project_tests.json

# Custom output path
node scan.js https://gerrit.wikimedia.org/r/mediawiki/core --output custom.json
```

### Output

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

## Batch scanning

Create a text file with one repo URL per line (lines starting with `#` are comments):

```
# repos.txt
https://gerrit.wikimedia.org/r/mediawiki/core
https://gerrit.wikimedia.org/r/mediawiki/extensions/CampaignEvents
https://gerrit.wikimedia.org/r/mediawiki/extensions/GrowthExperiments
```

Then run:

```bash
node scan-repos.js repos.txt
```

This scans each repo and writes a `summary.json` alongside per-repo results:

```
results/
  summary.json
  gerrit_wikimedia_org_r_mediawiki_core_tests.json
  gerrit_wikimedia_org_r_mediawiki_extensions_CampaignEvents_tests.json
  gerrit_wikimedia_org_r_mediawiki_extensions_GrowthExperiments_tests.json
```

## Project structure

```
scan.js            # Scan a single repo
scan-repos.js      # Scan multiple repos from a list
parser.js          # Shared parsing, API providers, and utilities
repos.example.txt  # Example repo list
```

## Requirements

- Node.js (no additional dependencies)
