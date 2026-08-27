import { createRoot } from 'react-dom/client';
import { RunnerClient } from '../browser-client.js';
import { InlineDataSource, readInlinePayload } from '../data-source.js';
import { TermwrightApp } from './TermwrightApp.js';
import { PreferencesProvider } from './preferences.js';
import { bootstrapRunnerToken } from './auth-bootstrap.js';
import './app.css';

const host = document.querySelector<HTMLElement>('#termwright-root');
if (host === null) throw new Error('Termwright application root is missing');

const inline = readInlinePayload();
const client = inline === undefined ? new RunnerClient(bootstrapRunnerToken()) : undefined;
const source = inline === undefined ? (client as RunnerClient) : new InlineDataSource(inline);

createRoot(host).render(
  <PreferencesProvider>
    <TermwrightApp source={source} {...(client === undefined ? {} : { client })} />
  </PreferencesProvider>,
);
