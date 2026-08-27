import { rm } from 'node:fs/promises';

export interface ProbeStartCleanup {
  readonly closeAdmission?: () => Promise<void>;
  readonly disposePty?: () => void;
  readonly directory?: string | null;
  readonly debugFile?: string | null;
}

/** Rolls back every resource acquired before AdapterProbe startup committed. */
export async function rollbackProbeStart(
  primary: unknown,
  cleanup: ProbeStartCleanup,
): Promise<never> {
  const failures: unknown[] = [primary];
  let serverClosed = Promise.resolve();
  if (cleanup.closeAdmission !== undefined) {
    try {
      serverClosed = cleanup.closeAdmission();
    } catch (error) {
      failures.push(error);
    }
  }
  if (cleanup.disposePty !== undefined) {
    try {
      cleanup.disposePty();
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await serverClosed;
  } catch (error) {
    failures.push(error);
  }
  for (const path of [cleanup.directory, cleanup.debugFile]) {
    if (path === undefined || path === null) continue;
    try {
      await rm(path, { recursive: path === cleanup.directory, force: true });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw primary;
  throw new AggregateError(failures, 'adapter probe startup and rollback failed', {
    cause: primary,
  });
}
