#!/usr/bin/env node

/**
 * Updates a MediaWiki page with the generated wikitext.
 *
 * Usage:
 *   node update-wiki.js
 *
 * Requires a .env file with:
 *   MW_USERNAME, MW_PASSWORD, MW_API_URL, MW_PAGE_TITLE
 */

'use strict';

const fs = require( 'fs' );
const https = require( 'https' );
const path = require( 'path' );

const wikiFile = path.resolve( 'results', 'browser-tests.wiki' );

function loadEnv() {
	const env = Object.assign( {}, process.env );
	const envPath = path.resolve( '.env' );
	if ( fs.existsSync( envPath ) ) {
		const lines = fs.readFileSync( envPath, 'utf-8' ).split( '\n' );
		for ( const line of lines ) {
			const match = line.match( /^(\w+)=(.*)$/ );
			if ( match ) {
				env[ match[ 1 ] ] = match[ 2 ].trim();
			}
		}
	}
	return env;
}

function httpPost( url, params, cookies ) {
	return new Promise( ( resolve, reject ) => {
		const body = new URLSearchParams( params ).toString();
		const parsed = new URL( url );
		const options = {
			hostname: parsed.hostname,
			path: parsed.pathname + parsed.search,
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'User-Agent': 'browser-test-scanner',
				'Content-Length': Buffer.byteLength( body )
			}
		};
		if ( cookies ) {
			options.headers.Cookie = cookies;
		}

		const req = https.request( options, ( res ) => {
			const chunks = [];
			// Collect set-cookie headers
			const setCookies = res.headers[ 'set-cookie' ] || [];
			res.on( 'data', ( chunk ) => chunks.push( chunk ) );
			res.on( 'end', () => {
				const text = Buffer.concat( chunks ).toString();
				try {
					resolve( { data: JSON.parse( text ), cookies: setCookies } );
				} catch {
					reject( new Error( `Invalid JSON response: ${ text.slice( 0, 200 ) }` ) );
				}
			} );
			res.on( 'error', reject );
		} );
		req.on( 'error', reject );
		req.write( body );
		req.end();
	} );
}

function mergeCookies( existing, newCookies ) {
	const map = {};
	const all = ( existing || '' ).split( '; ' ).concat(
		( newCookies || [] ).map( ( c ) => c.split( ';' )[ 0 ] )
	);
	for ( const c of all ) {
		const eqIdx = c.indexOf( '=' );
		if ( eqIdx > 0 ) {
			map[ c.slice( 0, eqIdx ) ] = c.slice( eqIdx + 1 );
		}
	}
	return Object.entries( map ).map( ( [ k, v ] ) => `${ k }=${ v }` ).join( '; ' );
}

async function main() {
	const env = loadEnv();
	const apiUrl = env.MW_API_URL;
	const username = env.MW_USERNAME;
	const password = env.MW_PASSWORD;
	const pageTitle = env.MW_PAGE_TITLE;

	if ( !apiUrl || !username || !password || !pageTitle ) {
		console.error( 'Error: .env must have MW_USERNAME, MW_PASSWORD, MW_API_URL, MW_PAGE_TITLE' );
		process.exit( 1 );
	}

	if ( !fs.existsSync( wikiFile ) ) {
		console.error( 'Error: results/browser-tests.wiki not found. Run node scan.js && node wikitext.js first.' );
		process.exit( 1 );
	}

	const wikitext = fs.readFileSync( wikiFile, 'utf-8' );
	let cookies = '';

	// Step 1: Get login token
	console.log( 'Getting login token...' );
	const tokenRes = await httpPost( apiUrl, {
		action: 'query',
		meta: 'tokens',
		type: 'login',
		format: 'json'
	}, cookies );
	const loginToken = tokenRes.data.query.tokens.logintoken;
	cookies = mergeCookies( cookies, tokenRes.cookies );

	// Step 2: Log in
	console.log( `Logging in as ${ username }...` );
	const loginRes = await httpPost( apiUrl, {
		action: 'login',
		lgname: username,
		lgpassword: password,
		lgtoken: loginToken,
		format: 'json'
	}, cookies );
	cookies = mergeCookies( cookies, loginRes.cookies );

	if ( loginRes.data.login.result !== 'Success' ) {
		console.error( `Login failed: ${ loginRes.data.login.result }` );
		process.exit( 1 );
	}
	console.log( 'Login successful.' );

	// Step 3: Get CSRF token
	const csrfRes = await httpPost( apiUrl, {
		action: 'query',
		meta: 'tokens',
		format: 'json'
	}, cookies );
	const csrfToken = csrfRes.data.query.tokens.csrftoken;
	cookies = mergeCookies( cookies, csrfRes.cookies );

	// Step 4: Edit the page
	console.log( `Updating ${ pageTitle }...` );
	const editRes = await httpPost( apiUrl, {
		action: 'edit',
		title: pageTitle,
		text: wikitext,
		summary: 'Update browser test listing (automated)',
		bot: '1',
		format: 'json',
		token: csrfToken
	}, cookies );

	if ( editRes.data.edit && editRes.data.edit.result === 'Success' ) {
		const status = editRes.data.edit.nochange !== undefined ? '(no change)' : '(updated)';
		console.log( `Page ${ status }: https://www.mediawiki.org/wiki/${ pageTitle }` );
	} else {
		console.error( 'Edit failed:', JSON.stringify( editRes.data, null, 2 ) );
		process.exit( 1 );
	}
}

main();
