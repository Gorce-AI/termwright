/**
 * The single module in this package that is allowed to import
 * `@modelcontextprotocol/sdk`.
 *
 * Everything else — tools, server wiring, CLI, tests — imports from here. The
 * SDK v2 package split is therefore a change to this one file: re-point the
 * specifiers, keep the exported names, and no tool handler moves.
 *
 * Nothing SDK-shaped leaks into the package's own public surface
 * (`src/index.ts`) beyond what a host needs to connect a transport.
 */
import type { Client as ClientType } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpServer as McpServerType } from '@modelcontextprotocol/sdk/server/mcp.js';

export { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
export { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
export { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
export { Client } from '@modelcontextprotocol/sdk/client/index.js';
export { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
export { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

export type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

/**
 * Connects a server to a transport.
 *
 * The SDK is compiled without `exactOptionalPropertyTypes`, so its transport
 * classes declare `onclose?: (() => void) | undefined` while the `Transport`
 * interface declares `onclose?: () => void`. The two are the same thing at
 * runtime; the single cast that reconciles them lives here, in the SDK
 * boundary, rather than in every call site.
 */
export async function connectTransport(server: McpServerType, transport: unknown): Promise<void> {
  await server.connect(transport as Parameters<McpServerType['connect']>[0]);
}

/** The client-side counterpart of {@link connectTransport}, with the same rationale. */
export async function connectClient(client: ClientType, transport: unknown): Promise<void> {
  await client.connect(transport as Parameters<ClientType['connect']>[0]);
}

export type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
