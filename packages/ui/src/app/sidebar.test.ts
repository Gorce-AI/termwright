import { describe, expect, it } from 'vitest';
import { ENTRY_VIEWS, visibleEntries } from './sidebar.js';

const project = { name: 'demo', root: '/repo', branch: 'main', version: '0.1.0' };

describe('what the frame offers', () => {
  it('offers every place when a server is behind the page', () => {
    expect(visibleEntries({ project, view: 'specs', running: false, hasRunner: true, hasHistory: true })).toEqual(
      ENTRY_VIEWS,
    );
  });

  it('drops the history when the source holds one recording', () => {
    // A self-contained report cannot list past runs, and a destination that
    // always fails is worse than one that is not offered.
    const entries = visibleEntries({
      project,
      view: 'runner',
      running: false,
      hasRunner: true,
      hasHistory: false,
    });
    expect(entries).not.toContain('runs');
    expect(entries).toContain('runner');
  });
});
