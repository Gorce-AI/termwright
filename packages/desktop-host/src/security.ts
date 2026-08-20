import type { WebPreferences } from 'electron';
import type { ValidatedRunnerUrl } from './protocol.js';

/** Effective renderer boundary. Kept as data so it can be asserted without a display. */
export const SECURE_WEB_PREFERENCES = Object.freeze({
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
} satisfies WebPreferences);

export function isAllowedRequest(rawUrl: string, runner: ValidatedRunnerUrl): boolean {
  if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) return true;
  try {
    const url = new URL(rawUrl);
    return url.origin === runner.origin || url.origin === runner.websocketOrigin;
  } catch {
    return false;
  }
}

export function isAllowedNavigation(rawUrl: string, runner: ValidatedRunnerUrl): boolean {
  try {
    return new URL(rawUrl).origin === runner.origin;
  } catch {
    return false;
  }
}

export function contentSecurityPolicy(runner: ValidatedRunnerUrl): string {
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${runner.origin} ${runner.websocketOrigin}`,
  ].join('; ');
}
