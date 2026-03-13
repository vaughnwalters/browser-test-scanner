'use strict';

const fs = require( 'fs' );
const path = require( 'path' );
const https = require( 'https' );

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

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a URL and return the response body as a string.
 *
 * @param {string} url - URL to fetch
 * @return {Promise<string>} Response body
 */
function httpGet( url ) {
	return new Promise( ( resolve, reject ) => {
		https.get( url, { headers: { 'User-Agent': 'browser-test-scanner' } }, ( res ) => {
			if ( res.statusCode >= 300 && res.statusCode < 400 && res.headers.location ) {
				return httpGet( res.headers.location ).then( resolve, reject );
			}
			if ( res.statusCode !== 200 ) {
				res.resume();
				return reject( new Error( `HTTP ${ res.statusCode } for ${ url }` ) );
			}
			const chunks = [];
			res.on( 'data', ( chunk ) => chunks.push( chunk ) );
			res.on( 'end', () => resolve( Buffer.concat( chunks ).toString() ) );
			res.on( 'error', reject );
		} ).on( 'error', reject );
	} );
}

// ---------------------------------------------------------------------------
// Remote provider: Gitiles (Gerrit)
// ---------------------------------------------------------------------------

/**
 * Parse a Gerrit/Gitiles repository URL into its components.
 *
 * @param {string} url - e.g. https://gerrit.wikimedia.org/r/mediawiki/extensions/CampaignEvents
 * @return {{ baseUrl: string, repoPath: string, branch: string }}
 */
function parseGitilesUrl( url ) {
	// https://gerrit.wikimedia.org/r/mediawiki/extensions/CampaignEvents
	const match = url.match( /^(https:\/\/[^/]+\/r)\/(.+?)$/ );
	if ( !match ) {
		throw new Error( `Cannot parse Gerrit URL: ${ url }` );
	}
	return {
		baseUrl: match[ 1 ],
		repoPath: match[ 2 ],
		branch: 'master'
	};
}

/**
 * List files in a Gitiles directory recursively.
 *
 * @param {string} baseUrl - Gitiles base URL
 * @param {string} repoPath - Repository path
 * @param {string} branch - Branch name
 * @param {string} dirPath - Directory path within the repo
 * @return {Promise<string[]>} List of file paths relative to repo root
 */
async function gitilesListFiles( baseUrl, repoPath, branch, dirPath ) {
	const url = `${ baseUrl }/plugins/gitiles/${ repoPath }/+/refs/heads/${ branch }/${ dirPath }?format=JSON`;
	let body;
	try {
		body = await httpGet( url );
	} catch {
		return [];
	}

	// Gitiles prefixes JSON with )]}'  for XSSI protection
	const json = JSON.parse( body.replace( /^\)\]\}'[\s]*/, '' ) );
	if ( !json.entries ) {
		return [];
	}

	const files = [];
	for ( const entry of json.entries ) {
		const entryPath = dirPath ? `${ dirPath }/${ entry.name }` : entry.name;
		if ( entry.type === 'blob' ) {
			files.push( entryPath );
		} else if ( entry.type === 'tree' ) {
			if ( ![ 'node_modules', 'vendor', '.git' ].includes( entry.name ) ) {
				const subFiles = await gitilesListFiles( baseUrl, repoPath, branch, entryPath );
				files.push( ...subFiles );
			}
		}
	}

	return files;
}

/**
 * Fetch a file's content from Gitiles.
 *
 * @param {string} baseUrl - Gitiles base URL
 * @param {string} repoPath - Repository path
 * @param {string} branch - Branch name
 * @param {string} filePath - File path within the repo
 * @return {Promise<string>} File content
 */
async function gitilesReadFile( baseUrl, repoPath, branch, filePath ) {
	const url = `${ baseUrl }/plugins/gitiles/${ repoPath }/+/refs/heads/${ branch }/${ filePath }?format=TEXT`;
	const body = await httpGet( url );
	return Buffer.from( body, 'base64' ).toString( 'utf-8' );
}

// ---------------------------------------------------------------------------
// Remote provider: GitHub
// ---------------------------------------------------------------------------

/**
 * Parse a GitHub repository URL into its components.
 *
 * @param {string} url - e.g. https://github.com/user/repo
 * @return {{ owner: string, repo: string, branch: string }}
 */
