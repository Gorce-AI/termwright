import { describe, expect, it } from "vitest";
import { ConPtyControlPlaneNormalizer } from "./windows-output-normalizer.js";

const DA1 = "\x1b[c";
const DSRCPR = "\x1b[6n";
const FOCUS_ON = "\x1b[?1004h";
const FOCUS_OFF = "\x1b[?1004l";
const WIN32_ON = "\x1b[?9001h";
const WIN32_OFF = "\x1b[?9001l";
const RIS = "\x1bc";

function normalize(chunks: readonly Buffer[]): Buffer {
  const normalizer = new ConPtyControlPlaneNormalizer();
  const output = chunks.map((chunk) => normalizer.push(chunk));
  output.push(normalizer.finish());
  return Buffer.concat(output);
}

function everySplit(input: string, expected: string): void {
  const source = Buffer.from(input);
  expect(normalize([source]).toString()).toBe(expected);
  expect(normalize([...source].map((byte) => Buffer.of(byte))).toString()).toBe(expected);
  for (let first = 0; first <= source.length; first += 1) {
    expect(normalize([source.subarray(0, first), source.subarray(first)]).toString()).toBe(expected);
    for (let second = first; second <= source.length; second += 1) {
      expect(normalize([
        source.subarray(0, first),
        source.subarray(first, second),
        source.subarray(second),
      ]).toString()).toBe(expected);
    }
  }
}

describe("ConPTY control-plane output normalization", () => {
  it("keeps DA1 while removing the two startup host modes at every split", () => {
    everySplit(`${DA1}${FOCUS_ON}${WIN32_ON}app`, `${DA1}app`);
  });

  it("keeps startup DSRCPR and DA1 while removing host modes at every split", () => {
    everySplit(
      `${DSRCPR}${DA1}${FOCUS_ON}${WIN32_ON}app`,
      `${DSRCPR}${DA1}app`,
    );
  });

  it("removes only the focus mode reinjected after a child reset", () => {
    everySplit(`a${FOCUS_OFF}${FOCUS_ON}b`, `a${FOCUS_OFF}b`);
  });

  it("removes only the Win32 input mode reinjected after a child reset", () => {
    everySplit(`a${WIN32_OFF}${WIN32_ON}b`, `a${WIN32_OFF}b`);
  });

  it("removes both host modes reinjected after RIS", () => {
    everySplit(`a${RIS}${FOCUS_ON}${WIN32_ON}b`, `a${RIS}b`);
  });

  it("preserves an intentional child disable followed by enable", () => {
    // ConPTY inserts its own SET between the two original child sequences.
    // The first SET is removed; the second one remains application evidence.
    everySplit(
      `${FOCUS_OFF}${FOCUS_ON}${FOCUS_ON}${WIN32_OFF}${WIN32_ON}${WIN32_ON}`,
      `${FOCUS_OFF}${FOCUS_ON}${WIN32_OFF}${WIN32_ON}`,
    );
  });

  it("preserves child mode changes following a hard reset", () => {
    everySplit(
      `${RIS}${FOCUS_ON}${WIN32_ON}${FOCUS_ON}${WIN32_ON}`,
      `${RIS}${FOCUS_ON}${WIN32_ON}`,
    );
  });

  it("does not remove standalone child enables or near misses", () => {
    const sequences = [
      FOCUS_ON,
      WIN32_ON,
      `${FOCUS_OFF}x${FOCUS_ON}`,
      `${WIN32_OFF}\x1b[?9002h`,
      `${RIS}${WIN32_ON}${FOCUS_ON}`,
      `${DA1}${FOCUS_ON}x${WIN32_ON}`,
      `x${DA1}${FOCUS_ON}${WIN32_ON}`,
    ];
    for (const sequence of sequences) everySplit(sequence, sequence);
  });

  it("releases every incomplete candidate verbatim at EOF", () => {
    const candidates = [
      `${DSRCPR}${DA1}${FOCUS_ON}${WIN32_ON}`,
      `${DA1}${FOCUS_ON}${WIN32_ON}`,
      `${FOCUS_OFF}${FOCUS_ON}`,
      `${WIN32_OFF}${WIN32_ON}`,
      `${RIS}${FOCUS_ON}${WIN32_ON}`,
    ];
    for (const candidate of candidates) {
      for (let length = 1; length < candidate.length; length += 1) {
        const prefix = candidate.slice(0, length);
        expect(normalize([Buffer.from(prefix)]).toString()).toBe(prefix);
      }
    }
  });

  it("is idempotent at EOF and rejects data after EOF", () => {
    const normalizer = new ConPtyControlPlaneNormalizer();
    expect(normalizer.push(Buffer.from(FOCUS_OFF))).toEqual(Buffer.alloc(0));
    expect(normalizer.finish().toString()).toBe(FOCUS_OFF);
    expect(normalizer.finish()).toEqual(Buffer.alloc(0));
    expect(() => normalizer.push(Buffer.from("late"))).toThrow(/after authoritative EOF/u);
  });
});
