#!/usr/bin/env node

/**
 * Scans a git repository for WebdriverIO tests and outputs a JSON file
 * listing all test suites and individual test cases.
 *
 * Usage:
 *   node list-wdio-tests.js <repo-url-or-local-path> [--output <file>]
 *
 * Examples:
 *   node list-wdio-tests.js https://gerrit.wikimedia.org/r/mediawiki/extensions/CampaignEvents
 *   node list-wdio-tests.js /path/to/local/repo
 *   node list-wdio-tests.js https://github.com/user/repo --output results.json
 */

'use strict';

const fs = require( 'fs' );
const path = require( 'path' );
const { execSync } = require( 'child_process' );
const os = require( 'os' );

/**
 * Parse command-line arguments.
 *
 * @return {Object} Parsed arguments with repoUrl and outputFile
 */
function parseArgs() {
	const args = process.argv.slice( 2 );

	if ( args.length === 0 || args.includes( '--help' ) || args.includes( '-h' ) ) {
		console.log( `Usage: node ${ path.basename( process.argv[ 1 ] ) } <repo-url-or-path> [--output <file>]

Arguments:
  repo-url-or-path   Git repository URL or local directory path
  --output, -o       Output JSON file path (default: wdio-tests.json)

Examples:
  node list-wdio-tests.js https://gerrit.wikimedia.org/r/mediawiki/extensions/CampaignEvents
  node list-wdio-tests.js ./my-project --output my-tests.json` );
		process.exit( args.length === 0 ? 1 : 0 );
	}

	let repoUrl = null;
	let outputFile = 'wdio-tests.json';

	for ( let i = 0; i < args.length; i++ ) {
		if ( args[ i ] === '--output' || args[ i ] === '-o' ) {
			i++;
			if ( i < args.length ) {
				outputFile = args[ i ];
			} else {
				console.error( 'Error: --output requires a file path argument' );
				process.exit( 1 );
			}
		} else if ( !repoUrl ) {
			repoUrl = args[ i ];
		}
	}

	if ( !repoUrl ) {
		console.error( 'Error: repository URL or path is required' );
		process.exit( 1 );
	}

	return { repoUrl, outputFile };
}

/**
 * Determine if the input is a URL (needs cloning) or a local path.
 *
 * @param {string} input - Repository URL or local path
 * @return {boolean}
 */
function isRemoteUrl( input ) {
	return /^https?:\/\//.test( input ) ||
		/^git@/.test( input ) ||
		/^ssh:\/\//.test( input ) ||
		/^git:\/\//.test( input );
}

/**
 * Clone a remote repository to a temporary directory.
 *
 * @param {string} url - Repository URL
 * @return {string} Path to the cloned repository
 */
function cloneRepo( url ) {
	const tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'wdio-scan-' ) );
	console.log( `Cloning ${ url } into ${ tmpDir }...` );

	try {
		execSync( `git clone --depth 1 "${ url }" "${ tmpDir }"`, {
			stdio: [ 'pipe', 'pipe', 'pipe' ]
		} );
	} catch ( e ) {
		console.error( `Error cloning repository: ${ e.stderr?.toString() || e.message }` );
		cleanupDir( tmpDir );
		process.exit( 1 );
	}

	return tmpDir;
}

/**
 * Remove a temporary directory.
 *
 * @param {string} dirPath - Directory to remove
 */
function cleanupDir( dirPath ) {
	try {
		fs.rmSync( dirPath, { recursive: true, force: true } );
	} catch {
		// Best-effort cleanup
	}
}

/**
 * Recursively find files matching a pattern.
 *
 * @param {string} dir - Directory to search
 * @param {RegExp} pattern - Filename pattern to match
 * @param {Array} results - Accumulator for results
 * @return {string[]} Matching file paths
 */
function findFiles( dir, pattern, results = [] ) {
	let entries;
	try {
		entries = fs.readdirSync( dir, { withFileTypes: true } );
	} catch {
		return results;
	}

	for ( const entry of entries ) {
		const fullPath = path.join( dir, entry.name );

		if ( entry.isDirectory() ) {
			// Skip node_modules, vendor, .git directories
			if ( [ 'node_modules', 'vendor', '.git' ].includes( entry.name ) ) {
				continue;
			}
			findFiles( fullPath, pattern, results );
		} else if ( pattern.test( entry.name ) ) {
			results.push( fullPath );
		}
	}

	return results;
}

