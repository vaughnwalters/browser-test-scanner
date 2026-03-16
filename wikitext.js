#!/usr/bin/env node

/**
 * Reads all JSON result files and generates a wikitext file
 * listing every test grouped by: Core, Extensions, Skins, Wikibase.
 *
 * Usage:
 *   node wikitext.js
 *   # -> results/browser-tests.wiki
 */

'use strict';

const fs = require( 'fs' );
const path = require( 'path' );

const resultsDir = 'results';

function categorize( repoUrl ) {
	if ( /\/mediawiki\/core$/.test( repoUrl ) ) {
		return { category: 'Core', name: 'Core' };
	}
	const extMatch = repoUrl.match( /\/mediawiki\/extensions\/(.+)$/ );
	if ( extMatch ) {
		return { category: 'Extensions', name: extMatch[ 1 ] };
	}
	const skinMatch = repoUrl.match( /\/mediawiki\/skins\/(.+)$/ );
	if ( skinMatch ) {
		return { category: 'Skins', name: skinMatch[ 1 ] };
	}
	const wikibaseMatch = repoUrl.match( /\/wikibase\/(.+)$/ );
	if ( wikibaseMatch ) {
		return { category: 'Wikibase', name: wikibaseMatch[ 1 ] };
	}
	return { category: 'Other', name: repoUrl };
}

function main() {
	const files = fs.readdirSync( resultsDir )
		.filter( ( f ) => f.endsWith( '_tests.json' ) )
		.map( ( f ) => path.join( resultsDir, f ) );

	if ( files.length === 0 ) {
		console.error( 'Error: no result files found in results/. Run node scan.js first.' );
		process.exit( 1 );
	}

	const groups = {};

	for ( const file of files ) {
		const data = JSON.parse( fs.readFileSync( file, 'utf-8' ) );
		const { category, name } = categorize( data.repository );

		if ( !groups[ category ] ) {
			groups[ category ] = [];
		}

		const tests = [];
		for ( const [ , suites ] of Object.entries( data.tests ) ) {
			for ( const [ suiteName, testNames ] of Object.entries( suites ) ) {
				for ( const testName of testNames ) {
					tests.push( `${ suiteName } > ${ testName }` );
				}
			}
		}

		groups[ category ].push( {
			name,
			frameworks: data.frameworks || [],
			tests
		} );
	}

	for ( const category of Object.keys( groups ) ) {
		groups[ category ].sort( ( a, b ) => a.name.localeCompare( b.name ) );
	}

	const categoryOrder = [ 'Core', 'Extensions', 'Skins', 'Wikibase', 'Other' ];
	const totalTests = Object.values( groups ).flat().reduce( ( sum, r ) => sum + r.tests.length, 0 );
	const lines = [];

	lines.push( `''Last updated: ${ new Date().toISOString().replace( 'T', ' ' ).replace( /\.\d+Z$/, ' UTC' ) } | ${ files.length } repos | ${ totalTests } tests''` );
	lines.push( '' );

	for ( const category of categoryOrder ) {
		if ( !groups[ category ] ) {
			continue;
		}

		lines.push( `== ${ category } ==` );
		lines.push( '' );

		for ( const repo of groups[ category ] ) {
			const framework = repo.frameworks.length > 0 ? ` (${ repo.frameworks.join( ', ' ) })` : '';
			lines.push( `=== ${ repo.name }${ framework } ===` );
			lines.push( '' );

			for ( const test of repo.tests ) {
				lines.push( `* ${ test }` );
			}

			lines.push( '' );
		}
	}

	const wikiFile = path.resolve( resultsDir, 'browser-tests.wiki' );
	fs.writeFileSync( wikiFile, lines.join( '\n' ) );
	console.log( `Wikitext written to ${ wikiFile }` );
	console.log( `${ files.length } repos, ${ totalTests } total tests` );
}

main();
