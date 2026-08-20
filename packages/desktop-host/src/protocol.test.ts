import { describe, expect, it } from 'vitest';
import { DESKTOP_HOST_PROTOCOL, encodeControlMessage, parseControlMessage } from './protocol.js';
import { desktopHostArguments, desktopHostEnvironment } from './index.js';

describe('desktop bootstrap protocol', () => {
  it('round-trips a versioned bootstrap', () => {
    const line = encodeControlMessage({
      protocol: DESKTOP_HOST_PROTOCOL,
      type: 'bootstrap',
      url: 'http://127.0.0.1:5000/?token=x',
    });
    expect(parseControlMessage(line.trim())).toEqual({
      protocol: DESKTOP_HOST_PROTOCOL,
      type: 'bootstrap',
      url: 'http://127.0.0.1:5000/?token=x',
    });
  });

  it('rejects incompatible and unknown messages', () => {
    expect(() => parseControlMessage('{"protocol":2,"type":"ready"}')).toThrow('incompatible');
    expect(() => parseControlMessage('{"protocol":1,"type":"nope"}')).toThrow('unknown');
  });

  it('keeps the token out of argv and strips execution overrides from env', () => {
    const args = desktopHostArguments('/app/main.js');
    const env = desktopHostEnvironment({
      PATH: '/bin',
      NODE_OPTIONS: '--inspect=0.0.0.0:9229',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_INSPECT_RESUME_ON_START: '1',
    });
    expect(args).toEqual(['/app/main.js']);
    expect(JSON.stringify(args)).not.toContain('token');
    expect(env).toEqual({ PATH: '/bin' });
  });
});
