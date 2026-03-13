#!/usr/bin/env node

/**
 * Scans a git repository for WebdriverIO tests and outputs a JSON file
 * listing all test suites and individual test cases.
 *
 * Usage:
 *   node list-wdio-tests.js <repo-url-or-local-path> [--output <file>]
 */

'use strict';

const path = require( 'path' );
const {
	parseArgs,
	resolveRepo,
	cleanupDir,
	findFiles,
	findSpecsInDirs,
	buildTestMap,
	writeOutput
} = require( './lib/parser' );

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

function main() {
	const { repoUrl, outputFile } = parseArgs( 'wdio-tests.json' );
	const { repoPath, isCloned } = resolveRepo( repoUrl );

	try {
		const configs = findFiles( repoPath, /^wdio\.conf\.(js|ts|mjs|cjs)$/ );
		console.log( `Found ${ configs.length } WebdriverIO config(s)` );

		const specFiles = Array.from( findSpecsInDirs( repoPath, WDIO_DIRS ) );
		console.log( `Found ${ specFiles.length } potential test file(s)` );

		const { tests, totalTests, totalSuites } = buildTestMap( specFiles, isWdioTest );

		writeOutput( outputFile, {
			repository: repoUrl,
			generatedAt: new Date().toISOString(),
			totalSuites,
			totalTests,
			tests
		} );
	} finally {
		if ( isCloned ) {
			console.log( 'Cleaning up temporary clone...' );
			cleanupDir( repoPath );
		}
	}
}

main();
