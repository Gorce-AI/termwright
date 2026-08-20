/**
 * Opening a spec where you edit it.
 *
 * A runner that shows you a failing test and cannot take you to it makes you
 * retype a path. Every editor worth naming registers a URL scheme for exactly
 * this, so the link is one string — and because a scheme can silently do
 * nothing (no editor installed, a browser that blocks unknown schemes), the
 * path is always available to copy as well.
 */

/** Editors the panel can hand a file to. */
export type EditorId = 'vscode' | 'vscode-insiders' | 'cursor' | 'webstorm' | 'zed' | 'none';

/** What each editor is called, and how it takes a file. */
interface Editor {
  readonly label: string;
  /** Builds the URL, or `null` when this editor takes none. */
  readonly link: (file: string, line: number | undefined) => string | null;
}

const EDITORS: Readonly<Record<EditorId, Editor>> = {
  vscode: { label: 'VS Code', link: (file, line) => `vscode://file${absolute(file)}${at(line)}` },
  'vscode-insiders': {
    label: 'VS Code Insiders',
    link: (file, line) => `vscode-insiders://file${absolute(file)}${at(line)}`,
  },
  cursor: { label: 'Cursor', link: (file, line) => `cursor://file${absolute(file)}${at(line)}` },
  // JetBrains takes the line as a query parameter rather than a suffix.
  webstorm: {
    label: 'WebStorm',
    link: (file, line) =>
      `jetbrains://web-storm/navigate/reference?path=${encodeURIComponent(absolute(file))}${
        line === undefined ? '' : `%3A${line}`
      }`,
  },
  zed: { label: 'Zed', link: (file, line) => `zed://file${absolute(file)}${at(line)}` },
  none: { label: 'None (copy the path)', link: () => null },
};

/** The editors a person can choose, for the Settings view. */
export function editorChoices(): readonly { readonly id: EditorId; readonly label: string }[] {
  return (Object.keys(EDITORS) as EditorId[]).map((id) => ({ id, label: EDITORS[id].label }));
}

/**
 * The URL that opens `file` in the chosen editor.
 *
 * @param line - one-based line, when the panel knows which one.
 * @returns the URL, or `null` when the choice is to copy the path instead.
 */
export function editorLink(editor: EditorId, file: string, line?: number): string | null {
  if (file === '') return null;
  return (EDITORS[editor] ?? EDITORS.vscode).link(file, line);
}

/** Editors address files by absolute path; a relative one opens nothing. */
function absolute(file: string): string {
  return file.startsWith('/') ? file : `/${file}`;
}

function at(line: number | undefined): string {
  return line === undefined ? '' : `:${line}`;
}
