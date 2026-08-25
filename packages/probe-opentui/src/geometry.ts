/** Geometry captured from one completed OpenTUI render pass. */
export interface InstrumentedRect {
  readonly row: number;
  readonly column: number;
  readonly width: number;
  readonly height: number;
}

export interface CommittedFrameGeometry {
  readonly frameId: number;
  readonly columns: number;
  readonly rows: number;
  readonly surfaceColumns: number;
  readonly surfaceRows: number;
  readonly surfaceOrigin: { readonly row: number; readonly column: number };
  readonly intended: ReadonlyMap<string, InstrumentedRect>;
  readonly visible: ReadonlyMap<string, InstrumentedRect>;
}

export interface FrameGeometryProvider {
  readonly version: 1;
  readonly frameworkVersion: string;
  getCommitted(frameId: number): CommittedFrameGeometry | undefined;
}
