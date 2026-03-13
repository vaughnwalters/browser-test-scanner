#!/usr/bin/env node

/**
 * Scans a git repository for Cypress tests and outputs a JSON file
 * listing all test suites and individual test cases.
 *
 * Usage:
 *   node list-cypress-tests.js <repo-url-or-local-path> [--output <file>]
 */

'use strict';

const fs = require( 'fs' );
const path = require( 'path' );
const {
	parseArgs,
	createRemoteProvider,
	findFiles,
	findLocalSpecs,
	findRemoteSpecs,
	buildTestMapLocal,
	buildTestMapRemote,
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

async function main() {
	const { repoUrl, outputFile } = parseArgs( 'cypress-tests.json' );
	const provider = createRemoteProvider( repoUrl );

	let tests, totalTests, totalSuites, totalFiles;

	if ( provider ) {
		console.log( `Scanning ${ repoUrl } via ${ provider.type } API...` );

		const specFiles = await findRemoteSpecs( provider, CYPRESS_DIRS );
		console.log( `Found ${ specFiles.length } potential test file(s)` );

		( { tests, totalTests, totalSuites, totalFiles } = await buildTestMapRemote( provider, specFiles, isCypressTest ) );
	} else {
		const repoPath = path.resolve( repoUrl );
		if ( !fs.existsSync( repoPath ) ) {
			console.error( `Error: path does not exist: ${ repoPath }` );
			process.exit( 1 );
		}

		const configs = findFiles( repoPath, /^cypress\.(config\.(js|ts|mjs|cjs)|json)$/ );
		console.log( `Found ${ configs.length } Cypress config(s)` );

		const specFiles = findLocalSpecs( repoPath, CYPRESS_DIRS );
		console.log( `Found ${ specFiles.length } potential test file(s)` );

		( { tests, totalTests, totalSuites, totalFiles } = buildTestMapLocal( specFiles, isCypressTest, repoPath ) );
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
