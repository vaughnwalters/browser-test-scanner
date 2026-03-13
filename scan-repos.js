#!/usr/bin/env node

/**
 * Scans multiple repositories for browser tests (WebdriverIO and/or Cypress).
 *
 * Usage:
 *   node scan-repos.js <repos-file>
 *
 * The repos file should contain one repository URL per line.
 * Lines starting with # are treated as comments.
 */

'use strict';

const fs = require( 'fs' );
const path = require( 'path' );
const {
	createRemoteProvider,
	findRemoteSpecs,
	buildTestMapRemote,
	repoSlug
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

function parseArgs() {
	const args = process.argv.slice( 2 );

	if ( args.length === 0 || args.includes( '--help' ) || args.includes( '-h' ) ) {
		console.log( `Usage: node scan-repos.js <repos-file>

Arguments:
  repos-file   Text file with one repo URL per line

Lines starting with # are comments.` );
		process.exit( args.length === 0 ? 1 : 0 );
	}

	return { reposFile: args[ 0 ] };
}

function readRepoList( filePath ) {
	const content = fs.readFileSync( path.resolve( filePath ), 'utf-8' );
	return content
		.split( '\n' )
		.map( ( line ) => line.trim() )
		.filter( ( line ) => line && !line.startsWith( '#' ) );
}

async function main() {
	const { reposFile } = parseArgs();
	const repos = readRepoList( reposFile );
	const outputDir = 'results';

	console.log( `Scanning ${ repos.length } repo(s)...\n` );

	fs.mkdirSync( path.resolve( outputDir ), { recursive: true } );

	const summary = [];

	for ( const repoUrl of repos ) {
		const provider = createRemoteProvider( repoUrl );
		if ( !provider ) {
			console.log( `  SKIP  ${ repoUrl } (unsupported host)` );
			summary.push( { repository: repoUrl, status: 'unsupported' } );
			continue;
		}

		let specFiles;
		try {
			specFiles = await findRemoteSpecs( provider, TEST_DIRS );
		} catch ( e ) {
			console.log( `  ERROR ${ repoUrl } (${ e.message })` );
			summary.push( { repository: repoUrl, status: 'error', error: e.message } );
			continue;
		}

		if ( specFiles.length === 0 ) {
			console.log( `  NONE  ${ repoUrl }` );
			summary.push( { repository: repoUrl, status: 'none' } );
			continue;
		}

		const { tests, totalTests, totalSuites, totalFiles } = await buildTestMapRemote( provider, specFiles, isBrowserTest );

		const slug = repoSlug( repoUrl );
		const outFile = path.resolve( outputDir, `${ slug }_tests.json` );
		const output = {
			repository: repoUrl,
			generatedAt: new Date().toISOString(),
			totalFiles,
			totalSuites,
			totalTests,
			tests
		};
		fs.writeFileSync( outFile, JSON.stringify( output, null, 2 ) + '\n' );

		summary.push( {
			repository: repoUrl,
			status: 'found',
			totalFiles,
			totalSuites,
			totalTests
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

main();
