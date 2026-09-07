import { useEffect, useRef, useState } from 'react';
import { translateActive } from '../i18n';

export function useCompletionFeedback(scope: string) {
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [popped, setPopped] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(new Set<string>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const version = useRef(0);
  useEffect(() => {
    version.current += 1;
    inflight.current.clear();
    setPending(new Set());
    setPopped(new Set());
    setError(null);
    return () => {
      version.current += 1;
      for (const timer of timers.current) clearTimeout(timer);
      timers.current.clear();
    };
  }, [scope]);

  const run = async (key: string, done: boolean, mutation: () => void | Promise<unknown>) => {
    if (inflight.current.has(key)) return;
    const generation = version.current;
    inflight.current.add(key);
    setPending(new Set(inflight.current));
    setError(null);
    try {
      await mutation();
      if (generation !== version.current || !done || document.hidden) return;
      setPopped((old) => new Set(old).add(key));
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setPopped((old) => { const next = new Set(old); next.delete(key); return next; });
      }, 720);
      timers.current.add(timer);
    } catch {
      if (generation === version.current) setError(translateActive('common.mark.failed'));
    } finally {
      if (generation === version.current) {
        inflight.current.delete(key);
        setPending(new Set(inflight.current));
      }
    }
  };
  return { pending, popped, error, run };
}
