import { createServer } from 'node:net';

const { writeWindowsConsoleMarker } = await import(
  process.env.TW_MARKER_PTY_ENTRY ?? '@termwright/pty'
);
const controlPipe = process.env.TW_MARKER_CONTROL_PIPE;
if (!controlPipe) throw new Error('TW_MARKER_CONTROL_PIPE is required');

const server = createServer((socket) => {
  // This fixture accepts exactly one owner. Stop accepting before any
  // protocol work so listener lifetime cannot outlive the accepted pipe.
  server.close();
  socket.setEncoding('utf8');
  let pending = '';
  let markerWritten = false;
  socket.on('data', (chunk) => {
    pending += chunk;
    for (;;) {
      const newline = pending.indexOf('\n');
      if (newline < 0) break;
      const command = pending.slice(0, newline).replace(/\r$/u, '');
      pending = pending.slice(newline + 1);
      if (command === 'GO') {
        if (markerWritten) throw new Error('duplicate GO command');
        markerWritten = true;
        writeWindowsConsoleMarker(1, process.env.TW_MARKER_TEXT ?? '');
        // DONE proves that the synchronous native write and mode restoration
        // returned. Keep the connection fully open until the parent confirms
        // it consumed DONE and inspected the restored console mode.
        socket.write('DONE\n');
      } else if (command === 'CLOSE') {
        if (!markerWritten) throw new Error('CLOSE received before GO');
        // A write completion is the causal boundary we need. Do not use
        // socket.end(): on Windows named pipes its uv_shutdown callback can
        // depend on the peer half-closing, which made process exit racy under
        // Node 24. The parent reads CLOSED before disposing its pipe.
        socket.write('CLOSED\n', () => {
          socket.destroy();
        });
      } else {
        throw new Error(`unexpected marker control command ${JSON.stringify(command)}`);
      }
    }
  });
  socket.write('READY\n');
});

server.listen(`\\\\.\\pipe\\${controlPipe}`);
