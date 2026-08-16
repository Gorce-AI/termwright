/**
 * The panel's own furniture: theme, resizable splits, and the shortcut list.
 *
 * None of it is part of a pane, all of it is what makes the panel feel like an
 * application rather than three boxes: the split you dragged is where you left
 * it next time, the theme follows the system until you say otherwise, and the
 * keys the app listens for are written down somewhere you can find them.
 */

/** Where the choices are remembered. Namespaced, since this is a shared origin. */
const STORAGE_PREFIX = 'termwright.ui.';

/** Which theme is in force. `system` follows the OS. */
export type Theme = 'system' | 'dark' | 'light';

const THEMES: readonly Theme[] = ['system', 'dark', 'light'];

/** Reads a remembered value, tolerating a storage that refuses to answer. */
export function remembered(key: string): string | null {
  try {
    return localStorage.getItem(STORAGE_PREFIX + key);
  } catch {
    return null; // private mode, disabled storage — not worth failing over
  }
}

/** Remembers a value for the next visit; a refusing storage costs the session only. */
export function remember(key: string, value: string): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, value);
  } catch {
    // The setting lasts for this session only.
  }
}

/** Applies a theme and remembers it. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  remember('theme', theme);
}

/** The theme in force, from what was remembered. */
export function currentTheme(): Theme {
  const stored = remembered('theme');
  return THEMES.includes(stored as Theme) ? (stored as Theme) : 'system';
}

/** The next theme in the cycle: system → dark → light → system. */
export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] as Theme;
}

/**
 * Clamps a split fraction to something usable.
 *
 * A pane dragged to nothing is a pane you cannot drag back, so both sides keep
 * a floor.
 */
export function clampSplit(fraction: number, min = 0.15, max = 0.85): number {
  if (!Number.isFinite(fraction)) return min;
  return Math.min(Math.max(fraction, min), max);
}

/** Options for {@link installSplitter}. */
export interface SplitterOptions {
  /** Element the user drags. */
  readonly handle: HTMLElement;
  /** Element whose grid template the drag changes. */
  readonly container: HTMLElement;
  readonly axis: 'horizontal' | 'vertical';
  /** Key the fraction is remembered under. */
  readonly key: string;
  /** Applies a fraction to the layout. */
  readonly apply: (fraction: number) => void;
  /** Where the splitter sits before anyone drags it. */
  readonly initial: number;
}

/**
 * Makes one splitter draggable, and restores where it was left.
 *
 * Arrow keys move it too: a splitter that only responds to a mouse is a control
 * that some people simply do not have.
 */
export function installSplitter(options: SplitterOptions): void {
  const stored = Number.parseFloat(remembered(options.key) ?? '');
  let fraction = clampSplit(Number.isFinite(stored) ? stored : options.initial);
  options.apply(fraction);

  const set = (next: number): void => {
    fraction = clampSplit(next);
    options.apply(fraction);
    remember(options.key, String(fraction));
  };

  const onPointerMove = (event: PointerEvent): void => {
    const box = options.container.getBoundingClientRect();
    const next =
      options.axis === 'vertical'
        ? (event.clientX - box.left) / box.width
        : (event.clientY - box.top) / box.height;
    set(next);
  };

  options.handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    options.handle.setPointerCapture(event.pointerId);
    options.handle.classList.add('dragging');
    const stop = (): void => {
      options.handle.classList.remove('dragging');
      options.handle.removeEventListener('pointermove', onPointerMove);
      options.handle.removeEventListener('pointerup', stop);
    };
    options.handle.addEventListener('pointermove', onPointerMove);
    options.handle.addEventListener('pointerup', stop);
  });

  options.handle.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -0.02 : 0.02;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    set(fraction + step);
  });
}
