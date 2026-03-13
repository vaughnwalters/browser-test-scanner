# wdio-test-scanner

Scans a git repository for WebdriverIO tests and outputs a JSON file mapping describe blocks to test names.

## Usage

```bash
node list-wdio-tests.js <repo-url-or-path> [--output <file>]
```

### Arguments

| Argument | Description |
|---|---|
| `repo-url-or-path` | Git repository URL or local directory path |
| `--output`, `-o` | Output JSON file path (default: `wdio-tests.json`) |

### Examples

```bash
# Scan a remote repo (clones, scans, cleans up automatically)
node list-wdio-tests.js https://gerrit.wikimedia.org/r/mediawiki/extensions/CampaignEvents

# Scan a local repo
node list-wdio-tests.js /path/to/my/project

# Scan current directory with custom output file
node list-wdio-tests.js . --output my-tests.json
```

## Output

The script produces a JSON file like this:

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
    ],
    "Event page": [
      "can have one user register publicly",
      "can have one user register privately",
      "can have a user cancel registration"
    ],
    "MyEvents": [
      "can allow organizer to search events by name",
      "can allow organizer to delete registration of first event in My Events"
    ]
  }
}
```

Each key in `tests` is the `describe()` block name. Each value is an array of `it()` test names. Nested describes are joined with ` > `.

## What it detects

- WebdriverIO config files (`wdio.conf.js`, `.ts`, `.mjs`, `.cjs`)
- Test specs in common directories (`tests/selenium/specs`, `tests/e2e`, `tests/wdio`, etc.)
- Mocha-style `describe()` / `it()` blocks, including nested suites
- Works with both ES module `import` and CommonJS `require` style tests

## Requirements

- Node.js (no additional dependencies)
- Git (for cloning remote repos)
