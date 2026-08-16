/**
 * Opening the runner in the user's browser.
 *
 * The URL carries a per-launch token, so the thing that gets opened is the
 * *whole* URL or nothing — a tokenless address renders an unauthorised page and
 * teaches the user that the feature is broken.
 *
 * Opening is an addition, never a replacement: the URL is printed either way.
 * A failure here degrades to what the command did before, and is not an error,
 * because there is nothing the user can do about a machine with no browser
 * except copy the line that is already on their screen.
 */

import { spawn } from 'node:child_process';

/** The circumstances that decide whether opening a browser is welcome. */
export interface OpenDecision {
  /** False when the user passed `--no-open`. */
  readonly requested: boolean;
  /** True when the command speaks JSON to a program rather than to a person. */
  readonly json: boolean;
  /** Whether stdout is a terminal. */
  readonly isTty: boolean;
  /** The environment, read for `CI`. */
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Whether to open a browser.
 *
 * Interactive use is the only case that gets a window. A pipe, a JSON consumer
 * and CI all get the URL alone: opening a browser on a build agent is at best
 * noise and at worst a hung process holding the job open.
 */
export function shouldOpenBrowser(decision: OpenDecision): boolean {
  if (!decision.requested) return false;
  if (decision.json) return false;
  if (!decision.isTty) return false;
  // Any value at all, `false` included: setting CI=false to mean "not CI" is
  // not a convention anyone follows, and CI agents only ever set it to `true`.
  return decision.env['CI'] === undefined || decision.env['CI'] === '';
}

/**
 * The platform's own "open this with whatever handles it" command.
 *
 * Native commands rather than a dependency: this is one line per platform, and
 * the alternative is shipping a package to every user of the CLI for it.
 */
export function browserCommand(
  platform: NodeJS.Platform,
  url: string,
): { readonly command: string; readonly args: readonly string[] } {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  // `start` is a shell builtin, and its first quoted argument is the window
  // title — omitting it makes the URL the title and opens nothing.
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  return { command: 'xdg-open', args: [url] };
}

/**
 * Open `url` in the default browser.
 *
 * @returns whether the command could be started. The browser's own success is
 * not observable — a handler that opens a tab and one that silently does
 * nothing both exit zero — so this reports the launch, not the outcome.
 */
export async function openInBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const { command, args } = browserCommand(platform, url);
  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(command, [...args], { stdio: 'ignore', detached: true });
      // The browser outlives the CLI: a launcher kept as a child would hold the
      // process open, and closing the CLI would be free to take the tab with it.
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
