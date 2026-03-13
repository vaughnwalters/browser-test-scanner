#!/usr/bin/env node

/**
 * Scans a git repository for all browser tests (WebdriverIO, Cypress, etc.)
 * and outputs a JSON file listing all test suites and test cases, grouped by file.
 *
 * Usage:
 *   node scan.js <repo-url-or-path> [--output <file>]
 */

'use strict';

const fs = require( 'fs' );
const path = require( 'path' );
const {
	parseArgs,
	createRemoteProvider,
	defaultOutputName,
	findFiles,
	findLocalSpecs,
	findRemoteSpecs,
	buildTestMapLocal,
	buildTestMapRemote,
	writeOutput
} = require( './parser' );

const TEST_DIRS = [
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
	'specs',
	'cypress/e2e',
	'cypress/integration',
	'cypress/specs',
	'tests/cypress',
	'tests/cypress/e2e',
	'tests/cypress/integration',
	'test/cypress',
	'test/cypress/e2e',
	'test/cypress/integration'
];

/**
 * Check if file content looks like a browser test.
 *
 * @param {string} content - File content
 * @param {string} filePath - File path
 * @return {boolean}
 */
function isBrowserTest( content, filePath ) {
	return /(?:browser\.|wdio-mediawiki|@wdio\/|webdriverio|import.*from\s+['"]wdio|cy\.|Cypress\.)/i.test( content ) ||
		filePath.includes( 'selenium' ) ||
		filePath.includes( 'wdio' ) ||
		filePath.includes( 'e2e' ) ||
		filePath.includes( 'cypress' );
}

async function main() {
	let { repoUrl, outputFile } = parseArgs( `results/${ defaultOutputName( '...', 'tests' ) }` );
	if ( !process.argv.includes( '--output' ) && !process.argv.includes( '-o' ) ) {
		outputFile = `results/${ defaultOutputName( repoUrl, 'tests' ) }`;
	}

	const provider = createRemoteProvider( repoUrl );

	let tests, totalTests, totalSuites, totalFiles;

	if ( provider ) {
		console.log( `Scanning ${ repoUrl } via ${ provider.type } API...` );

		const specFiles = await findRemoteSpecs( provider, TEST_DIRS );
		console.log( `Found ${ specFiles.length } potential test file(s)` );

		( { tests, totalTests, totalSuites, totalFiles } = await buildTestMapRemote( provider, specFiles, isBrowserTest ) );
	} else {
		const repoPath = path.resolve( repoUrl );
		if ( !fs.existsSync( repoPath ) ) {
			console.error( `Error: path does not exist: ${ repoPath }` );
			process.exit( 1 );
		}

		const specFiles = findLocalSpecs( repoPath, TEST_DIRS );
		console.log( `Found ${ specFiles.length } potential test file(s)` );

		( { tests, totalTests, totalSuites, totalFiles } = buildTestMapLocal( specFiles, isBrowserTest, repoPath ) );
	}

	writeOutput( outputFile, {
		repository: repoUrl,
		generatedAt: new Date().toISOString(),
		totalFiles,
		totalSuites,
		totalTests,
		tests
	} );
}

main();
