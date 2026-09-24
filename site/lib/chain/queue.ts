/**
 * One queue per signer.
 *
 * A nonce manager hands out distinct nonces, but transactions must still reach the node in
 * nonce order, and a transaction above a gap is not late but unmineable: the node will not skip
 * a nonce. Running each signer's submissions one at a time, each waiting for its receipt,
 * keeps the order. Different signers still proceed in parallel.
 */
export function signerQueues<K>() {
  const tails = new Map<K, Promise<unknown>>();
  return function enqueue<T>(signer: K, task: () => Promise<T>): Promise<T> {
    const previous = tails.get(signer) ?? Promise.resolve();
    const next = previous.then(task, task);
    // The chain continues past a failed task, without holding on to its rejection.
    tails.set(signer, next.catch(() => undefined));
    return next;
  };
}
