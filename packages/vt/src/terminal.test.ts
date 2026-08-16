import { describe, expect, it } from 'vitest';
import { createTerminal, loadSerializeAddon } from './terminal.js';
import { DEFAULT_PROFILE, resolveProfile, resolveProfileId, TERMINAL_PROFILES } from './profiles.js';
import { isAmbiguousWidth } from './unicode.js';
import type { TerminalProfileLike } from './profiles.js';

/** Writes text and reports the columns each cell of the first row occupies. */
async function widths(text: string, profile?: TerminalProfileLike): Promise<number[]> {
  const { terminal } = createTerminal({ columns: 40, rows: 4, ...(profile !== undefined ? { profile } : {}) });
  await new Promise<void>((resolve) => terminal.write(text, resolve));
  const line = terminal.buffer.active.getLine(0);
  const out: number[] = [];
  for (let column = 0; column < 40; column += 1) {
    const cell = line?.getCell(column);
    if (cell === undefined) break;
    if (cell.getChars() === '' && cell.getWidth() === 1) break; // untouched cell
    out.push(cell.getWidth());
  }
  terminal.dispose();
  return out;
}

/** Total columns the text occupies. */
async function columnsUsed(text: string, profile?: TerminalProfileLike): Promise<number> {
  return (await widths(text, profile)).reduce((sum, width) => sum + width, 0);
}

describe('createTerminal', () => {
  it('activates the profile as the terminal’s Unicode version', () => {
    for (const [id, profile] of Object.entries(TERMINAL_PROFILES)) {
      const { terminal, profile: applied } = createTerminal({ columns: 10, rows: 2, profile: id as never });
      // The active version names the profile, so a replay can ask a terminal
      // which profile it is using.
      expect(terminal.unicode.activeVersion).toBe(id);
      expect(applied).toBe(profile);
      terminal.dispose();
    }
  });

  it('defaults to the conservative profile', () => {
    const { profile } = createTerminal({ columns: 10, rows: 2 });
    expect(profile).toBe(DEFAULT_PROFILE);
  });

  it('measures a wide character as two columns under every profile', async () => {
    for (const id of Object.keys(TERMINAL_PROFILES)) {
      expect(await columnsUsed('世', id as never), id).toBe(2);
    }
  });

  it('keeps ambiguous characters narrow by default and wide under the iTerm2 profile', async () => {
    // A box-drawing character is the case that decides whether a bordered
    // layout lines up, and it is exactly where terminals disagree.
    expect(await columnsUsed('│', 'default')).toBe(1);
    expect(await columnsUsed('│', 'iterm2-ambiguous-wide')).toBe(2);
    // Unambiguous characters are untouched by the switch.
    expect(await columnsUsed('a', 'iterm2-ambiguous-wide')).toBe(1);
    expect(await columnsUsed('世', 'iterm2-ambiguous-wide')).toBe(2);
  });

  it('promotes an emoji presentation sequence only where the profile says so', async () => {
    // ❤ is one column everywhere. ❤️ (the same character plus VS16) is the
    // emoji, and terminals disagree: that disagreement is the switch.
    expect(await columnsUsed('❤', 'default')).toBe(1);
    expect(await columnsUsed('❤️', 'default')).toBe(1);
    expect(await columnsUsed('❤️', 'kitty')).toBe(2);
  });

  it('keeps the three profiles behaviourally distinct', async () => {
    // A profile nobody can tell apart from another is not a profile.
    const probe = '│❤️';
    const measured = await Promise.all(
      (['default', 'kitty', 'iterm2-ambiguous-wide'] as const).map((id) => columnsUsed(probe, id)),
    );
    expect(new Set(measured).size).toBe(3);
  });

  it('honours the scrollback it was asked for', async () => {
    const { terminal } = createTerminal({ columns: 10, rows: 2, scrollback: 5 });
    await new Promise<void>((resolve) => terminal.write('a\r\nb\r\nc\r\nd\r\ne\r\n', resolve));
    expect(terminal.buffer.active.length).toBeGreaterThan(2);
    terminal.dispose();
  });

  it('loads the serialize addon without the caller touching the CJS interop', async () => {
    const { terminal } = createTerminal({ columns: 20, rows: 2 });
    const serialize = loadSerializeAddon(terminal);
    await new Promise<void>((resolve) => terminal.write('\x1b[31mred\x1b[0m', resolve));
    expect(serialize.serialize({ scrollback: 0 })).toContain('red');
    expect(serialize.serializeAsHTML().length).toBeGreaterThan(0);
    terminal.dispose();
  });
});

