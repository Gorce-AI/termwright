/**
 * OSC 8 hyperlinks, read back out of the emulator.
 *
 * xterm parses `OSC 8 ; params ; uri ST` and attaches the link to every cell
 * it covers, but none of that reaches the public API: `IBufferCell` exposes
 * colours, attributes and text, and nothing about links. The data is there —
 * measured, not assumed:
 *
 * - the cell object carries `extended.urlId`, a small integer;
 * - `_core._oscLinkService.getLinkData(urlId)` returns `{ id?, uri }`.
 *
 * Both are private. They are reached from here, in the package that owns
 * xterm's quirks, so the rest of the codebase reads a documented shape instead
 * of a version-sensitive path — and if a future xterm moves them, one guarded
 * function returns null rather than a stack trace from the screen capture.
 *
 * ## What xterm keeps, and what it throws away
 *
 * OSC 8 params are `key=value:key=value`. xterm keeps **`id` only**; every
 * other parameter is parsed and dropped. Measured across four shapes:
 * `id=abc:frag=btn7:x=1` yields `{ id: 'abc' }` — `frag` and `x` are gone.
 * Anything that wants to carry data through a hyperlink therefore has exactly
 * one field to carry it in, and that field is `id`.
 */
import type { IBufferCell, Terminal } from './terminal.js';

/** A hyperlink attached to a cell, as much of it as xterm retains. */
export interface CellLink {
  readonly uri: string;
  /** The `id=` parameter, when the writer supplied one. */
  readonly id?: string;
}

/** Reads a cell's link, or null when it has none. */
export type LinkResolver = (cell: IBufferCell) => CellLink | null;

/** The private shape this module depends on, named so the cast is visible. */
interface OscLinkInternals {
  readonly _core?: {
    readonly _oscLinkService?: {
      getLinkData(id: number): { id?: string; uri?: string } | undefined;
    };
  };
}

interface CellInternals {
  readonly extended?: { readonly urlId?: number };
}

/**
 * Builds a resolver for one terminal.
 *
 * Returns a resolver that always answers null when the internals are not
 * where they were: a terminal with no readable links is a terminal whose cells
 * have no links, which is the honest degradation. Callers get a shape, never
 * an exception, because this runs inside screen capture.
 */
export function createLinkResolver(terminal: Terminal): LinkResolver {
  const service = (terminal as unknown as OscLinkInternals)._core?._oscLinkService;
  if (service === undefined) return () => null;
  // One cache per terminal: a link covers many cells and every one of them
  // would otherwise re-enter the service and rebuild an identical object.
  const cache = new Map<number, CellLink | null>();
  return (cell: IBufferCell): CellLink | null => {
    const urlId = (cell as unknown as CellInternals).extended?.urlId;
    if (urlId === undefined || urlId === 0) return null;
    const cached = cache.get(urlId);
    if (cached !== undefined) return cached;
    let link: CellLink | null = null;
    try {
      const data = service.getLinkData(urlId);
      if (data?.uri !== undefined && data.uri.length > 0) {
        link = Object.freeze(data.id === undefined ? { uri: data.uri } : { uri: data.uri, id: data.id });
      }
    } catch {
      link = null;
    }
    cache.set(urlId, link);
    return link;
  };
}
