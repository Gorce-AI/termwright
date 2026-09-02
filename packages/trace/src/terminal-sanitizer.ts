import type { ResolvedArtifactSecurityPolicy } from '@termwright/protocol';
import { measureTextCellWidth } from '@termwright/vt';
import { TraceError } from './errors.js';

interface Token {
  raw: string;
  readonly visible: string;
}

/** Stateful VT-aware sanitizer used before terminal bytes enter the spool. */
export class TerminalSanitizer {
  readonly #policy: ResolvedArtifactSecurityPolicy;
  readonly #secrets = new Set<string>();
  readonly #tokens: Token[] = [];
  #control = '';
  #controlKind: 'esc' | 'csi' | 'string' | null = null;
  #stringEsc = false;

  constructor(policy: ResolvedArtifactSecurityPolicy) {
    this.#policy = policy;
    for (const secret of policy.secrets) this.register(secret);
  }

  register(value: string): void {
    for (const line of value.split(/\r?\n/u)) {
      if (line !== '') this.#secrets.add(line);
    }
  }

  push(text: string): string {
    if (this.#policy.mode === 'raw') return text;
    if (this.#policy.mode === 'none') return '';
    this.#tokenize(text);
    this.#redactPending();
    this.#assertBounded();
    return this.#flush(false);
  }

  finish(): string {
    if (this.#policy.mode === 'raw') return '';
    if (this.#policy.mode === 'none') return '';
    if (this.#control !== '') {
      // An unterminated string control can hide arbitrary payload. Persisting
      // it would be neither replayable nor provably sanitized.
      throw new TraceError('protocol-violation', 'terminal stream ended inside a control sequence');
    }
    this.#redactPending();
    return this.#flush(true);
  }

  sanitizeComplete(text: string): string {
    const isolated = new TerminalSanitizer(this.#policy);
    for (const secret of this.#secrets) isolated.register(secret);
    return isolated.push(text) + isolated.finish();
  }

  #tokenize(text: string): void {
    for (const character of text) {
      if (this.#controlKind === null) {
        if (character === '\u001b') {
          this.#control = character;
          this.#controlKind = 'esc';
        } else {
          this.#tokens.push({ raw: character, visible: character });
        }
        continue;
      }

      this.#control += character;
      if (this.#controlKind === 'esc') {
        if (character === '[') this.#controlKind = 'csi';
        else if (character === ']' || character === 'P' || character === '_' || character === '^')
          this.#controlKind = 'string';
        else this.#finishControl();
      } else if (this.#controlKind === 'csi') {
        const code = character.codePointAt(0) ?? 0;
        if (code >= 0x40 && code <= 0x7e) this.#finishControl();
      } else if (character === '\u0007' || (this.#stringEsc && character === '\\')) {
        this.#finishControl();
      } else {
        this.#stringEsc = character === '\u001b';
      }
    }
  }

  #finishControl(): void {
    this.#tokens.push({ raw: this.#sanitizeControl(this.#control), visible: '' });
    this.#control = '';
    this.#controlKind = null;
    this.#stringEsc = false;
  }

  #sanitizeControl(control: string): string {
    let result = control;
    for (const secret of this.#secrets) result = result.split(secret).join('[redacted]');
    for (const rule of this.#policy.patterns) {
      const pattern = rule.pattern;
      pattern.lastIndex = 0;
      result = result.replace(pattern, (match: string) => {
        this.#assertPatternBound(match, rule.maxMatchChars);
        return '[redacted]';
      });
    }
    return result;
  }

  #redactPending(): void {
    const visible = this.#tokens.map((token) => token.visible).join('');
    const ranges: Array<{ start: number; end: number; mask: string }> = [];
    for (const secret of this.#secrets) {
      let from = 0;
      while (from <= visible.length - secret.length) {
        const start = visible.indexOf(secret, from);
        if (start < 0) break;
        ranges.push({ start, end: start + secret.length, mask: maskGeometry(secret) });
        from = start + Math.max(1, secret.length);
      }
    }
    for (const rule of this.#policy.patterns) {
      const pattern = rule.pattern;
      pattern.lastIndex = 0;
      for (const match of visible.matchAll(global(pattern))) {
        if (match.index !== undefined && match[0] !== '') {
          this.#assertPatternBound(match[0], rule.maxMatchChars);
          ranges.push({
            start: match.index,
            end: match.index + match[0].length,
            mask: maskGeometry(match[0]),
          });
        }
      }
    }
    ranges.sort((left, right) => right.start - left.start);
    for (const range of ranges) this.#replaceVisibleRange(range.start, range.end, range.mask);
  }

  #replaceVisibleRange(start: number, end: number, mask: string): void {
    let offset = 0;
    let placed = false;
    for (const token of this.#tokens) {
      const next = offset + token.visible.length;
      if (token.visible !== '' && next > start && offset < end) {
        token.raw = placed ? '' : mask;
        placed = true;
      }
      offset = next;
    }
  }

  #flush(all: boolean): string {
    const keep = all ? 0 : Math.max(0, this.#longestSecret() - 1);
    const totalVisible = this.#tokens.reduce((sum, token) => sum + token.visible.length, 0);
    const flushVisible = Math.max(0, totalVisible - keep);
    let seen = 0;
    let count = 0;
    while (count < this.#tokens.length) {
      const token = this.#tokens[count];
      if (token === undefined) break;
      if (token.visible !== '' && seen + token.visible.length > flushVisible) break;
      seen += token.visible.length;
      count += 1;
    }
    return this.#tokens
      .splice(0, count)
      .map((token) => token.raw)
      .join('');
  }

  #longestSecret(): number {
    let longest = 1;
    for (const secret of this.#secrets) longest = Math.max(longest, secret.length);
    for (const rule of this.#policy.patterns) longest = Math.max(longest, rule.maxMatchChars);
    return longest;
  }

  #assertPatternBound(match: string, maximum: number): void {
    if (match.length > maximum) {
      throw new TraceError(
        'capacity',
        `artifact redaction pattern exceeded its declared ${maximum}-character streaming bound`,
      );
    }
  }

  #assertBounded(): void {
    const pending =
      Buffer.byteLength(this.#control, 'utf8') +
      this.#tokens.reduce((sum, token) => sum + Buffer.byteLength(token.raw, 'utf8'), 0);
    if (pending > this.#policy.maxTerminalPendingBytes) {
      throw new TraceError(
        'capacity',
        `terminal sanitizer pending data exceeded ${this.#policy.maxTerminalPendingBytes} bytes`,
      );
    }
  }
}

const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

function maskGeometry(text: string): string {
  let result = '';
  for (const { segment } of segmenter.segment(text)) {
    if (segment === '\r' || segment === '\n') result += segment;
    else result += '█'.repeat(measureTextCellWidth(segment));
  }
  return result;
}

function global(pattern: RegExp): RegExp {
  return new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
  );
}
