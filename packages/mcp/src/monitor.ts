import { randomBytes } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLoopbackHost } from './http-security.js';
import type { SessionStores } from './sessions.js';
import type { CellColor, CellSnapshot, ScreenSnapshot } from '@termwright/driver';

export interface MonitorOptions {
  readonly host?: string;
  readonly port?: number;
  readonly openBrowser?: boolean;
  /** Called once the lazy monitor has a URL. Useful when browser opening is disabled. */
  readonly onStarted?: (url: string) => void;
  /** Reports monitor startup/teardown failures without failing the terminal tool call. */
  readonly onError?: (error: unknown) => void;
  /** Injectable owned browser session. The default starts a dedicated local browser process. */
  readonly browserLauncher?: (
    url: string,
  ) => Promise<MonitorBrowserSession> | MonitorBrowserSession;
}

export interface MonitorBrowserSession {
  close(): Promise<void> | void;
}

export interface MonitorHandle {
  readonly http: Server;
  readonly url: string;
  close(): Promise<void>;
}

export interface MonitorLifecycle {
  readonly url: string | undefined;
  terminalLaunched(): Promise<void>;
  terminalClosed(): Promise<void>;
  close(): Promise<void>;
}

function colorValue(color: CellColor): string | null {
  if (color.kind === 'default') return null;
  if (color.kind === 'palette') return `p${color.index}`;
  return `#${[color.r, color.g, color.b].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}

function attributeBits(cell: CellSnapshot): number {
  const value = cell.attributes;
  return (
    (value.bold ? 1 : 0) |
    (value.dim ? 2 : 0) |
    (value.italic ? 4 : 0) |
    (value.underline ? 8 : 0) |
    (value.inverse ? 16 : 0) |
    (value.strikethrough ? 32 : 0)
  );
}

function screenRows(screen: ScreenSnapshot): readonly unknown[] {
  const rows: unknown[] = [];
  for (let row = 0; row < screen.rows; row += 1) {
    const runs: [string, string | null, string | null, number][] = [];
    for (let column = 0; column < screen.columns; column += 1) {
      const cell = screen.cell(row, column);
      if (cell.width === 0) continue;
      const text = cell.char || ' ';
      const fg = colorValue(cell.fg);
      const bg = colorValue(cell.bg);
      const attributes = attributeBits(cell);
      const last = runs.at(-1);
      if (last !== undefined && last[1] === fg && last[2] === bg && last[3] === attributes) {
        last[0] += text;
      } else {
        runs.push([text, fg, bg, attributes]);
      }
    }
    rows.push(runs);
  }
  return rows;
}

type TerminalMonitorState = Record<string, unknown> & { readonly id: string };

function monitorState(
  stores: SessionStores,
  previousTerminals: Map<string, TerminalMonitorState>,
): Record<string, unknown> {
  return {
    terminals: stores.terminals.list().map((entry) => {
      let screen: ReturnType<typeof entry.harness.screen>;
      try {
        screen = entry.harness.screen();
      } catch {
        const previous = previousTerminals.get(entry.id);
        return previous === undefined
          ? {
              id: entry.id,
              revision: 0,
              columns: 0,
              rows: 0,
              buffer: 'normal',
              text: '',
              exit: entry.exit,
              recording: entry.writer !== undefined,
              semanticRevision: null,
              nodes: [],
              closing: true,
            }
          : { ...previous, exit: entry.exit, closing: true };
      }
      // The semantic channel can be between frames while the PTY screen is
      // already valid. A semantic read failure must never erase the terminal.
      let semantic: ReturnType<typeof entry.harness.semanticTree> = null;
      try {
        semantic = entry.harness.semanticTree();
      } catch {
        semantic = null;
      }
      const state: TerminalMonitorState = {
        id: entry.id,
        revision: screen.revision,
        columns: screen.columns,
        rows: screen.rows,
        buffer: screen.buffer,
        text: screen.text(),
        cellRows:
          previousTerminals.get(entry.id)?.['revision'] === screen.revision
            ? previousTerminals.get(entry.id)?.['cellRows']
            : screenRows(screen),
        cursor: screen.cursor,
        exit: entry.exit,
        recording: entry.writer !== undefined,
        semanticRevision: semantic?.revision ?? null,
        nodes:
          semantic?.nodes.map((node) => ({
            id: node.id,
            parentId: node.parentId,
            role: node.role,
            name: node.name,
            description: node.description,
            testId: node.testId,
            state: node.state,
            value: node.value,
            actions: node.actions,
            bounds:
              node.geometry.visibleRect.status === 'known'
                ? node.geometry.visibleRect.value
                : undefined,
          })) ?? [],
      };
      previousTerminals.set(entry.id, state);
      return state;
    }),
    watchers: stores.watchers.list(),
  };
}

function sendJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

function browserCandidates(): readonly { file: string; family: 'chromium' | 'firefox' }[] {
  if (process.platform === 'darwin') {
    return [
      {
        file: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        family: 'chromium',
      },
      {
        file: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        family: 'chromium',
      },
      {
        file: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        family: 'chromium',
      },
      { file: '/Applications/Chromium.app/Contents/MacOS/Chromium', family: 'chromium' },
      { file: '/Applications/Firefox.app/Contents/MacOS/firefox', family: 'firefox' },
    ];
  }
  if (process.platform === 'win32') {
    const roots = [
      process.env['PROGRAMFILES'],
      process.env['PROGRAMFILES(X86)'],
      process.env['LOCALAPPDATA'],
    ].filter((value): value is string => value !== undefined);
    return roots.flatMap((root) => [
      { file: join(root, 'Google/Chrome/Application/chrome.exe'), family: 'chromium' as const },
      { file: join(root, 'Microsoft/Edge/Application/msedge.exe'), family: 'chromium' as const },
      {
        file: join(root, 'BraveSoftware/Brave-Browser/Application/brave.exe'),
        family: 'chromium' as const,
      },
      { file: join(root, 'Mozilla Firefox/firefox.exe'), family: 'firefox' as const },
    ]);
  }
  return [
    { file: '/usr/bin/google-chrome', family: 'chromium' },
    { file: '/usr/bin/google-chrome-stable', family: 'chromium' },
    { file: '/usr/bin/chromium', family: 'chromium' },
    { file: '/usr/bin/chromium-browser', family: 'chromium' },
    { file: '/usr/bin/microsoft-edge', family: 'chromium' },
    { file: '/usr/bin/brave-browser', family: 'chromium' },
    { file: '/usr/bin/firefox', family: 'firefox' },
  ];
}

async function openBrowser(url: string): Promise<MonitorBrowserSession> {
  const candidate = browserCandidates().find(({ file }) => existsSync(file));
  if (candidate === undefined) {
    throw new Error('no supported local Chromium or Firefox executable was found for MCP monitor');
  }
  const profile = mkdtempSync(join(tmpdir(), 'termwright-mcp-monitor-browser-'));
  const args =
    candidate.family === 'chromium'
      ? [
          `--app=${url}`,
          `--user-data-dir=${profile}`,
          '--no-first-run',
          '--no-default-browser-check',
        ]
      : ['--new-instance', '--profile', profile, url];
  const child = spawn(candidate.file, args, { stdio: 'ignore' });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
  } catch (error) {
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    throw error;
  }
  child.on('error', () => undefined);
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  let closed = false;
  return {
    close: async () => {
      if (closed) return;
      closed = true;
      if (!exited) {
        await new Promise<void>((resolve) => {
          child.once('close', () => resolve());
          if (!child.kill()) resolve();
        });
      }
      rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    },
  };
}

const PAGE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Termwright MCP Monitor</title><style>
:root{color-scheme:dark;--bg:#091018;--panel:#111c28;--line:#26384a;--text:#dbe8f4;--muted:#89a0b8;--accent:#40e0a5;--warn:#ffcb6b}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px ui-sans-serif,system-ui;overflow:hidden}header{height:52px;display:flex;align-items:center;gap:16px;padding:0 18px;border-bottom:1px solid var(--line)}header strong{color:var(--accent)}#status{color:var(--muted)}#tabs{display:flex;gap:6px;overflow:auto}.tab{border:1px solid var(--line);background:transparent;color:var(--muted);padding:6px 10px;border-radius:7px;cursor:pointer;white-space:nowrap}.tab.active{color:var(--text);border-color:var(--accent)}main{height:calc(100vh - 52px);display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,400px)}.terminal{padding:18px;overflow:hidden;min-width:0;min-height:0}.viewport{position:relative;display:inline-block;font:14px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}.screen{margin:0;padding:16px;background:#05090d;border:1px solid var(--line);border-radius:9px;color:#edf7ff;font:inherit;white-space:pre}.screen-row{height:1.35em}.cursor{position:absolute;display:none;pointer-events:none;left:calc(17px + var(--column)*1ch);top:calc(17px + var(--row)*1.35em);width:1ch;height:1.35em;background:#dbe8f4aa;mix-blend-mode:difference}.highlight{display:none;position:absolute;pointer-events:none;left:calc(17px + var(--column)*1ch);top:calc(17px + var(--row)*1.35em);width:calc(var(--width)*1ch);height:calc(var(--height)*1.35em);outline:2px solid var(--accent);background:rgb(64 224 165 / .16);z-index:2}.side{border-left:1px solid var(--line);overflow:auto;padding:14px}.meta{color:var(--muted);margin-bottom:12px}.section-title{margin:18px 8px 8px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}.node{padding:7px 9px;margin-left:calc(var(--depth)*12px);border:1px solid transparent;border-bottom-color:var(--line);cursor:pointer}.node:hover,.node.active{background:var(--panel);border-color:#36516a;border-radius:6px}.node.focused .label::after{content:' focused';color:var(--warn);font-size:11px}.role{color:var(--accent);font-size:10px;text-transform:uppercase;letter-spacing:.06em}.label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.detail{margin-top:14px;padding:12px;background:var(--panel);border-radius:8px;white-space:pre-wrap;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.watch{color:var(--muted);padding:5px 8px;border-bottom:1px solid var(--line)}.empty{color:var(--muted);padding:20px}@media(max-width:850px){main{grid-template-columns:1fr;grid-template-rows:minmax(0,58vh) minmax(0,42vh)}.side{border-left:0;border-top:1px solid var(--line)}}
</style><style>
.terminal{position:relative}.stage-controls{position:absolute;top:8px;right:8px;z-index:5;display:flex;align-items:center;gap:5px;padding:5px;background:#091018dd;border:1px solid var(--line);border-radius:8px;backdrop-filter:blur(8px)}.stage-controls button{border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text);height:28px;padding:0 9px;cursor:pointer}.stage-controls button:hover{border-color:var(--accent)}#scale-status{min-width:112px;text-align:center;color:var(--muted);font-size:11px}.terminal:fullscreen{width:100vw;height:100vh;padding:18px;background:var(--bg)}.terminal:fullscreen .stage-controls{position:fixed}.terminal[data-manual-scale="true"]{overflow:auto}
</style></head><body><header><strong>TERMWRIGHT MCP</strong><span id="status">connecting…</span><div id="tabs"></div></header><main><section class="terminal"><div class="stage-controls"><button id="zoom-out" aria-label="Decrease terminal scale">−</button><span id="scale-status">100% · actual</span><button id="zoom-in" aria-label="Increase terminal scale">+</button><button id="zoom-auto">Auto</button><button id="fullscreen">Fullscreen</button></div><div class="viewport"><div id="screen" class="screen"></div><div id="cursor" class="cursor"></div><div id="highlight" class="highlight"></div></div></section><aside class="side"><div id="meta" class="meta"></div><div class="section-title">Semantic tree</div><div id="tree"></div><div class="section-title">Watchers</div><div id="watchers"></div><div id="detail" class="detail">Select a semantic node</div></aside></main>
<script>
const base=location.pathname.replace(/\/$/,'');let state={terminals:[],watchers:[]},selectedTerminal=null,selectedNode=null;const palette=['#000000','#cd3131','#0dbc79','#e5e510','#2472c8','#bc3fbc','#11a8cd','#e5e5e5','#666666','#f14c4c','#23d18b','#f5f543','#3b8eea','#d670d6','#29b8db','#ffffff'];
const $=id=>document.getElementById(id);function color(v){if(!v)return null;if(v[0]==='#')return v;const i=Number(v.slice(1));if(i<16)return palette[i];if(i<232){const n=i-16,r=Math.floor(n/36),g=Math.floor(n%36/6),b=n%6,c=x=>x?55+x*40:0;return 'rgb('+c(r)+','+c(g)+','+c(b)+')'}const c=8+(i-232)*10;return 'rgb('+c+','+c+','+c+')'}function fitScreen(t){const host=document.querySelector('.terminal'),view=document.querySelector('.viewport');if(!t||!host||!view)return;const availableWidth=Math.max(1,host.clientWidth-36),availableHeight=Math.max(1,host.clientHeight-36);const size=Math.min((availableWidth-34)/(Math.max(1,t.columns)*.602),(availableHeight-34)/(Math.max(1,t.rows)*1.35));view.style.fontSize=Math.max(1,size)+'px'}function renderScreen(t){const rows=(t.cellRows||[]).map(r=>{const line=document.createElement('div');line.className='screen-row';for(const [text,rawFg,rawBg,a] of r){const span=document.createElement('span');span.textContent=text;let fg=color(rawFg),bg=color(rawBg);if(a&16)[fg,bg]=[bg||'#05090d',fg||'#edf7ff'];if(fg)span.style.color=fg;if(bg)span.style.backgroundColor=bg;if(a&1)span.style.fontWeight='bold';if(a&2)span.style.opacity='.55';if(a&4)span.style.fontStyle='italic';if(a&8)span.style.textDecoration='underline';if(a&32)span.style.textDecoration=(span.style.textDecoration+' line-through').trim();line.append(span)}return line});if(rows.length)$('screen').replaceChildren(...rows);else $('screen').textContent=t.text||'';const c=$('cursor');if(t.cursor?.visible){c.style.display='block';c.style.setProperty('--row',String(t.cursor.row));c.style.setProperty('--column',String(t.cursor.column));c.dataset.shape=t.cursor.shape||'block'}else c.style.display='none';fitScreen(t)}function depth(node,byId){let d=0,p=node.parentId,seen=new Set;while(p&&byId.has(p)&&!seen.has(p)){seen.add(p);d++;p=byId.get(p).parentId}return d}function render(){const terminals=state.terminals||[];if(!terminals.some(t=>t.id===selectedTerminal)){selectedTerminal=terminals[0]?.id||null;selectedNode=null}const t=terminals.find(x=>x.id===selectedTerminal);$('tabs').replaceChildren(...terminals.map(x=>{const b=document.createElement('button');b.className='tab'+(x.id===selectedTerminal?' active':'');b.textContent=x.id;b.title=x.exit?'exited':'screen '+x.revision;b.onclick=()=>{selectedTerminal=x.id;selectedNode=null;render()};return b}));if(!t){$('screen').textContent='No live terminals';$('cursor').style.display='none';$('tree').replaceChildren();$('meta').textContent='Waiting for terminal.launch';$('watchers').replaceChildren();$('detail').textContent='Select a semantic node';return}renderScreen(t);$('meta').textContent=t.closing?'Closing '+t.id:t.columns+'×'+t.rows+' · screen '+t.revision+' · semantics '+(t.semanticRevision??'unavailable')+(t.recording?' · recording':'')+(t.exit?' · exited '+String(t.exit.code):' · running');const byId=new Map(t.nodes.map(n=>[n.id,n]));const selected=byId.get(selectedNode);if(selectedNode&&!selected)selectedNode=null;$('tree').replaceChildren(...t.nodes.map(n=>{const d=document.createElement('div');d.className='node'+(n.id===selectedNode?' active':'')+(n.state?.focused?' focused':'');d.style.setProperty('--depth',String(depth(n,byId)));const r=document.createElement('div');r.className='role';r.textContent=n.role||'generic';const label=document.createElement('div');label.className='label';label.textContent=n.name||n.testId||n.id;d.append(r,label);d.onclick=()=>{selectedNode=n.id;render()};d.onmouseenter=()=>showBounds(n);d.onmouseleave=()=>showBounds(byId.get(selectedNode));return d}));$('watchers').replaceChildren(...(state.watchers||[]).map(w=>{const d=document.createElement('div');d.className='watch';d.textContent=w.id+' · '+w.terminal+' · '+w.status+' · from r'+w.startRevision;return d}));$('detail').textContent=selected?JSON.stringify(selected,null,2):'Select a semantic node';showBounds(selected)}function showBounds(node){const h=$('highlight');if(!node?.bounds){h.style.display='none';return}h.style.display='block';for(const key of ['row','column','width','height'])h.style.setProperty('--'+key,String(node.bounds[key]))}new ResizeObserver(()=>{const t=(state.terminals||[]).find(x=>x.id===selectedTerminal);fitScreen(t)}).observe(document.querySelector('.terminal'));
let manualScale=null,lastAutoScale=1;fitScreen=function(t){const host=document.querySelector('.terminal'),view=document.querySelector('.viewport');if(!t||!host||!view)return;const baseSize=14,availableWidth=Math.max(1,host.clientWidth-36),availableHeight=Math.max(1,host.clientHeight-36),fitSize=Math.min((availableWidth-34)/(Math.max(1,t.columns)*.602),(availableHeight-34)/(Math.max(1,t.rows)*1.35));lastAutoScale=Math.min(1,fitSize/baseSize);const scale=Math.max(.25,Math.min(3,manualScale??lastAutoScale));view.style.fontSize=baseSize*scale+'px';host.dataset.manualScale=String(manualScale!==null);$('scale-status').textContent=Math.round(scale*100)+'% · '+(manualScale!==null?'manual':scale<.999?'fitted '+t.columns+'×'+t.rows:'actual')};function activeTerminal(){return(state.terminals||[]).find(x=>x.id===selectedTerminal)}$('zoom-out').onclick=()=>{manualScale=Math.max(.25,(manualScale??lastAutoScale)-.1);fitScreen(activeTerminal())};$('zoom-in').onclick=()=>{manualScale=Math.min(3,(manualScale??lastAutoScale)+.1);fitScreen(activeTerminal())};$('zoom-auto').onclick=()=>{manualScale=null;fitScreen(activeTerminal())};$('fullscreen').onclick=async()=>{const host=document.querySelector('.terminal');if(document.fullscreenElement===host)await document.exitFullscreen();else await host.requestFullscreen()};document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'Exit fullscreen':'Fullscreen';fitScreen(activeTerminal())});
const events=new EventSource(base+'/events');events.onopen=()=>{$('status').textContent='live'};events.onerror=()=>{$('status').textContent='reconnecting…'};events.onmessage=e=>{state=JSON.parse(e.data);render()};events.addEventListener('shutdown',()=>{events.close();window.close();document.body.innerHTML='<main class="empty">Terminal session closed.</main>'});
</script></body></html>`;

export async function startMonitor(
  stores: SessionStores,
  options: MonitorOptions = {},
): Promise<MonitorHandle> {
  const host = options.host ?? '127.0.0.1';
  if (!isLoopbackHost(host)) {
    throw new Error(`MCP monitor refuses non-loopback host ${JSON.stringify(host)}`);
  }
  const urlHost = host.includes(':') ? `[${host}]` : host;
  const token = randomBytes(24).toString('base64url');
  const root = `/monitor/${token}`;
  const clients = new Set<ServerResponse>();
  const previousTerminals = new Map<string, TerminalMonitorState>();
  const readState = (): Record<string, unknown> => monitorState(stores, previousTerminals);
  let previous = '';
  const http = createServer((request, response) => {
    const path = new URL(request.url ?? '/', `http://${urlHost}`).pathname.replace(/\/$/u, '');
    if (
      request.method !== 'GET' ||
      (path !== root && path !== `${root}/state` && path !== `${root}/events`)
    ) {
      response.writeHead(404).end();
      return;
    }
    if (path === root) {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
        'x-frame-options': 'DENY',
      });
      response.end(PAGE);
      return;
    }
    if (path === `${root}/state`) {
      sendJson(response, readState());
      return;
    }
    if (path === `${root}/events`) {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-content-type-options': 'nosniff',
      });
      clients.add(response);
      request.on('close', () => clients.delete(response));
      response.write(`data: ${JSON.stringify(readState())}\n\n`);
      return;
    }
    response.writeHead(404).end();
  });
  const timer = setInterval(() => {
    if (clients.size === 0) return;
    const next = JSON.stringify(readState());
    if (next === previous) return;
    previous = next;
    for (const client of clients) client.write(`data: ${next}\n\n`);
  }, 100);
  timer.unref();
  try {
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(options.port ?? 0, host, () => {
        http.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    clearInterval(timer);
    throw error;
  }
  const address = http.address();
  if (address === null || typeof address === 'string')
    throw new Error('monitor has no TCP address');
  const url = `http://${urlHost}:${address.port}${root}/`;
  let browser: MonitorBrowserSession | undefined;
  try {
    browser =
      options.openBrowser === false
        ? undefined
        : await (options.browserLauncher ?? openBrowser)(url);
  } catch (error) {
    clearInterval(timer);
    await new Promise<void>((resolve) => http.close(() => resolve()));
    throw error;
  }
  try {
    options.onStarted?.(url);
  } catch (error) {
    clearInterval(timer);
    await Promise.allSettled([
      browser?.close(),
      new Promise<void>((resolve) => http.close(() => resolve())),
    ]);
    throw error;
  }
  let closePromise: Promise<void> | undefined;
  return {
    http,
    url,
    close: () => {
      closePromise ??= (async () => {
        clearInterval(timer);
        for (const client of clients) client.end('event: shutdown\ndata: {}\n\n');
        clients.clear();
        await new Promise<void>((resolve, reject) =>
          http.close((error) => (error === undefined ? resolve() : reject(error))),
        );
        await browser?.close();
      })();
      return closePromise;
    },
  };
}

/** Starts the monitor for the first terminal and tears it down after the last. */
export function createMonitorLifecycle(
  stores: SessionStores,
  options: MonitorOptions = {},
): MonitorLifecycle {
  let monitor: MonitorHandle | undefined;
  let transition = Promise.resolve();
  const enqueue = (work: () => Promise<void>): Promise<void> => {
    const next = transition.then(work, work);
    transition = next.catch(() => undefined);
    return next;
  };
  return {
    get url() {
      return monitor?.url;
    },
    terminalLaunched: () =>
      enqueue(async () => {
        if (monitor !== undefined) return;
        try {
          monitor = await startMonitor(stores, options);
        } catch (error) {
          options.onError?.(error);
        }
      }),
    terminalClosed: () =>
      enqueue(async () => {
        if (stores.terminals.list().length !== 0 || monitor === undefined) return;
        const current = monitor;
        monitor = undefined;
        try {
          await current.close();
        } catch (error) {
          options.onError?.(error);
        }
      }),
    close: () =>
      enqueue(async () => {
        const current = monitor;
        monitor = undefined;
        if (current === undefined) return;
        try {
          await current.close();
        } catch (error) {
          options.onError?.(error);
        }
      }),
  };
}
