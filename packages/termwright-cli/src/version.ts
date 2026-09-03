/**
 * Identity of the umbrella package, shared by the CLI and the library entry.
 *
 * Duplicated from `package.json` on purpose: importing JSON would force
 * `resolveJsonModule` and put a `package.json` read into every consumer's
 * bundle. Bump both together.
 */

/** The binary's name, as it appears in usage text. */
export const CLI_NAME = 'termwright';

/** Keep in sync with `package.json`. */
export const CLI_VERSION = '0.5.0';
