import { randomBytes } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { isLoopbackHost } from './http-security.js';
import type { SessionStores } from './sessions.js';

export interface MonitorOptions {
  readonly host?: string;
  readonly port?: number;
  readonly openBrowser?: boolean;
}

export interface MonitorHandle {
  readonly http: Server;
  readonly url: string;
  close(): Promise<void>;
}

function monitorState(stores: SessionStores): Record<string, unknown> {
  return {
    terminals: stores.terminals.list().map((entry) => {
      try {
        const screen = entry.harness.screen();
        const semantic = entry.harness.semanticTree();
        return {
          id: entry.id,
          revision: screen.revision,
          columns: screen.columns,
          rows: screen.rows,
          buffer: screen.buffer,
          text: screen.text(),
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
      } catch {
        // terminal.close physically tears down the harness before removing its
        // store entry. Keep that short transition observable without letting a
        // monitor timer become an uncaught exception.
        return {
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
        };
      }
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

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : process.platform === 'win32'
        ? { file: 'cmd', args: ['/d', '/s', '/c', 'start', '', url] }
        : { file: 'xdg-open', args: [url] };
  const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
}

const PAGE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Termwright MCP Monitor</title><style>
:root{color-scheme:dark;--bg:#091018;--panel:#111c28;--line:#26384a;--text:#dbe8f4;--muted:#89a0b8;--accent:#40e0a5;--warn:#ffcb6b}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px ui-sans-serif,system-ui}header{height:52px;display:flex;align-items:center;gap:16px;padding:0 18px;border-bottom:1px solid var(--line)}header strong{color:var(--accent)}#status{color:var(--muted)}#tabs{display:flex;gap:6px;overflow:auto}.tab{border:1px solid var(--line);background:transparent;color:var(--muted);padding:6px 10px;border-radius:7px;cursor:pointer;white-space:nowrap}.tab.active{color:var(--text);border-color:var(--accent)}main{height:calc(100vh - 52px);display:grid;grid-template-columns:minmax(480px,1fr) minmax(300px,400px)}.terminal{padding:18px;overflow:auto}.viewport{position:relative;display:inline-block;min-width:100%;min-height:100%;font:14px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}.screen{margin:0;min-height:100%;padding:16px;background:#05090d;border:1px solid var(--line);border-radius:9px;color:#edf7ff;font:inherit;white-space:pre}.highlight{display:none;position:absolute;pointer-events:none;left:calc(17px + var(--column)*1ch);top:calc(17px + var(--row)*1.35em);width:calc(var(--width)*1ch);height:calc(var(--height)*1.35em);outline:2px solid var(--accent);background:rgb(64 224 165 / .16);z-index:2}.side{border-left:1px solid var(--line);overflow:auto;padding:14px}.meta{color:var(--muted);margin-bottom:12px}.section-title{margin:18px 8px 8px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}.node{padding:7px 9px;margin-left:calc(var(--depth)*12px);border:1px solid transparent;border-bottom-color:var(--line);cursor:pointer}.node:hover,.node.active{background:var(--panel);border-color:#36516a;border-radius:6px}.node.focused .label::after{content:' focused';color:var(--warn);font-size:11px}.role{color:var(--accent);font-size:10px;text-transform:uppercase;letter-spacing:.06em}.label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.detail{margin-top:14px;padding:12px;background:var(--panel);border-radius:8px;white-space:pre-wrap;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.watch{color:var(--muted);padding:5px 8px;border-bottom:1px solid var(--line)}.empty{color:var(--muted);padding:20px}@media(max-width:850px){main{grid-template-columns:1fr;grid-template-rows:minmax(320px,58vh) auto}.side{border-left:0;border-top:1px solid var(--line)}}
</style></head><body><header><strong>TERMWRIGHT MCP</strong><span id="status">connecting…</span><div id="tabs"></div></header><main><section class="terminal"><div class="viewport"><pre id="screen" class="screen"></pre><div id="highlight" class="highlight"></div></div></section><aside class="side"><div id="meta" class="meta"></div><div class="section-title">Semantic tree</div><div id="tree"></div><div class="section-title">Watchers</div><div id="watchers"></div><div id="detail" class="detail">Select a semantic node</div></aside></main>
<script>
const base=location.pathname.replace(/\/$/,'');let state={terminals:[],watchers:[]},selectedTerminal=null,selectedNode=null;
const $=id=>document.getElementById(id);function depth(node,byId){let d=0,p=node.parentId,seen=new Set;while(p&&byId.has(p)&&!seen.has(p)){seen.add(p);d++;p=byId.get(p).parentId}return d}function render(){const terminals=state.terminals||[];if(!terminals.some(t=>t.id===selectedTerminal)){selectedTerminal=terminals[0]?.id||null;selectedNode=null}const t=terminals.find(x=>x.id===selectedTerminal);$('tabs').replaceChildren(...terminals.map(x=>{const b=document.createElement('button');b.className='tab'+(x.id===selectedTerminal?' active':'');b.textContent=x.id;b.title=x.exit?'exited':'screen '+x.revision;b.onclick=()=>{selectedTerminal=x.id;selectedNode=null;render()};return b}));if(!t){$('screen').textContent='No live terminals';$('tree').replaceChildren();$('meta').textContent='Waiting for terminal.launch';$('watchers').replaceChildren();$('detail').textContent='Select a semantic node';return}$('screen').textContent=t.text;$('meta').textContent=t.closing?'Closing '+t.id:t.columns+'×'+t.rows+' · screen '+t.revision+' · semantics '+(t.semanticRevision??'unavailable')+(t.recording?' · recording':'')+(t.exit?' · exited '+String(t.exit.code):' · running');const byId=new Map(t.nodes.map(n=>[n.id,n]));const selected=byId.get(selectedNode);if(selectedNode&&!selected)selectedNode=null;$('tree').replaceChildren(...t.nodes.map(n=>{const d=document.createElement('div');d.className='node'+(n.id===selectedNode?' active':'')+(n.state?.focused?' focused':'');d.style.setProperty('--depth',String(depth(n,byId)));const r=document.createElement('div');r.className='role';r.textContent=n.role||'generic';const label=document.createElement('div');label.className='label';label.textContent=n.name||n.testId||n.id;d.append(r,label);d.onclick=()=>{selectedNode=n.id;render()};d.onmouseenter=()=>showBounds(n);d.onmouseleave=()=>showBounds(byId.get(selectedNode));return d}));$('watchers').replaceChildren(...(state.watchers||[]).map(w=>{const d=document.createElement('div');d.className='watch';d.textContent=w.id+' · '+w.terminal+' · '+w.status+' · from r'+w.startRevision;return d}));$('detail').textContent=selected?JSON.stringify(selected,null,2):'Select a semantic node';showBounds(selected)}function showBounds(node){const h=$('highlight');if(!node?.bounds){h.style.display='none';return}h.style.display='block';for(const key of ['row','column','width','height'])h.style.setProperty('--'+key,String(node.bounds[key]))}
const events=new EventSource(base+'/events');events.onopen=()=>{$('status').textContent='live'};events.onerror=()=>{$('status').textContent='reconnecting…'};events.onmessage=e=>{state=JSON.parse(e.data);render()};fetch(base+'/state').then(r=>r.json()).then(s=>{state=s;render()});
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
      sendJson(response, monitorState(stores));
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
      response.write(`data: ${JSON.stringify(monitorState(stores))}\n\n`);
      return;
    }
    response.writeHead(404).end();
  });
  const timer = setInterval(() => {
    if (clients.size === 0) return;
    const next = JSON.stringify(monitorState(stores));
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
  if (options.openBrowser !== false) openBrowser(url);
  let closePromise: Promise<void> | undefined;
  return {
    http,
    url,
    close: () => {
      closePromise ??= (async () => {
        clearInterval(timer);
        for (const client of clients) client.end();
        clients.clear();
        await new Promise<void>((resolve, reject) =>
          http.close((error) => (error === undefined ? resolve() : reject(error))),
        );
      })();
      return closePromise;
    },
  };
}
