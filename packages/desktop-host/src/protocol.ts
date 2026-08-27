export const DESKTOP_HOST_PROTOCOL = 1 as const;
export const MAX_CONTROL_MESSAGE_BYTES = 8 * 1024;
export const DESKTOP_CONTROL_ENV = 'TERMWRIGHT_DESKTOP_CONTROL';

export interface DesktopBootstrap {
  readonly protocol: typeof DESKTOP_HOST_PROTOCOL;
  readonly type: 'bootstrap';
  readonly url: string;
}

export type DesktopControl =
  | DesktopBootstrap
  | {
      readonly protocol: typeof DESKTOP_HOST_PROTOCOL;
      readonly type: 'shutdown';
    };

export type DesktopHostMessage =
  | {
      readonly protocol: typeof DESKTOP_HOST_PROTOCOL;
      readonly type: 'stage';
      readonly stage: 'connected' | 'app-ready' | 'window-created' | 'loaded';
    }
  | { readonly protocol: typeof DESKTOP_HOST_PROTOCOL; readonly type: 'ready' }
  | { readonly protocol: typeof DESKTOP_HOST_PROTOCOL; readonly type: 'closed' }
  | {
      readonly protocol: typeof DESKTOP_HOST_PROTOCOL;
      readonly type: 'error';
      readonly message: string;
    };

export interface ValidatedRunnerUrl {
  readonly href: string;
  readonly origin: string;
  readonly websocketOrigin: string;
}

/** Validate the complete URL before Electron sees it. */
export function validateRunnerUrl(input: string): ValidatedRunnerUrl {
  if (Buffer.byteLength(input, 'utf8') > MAX_CONTROL_MESSAGE_BYTES) {
    throw new Error('runner URL exceeds the desktop bootstrap limit');
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('runner URL is not valid');
  }
  if (url.protocol !== 'http:') throw new Error('desktop runner URL must use http');
  if (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') {
    throw new Error('desktop runner URL must use a loopback address');
  }
  if (url.username !== '' || url.password !== '')
    throw new Error('desktop runner URL cannot contain credentials');
  const tokens = url.searchParams.getAll('token');
  if (tokens.length !== 1 || tokens[0] === '')
    throw new Error('desktop runner URL needs one token');
  url.hash = '';
  const websocket = new URL(url.origin);
  websocket.protocol = 'ws:';
  return { href: url.href, origin: url.origin, websocketOrigin: websocket.origin };
}

export function encodeControlMessage(message: DesktopControl | DesktopHostMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseControlMessage(line: string): DesktopControl | DesktopHostMessage {
  if (Buffer.byteLength(line, 'utf8') > MAX_CONTROL_MESSAGE_BYTES)
    throw new Error('desktop control message is too large');
  const value: unknown = JSON.parse(line);
  if (value === null || typeof value !== 'object')
    throw new Error('desktop control message must be an object');
  const message = value as { protocol?: unknown; type?: unknown; url?: unknown; message?: unknown };
  if (message.protocol !== DESKTOP_HOST_PROTOCOL)
    throw new Error('incompatible desktop host protocol');
  if (message.type === 'bootstrap' && typeof message.url === 'string')
    return {
      protocol: DESKTOP_HOST_PROTOCOL,
      type: 'bootstrap',
      url: message.url,
    };
  if (message.type === 'shutdown') return { protocol: DESKTOP_HOST_PROTOCOL, type: 'shutdown' };
  if (message.type === 'ready' || message.type === 'closed')
    return {
      protocol: DESKTOP_HOST_PROTOCOL,
      type: message.type,
    };
  if (
    message.type === 'stage' &&
    message.message === undefined &&
    ['connected', 'app-ready', 'window-created', 'loaded'].includes(
      (value as { stage?: string }).stage ?? '',
    )
  )
    return {
      protocol: DESKTOP_HOST_PROTOCOL,
      type: 'stage',
      stage: (value as { stage: 'connected' | 'app-ready' | 'window-created' | 'loaded' }).stage,
    };
  if (message.type === 'error' && typeof message.message === 'string')
    return {
      protocol: DESKTOP_HOST_PROTOCOL,
      type: 'error',
      message: message.message,
    };
  throw new Error('unknown desktop control message');
}
