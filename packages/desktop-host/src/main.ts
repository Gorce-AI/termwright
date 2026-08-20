import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:net';
import { app, BrowserWindow, nativeImage, session, type Session } from 'electron';
import {
  DESKTOP_HOST_PROTOCOL,
  DESKTOP_CONTROL_ENV,
  MAX_CONTROL_MESSAGE_BYTES,
  encodeControlMessage,
  parseControlMessage,
  validateRunnerUrl,
  type DesktopBootstrap,
  type DesktopControl,
  type DesktopHostMessage,
  type ValidatedRunnerUrl,
} from './protocol.js';
import {
  SECURE_WEB_PREFERENCES,
  contentSecurityPolicy,
  isAllowedNavigation,
  isAllowedRequest,
} from './security.js';

app.enableSandbox();
app.setName('Termwright');
// Register before waiting for the private bootstrap. On macOS Electron emits
// ready during its own bundle bootstrap and does not replay it for a late
// `whenReady()` subscriber.
const appReady = app.whenReady();

const controlAddress = process.env[DESKTOP_CONTROL_ENV];
delete process.env[DESKTOP_CONTROL_ENV];
if (controlAddress === undefined || controlAddress === '') throw new Error('desktop control address is missing');
const control = connect(controlAddress);
control.setEncoding('utf8');
const replies = control;
let buffer = '';
let quitting = false;
let window: BrowserWindow | undefined;
let hostSession: Session | undefined;

function reply(message: DesktopHostMessage): void {
  if (!replies.destroyed) replies.write(encodeControlMessage(message));
}

function quit(): void {
  if (quitting) return;
  quitting = true;
  window?.destroy();
  window = undefined;
  void hostSession?.clearStorageData().finally(() => app.quit());
  if (hostSession === undefined) app.quit();
}

function readBootstrap(): Promise<DesktopBootstrap> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: string | Buffer): void => {
      buffer += chunk.toString();
      if (Buffer.byteLength(buffer, 'utf8') > MAX_CONTROL_MESSAGE_BYTES * 2) {
        reject(new Error('desktop bootstrap is too large'));
        return;
      }
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message: DesktopControl | DesktopHostMessage;
        try {
          message = parseControlMessage(line);
        } catch (error) {
          reject(error);
          return;
        }
        if (message.type === 'bootstrap') {
          control.off('data', onData);
          resolve(message);
          return;
        }
        reject(new Error('desktop host expected a bootstrap message'));
        return;
      }
    };
    control.on('data', onData);
    control.once('error', reject);
    control.once('end', () => reject(new Error('desktop control channel closed before bootstrap')));
  });
}

function installControlLoop(): void {
  const consume = (): void => {
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const message = parseControlMessage(line);
        if (message.type === 'shutdown') quit();
      } catch {
        quit();
      }
    }
  };
  control.on('data', (chunk: string | Buffer) => {
    buffer += chunk.toString();
    if (Buffer.byteLength(buffer, 'utf8') > MAX_CONTROL_MESSAGE_BYTES * 2) return quit();
    consume();
  });
  // Losing the parent is terminal: never leave an authenticated runner window orphaned.
  control.once('end', quit);
  control.once('error', quit);
}

function configureSession(partition: Session, runner: ValidatedRunnerUrl): void {
  partition.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  partition.setPermissionCheckHandler(() => false);
  partition.on('will-download', (event, item) => {
    event.preventDefault();
    item.cancel();
  });
  partition.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => callback({ cancel: !isAllowedRequest(details.url, runner) }),
  );
  const csp = contentSecurityPolicy(runner);
  partition.webRequest.onHeadersReceived(
    { urls: [`${runner.origin}/*`] },
    (details, callback) => callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    }),
  );
}

async function start(bootstrap: DesktopBootstrap): Promise<void> {
  const runner = validateRunnerUrl(bootstrap.url);
  reply({ protocol: DESKTOP_HOST_PROTOCOL, type: 'stage', stage: 'connected' });
  await appReady;
  reply({ protocol: DESKTOP_HOST_PROTOCOL, type: 'stage', stage: 'app-ready' });
  const partitionName = `termwright-${randomUUID()}`;
  hostSession = session.fromPartition(partitionName, { cache: false });
  configureSession(hostSession, runner);
  const icon = nativeImage.createFromPath(fileURLToPath(new URL('./termwright-icon.svg', import.meta.url)));
  if (process.platform === 'darwin' && !icon.isEmpty()) app.dock?.setIcon(icon);

  const created = new BrowserWindow({
    title: 'Termwright',
    width: 1440,
    height: 960,
    minWidth: 860,
    minHeight: 600,
    show: false,
    backgroundColor: '#090f17',
    autoHideMenuBar: true,
    ...(!icon.isEmpty() ? { icon } : {}),
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      partition: partitionName,
    },
  });
  window = created;
  reply({ protocol: DESKTOP_HOST_PROTOCOL, type: 'stage', stage: 'window-created' });
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, runner)) event.preventDefault();
  });
  created.webContents.on('will-attach-webview', (event) => event.preventDefault());
  created.webContents.on('render-process-gone', () => {
    if (!quitting) reply({ protocol: DESKTOP_HOST_PROTOCOL, type: 'error', message: 'runner renderer stopped' });
    quit();
  });
  created.on('closed', () => {
    window = undefined;
    reply({ protocol: DESKTOP_HOST_PROTOCOL, type: 'closed' });
    quit();
  });

  await created.loadURL(runner.href);
  reply({ protocol: DESKTOP_HOST_PROTOCOL, type: 'stage', stage: 'loaded' });
  if (quitting) return;
  created.show();
  reply({ protocol: DESKTOP_HOST_PROTOCOL, type: 'ready' });
  installControlLoop();
}

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[runner URL]') : 'desktop host failed';
  reply({ protocol: DESKTOP_HOST_PROTOCOL, type: 'error', message });
  quit();
}

// Do not top-level-await `app.whenReady()`: Electron emits `ready` only after
// the entry module has finished evaluating, so awaiting it here deadlocks the
// main process before a BrowserWindow can exist.
void readBootstrap().then(start).catch(fail);
