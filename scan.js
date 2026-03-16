#!/usr/bin/env node

/**
 * Scans all Gerrit repositories listed in repos.txt for browser tests
 * (WebdriverIO, Cypress) and outputs JSON files grouped by spec file.
 *
 * Usage:
 *   node scan.js
 */

'use strict';

const fs = require( 'fs' );
const path = require( 'path' );
const {
	createProvider,
	findSpecs,
	buildTestMap,
	repoSlug
} = require( './parser' );

const TEST_DIRS = [
	'tests/selenium',
	'test/selenium',
	'tests/e2e',
	'test/e2e',
	'tests/wdio',
	'test/wdio',
	'tests/browser',
	'test/browser',
	'tests/cypress',
	'test/cypress',
	'selenium',
	'e2e',
	'specs',
	'cypress'
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

async function main() {
	const reposFile = 'repos.txt';
	if ( !fs.existsSync( reposFile ) ) {
		console.error( 'Error: repos.txt not found.' );
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
			const provider = createProvider( repoUrl );
			const specFiles = await findSpecs( provider, TEST_DIRS );
			result = await buildTestMap( provider, specFiles, isBrowserTest );
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

main();
