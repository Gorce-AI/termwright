/** Runtime conformance fixture; transitions are driven only by committed FRAME events. */
import { writeSync } from 'node:fs';
import {
  BoxRenderable,
  CliRenderEvents,
  Renderable,
  ScrollBoxRenderable,
  TextRenderable,
  createCliRenderer,
  type OptimizedBuffer,
  type RenderContext,
} from '@opentui/core';

const splitFooter = process.env['TW_RUNTIME_SPLIT_FOOTER'] === '1';

class NoHitGridRenderable extends Renderable {
  constructor(ctx: RenderContext) {
    super(ctx, {
      id: 'custom-no-hit',
      position: 'absolute',
      left: 31,
      top: 1,
      width: 9,
      height: 2,
    });
  }

  override render(_buffer: OptimizedBuffer, _deltaTime: number): void {
    // Deliberately does not call super.render() or addToHitGrid(). The exact
    // observer sees the render-command boundary; the runtime observer must do
    // the same rather than confusing this with a culled node.
  }
}

class LocalBufferScissorRenderable extends Renderable {
  constructor(ctx: RenderContext) {
    super(ctx, {
      id: 'custom-buffer-scissor',
      position: 'absolute',
      left: 31,
      top: 4,
      width: 8,
      height: 2,
    });
  }

  override render(buffer: OptimizedBuffer, _deltaTime: number): void {
    // Semantic clipping belongs to the root command stack, not arbitrary
    // buffer state owned inside a custom renderable.
    buffer.pushScissorRect(0, 0, 1, 1);
    buffer.popScissorRect();
  }
}

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  targetFps: 60,
  useMouse: true,
  ...(splitFooter
    ? { screenMode: 'split-footer' as const, footerHeight: 12 }
    : {}),
});

const clippedOuter = new BoxRenderable(renderer, {
  id: 'differential-outer', width: 12, height: 5, overflow: 'hidden',
  position: 'absolute', left: 1, top: 1,
});
const clippedInner = new BoxRenderable(renderer, {
  id: 'differential-inner', width: 9, height: 3, overflow: 'hidden',
  position: 'absolute', left: 5, top: 1,
});
clippedInner.add(new TextRenderable(renderer, {
  id: 'differential-clipped', content: 'differential clipped', width: 20, height: 1,
}));
clippedOuter.add(clippedInner);

const buffered = new BoxRenderable(renderer, {
  id: 'differential-buffered', buffered: true, overflow: 'hidden',
  position: 'absolute', left: 15, top: 1, width: 12, height: 4,
});
buffered.add(new TextRenderable(renderer, {
  id: 'buffered-child', content: 'buffered child wider', width: 20, height: 1,
}));

const scroll = new ScrollBoxRenderable(renderer, {
  id: 'differential-scroll', position: 'absolute', left: 1, top: 7,
  width: 18, height: 3, scrollY: true, stickyScroll: false,
});
for (let index = 0; index < 12; index += 1) {
  scroll.add(new TextRenderable(renderer, {
    id: `differential-row-${index}`,
    content: `differential row ${index}`,
    height: 1,
  }));
}

const lower = new TextRenderable(renderer, {
  id: 'differential-lower', content: 'lower overlap', width: 8, height: 1,
  position: 'absolute', left: 21, top: 7, zIndex: 1,
});
const upper = new TextRenderable(renderer, {
  id: 'differential-upper', content: 'upper overlap', width: 8, height: 1,
  position: 'absolute', left: 21, top: 7, zIndex: 2,
});
const noHit = new NoHitGridRenderable(renderer);
const customScissor = new LocalBufferScissorRenderable(renderer);
const dynamic = new TextRenderable(renderer, {
  id: 'differential-dynamic', content: 'dynamic mounted', width: 16, height: 1,
  position: 'absolute', left: 21, top: 10,
});
let oracleToken = 0;
const originOracle = splitFooter
  ? new TextRenderable(renderer, {
      id: 'split-origin-oracle',
      content: `split origin oracle ${oracleToken}`,
      width: 24,
      height: 1,
      position: 'absolute',
      left: 41,
      top: 10,
    })
  : undefined;

renderer.root.add(clippedOuter);
renderer.root.add(buffered);
renderer.root.add(scroll);
renderer.root.add(lower);
renderer.root.add(upper);
renderer.root.add(noHit);
renderer.root.add(customScissor);
if (originOracle !== undefined) renderer.root.add(originOracle);

renderer.addPostProcessFn((buffer) => {
  // Exercises the root-render → post-process → native commit gap without
  // mutating the retained tree after its render-command observations.
  buffer.getCurrentOpacity();
});

let committed = 0;
let stopping = false;
const controlledLifecycle = process.env['TW_RUNTIME_CONTROLLED_LIFECYCLE'] === '1';

if (controlledLifecycle) {
  process.stdin.once('data', () => {
    stopping = true;
    renderer.destroy();
    process.stdout.write('', () => process.exit(0));
  });
}

renderer.on(CliRenderEvents.FRAME, () => {
  if (stopping) return;
  committed += 1;
  if (splitFooter && process.env['TW_RUNTIME_ORACLE_FD'] === '3' && originOracle !== undefined) {
    writeSync(3, `${JSON.stringify({
      frameId: renderer.frameId,
      renderOffset: (renderer as unknown as { readonly renderOffset: number }).renderOffset,
      token: `split origin oracle ${oracleToken}`,
    })}\n`);
    oracleToken += 1;
    originOracle.content = `split origin oracle ${oracleToken}`;
  }
  if (splitFooter && (controlledLifecycle || committed === 1)) {
    renderer.writeToScrollback(({ renderContext }) => ({
      root: new TextRenderable(renderContext, {
        content: 'split footer scrollback transition',
        width: 34,
        height: 1,
      }),
      width: 34,
      height: 1,
      trailingNewline: true,
    }));
  }
  if (controlledLifecycle) {
    scroll.scrollTo(7);
    if (committed % 2 === 1) {
      renderer.root.add(dynamic);
      if (!splitFooter) renderer.resize(44, 13);
    } else {
      renderer.root.remove(dynamic);
      if (!splitFooter) renderer.resize(48, 14);
    }
    renderer.requestRender();
    return;
  }
  if (committed === 1) {
    scroll.scrollTo(7);
    renderer.root.add(dynamic);
    renderer.requestRender();
  } else if (committed === 2) {
    renderer.resize(44, 13);
    renderer.requestRender();
  } else if (committed === 3) {
    renderer.root.remove(dynamic);
    renderer.requestRender();
  } else if (committed === 4) {
    renderer.destroy();
    process.stdout.write('', () => process.exit(0));
  }
});

renderer.start();
