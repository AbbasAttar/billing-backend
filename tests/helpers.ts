import { vi } from 'vitest';
import crypto from 'crypto';

/**
 * Stand-in for a firestoreModel query: every chain method (sort/limit/populate/lean/select)
 * returns the same object, and awaiting it resolves to `result`.
 */
export function chain<T>(result: T) {
  const q: any = {
    then: (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const m of ['sort', 'limit', 'skip', 'populate', 'lean', 'select']) q[m] = vi.fn(() => q);
  return q;
}

export const hmacHex = (secret: string, data: string | Buffer) =>
  crypto.createHmac('sha256', secret).update(data).digest('hex');