describe('resolveProfile', () => {
  it('accepts an id, a custom profile, or nothing', () => {
    expect(resolveProfile(undefined)).toBe(DEFAULT_PROFILE);
    expect(resolveProfile('kitty')).toBe(TERMINAL_PROFILES.kitty);
    const custom = { ...DEFAULT_PROFILE, id: 'mine', ambiguousWide: true };
    expect(resolveProfile(custom)).toBe(custom);
  });

  it('refuses an unknown id instead of silently defaulting', () => {
    expect(() => resolveProfile('konsole' as never)).toThrow(/unknown terminal profile/u);
  });
});

describe('resolveProfileId', () => {
  it('answers with a profile or with nothing, and never throws', () => {
    // For callers holding a string read from a recording: they report an
    // unknown profile in their own vocabulary instead of catching ours.
    expect(resolveProfileId('kitty')).toBe(TERMINAL_PROFILES.kitty);
    expect(resolveProfileId('konsole')).toBeUndefined();
    expect(resolveProfileId('')).toBeUndefined();
    expect(resolveProfileId('__proto__')).toBeUndefined();
  });
});

describe('isAmbiguousWidth', () => {
  it('covers the characters terminal layouts are built from', () => {
    for (const codepoint of [0x2502, 0x2588, 0x2190, 0x25cf, 0x2460, 0x03b1, 0x0430]) {
      expect(isAmbiguousWidth(codepoint), codepoint.toString(16)).toBe(true);
    }
  });

  it('leaves plainly narrow and plainly wide characters alone', () => {
    for (const codepoint of [0x0061, 0x4e00, 0x1f600, 0x0020]) {
      expect(isAmbiguousWidth(codepoint), codepoint.toString(16)).toBe(false);
    }
  });
});

describe('the portable half', () => {
  it('applies a profile to any terminal-shaped object, browser or headless', async () => {
    // What a browser consumer does: its own addon, its own terminal, our
    // profile — no @xterm/headless anywhere in the path.
    const { applyProfile } = await import('./unicode.js');
    const unicode11 = (await import('@xterm/addon-unicode11')).default;

    const registered: { version: string; wcwidth(cp: number): number }[] = [];
    let active = '';
    const unicode = {
      register(provider: { version: string; wcwidth(cp: number): number }): void {
        registered.push(provider);
      },
      get activeVersion(): string {
        return active;
      },
      set activeVersion(value: string) {
        active = value;
      },
    };

    applyProfile(unicode as never, new unicode11.Unicode11Addon() as never, TERMINAL_PROFILES['iterm2-ambiguous-wide']);

    // Registering alone changes nothing: the provider must also be activated.
    expect(active).toBe('iterm2-ambiguous-wide');
    expect(registered).toHaveLength(1);
    // And it is the profile's provider, not the addon's own.
    expect(registered[0]?.wcwidth(0x2502)).toBe(2);
    expect(registered[0]?.wcwidth(0x0061)).toBe(1);
  });

  it('reads a provider out of an addon without registering it anywhere', async () => {
    const { captureAddonProvider } = await import('./unicode.js');
    const unicode11 = (await import('@xterm/addon-unicode11')).default;

    const base = captureAddonProvider(new unicode11.Unicode11Addon() as never, '11');
    expect(base.version).toBe('11');
    expect(base.wcwidth(0x4e00)).toBe(2);
    // Untouched by the profile: the box character is still narrow here.
    expect(base.wcwidth(0x2502)).toBe(1);
  });
});
