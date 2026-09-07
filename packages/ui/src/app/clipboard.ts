/** Convert unavailable clipboard APIs and denied writes into the same rejected promise. */
export async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}
