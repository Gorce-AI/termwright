import { verifyImmutableBuildInputs } from '../immutable-build-manifest.mjs';

/**
 * Fail closed when a process-level test was started without its prebuilt
 * workspace inputs. Test workers only consume `dist`; producing or cleaning it
 * after the Native Host starts would race every other worker using that tree.
 *
 * @param {readonly string[]} entries
 * @param {{ readonly label: string; readonly buildCommand?: string }} options
 */
export async function requireImmutableBuildInputs(entries, options) {
  let issues;
  try {
    issues = await verifyImmutableBuildInputs(entries, options);
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    issues = [
      `build manifest is missing or unreadable: ${options.manifestPath ?? 'the workspace manifest'}`,
    ];
  }
  if (issues.length === 0) return;

  const command = options.buildCommand ?? 'pnpm build';
  throw new Error(
    `${options.label} requires immutable workspace build inputs before the Native Host starts. ` +
      `${issues.join('; ')}. Run \`${command}\` before the test command; ` +
      'tests must not build or clean shared dist directories during execution.',
  );
}
