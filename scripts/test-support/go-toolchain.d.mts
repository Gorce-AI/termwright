export declare function goTestCapability<T>(
  probe: () => Promise<T>,
  unavailable: T,
  label: string,
  env?: Readonly<Record<string, string | undefined>>,
): Promise<T>;
