'use strict';

const path = require( 'path' );
const https = require( 'https' );

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
// Gitiles (Gerrit) API
// ---------------------------------------------------------------------------

/**
 * Parse a Gerrit/Gitiles repository URL into its components.
 *
 * @param {string} url - e.g. https://gerrit.wikimedia.org/r/mediawiki/extensions/CampaignEvents
 * @return {{ baseUrl: string, repoPath: string, branch: string }}
 */
function parseGitilesUrl( url ) {
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

/**
 * Create a Gitiles provider for a given Gerrit URL.
 *
 * @param {string} url - Repository URL
 * @return {Object} Provider with listFiles(dir) and readFile(path) methods
 */
function createProvider( url ) {
	const { baseUrl, repoPath, branch } = parseGitilesUrl( url );
	return {
		listFiles: ( dir ) => gitilesListFiles( baseUrl, repoPath, branch, dir ),
		readFile: ( filePath ) => gitilesReadFile( baseUrl, repoPath, branch, filePath )
	};
}

// ---------------------------------------------------------------------------
// Spec file filtering
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
 * Find spec files in given directories using a provider.
 *
 * @param {Object} provider - Provider with listFiles method
 * @param {string[]} dirs - Directories to scan
 * @return {Promise<string[]>} List of spec file paths
 */
async function findSpecs( provider, dirs ) {
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

// ---------------------------------------------------------------------------
// Test parsing
// ---------------------------------------------------------------------------

/**
 * Parse test content to extract describe/it blocks.
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
 * Flatten suites into a map of describe name -> test names.
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
// Framework detection
// ---------------------------------------------------------------------------

/**
 * Detect whether a test file is WebdriverIO or Cypress.
 *
 * @param {string} content - File content
 * @param {string} filePath - File path
 * @return {'wdio'|'cypress'|'unknown'}
 */
function detectFramework( content, filePath ) {
	const lowerPath = filePath.toLowerCase();
	const isCypress = /(?:cy\.|Cypress\.)/.test( content ) || lowerPath.includes( 'cypress' );
	const isWdio = /(?:browser\.|wdio-mediawiki|@wdio\/|webdriverio|import.*from\s+['"]wdio)/.test( content ) ||
		lowerPath.includes( 'selenium' ) || lowerPath.includes( 'wdio' );

	if ( isCypress ) {
		return 'cypress';
	}
	if ( isWdio ) {
		return 'wdio';
	}
	return 'unknown';
}

// ---------------------------------------------------------------------------
// Test map builder
// ---------------------------------------------------------------------------

/**
 * Process parsed suites into a file-grouped entry.
 *
 * @param {Object} parsed - Parsed test structure from parseContent
 * @return {{ suites: Object, testCount: number, suiteCount: number }}
 */
function buildFileEntry( parsed ) {
	const flattened = flattenSuites( parsed.suites );
	let testCount = 0;
	for ( const names of Object.values( flattened ) ) {
		testCount += names.length;
	}
	return {
		suites: flattened,
		testCount,
		suiteCount: Object.keys( flattened ).length
	};
}

/**
 * Build the tests map from remote spec files, grouped by file.
 *
 * @param {Object} provider - Provider with readFile method
 * @param {string[]} specFiles - Array of remote file paths
 * @param {Function} [filter] - Optional content filter
 * @return {Promise<{ tests: Object, totalTests: number, totalSuites: number, totalFiles: number, frameworks: string[] }>}
 */
async function buildTestMap( provider, specFiles, filter ) {
	const tests = {};
	let totalTests = 0;
	let totalSuites = 0;
	const frameworksFound = new Set();

	for ( const specFile of specFiles ) {
		let content;
		try {
			content = await provider.readFile( specFile );
		} catch {
			continue;
		}
		const parsed = parseContent( content, specFile, filter );
		if ( parsed && parsed.suites.length > 0 ) {
			const entry = buildFileEntry( parsed );
			tests[ specFile ] = entry.suites;
			totalTests += entry.testCount;
			totalSuites += entry.suiteCount;
			frameworksFound.add( detectFramework( content, specFile ) );
		}
	}

	return {
		tests,
		totalTests,
		totalSuites,
		totalFiles: Object.keys( tests ).length,
		frameworks: Array.from( frameworksFound ).sort()
	};
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/**
 * Derive a short name from a repo URL for use in filenames.
 *
 * @param {string} url - Repository URL
 * @return {string} Short name
 */
function repoSlug( url ) {
	return url
		.replace( /^https?:\/\//, '' )
		.replace( /^[^/]+\/r\//, '' )
		.replace( /[^a-zA-Z0-9-]/g, '_' )
		.replace( /_+/g, '_' )
		.replace( /^_|_$/g, '' );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
	createProvider,
	findSpecs,
	buildTestMap,
	repoSlug
};
