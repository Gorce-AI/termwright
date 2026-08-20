import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, normalizePreferences } from './preferences.js';

describe('preferences validation', () => {
  it('clamps supported values and replaces malformed fields independently', () => {
    expect(normalizePreferences({ version: 1, railShare: 9, inspectorShare: -2, timelineDensity: 'huge', autoLiveReplay: false })).toMatchObject({
      railShare: .42,
      inspectorShare: .2,
      timelineDensity: 'compact',
      autoLiveReplay: false,
    });
  });

  it('does not interpret or overwrite a future schema as version one', () => {
    expect(normalizePreferences({ version: 2, navigationExpanded: true })).toEqual(DEFAULT_PREFERENCES);
  });
});
