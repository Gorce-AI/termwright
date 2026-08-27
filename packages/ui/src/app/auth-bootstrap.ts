const TOKEN_PARAM = 'token';
const SESSION_KEY_PREFIX = 'termwright.runner-token:';

/**
 * Moves the one-shot URL credential into tab-scoped storage before React starts.
 * This preserves authenticated refreshes without retaining the secret in a URL,
 * a deep link, browser history state, or cross-tab storage.
 */
export function bootstrapRunnerToken(
  url: URL = new URL(window.location.href),
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.sessionStorage,
  history: Pick<History, 'replaceState' | 'state'> = window.history,
): string {
  const key = `${SESSION_KEY_PREFIX}${url.origin}`;
  const supplied = url.searchParams.get(TOKEN_PARAM);
  if (supplied !== null && supplied !== '') {
    try {
      storage.setItem(key, supplied);
    } catch {
      /* The current page can still use the one-shot credential. */
    }
  }
  if (url.searchParams.has(TOKEN_PARAM)) {
    url.searchParams.delete(TOKEN_PARAM);
    history.replaceState(history.state, '', url);
  }
  if (supplied !== null && supplied !== '') return supplied;
  try {
    return storage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
