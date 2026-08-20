import { describe, expect, it } from 'vitest';
import { validateRunnerUrl } from './protocol.js';
import {
  SECURE_WEB_PREFERENCES,
  contentSecurityPolicy,
  isAllowedNavigation,
  isAllowedRequest,
} from './security.js';

describe('desktop host boundary', () => {
  const runner = validateRunnerUrl('http://127.0.0.1:5000/?token=secret');

  it('accepts only authenticated loopback runner URLs', () => {
    expect(validateRunnerUrl('http://[::1]:6000/?token=x').origin).toBe('http://[::1]:6000');
    for (const url of [
      'https://127.0.0.1:5000/?token=x',
      'http://localhost:5000/?token=x',
      'http://0.0.0.0:5000/?token=x',
      'http://127.0.0.1:5000/',
      'http://127.0.0.1:5000/?token=x&token=y',
    ]) expect(() => validateRunnerUrl(url), url).toThrow();
  });

  it('keeps Node and privileged renderer features disabled', () => {
    expect(SECURE_WEB_PREFERENCES).toMatchObject({
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      devTools: false,
    });
  });

  it('allows only this server for navigation and network', () => {
    expect(isAllowedNavigation('http://127.0.0.1:5000/runs?token=secret', runner)).toBe(true);
    expect(isAllowedNavigation('https://example.com/', runner)).toBe(false);
    expect(isAllowedRequest('http://127.0.0.1:5000/app.js', runner)).toBe(true);
    expect(isAllowedRequest('ws://127.0.0.1:5000/ws?token=secret', runner)).toBe(true);
    expect(isAllowedRequest('http://127.0.0.1:5001/', runner)).toBe(false);
    expect(isAllowedRequest('https://example.com/', runner)).toBe(false);
  });

  it('builds a CSP limited to the runner origin', () => {
    const csp = contentSecurityPolicy(runner);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('connect-src http://127.0.0.1:5000 ws://127.0.0.1:5000');
    expect(csp).not.toContain('secret');
  });
});
