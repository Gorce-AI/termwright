export declare function requireImmutableBuildInputs(
  entries: readonly string[],
  options: {
    readonly label: string;
    readonly buildCommand?: string;
    readonly root?: string;
    readonly manifestPath?: string;
  },
): Promise<void>;
