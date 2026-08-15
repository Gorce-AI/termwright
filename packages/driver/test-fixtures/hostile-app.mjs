/**
 * Hostile-adapter fixture: completes the handshake, then announces a frame far
 * larger than the negotiated ceiling. Used to prove that the driver classifies
 * the failure as a limit breach (not a syntax error) and records the wire code
 * it sent, without any conformance machinery.
 */
import { connect } from 'node:net';
import { encodeFrame } from '@termwright/protocol';

const endpoint = process.env['TERMWRIGHT_ENDPOINT'];
const token = process.env['TERMWRIGHT_TOKEN'];

process.stdout.write('HOSTILE READY\r\n');

if (endpoint === undefined || token === undefined) {
  process.stdout.write('DORMANT\r\n');
} else {
  const socket = connect(endpoint, () => {
    socket.write(
      encodeFrame(
        {
          type: 'hello',
          protocol: 'termwright/1',
          token,
          adapter: { name: 'hostile', version: '0.1.0' },
          capabilities: ['tree', 'render-revisions'],
        },
        1024 * 1024,
      ),
    );
  });

  socket.on('data', () => {
    // Header only: a declared length past the ceiling must be refused before
    // a single byte of the body is read.
    const header = Buffer.alloc(4);
    header.writeUInt32BE(64 * 1024 * 1024, 0);
    socket.write(header);
  });
  socket.on('error', () => {});
}

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', () => process.exit(0));
