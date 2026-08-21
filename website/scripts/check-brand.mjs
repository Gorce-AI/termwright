import {readFile} from 'node:fs/promises';

const canonicalIcon = new URL(
	'../../assets/brand/termwright-icon.svg',
	import.meta.url,
);
const canonicalLogo = new URL(
	'../../assets/brand/termwright-logo.svg',
	import.meta.url,
);
const websiteLogo = new URL('../src/assets/termwright-logo.svg', import.meta.url);
const websiteMark = new URL('../src/assets/termwright-mark.svg', import.meta.url);
const websiteFavicon = new URL('../public/favicon.svg', import.meta.url);
const runnerIcon = new URL('../../packages/ui/src/app/termwright-icon.svg', import.meta.url);

const [icon, favicon, uiIcon, logo, webLogo, webMark] = await Promise.all([
	readFile(canonicalIcon),
	readFile(websiteFavicon),
	readFile(runnerIcon),
	readFile(canonicalLogo),
	readFile(websiteLogo),
	readFile(websiteMark),
]);

if (!icon.equals(favicon)) {
	console.error(
		'website/public/favicon.svg must match assets/brand/termwright-icon.svg byte-for-byte.',
	);
	process.exitCode = 1;
}

if (!icon.equals(uiIcon)) {
	console.error(
		'packages/ui/src/app/termwright-icon.svg must match assets/brand/termwright-icon.svg byte-for-byte.',
	);
	process.exitCode = 1;
}

if (!icon.equals(webMark)) {
	console.error(
		'website/src/assets/termwright-mark.svg must match assets/brand/termwright-icon.svg byte-for-byte.',
	);
	process.exitCode = 1;
}

const validWebLogo = logo[0] === 0x0a ? logo.subarray(1) : logo;
if (!validWebLogo.equals(webLogo)) {
	console.error(
		'website/src/assets/termwright-logo.svg must match the canonical logo after removing its optional leading blank line.',
	);
	process.exitCode = 1;
}
