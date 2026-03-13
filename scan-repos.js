#!/usr/bin/env node

/**
 * Scans multiple repositories for browser tests (WebdriverIO and/or Cypress).
 * Detects which framework each repo uses, then runs the appropriate scanner.
 *
 * Usage:
 *   node scan-repos.js <repos-file> [--output-dir <dir>]
 *
 * The repos file should contain one repository URL per line.
 * Lines starting with # are treated as comments.
 *
 * Examples:
 *   node scan-repos.js repos.txt
 *   node scan-repos.js repos.txt --output-dir results/
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

function isWdioTest( content, filePath ) {
	return /(?:browser\.|wdio-mediawiki|@wdio\/|webdriverio|import.*from\s+['"]wdio)/i.test( content ) ||
		filePath.includes( 'selenium' ) ||
		filePath.includes( 'wdio' ) ||
		filePath.includes( 'e2e' );
}

function isCypressTest( content, filePath ) {
	return /(?:cy\.|Cypress\.|cypress)/i.test( content ) ||
		filePath.includes( 'cypress' );
}

function parseArgs() {
	const args = process.argv.slice( 2 );

	if ( args.length === 0 || args.includes( '--help' ) || args.includes( '-h' ) ) {
		console.log( `Usage: node scan-repos.js <repos-file> [--output-dir <dir>]

Arguments:
  repos-file         Text file with one repo URL per line
  --output-dir, -d   Output directory for JSON files (default: results/)

The repos file should contain one URL per line. Lines starting with # are comments.` );
		process.exit( args.length === 0 ? 1 : 0 );
	}

	let reposFile = null;
	let outputDir = 'results';

	for ( let i = 0; i < args.length; i++ ) {
		if ( args[ i ] === '--output-dir' || args[ i ] === '-d' ) {
			i++;
			if ( i < args.length ) {
				outputDir = args[ i ];
			}
		} else if ( !reposFile ) {
			reposFile = args[ i ];
		}
	}

	if ( !reposFile ) {
		console.error( 'Error: repos file is required' );
		process.exit( 1 );
	}

	return { reposFile, outputDir };
}

/**
 * Read repo URLs from a file.
 *
 * @param {string} filePath - Path to the repos file
 * @return {string[]} Array of repo URLs
 */
function readRepoList( filePath ) {
	const content = fs.readFileSync( path.resolve( filePath ), 'utf-8' );
	return content
		.split( '\n' )
		.map( ( line ) => line.trim() )
		.filter( ( line ) => line && !line.startsWith( '#' ) );
}

/**
 * Detect which test frameworks a repo uses by checking for spec files
 * in the known directories.
 *
 * @param {Object} provider - Remote provider
 * @return {Promise<{ hasWdio: boolean, hasCypress: boolean, wdioFiles: string[], cypressFiles: string[] }>}
 */
async function detectFrameworks( provider ) {
	const [ wdioFiles, cypressFiles ] = await Promise.all( [
		findRemoteSpecs( provider, WDIO_DIRS ),
		findRemoteSpecs( provider, CYPRESS_DIRS )
	] );

	return {
		hasWdio: wdioFiles.length > 0,
		hasCypress: cypressFiles.length > 0,
		wdioFiles,
		cypressFiles
	};
}

async function main() {
	const { reposFile, outputDir } = parseArgs();
	const repos = readRepoList( reposFile );

	console.log( `Scanning ${ repos.length } repo(s)...\n` );

	fs.mkdirSync( path.resolve( outputDir ), { recursive: true } );

	const summary = [];

	for ( const repoUrl of repos ) {
		const provider = createRemoteProvider( repoUrl );
		if ( !provider ) {
			console.log( `  SKIP  ${ repoUrl } (unsupported host)` );
			summary.push( { repository: repoUrl, framework: 'unsupported' } );
			continue;
		}

		let detection;
		try {
			detection = await detectFrameworks( provider );
		} catch ( e ) {
			console.log( `  ERROR ${ repoUrl } (${ e.message })` );
			summary.push( { repository: repoUrl, framework: 'error', error: e.message } );
			continue;
		}

		const { hasWdio, hasCypress, wdioFiles, cypressFiles } = detection;

		if ( !hasWdio && !hasCypress ) {
			console.log( `  NONE  ${ repoUrl }` );
			summary.push( { repository: repoUrl, framework: 'none' } );
			continue;
		}

		const slug = repoSlug( repoUrl );
		const frameworks = [];
		const repoEntry = { repository: repoUrl };

		if ( hasWdio ) {
			frameworks.push( 'wdio' );
			const { tests, totalTests, totalSuites, totalFiles } = await buildTestMapRemote( provider, wdioFiles, isWdioTest );
			const outFile = path.resolve( outputDir, `${ slug }_wdio.json` );
			const output = {
				repository: repoUrl,
				generatedAt: new Date().toISOString(),
				totalFiles,
				totalSuites,
				totalTests,
				tests
			};
			fs.writeFileSync( outFile, JSON.stringify( output, null, 2 ) + '\n' );
			repoEntry.wdio = { totalFiles, totalSuites, totalTests };
		}

		if ( hasCypress ) {
			frameworks.push( 'cypress' );
			const { tests, totalTests, totalSuites, totalFiles } = await buildTestMapRemote( provider, cypressFiles, isCypressTest );
			const outFile = path.resolve( outputDir, `${ slug }_cypress.json` );
			const output = {
				repository: repoUrl,
				generatedAt: new Date().toISOString(),
				totalFiles,
				totalSuites,
				totalTests,
				tests
			};
			fs.writeFileSync( outFile, JSON.stringify( output, null, 2 ) + '\n' );
			repoEntry.cypress = { totalFiles, totalSuites, totalTests };
		}

		repoEntry.framework = frameworks.join( '+' );
		summary.push( repoEntry );

		const label = frameworks.join( ' + ' ).toUpperCase();
		console.log( `  ${ label.padEnd( 7 ) } ${ repoUrl }` );
	}

	// Write summary
	const summaryFile = path.resolve( outputDir, 'summary.json' );
	const summaryOutput = {
		generatedAt: new Date().toISOString(),
		totalRepos: repos.length,
		withWdio: summary.filter( ( s ) => s.framework.includes( 'wdio' ) ).length,
		withCypress: summary.filter( ( s ) => s.framework.includes( 'cypress' ) ).length,
		withBoth: summary.filter( ( s ) => s.framework === 'wdio+cypress' ).length,
		withNone: summary.filter( ( s ) => s.framework === 'none' ).length,
		repos: summary
	};
	fs.writeFileSync( summaryFile, JSON.stringify( summaryOutput, null, 2 ) + '\n' );

	console.log( `\nResults written to ${ path.resolve( outputDir ) }/` );
	console.log( `Summary: ${ summaryOutput.withWdio } wdio, ${ summaryOutput.withCypress } cypress, ${ summaryOutput.withBoth } both, ${ summaryOutput.withNone } none` );
}

main();
