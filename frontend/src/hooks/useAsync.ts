import { useCallback, useEffect, useState } from 'react';

export type AsyncState<T> =
  { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'success'; data: T };

interface Settled<T> {
  key: string;
  state: AsyncState<T>;
}

/** Runs `load` when `deps` change (or `reload()` is called); the result is ignored if it is no longer current. */
export function useAsync<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> & { reload: () => void } {
  const [tick, setTick] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const key = `${tick}|${JSON.stringify(deps)}`;

  useEffect(() => {
    let current = true;
    load().then(
      (data) => current && setSettled({ key, state: { status: 'success', data } }),
      (error: unknown) => current && setSettled({ key, state: { status: 'error', error } }),
    );
    return () => {
      current = false;
    };
    // `load` is intentionally not a dependency: callers pass an inline function and list what it reads in `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const state: AsyncState<T> =
    settled && settled.key === key ? settled.state : { status: 'loading' };
  return { ...state, reload };
}
