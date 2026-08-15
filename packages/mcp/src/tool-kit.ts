/**
 * The small kit every tool definition is built from: what a handler is given,
 * what it returns, and the `defineTool` helper that keeps input schema, output
 * schema and handler types in step.
 *
 * It lives apart from the tool files so that `tools.ts` (live terminals) and
 * `trace-tools.ts` (recorded sessions) can share it without importing each
 * other.
 */
import type { z } from 'zod';
import type { ToolAnnotations } from './sdk-facade.js';
import type { TerminalStore } from './sessions.js';
import type { ScreenshotImage } from './screenshots.js';
import type { TraceStore } from './traces.js';

/** What a tool handler is given besides its arguments: the session's stores. */
export interface ToolContext {
  readonly terminals: TerminalStore;
  readonly traces: TraceStore;
}

/** A handler's result: the text block an agent reads, plus the structured data. */
export interface ToolOutcome<T> {
  readonly text: string;
  readonly data: T;
  /**
   * Images attached to the result as `ImageContent`, when the caller asked for
   * one. Text and structured data are never replaced by an image — an agent
   * that cannot see pictures loses nothing.
   */
  readonly images?: readonly ScreenshotImage[];
}

/** A registered tool, in the form both the server and `agent-context` consume. */
export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, z.ZodType>;
  readonly outputSchema: Record<string, z.ZodType>;
  readonly annotations: ToolAnnotations;
  /**
   * Args are typed `never` in the erased form so that any concrete handler is
   * assignable; the server passes the values zod already validated.
   */
  readonly handler: (context: ToolContext, args: never) => Promise<ToolOutcome<Record<string, unknown>>>;
}

export function defineTool<I extends Record<string, z.ZodType>, O extends Record<string, z.ZodType>>(definition: {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: I;
  readonly outputSchema: O;
  readonly annotations?: ToolAnnotations;
  readonly handler: (
    context: ToolContext,
    args: z.output<z.ZodObject<I>>,
  ) => Promise<ToolOutcome<z.output<z.ZodObject<O>>>>;
}): ToolDefinition {
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    annotations: definition.annotations ?? {},
    handler: definition.handler as ToolDefinition['handler'],
  };
}

