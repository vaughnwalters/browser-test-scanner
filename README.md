# Browser Test Scanner

Scans git repositories for WebdriverIO and Cypress tests and outputs JSON files mapping describe blocks to test names.

## Scripts

| Script | Detects | Default output |
|---|---|---|
| `list-wdio-tests.js` | WebdriverIO / Selenium tests | `wdio-tests.json` |
| `list-cypress-tests.js` | Cypress tests | `cypress-tests.json` |

## Usage

```bash
node list-wdio-tests.js <repo-url-or-path> [--output <file>]
node list-cypress-tests.js <repo-url-or-path> [--output <file>]
```

### Arguments

| Argument | Description |
|---|---|
| `repo-url-or-path` | Git repository URL or local directory path |
| `--output`, `-o` | Output JSON file path |

### Examples

```bash
# WebdriverIO tests from a remote repo
node list-wdio-tests.js https://gerrit.wikimedia.org/r/mediawiki/extensions/CampaignEvents

# Cypress tests from a remote repo
node list-cypress-tests.js https://gerrit.wikimedia.org/r/mediawiki/extensions/GrowthExperiments

# Local repo with custom output
node list-wdio-tests.js ./my-project --output my-tests.json
```

## Output

Each script produces a JSON file like this:

```json
{
  "repository": "https://gerrit.wikimedia.org/r/mediawiki/extensions/CampaignEvents",
  "generatedAt": "2026-03-13T16:12:44.946Z",
  "totalSuites": 4,
  "totalTests": 12,
  "tests": {
    "Edit Event Registration": [
      "can allow organizer to update event page and dates",
      "can allow organizer to change the event to be in person",
      "can allow organizer to change the event to be online and in-person",
      "can allow organizer to add an additional organizer"
    ],
    "Enable Event Registration @daily": [
      "is configured correctly",
      "requires event data",
      "can be enabled"
    ]
  }
}
```

Each key in `tests` is the `describe()` block name. Each value is an array of `it()` test names. Nested describes are joined with ` > `.

## Project structure

```
lib/parser.js          # Shared parsing and utility functions
list-wdio-tests.js     # WebdriverIO test scanner
list-cypress-tests.js  # Cypress test scanner
```

## Requirements

- Node.js (no additional dependencies)
- Git (for cloning remote repos)