/**
 * Find WebdriverIO configuration files in the repo.
 *
 * @param {string} repoPath - Repository root path
 * @return {string[]} Paths to wdio config files
 */
function findWdioConfigs( repoPath ) {
	return findFiles( repoPath, /^wdio\.conf\.(js|ts|mjs|cjs)$/ );
}

/**
 * Find WebdriverIO spec/test files by scanning common locations.
 *
 * @param {string} repoPath - Repository root path
 * @return {string[]} Paths to test spec files
 */
function findSpecFiles( repoPath ) {
	const specPattern = /\.(spec|test)\.(js|ts|mjs|cjs)$/;
	const plainJsPattern = /\.(js|ts|mjs|cjs)$/;

	const specFiles = new Set();

	// 1. Look in common WebdriverIO/Selenium test directories
	const seleniumDirs = [
		'tests/selenium/specs',
		'tests/selenium',
		'test/selenium/specs',
		'test/selenium',
		'tests/e2e/specs',
		'tests/e2e',
		'test/e2e/specs',
		'test/e2e',
		'tests/wdio/specs',
		'tests/wdio',
		'test/wdio/specs',
		'test/wdio',
		'tests/browser',
		'test/browser',
		'selenium',
		'e2e',
		'specs'
	];

	for ( const dir of seleniumDirs ) {
		const fullDir = path.join( repoPath, dir );
		if ( fs.existsSync( fullDir ) ) {
			const files = findFiles( fullDir, plainJsPattern );
			for ( const file of files ) {
				// Exclude page objects, utilities, and config files
				const basename = path.basename( file ).toLowerCase();
				const relPath = path.relative( repoPath, file ).toLowerCase();
				const inPageObjectDir = relPath.includes( 'pageobject' );
				if (
					!inPageObjectDir &&
					!basename.includes( 'util' ) &&
					!basename.includes( 'helper' ) &&
					!basename.includes( 'fixture' ) &&
					!basename.startsWith( 'wdio.' ) &&
					!basename.startsWith( '.' ) &&
					basename !== 'package.json'
				) {
					specFiles.add( file );
				}
			}
		}
	}

	// 2. Also search the whole repo for .spec.js/.test.js files that reference
	//    WebdriverIO (browser global, wdio imports)
	const allSpecFiles = findFiles( repoPath, specPattern );
	for ( const file of allSpecFiles ) {
		const relativePath = path.relative( repoPath, file ).toLowerCase();
		// Skip jest, qunit, phpunit, api-testing directories
		if (
			!relativePath.includes( 'jest' ) &&
			!relativePath.includes( 'qunit' ) &&
			!relativePath.includes( 'phpunit' ) &&
			!relativePath.includes( 'api-testing' ) &&
			!relativePath.includes( 'node_modules' )
		) {
			specFiles.add( file );
		}
	}

	return Array.from( specFiles );
}

/**
 * Parse a test file to extract describe/it blocks.
 * Handles nested describe blocks and extracts tags like @daily.
 *
 * @param {string} filePath - Path to the test file
 * @return {Object} Parsed test structure
 */