function parseGithubUrl( url ) {
	const match = url.match( /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/ );
	if ( !match ) {
		throw new Error( `Cannot parse GitHub URL: ${ url }` );
	}
	return {
		owner: match[ 1 ],
		repo: match[ 2 ],
		branch: 'main'
	};
}

/**
 * Get the full file tree from a GitHub repo.
 *
 * @param {string} owner - Repo owner
 * @param {string} repo - Repo name
 * @param {string} branch - Branch name
 * @return {Promise<string[]>} List of all file paths
 */
async function githubListAllFiles( owner, repo, branch ) {
	const url = `https://api.github.com/repos/${ owner }/${ repo }/git/trees/${ branch }?recursive=1`;
	let body;
	try {
		body = await httpGet( url );
	} catch {
		// Try 'master' if 'main' fails
		if ( branch === 'main' ) {
			const fallbackUrl = `https://api.github.com/repos/${ owner }/${ repo }/git/trees/master?recursive=1`;
			body = await httpGet( fallbackUrl );
		} else {
			throw new Error( `Cannot list files from GitHub repo ${ owner }/${ repo }` );
		}
	}

	const json = JSON.parse( body );
	return json.tree
		.filter( ( entry ) => entry.type === 'blob' )
		.map( ( entry ) => entry.path );
}

/**
 * Fetch a file's content from GitHub.
 *
 * @param {string} owner - Repo owner
 * @param {string} repo - Repo name
 * @param {string} branch - Branch name
 * @param {string} filePath - File path within the repo
 * @return {Promise<string>} File content
 */
async function githubReadFile( owner, repo, branch, filePath ) {
	const url = `https://raw.githubusercontent.com/${ owner }/${ repo }/${ branch }/${ filePath }`;
	return httpGet( url );
}

// ---------------------------------------------------------------------------
// Remote provider interface
// ---------------------------------------------------------------------------

/**
 * Detect the remote provider type from a URL.
 *
 * @param {string} url - Repository URL
 * @return {'gitiles'|'github'|null}
 */
function detectProvider( url ) {
	if ( /gerrit\.[^/]+\/r\//.test( url ) ) {
		return 'gitiles';
	}
	if ( /github\.com\//.test( url ) ) {
		return 'github';
	}
	return null;
}

/**
 * Create a remote file provider for a given URL.
 *
 * @param {string} url - Repository URL
 * @return {Object} Provider with listFiles(dir) and readFile(path) methods
 */
function createRemoteProvider( url ) {
	const providerType = detectProvider( url );

	if ( providerType === 'gitiles' ) {
		const { baseUrl, repoPath, branch } = parseGitilesUrl( url );
		return {
			type: 'gitiles',
			listFiles: ( dir ) => gitilesListFiles( baseUrl, repoPath, branch, dir ),
			readFile: ( filePath ) => gitilesReadFile( baseUrl, repoPath, branch, filePath )
		};
	}

	if ( providerType === 'github' ) {
		const { owner, repo, branch } = parseGithubUrl( url );
		let allFilesCache = null;
		return {
			type: 'github',
			listFiles: async ( dir ) => {
				// GitHub tree API returns everything at once, so cache it
				if ( !allFilesCache ) {
					allFilesCache = await githubListAllFiles( owner, repo, branch );
				}
				const prefix = dir ? dir + '/' : '';
				return allFilesCache.filter( ( f ) => f.startsWith( prefix ) );
			},
			readFile: ( filePath ) => githubReadFile( owner, repo, branch, filePath )
		};
	}

	return null;
}

// ---------------------------------------------------------------------------
// Local file operations
// ---------------------------------------------------------------------------

/**
 * Recursively find files matching a pattern in a local directory.
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

// ---------------------------------------------------------------------------
// Spec file filtering (shared between local and remote)
// ---------------------------------------------------------------------------

/**
 * Check if a file path looks like a test spec (not a page object, util, etc.).
 *
 * @param {string} filePath - File path (relative to repo root)
 * @return {boolean}
 */
