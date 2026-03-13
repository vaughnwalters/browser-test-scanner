#!/usr/bin/env node

/**
 * Scans a git repository for WebdriverIO tests and outputs a JSON file
 * listing all test suites and individual test cases.
 *
 * Usage:
 *   node list-wdio-tests.js <repo-url-or-local-path> [--output <file>]
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

const WDIO_DIRS = [
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

/**
 * Check if file content looks like a WebdriverIO test.
 *
 * @param {string} content - File content
 * @param {string} filePath - File path
 * @return {boolean}
 */
function isWdioTest( content, filePath ) {
	return /(?:browser\.|wdio-mediawiki|@wdio\/|webdriverio|import.*from\s+['"]wdio)/i.test( content ) ||
		filePath.includes( 'selenium' ) ||
		filePath.includes( 'wdio' ) ||
		filePath.includes( 'e2e' );
}

async function main() {
	let { repoUrl, outputFile } = parseArgs( `results/${ defaultOutputName( '...', 'wdio' ) }` );
	if ( !process.argv.includes( '--output' ) && !process.argv.includes( '-o' ) ) {
		outputFile = `results/${ defaultOutputName( repoUrl, 'wdio' ) }`;
	}
	const provider = createRemoteProvider( repoUrl );

	let tests, totalTests, totalSuites, totalFiles;

	if ( provider ) {
		console.log( `Scanning ${ repoUrl } via ${ provider.type } API...` );

		const specFiles = await findRemoteSpecs( provider, WDIO_DIRS );
		console.log( `Found ${ specFiles.length } potential test file(s)` );

		( { tests, totalTests, totalSuites, totalFiles } = await buildTestMapRemote( provider, specFiles, isWdioTest ) );
	} else {
		const repoPath = path.resolve( repoUrl );
		if ( !fs.existsSync( repoPath ) ) {
			console.error( `Error: path does not exist: ${ repoPath }` );
			process.exit( 1 );
		}

		const configs = findFiles( repoPath, /^wdio\.conf\.(js|ts|mjs|cjs)$/ );
		console.log( `Found ${ configs.length } WebdriverIO config(s)` );

		const specFiles = findLocalSpecs( repoPath, WDIO_DIRS );
		console.log( `Found ${ specFiles.length } potential test file(s)` );

		( { tests, totalTests, totalSuites, totalFiles } = buildTestMapLocal( specFiles, isWdioTest, repoPath ) );
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
