#!/usr/bin/env node

/**
 * Scans a git repository for Cypress tests and outputs a JSON file
 * listing all test suites and individual test cases.
 *
 * Usage:
 *   node list-cypress-tests.js <repo-url-or-local-path> [--output <file>]
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

const CYPRESS_DIRS = [
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
 * Check if file content looks like a Cypress test.
 *
 * @param {string} content - File content
 * @param {string} filePath - File path
 * @return {boolean}
 */
function isCypressTest( content, filePath ) {
	return /(?:cy\.|Cypress\.|cypress)/i.test( content ) ||
		filePath.includes( 'cypress' );
}

function main() {
	const { repoUrl, outputFile } = parseArgs( 'cypress-tests.json' );
	const { repoPath, isCloned } = resolveRepo( repoUrl );

	try {
		const configs = findFiles( repoPath, /^cypress\.(config\.(js|ts|mjs|cjs)|json)$/ );
		console.log( `Found ${ configs.length } Cypress config(s)` );

		const specFiles = Array.from( findSpecsInDirs( repoPath, CYPRESS_DIRS ) );
		console.log( `Found ${ specFiles.length } potential test file(s)` );

		const { tests, totalTests, totalSuites } = buildTestMap( specFiles, isCypressTest );

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
