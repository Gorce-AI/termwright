/**
 * Splits the command entered in the recorder into an executable and arguments.
 *
 * This is deliberately a parser, not a shell. Quotes only group text,
 * backslashes only escape whitespace, quotes and another backslash, and
 * characters such as `$`, `*`, `|` and `;` stay literal. That gives the form
 * the useful part of a command line without evaluating anything on the user's
 * machine.
 */

export type CommandLineErrorCode =
  'dangling-escape' | 'unclosed-single-quote' | 'unclosed-double-quote';

/** A syntax error that the recorder can show directly beside the command. */
export class CommandLineSyntaxError extends Error {
  override readonly name = 'CommandLineSyntaxError';

  constructor(
    readonly code: CommandLineErrorCode,
    readonly index: number,
    message: string,
  ) {
    super(`${message} (character ${index + 1}).`);
  }
}

interface Quote {
  readonly value: "'" | '"';
  readonly start: number;
}

/**
 * Parses a shell-like command line without invoking or emulating a shell.
 *
 * Adjacent quoted and unquoted fragments form one argument, so
 * `--name="two words"` becomes `--name=two words`. Empty quoted strings are
 * kept as empty arguments. A backslash before an ordinary character remains a
 * backslash, which keeps Windows paths such as `C:\\tools\\app.exe` intact.
 */
export function parseCommandLine(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let started = false;
  let quote: Quote | null = null;

  const finish = (): void => {
    if (!started) return;
    args.push(current);
    current = '';
    started = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] as string;

    // Single quotes are fully literal. A backslash inside one is therefore a
    // backslash rather than an escape, matching the least surprising shell
    // convention and preserving paths.
    if (quote?.value === "'") {
      if (character === "'") quote = null;
      else current += character;
      continue;
    }

    if (character === '\\') {
      const next = input[index + 1];
      if (next === undefined) {
        throw new CommandLineSyntaxError(
          'dangling-escape',
          index,
          'The command line ends with a backslash',
        );
      }
      if (isEscapable(next)) {
        current += next;
        index += 1;
      } else {
        // `\P` is not an escape in this grammar. Keeping both characters is
        // important for ordinary, unquoted Windows path segments.
        current += `\\${next}`;
        index += 1;
      }
      started = true;
      continue;
    }

    if (quote !== null) {
      if (character === quote.value) quote = null;
      else current += character;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = { value: character, start: index };
      started = true;
      continue;
    }

    if (/\s/u.test(character)) {
      finish();
      continue;
    }

    current += character;
    started = true;
  }

  if (quote !== null) {
    throw new CommandLineSyntaxError(
      quote.value === "'" ? 'unclosed-single-quote' : 'unclosed-double-quote',
      quote.start,
      quote.value === "'" ? 'Unclosed single quote' : 'Unclosed double quote',
    );
  }

  finish();
  return args;
}

function isEscapable(character: string): boolean {
  return character === '\\' || character === "'" || character === '"' || /\s/u.test(character);
}
