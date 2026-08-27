import { describe, expect, it } from 'vitest';
import type { ActionEvent, ActionStartedEvent } from '../api.js';
import { SessionActionLifecycle } from './session-actions.js';

const checkpoint = (sequence: number) =>
  ({
    sessionId: 'session:test',
    epoch: 0,
    sequence,
    screenRevision: 2,
    semanticRevision: null,
    pairedScreenRevision: null,
    contractId: 's:0',
  }) as const;

describe('SessionActionLifecycle', () => {
  it('publishes one correlated terminal edge with the completion checkpoint', () => {
    const started: ActionStartedEvent[] = [];
    const finished: ActionEvent[] = [];
    const lifecycle = new SessionActionLifecycle({
      isOpen: () => true,
      now: () => 7,
      checkpoint: () => checkpoint(3),
      started: (event) => started.push(event),
      finished: (event) => finished.push(event),
    });
    const id = lifecycle.begin('click', { selector: 'button' });
    lifecycle.end(id, 'click', true, { selector: 'button' });
    lifecycle.end(id, 'click', false);
    expect(started).toEqual([
      expect.objectContaining({ actionId: id, api: 'click', selector: 'button' }),
    ]);
    expect(finished).toEqual([
      expect.objectContaining({
        actionId: id,
        ok: true,
        observation: expect.objectContaining({ sequence: 3 }),
      }),
    ]);
  });

  it('fails every pending action exactly once during session teardown', () => {
    const finished: ActionEvent[] = [];
    const lifecycle = new SessionActionLifecycle({
      isOpen: () => true,
      now: () => 1,
      checkpoint: () => checkpoint(0),
      started: () => undefined,
      finished: (event) => finished.push(event),
    });
    lifecycle.begin('press');
    lifecycle.begin('click', { selector: 'Save' });
    lifecycle.failPending('session-closed');
    lifecycle.failPending('session-closed');
    expect(finished).toHaveLength(2);
    expect(finished).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ api: 'press', error: 'session-closed' }),
        expect.objectContaining({ api: 'click', selector: 'Save', error: 'session-closed' }),
      ]),
    );
  });

  it('does not announce work after the session is closed', () => {
    const started: ActionStartedEvent[] = [];
    const lifecycle = new SessionActionLifecycle({
      isOpen: () => false,
      now: () => 0,
      checkpoint: () => checkpoint(0),
      started: (event) => started.push(event),
      finished: () => undefined,
    });
    lifecycle.begin('press');
    expect(started).toEqual([]);
  });
});
