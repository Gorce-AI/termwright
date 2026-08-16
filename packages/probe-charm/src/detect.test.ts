/**
 * Detection, against real modules resolved by a real toolchain.
 *
 * The case worth the setup cost is v2: a probe that knows only the GitHub path
 * misses it entirely and reports nothing, which looks like an application
 * without semantics rather than like a bug.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BUBBLETEA_MODULES,
  capabilitiesFor,
  CharmDetectionError,
  detectCharmFlavour,
  reportsGeometry,
} from './detect.js';

const run = promisify(execFile);

async function goAvailable(): Promise<boolean> {
  if (process.env['TERMWRIGHT_SKIP_GO'] === '1') return false;
  try {
    await run('go', ['version']);
    return true;
  } catch {
    return false;
  }
}

const hasGo = await goAvailable();
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A module that requires exactly what it is told to. */
async function moduleRequiring(requires: readonly string[]): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tw-charm-')));
  roots.push(dir);
  await writeFile(
    join(dir, 'go.mod'),
    `module example.com/app\n\ngo 1.22\n\n${requires.map((line) => `require ${line}\n`).join('')}`,
    'utf8',
  );
  await writeFile(join(dir, 'doc.go'), 'package app\n', 'utf8');
  return dir;
}

describe('what the majors are called', () => {
  it('does not derive the v2 path from the v1 one', () => {
    // The mistake this constant exists to prevent. `…/bubbletea/v2` under the
    // GitHub path is not a thing, and asking for it fails with "module
    // declares its path as: charm.land/bubbletea/v2".
    expect(BUBBLETEA_MODULES.v1).toBe('github.com/charmbracelet/bubbletea');
    expect(BUBBLETEA_MODULES.v2).toBe('charm.land/bubbletea/v2');
    expect(BUBBLETEA_MODULES.v2.startsWith(BUBBLETEA_MODULES.v1)).toBe(false);
  });
});

describe('what each major can promise', () => {
  it('claims bounds only where a channel survives the string', () => {
    // Both majors flatten the frame to one styled string, and Lip Gloss
    // destroys the fragment→region mapping on the way. v2 keeps two channels
    // that survive it; v1 keeps none, and says so instead of guessing.
    expect(capabilitiesFor('v2')).toContain('bounds');
    expect(capabilitiesFor('v1')).not.toContain('bounds');
    expect(reportsGeometry('v1')).toBe(false);
    expect(reportsGeometry('v2')).toBe(true);
  });

  it('reports a tree in both majors, because component and fragment are known', () => {
    for (const major of ['v1', 'v2'] as const) {
      expect(capabilitiesFor(major)).toContain('tree');
      expect(capabilitiesFor(major)).toContain('states');
    }
  });
});

describe.skipIf(!hasGo)('against a real toolchain', () => {
  it('recognises a v1 project', async () => {
    const dir = await moduleRequiring([
      'github.com/charmbracelet/bubbletea v1.3.10',
      'github.com/charmbracelet/bubbles v1.0.0',
    ]);

    const flavour = await detectCharmFlavour(dir);

    expect(flavour.major).toBe('v1');
    expect(flavour.module).toBe('github.com/charmbracelet/bubbletea');
    expect(flavour.version).toBe('v1.3.10');
    expect(flavour.companions['github.com/charmbracelet/bubbles']).toBe('v1.0.0');
  }, 300_000);

  it('recognises a v2 project under its vanity path', async () => {
    const dir = await moduleRequiring([
      'charm.land/bubbletea/v2 v2.0.8',
      'charm.land/lipgloss/v2 v2.0.6',
    ]);

    const flavour = await detectCharmFlavour(dir);

    expect(flavour.major).toBe('v2');
    expect(flavour.version).toBe('v2.0.8');
    expect(flavour.companions['charm.land/lipgloss/v2']).toBe('v2.0.6');
  }, 300_000);

  it('says a project is not Charm rather than guessing a major', async () => {
    const dir = await moduleRequiring(['github.com/rivo/tview v0.42.0']);

    await expect(detectCharmFlavour(dir)).rejects.toThrow(CharmDetectionError);
    await expect(detectCharmFlavour(dir)).rejects.toThrow(/does not require Bubble Tea/u);
  }, 300_000);

  it('refuses a project that pulls in both majors', async () => {
    // Legal in Go, since the paths are unrelated modules, and hopeless here:
    // two event loops and no way to attribute a frame to one of them.
    const dir = await moduleRequiring([
      'github.com/charmbracelet/bubbletea v1.3.10',
      'charm.land/bubbletea/v2 v2.0.8',
    ]);

    await expect(detectCharmFlavour(dir)).rejects.toThrow(/requires both Bubble Tea majors/u);
  }, 300_000);
});

describe.skipIf(hasGo)('the Go arms', () => {
  it('skips because no go toolchain is reachable', () => {
    expect(hasGo).toBe(false);
  });
});
