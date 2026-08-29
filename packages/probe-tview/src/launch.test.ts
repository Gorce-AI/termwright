import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compilerUnitTargetsForPlatform } from './launch.js';

const here = dirname(fileURLToPath(import.meta.url));
const WINDOWS_MARKER_SOURCE = join(here, '..', 'assets', 'tcell_marker_windows.go.txt');

describe('tview compiler units', () => {
  it('selects the Windows same-handle unit only for Windows compilers', () => {
    expect(compilerUnitTargetsForPlatform('linux')).toEqual(['zz_termwright_probe.go']);
    expect(compilerUnitTargetsForPlatform('darwin')).toEqual(['zz_termwright_probe.go']);
    expect(compilerUnitTargetsForPlatform('windows')).toEqual([
      'zz_termwright_probe.go',
      'zz_termwright_marker.go',
    ]);
  });

  it('checks the live Windows writer capability without a version-private tcell switch', async () => {
    const source = await readFile(WINDOWS_MARKER_SOURCE, 'utf8');
    expect(source).toContain('s.Lock()\n\tdefer s.Unlock()');
    expect(source).toContain('termwrightGetConsoleMode.Call(uintptr(s.out)');
    expect(source).toContain(
      'originalMode&termwrightMarkerOutputMode != termwrightMarkerOutputMode',
    );
    expect(source).toContain('syscall.WriteConsole(s.out');
    expect(source).not.toContain('s.vten');
    expect(source).toContain('termwrightSetConsoleMode.Call(uintptr(s.out)');
    expect(source).toContain('activeMode&termwrightMarkerOutputMode != termwrightMarkerOutputMode');
    expect(source).toContain('if restored == 0 && resultErr == nil');
  });
});
