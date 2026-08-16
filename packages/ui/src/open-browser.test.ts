import { describe, expect, it } from 'vitest';
import { browserCommand, shouldOpenBrowser, type OpenDecision } from './open-browser.js';

/** An interactive launch, which is the only case that opens anything. */
const interactive: OpenDecision = { requested: true, json: false, isTty: true, env: {} };

describe('deciding whether to open a browser', () => {
  it('opens for an interactive launch', () => {
    expect(shouldOpenBrowser(interactive)).toBe(true);
  });

  it('does not open when the user said not to', () => {
    expect(shouldOpenBrowser({ ...interactive, requested: false })).toBe(false);
  });

  it('does not open when the output is for a program', () => {
    expect(shouldOpenBrowser({ ...interactive, json: true })).toBe(false);
  });

  it('does not open when stdout is not a terminal', () => {
    // A piped `termwright ui` is a script, and a script wants the URL.
    expect(shouldOpenBrowser({ ...interactive, isTty: false })).toBe(false);
  });

  it('does not open on CI, whatever CI is set to', () => {
    for (const value of ['true', '1', 'false']) {
      expect(shouldOpenBrowser({ ...interactive, env: { CI: value } })).toBe(false);
    }
  });

  it('treats an empty CI as unset', () => {
    expect(shouldOpenBrowser({ ...interactive, env: { CI: '' } })).toBe(true);
  });
});

describe('the platform command', () => {
  const url = 'http://127.0.0.1:5173/?token=abc';

  it('uses the launcher each platform has, with the token intact', () => {
    expect(browserCommand('darwin', url)).toEqual({ command: 'open', args: [url] });
    expect(browserCommand('linux', url)).toEqual({ command: 'xdg-open', args: [url] });
  });

  it('passes an empty window title on Windows', () => {
    // `start "http://..."` treats the URL as the title and opens nothing.
    expect(browserCommand('win32', url)).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', url],
    });
  });
});
