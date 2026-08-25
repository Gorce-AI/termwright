import type { RunnerClient } from '../browser-client.js';
import type { DataSource, ViewerState } from '../data-source.js';
import type { ServerMessage } from '../events.js';

interface BootstrapHandlers {
  readonly active: () => boolean;
  readonly ready: (viewer: ViewerState) => void;
  readonly failed: (cause: unknown) => void;
  readonly message: (message: ServerMessage) => void;
  readonly status: (connected: boolean) => void;
}

/**
 * Establishes the snapshot/replay barrier for the live Runner.
 *
 * The HTTP snapshot must become reducer state before the WebSocket subscribes.
 * UiHub replays its bounded backlog to late subscribers, so live events that
 * arrive after the snapshot are then applied exactly once and can never be
 * overwritten by a slower bootstrap response.
 */
export async function bootstrapRunner(
  source: Pick<DataSource, 'state'>,
  client: Pick<RunnerClient, 'connect'> | undefined,
  handlers: BootstrapHandlers,
): Promise<void> {
  try {
    const viewer = await source.state();
    if (!handlers.active()) return;
    handlers.ready(viewer);
    if (!handlers.active()) return;
    client?.connect(handlers.message, handlers.status);
  } catch (cause) {
    if (handlers.active()) handlers.failed(cause);
  }
}
