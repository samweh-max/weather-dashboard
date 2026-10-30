'use client';

import { useEffect, useState } from 'react';

const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 5 * 60 * 1000;

/** Minimal fetch hook with a short in-memory cache. `url = null` skips fetching. */
export function useJson<T>(url: string | null): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>(() => {
    const c = url ? cache.get(url) : undefined;
    return { data: (c?.data as T) ?? null, error: null, loading: !!url && !c };
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!url) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    const c = cache.get(url);
    if (c && Date.now() - c.at < TTL && nonce === 0) {
      setState({ data: c.data as T, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ data: c ? (c.data as T) : s.data, error: null, loading: true }));
    fetch(url)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok && !(j && 'ok' in j)) throw new Error(j?.error?.error || j?.error || `Request failed (${r.status})`);
        return j as T;
      })
      .then((data) => {
        cache.set(url, { at: Date.now(), data });
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ data: null, error: e.message, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [url, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}
