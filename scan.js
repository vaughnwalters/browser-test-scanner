#!/usr/bin/env node

/**
 * Scans git repositories for browser tests (WebdriverIO, Cypress, etc.)
 * and outputs JSON files listing all test suites and test cases, grouped by file.
 *
 * Usage:
 *   node scan.js                  Scan all repos in repos.txt
 *   node scan.js <repo-url>       Scan a single repo
 */

'use strict';

const fs = require( 'fs' );
const path = require( 'path' );
const {
	createProvider,
	findSpecs,
	buildTestMap,
	repoSlug,
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

function isBrowserTest( content, filePath ) {
	return /(?:browser\.|wdio-mediawiki|@wdio\/|webdriverio|import.*from\s+['"]wdio|cy\.|Cypress\.)/i.test( content ) ||
		filePath.includes( 'selenium' ) ||
		filePath.includes( 'wdio' ) ||
		filePath.includes( 'e2e' ) ||
		filePath.includes( 'cypress' );
}

function readRepoList( filePath ) {
	const content = fs.readFileSync( path.resolve( filePath ), 'utf-8' );
	return content
		.split( '\n' )
		.map( ( line ) => line.trim() )
		.filter( ( line ) => line && !line.startsWith( '#' ) );
}

async function scanRepo( repoUrl ) {
	const provider = createProvider( repoUrl );
	const specFiles = await findSpecs( provider, TEST_DIRS );
	return buildTestMap( provider, specFiles, isBrowserTest );
}

async function scanAll() {
	const reposFile = 'repos.txt';
	if ( !fs.existsSync( reposFile ) ) {
		console.error( 'Error: repos.txt not found. Create it or pass a repo URL.' );
		process.exit( 1 );
	}

	const repos = readRepoList( reposFile );
	const outputDir = 'results';

	console.log( `Scanning ${ repos.length } repo(s)...\n` );

	fs.mkdirSync( path.resolve( outputDir ), { recursive: true } );

	const summary = [];

	for ( const repoUrl of repos ) {
		let result;
		try {
			result = await scanRepo( repoUrl );
		} catch ( e ) {
			console.log( `  ERROR ${ repoUrl } (${ e.message })` );
			summary.push( { repository: repoUrl, status: 'error', error: e.message } );
			continue;
		}

		const { tests, totalTests, totalSuites, totalFiles, frameworks } = result;

		if ( totalFiles === 0 ) {
			console.log( `  NONE  ${ repoUrl }` );
			summary.push( { repository: repoUrl, status: 'none' } );
			continue;
		}

		const slug = repoSlug( repoUrl );
		const outFile = path.resolve( outputDir, `${ slug }_tests.json` );
		const output = {
			repository: repoUrl,
			generatedAt: new Date().toISOString(),
			totalFiles,
			totalSuites,
			totalTests,
			frameworks,
			tests
		};
		fs.writeFileSync( outFile, JSON.stringify( output, null, 2 ) + '\n' );

		summary.push( {
			repository: repoUrl,
			status: 'found',
			totalFiles,
			totalSuites,
			totalTests,
			frameworks
		} );

		console.log( `  FOUND ${ repoUrl } (${ totalFiles } files, ${ totalTests } tests)` );
	}

	const summaryFile = path.resolve( outputDir, 'summary.json' );
	const found = summary.filter( ( s ) => s.status === 'found' );
	const summaryOutput = {
		generatedAt: new Date().toISOString(),
		totalRepos: repos.length,
		withTests: found.length,
		withNone: summary.filter( ( s ) => s.status === 'none' ).length,
		repos: summary
	};
	fs.writeFileSync( summaryFile, JSON.stringify( summaryOutput, null, 2 ) + '\n' );

	console.log( `\nResults written to ${ path.resolve( outputDir ) }/` );
	console.log( `Summary: ${ found.length } with tests, ${ summaryOutput.withNone } without` );
}

async function scanSingle( repoUrl ) {
	console.log( `Scanning ${ repoUrl }...` );

	const { tests, totalTests, totalSuites, totalFiles, frameworks } = await scanRepo( repoUrl );
	const outputFile = `results/${ repoSlug( repoUrl ) }_tests.json`;

	writeOutput( outputFile, {
		repository: repoUrl,
		generatedAt: new Date().toISOString(),
		totalFiles,
		totalSuites,
		totalTests,
		frameworks,
		tests
	} );
}

async function main() {
	const args = process.argv.slice( 2 );

	if ( args.includes( '--help' ) || args.includes( '-h' ) ) {
		console.log( `Usage:
  node scan.js              Scan all repos in repos.txt
  node scan.js <repo-url>   Scan a single repo` );
		process.exit( 0 );
	}

	if ( args.length === 0 ) {
		await scanAll();
	} else {
		await scanSingle( args[ 0 ] );
	}
}

main();