function parseTestFile( filePath ) {
	const content = fs.readFileSync( filePath, 'utf-8' );
	const lines = content.split( '\n' );

	// Verify this looks like a WebdriverIO test (has browser/wdio references,
	// or is in a selenium directory)
	const isWdioTest = /(?:browser\.|wdio-mediawiki|@wdio\/|webdriverio|import.*from\s+['"]wdio)/i.test( content ) ||
		filePath.includes( 'selenium' ) ||
		filePath.includes( 'wdio' ) ||
		filePath.includes( 'e2e' );

	if ( !isWdioTest ) {
		return null;
	}

	// Parse describe and it blocks
	const suites = [];
	const suiteStack = [];

	for ( let i = 0; i < lines.length; i++ ) {
		const line = lines[ i ];
		const lineNumber = i + 1;

		// Match describe blocks: describe( 'name', ... ) or describe.only( 'name', ... )
		const describeMatch = line.match(
			/\b(describe(?:\.(?:only|skip))?)\s*\(\s*(['"`])((?:(?!\2).)*)\2/
		);
		if ( describeMatch ) {
			const suite = {
				name: describeMatch[ 3 ],
				line: lineNumber,
				tests: [],
				nestedSuites: []
			};

			if ( suiteStack.length > 0 ) {
				suiteStack[ suiteStack.length - 1 ].nestedSuites.push( suite );
			} else {
				suites.push( suite );
			}
			suiteStack.push( suite );
		}

		// Match it blocks: it( 'name', ... ) or it.only( 'name', ... )
		const itMatch = line.match(
			/\b(it(?:\.(?:only|skip))?)\s*\(\s*(['"`])((?:(?!\2).)*)\2/
		);
		if ( itMatch ) {
			const test = {
				name: itMatch[ 3 ],
				line: lineNumber
			};

			if ( suiteStack.length > 0 ) {
				suiteStack[ suiteStack.length - 1 ].tests.push( test );
			} else {
				// Orphan it block (no describe wrapper)
				if ( suites.length === 0 ) {
					suites.push( {
						name: '(top-level)',
						line: lineNumber,
						tests: [],
						nestedSuites: []
					} );
				}
				suites[ suites.length - 1 ].tests.push( test );
			}
		}

		// Track closing braces to pop the suite stack.
		// This is a heuristic: we look for `} );` patterns that close
		// describe blocks. Not perfect, but reliable for standard formatting.
		if ( suiteStack.length > 0 ) {
			const closeMatch = line.match( /^(\s*)\}\s*\)\s*;?\s*$/ );
			if ( closeMatch ) {
				// Use indentation to figure out if this closes a describe.
				// The describe's opening line should have the same or less indentation.
				const currentSuite = suiteStack[ suiteStack.length - 1 ];
				const descLine = lines[ currentSuite.line - 1 ];
				const descIndent = descLine.match( /^(\s*)/ )[ 1 ].length;
				const closeIndent = closeMatch[ 1 ].length;

				if ( closeIndent <= descIndent ) {
					suiteStack.pop();
				}
			}
		}
	}

	return { suites };
}

/**
 * Flatten suites into a human-readable map of describe name -> test names.
 * Nested describes are joined with " > ".
 *
 * @param {Object[]} suites - Array of suite objects
 * @param {string} [prefix] - Parent suite name prefix
 * @return {Object} Map of suite name to array of test names
 */
function flattenSuites( suites, prefix ) {
	const result = {};

	for ( const suite of suites ) {
		const suiteName = prefix ? `${ prefix } > ${ suite.name }` : suite.name;

		if ( suite.tests.length > 0 ) {
			result[ suiteName ] = suite.tests.map( ( t ) => t.name );
		}

		if ( suite.nestedSuites && suite.nestedSuites.length > 0 ) {
			Object.assign( result, flattenSuites( suite.nestedSuites, suiteName ) );
		}
	}

	return result;
}

/**
 * Main entry point.
 */
function main() {
	const { repoUrl, outputFile } = parseArgs();

	let repoPath;
	let isCloned = false;

	if ( isRemoteUrl( repoUrl ) ) {
		repoPath = cloneRepo( repoUrl );
		isCloned = true;
	} else {
		repoPath = path.resolve( repoUrl );
		if ( !fs.existsSync( repoPath ) ) {
			console.error( `Error: path does not exist: ${ repoPath }` );
			process.exit( 1 );
		}
	}

	try {
		// Find wdio configs
		const wdioConfigs = findWdioConfigs( repoPath );
		console.log( `Found ${ wdioConfigs.length } WebdriverIO config(s)` );

		// Find test spec files
		const specFiles = findSpecFiles( repoPath );
		console.log( `Found ${ specFiles.length } potential test file(s)` );

		// Parse each spec file and build human-readable output
		const tests = {};
		let totalTests = 0;

		for ( const specFile of specFiles ) {
			const parsed = parseTestFile( specFile );
			if ( parsed && parsed.suites.length > 0 ) {
				const flattened = flattenSuites( parsed.suites );
				Object.assign( tests, flattened );
				for ( const names of Object.values( flattened ) ) {
					totalTests += names.length;
				}
			}
		}

		const suiteNames = Object.keys( tests );

		// Build the output
		const output = {
			repository: repoUrl,
			generatedAt: new Date().toISOString(),
			totalSuites: suiteNames.length,
			totalTests,
			tests
		};

		// Write JSON
		const outputPath = path.resolve( outputFile );
		fs.writeFileSync( outputPath, JSON.stringify( output, null, 2 ) + '\n' );
		console.log( `\nResults written to ${ outputPath }` );
		console.log( `Summary: ${ suiteNames.length } suite(s), ${ totalTests } test(s)` );
	} finally {
		if ( isCloned ) {
			console.log( 'Cleaning up temporary clone...' );
			cleanupDir( repoPath );
		}
	}
}

main();
