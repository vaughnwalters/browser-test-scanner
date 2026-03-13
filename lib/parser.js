'use strict';

const fs = require( 'fs' );
const path = require( 'path' );
const { execSync } = require( 'child_process' );
const os = require( 'os' );

/**
 * Parse command-line arguments.
 *
 * @param {string} defaultOutput - Default output filename
 * @return {Object} Parsed arguments with repoUrl and outputFile
 */
function parseArgs( defaultOutput ) {
	const args = process.argv.slice( 2 );
	const scriptName = path.basename( process.argv[ 1 ] );

	if ( args.length === 0 || args.includes( '--help' ) || args.includes( '-h' ) ) {
		console.log( `Usage: node ${ scriptName } <repo-url-or-path> [--output <file>]

Arguments:
  repo-url-or-path   Git repository URL or local directory path
  --output, -o       Output JSON file path (default: ${ defaultOutput })

Examples:
  node ${ scriptName } https://gerrit.wikimedia.org/r/mediawiki/extensions/CampaignEvents
  node ${ scriptName } ./my-project --output my-tests.json` );
		process.exit( args.length === 0 ? 1 : 0 );
	}

	let repoUrl = null;
	let outputFile = defaultOutput;

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
	const tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'test-scan-' ) );
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
 * Resolve the repo path, cloning if necessary.
 *
 * @param {string} repoUrl - Repository URL or local path
 * @return {{ repoPath: string, isCloned: boolean }}
 */
function resolveRepo( repoUrl ) {
	if ( isRemoteUrl( repoUrl ) ) {
		return { repoPath: cloneRepo( repoUrl ), isCloned: true };
	}

	const repoPath = path.resolve( repoUrl );
	if ( !fs.existsSync( repoPath ) ) {
		console.error( `Error: path does not exist: ${ repoPath }` );
		process.exit( 1 );
	}

	return { repoPath, isCloned: false };
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
 * Find spec files in a list of directories, filtering out non-test files.
 *
 * @param {string} repoPath - Repository root path
 * @param {string[]} dirs - Directories to scan (relative to repoPath)
 * @param {Object} [options] - Additional options
 * @param {RegExp} [options.extraExclude] - Extra basename pattern to exclude
 * @return {Set<string>} Set of matching file paths
 */
function findSpecsInDirs( repoPath, dirs, options = {} ) {
	const plainJsPattern = /\.(js|ts|mjs|cjs|jsx|tsx)$/;
	const specFiles = new Set();

	for ( const dir of dirs ) {
		const fullDir = path.join( repoPath, dir );
		if ( fs.existsSync( fullDir ) ) {
			const files = findFiles( fullDir, plainJsPattern );
			for ( const file of files ) {
				const basename = path.basename( file ).toLowerCase();
				const relPath = path.relative( repoPath, file ).toLowerCase();
				const inPageObjectDir = relPath.includes( 'pageobject' );
				if (
					!inPageObjectDir &&
					!basename.includes( 'util' ) &&
					!basename.includes( 'helper' ) &&
					!basename.includes( 'fixture' ) &&
					!basename.includes( 'command' ) &&
					!basename.includes( 'support' ) &&
					!basename.startsWith( 'wdio.' ) &&
					!basename.startsWith( 'cypress.' ) &&
					!basename.startsWith( '.' ) &&
					basename !== 'package.json' &&
					basename !== 'index.js' &&
					basename !== 'index.ts' &&
					( !options.extraExclude || !options.extraExclude.test( basename ) )
				) {
					specFiles.add( file );
				}
			}
		}
	}

	return specFiles;
}

/**
 * Parse a test file to extract describe/it blocks.
 * Works for any framework using Mocha-style describe/it syntax
 * (WebdriverIO, Cypress, Jest, Mocha).
 *
 * @param {string} filePath - Path to the test file
 * @param {Function} [filter] - Optional function to validate file content
 * @return {Object|null} Parsed test structure, or null if filtered out
 */
function parseTestFile( filePath, filter ) {
	const content = fs.readFileSync( filePath, 'utf-8' );
	const lines = content.split( '\n' );

	if ( filter && !filter( content, filePath ) ) {
		return null;
	}

	const suites = [];
	const suiteStack = [];

	for ( let i = 0; i < lines.length; i++ ) {
		const line = lines[ i ];
		const lineNumber = i + 1;

		// Match describe/context blocks
		const describeMatch = line.match(
			/\b((?:describe|context)(?:\.(?:only|skip))?)\s*\(\s*(['"`])((?:(?!\2).)*)\2/
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

		// Match it/specify blocks
		const itMatch = line.match(
			/\b((?:it|specify)(?:\.(?:only|skip))?)\s*\(\s*(['"`])((?:(?!\2).)*)\2/
		);
		if ( itMatch ) {
			const test = {
				name: itMatch[ 3 ],
				line: lineNumber
			};

			if ( suiteStack.length > 0 ) {
				suiteStack[ suiteStack.length - 1 ].tests.push( test );
			} else {
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

		// Track closing braces to pop the suite stack
		if ( suiteStack.length > 0 ) {
			const closeMatch = line.match( /^(\s*)\}\s*\)\s*;?\s*$/ );
			if ( closeMatch ) {
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
 * Build the tests map from parsed spec files.
 *
 * @param {string[]} specFiles - Array of spec file paths
 * @param {Function} [filter] - Optional filter for parseTestFile
 * @return {{ tests: Object, totalTests: number, totalSuites: number }}
 */
function buildTestMap( specFiles, filter ) {
	const tests = {};
	let totalTests = 0;

	for ( const specFile of specFiles ) {
		const parsed = parseTestFile( specFile, filter );
		if ( parsed && parsed.suites.length > 0 ) {
			const flattened = flattenSuites( parsed.suites );
			Object.assign( tests, flattened );
			for ( const names of Object.values( flattened ) ) {
				totalTests += names.length;
			}
		}
	}

	return {
		tests,
		totalTests,
		totalSuites: Object.keys( tests ).length
	};
}

/**
 * Write the JSON output file.
 *
 * @param {string} outputFile - Output file path
 * @param {Object} output - JSON output object
 */
function writeOutput( outputFile, output ) {
	const outputPath = path.resolve( outputFile );
	fs.writeFileSync( outputPath, JSON.stringify( output, null, 2 ) + '\n' );
	console.log( `\nResults written to ${ outputPath }` );
	console.log( `Summary: ${ output.totalSuites } suite(s), ${ output.totalTests } test(s)` );
}

module.exports = {
	parseArgs,
	resolveRepo,
	cleanupDir,
	findFiles,
	findSpecsInDirs,
	parseTestFile,
	flattenSuites,
	buildTestMap,
	writeOutput
};