function isSpecFile( filePath ) {
	const basename = path.basename( filePath ).toLowerCase();
	const lowerPath = filePath.toLowerCase();

	if ( !/\.(js|ts|mjs|cjs|jsx|tsx)$/.test( basename ) ) {
		return false;
	}

	if (
		lowerPath.includes( 'pageobject' ) ||
		basename.includes( 'util' ) ||
		basename.includes( 'helper' ) ||
		basename.includes( 'fixture' ) ||
		basename.includes( 'command' ) ||
		basename.includes( 'support' ) ||
		basename.startsWith( 'wdio.' ) ||
		basename.startsWith( 'cypress.' ) ||
		basename.startsWith( '.' ) ||
		basename === 'package.json' ||
		basename === 'index.js' ||
		basename === 'index.ts'
	) {
		return false;
	}

	return true;
}

/**
 * Find spec files in given directories using a remote provider.
 *
 * @param {Object} provider - Remote provider with listFiles method
 * @param {string[]} dirs - Directories to scan
 * @return {Promise<string[]>} List of spec file paths
 */
async function findRemoteSpecs( provider, dirs ) {
	const specFiles = new Set();

	for ( const dir of dirs ) {
		const files = await provider.listFiles( dir );
		for ( const file of files ) {
			if ( isSpecFile( file ) ) {
				specFiles.add( file );
			}
		}
	}

	return Array.from( specFiles );
}

/**
 * Find spec files in given directories on the local filesystem.
 *
 * @param {string} repoPath - Repository root path
 * @param {string[]} dirs - Directories to scan (relative to repoPath)
 * @return {string[]} List of spec file absolute paths
 */
function findLocalSpecs( repoPath, dirs ) {
	const plainJsPattern = /\.(js|ts|mjs|cjs|jsx|tsx)$/;
	const specFiles = new Set();

	for ( const dir of dirs ) {
		const fullDir = path.join( repoPath, dir );
		if ( fs.existsSync( fullDir ) ) {
			const files = findFiles( fullDir, plainJsPattern );
			for ( const file of files ) {
				const relPath = path.relative( repoPath, file );
				if ( isSpecFile( relPath ) ) {
					specFiles.add( file );
				}
			}
		}
	}

	return Array.from( specFiles );
}

// ---------------------------------------------------------------------------
// Test parsing (works on content strings, framework-agnostic)
// ---------------------------------------------------------------------------

/**
 * Parse test content to extract describe/it blocks.
 * Works for any framework using Mocha-style describe/it syntax.
 *
 * @param {string} content - File content
 * @param {string} filePath - File path (for filter context)
 * @param {Function} [filter] - Optional function to validate file content
 * @return {Object|null} Parsed test structure, or null if filtered out
 */
function parseContent( content, filePath, filter ) {
	if ( filter && !filter( content, filePath ) ) {
		return null;
	}

	const lines = content.split( '\n' );
	const suites = [];
	const suiteStack = [];

	for ( let i = 0; i < lines.length; i++ ) {
		const line = lines[ i ];
		const lineNumber = i + 1;

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

// ---------------------------------------------------------------------------
// Test map builders
// ---------------------------------------------------------------------------

/**
 * Build the tests map from local spec files.
 *
 * @param {string[]} specFiles - Array of local file paths
 * @param {Function} [filter] - Optional content filter
 * @return {{ tests: Object, totalTests: number, totalSuites: number }}
 */
function buildTestMapLocal( specFiles, filter ) {
	const tests = {};
	let totalTests = 0;

	for ( const specFile of specFiles ) {
		const content = fs.readFileSync( specFile, 'utf-8' );
		const parsed = parseContent( content, specFile, filter );
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
 * Build the tests map from remote spec files.
 *
 * @param {Object} provider - Remote provider with readFile method
 * @param {string[]} specFiles - Array of remote file paths
 * @param {Function} [filter] - Optional content filter
 * @return {Promise<{ tests: Object, totalTests: number, totalSuites: number }>}
 */
async function buildTestMapRemote( provider, specFiles, filter ) {
	const tests = {};
	let totalTests = 0;

	for ( const specFile of specFiles ) {
		let content;
		try {
			content = await provider.readFile( specFile );
		} catch {
			continue;
		}
		const parsed = parseContent( content, specFile, filter );
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

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
	parseArgs,
	detectProvider,
	createRemoteProvider,
	findFiles,
	findLocalSpecs,
	findRemoteSpecs,
	isSpecFile,
	parseContent,
	flattenSuites,
	buildTestMapLocal,
	buildTestMapRemote,
	writeOutput
};
