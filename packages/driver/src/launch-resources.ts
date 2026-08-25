/** Host-owned resource admission at the actual terminal allocation boundary. */

export interface TerminalLaunchResourceLease {
  /** Binds admitted capacity to the concrete session before allocation. */
  attach(sessionId: string): Promise<void>;
  /** Releases capacity only after the driver's verified teardown barrier. */
  release(): Promise<void>;
}

export type TerminalLaunchResourceProvider = () => Promise<TerminalLaunchResourceLease>;

const PROVIDER_KEY = Symbol.for('termwright.driver.launch-resource-provider.v1');
const globals = globalThis as typeof globalThis & {
  [PROVIDER_KEY]?: TerminalLaunchResourceProvider;
};

/** Installs the native host's worker-local admission provider. @internal */
export function installTerminalLaunchResourceProvider(provider: TerminalLaunchResourceProvider): void {
  globals[PROVIDER_KEY] = provider;
}

/** @internal */
export async function acquireTerminalLaunchResourceLease(): Promise<TerminalLaunchResourceLease | null> {
  return await (globals[PROVIDER_KEY]?.() ?? null);
}
