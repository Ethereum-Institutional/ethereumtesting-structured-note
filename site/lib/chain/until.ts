/**
 * Reads until `ok`, for up to about ten seconds. Just after a transaction, a load-balanced RPC may
 * answer from the block before it; a step that relies on the last one waits for it.
 */
export async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, tries = 7): Promise<T> {
  let v = await read();
  for (let i = 0; i < tries && !ok(v); i++) {
    await new Promise((r) => setTimeout(r, 1500));
    v = await read();
  }
  return v;
}
