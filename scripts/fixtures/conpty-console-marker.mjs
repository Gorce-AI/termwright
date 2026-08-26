import { writeWindowsConsoleMarker } from '@termwright/pty';

writeWindowsConsoleMarker(1, process.env.TW_MARKER_TEXT ?? '');
