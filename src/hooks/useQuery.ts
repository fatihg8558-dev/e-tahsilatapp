import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type QueryKey = readonly unknown[];

export interface UseQueryOptions<T> {
  queryKey: QueryKey;
  queryFn: (ctx: { signal: AbortSignal; queryKey: QueryKey }) => Promise<T>;
  enabled?: boolean;
  initialData: T;
  refetchOnWindowFocus?: boolean;
}

export interface UseQueryResult<T> {
  data: T;
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  dataUpdatedAt: number | null;
  refetchCount: number;
  lastQueryKey: QueryKey;
  refetch: () => Promise<T | undefined>;
}

const serializeQueryKey = (key: QueryKey): string => {
  try {
    return JSON.stringify(key);
  } catch {
    return key.map((part) => String(part)).join('|');
  }
};

/**
 * Hafif, race-condition korumalı ve `queryKey` (ör. `receiptRefreshKey`)
 * değiştiğinde veriyi otomatik tazeleyen React Query benzeri veri çekme kancası.
 */
export function useQuery<T>({
  queryKey,
  queryFn,
  enabled = true,
  initialData,
  refetchOnWindowFocus = true,
}: UseQueryOptions<T>): UseQueryResult<T> {
  const [data, setData] = useState<T>(initialData);
  const [hasResolvedOnce, setHasResolvedOnce] = useState<boolean>(false);
  const [isFetching, setIsFetching] = useState<boolean>(Boolean(enabled));
  const [error, setError] = useState<string | null>(null);
  const [dataUpdatedAt, setDataUpdatedAt] = useState<number | null>(null);
  const [refetchCount, setRefetchCount] = useState<number>(0);
  const [lastQueryKey, setLastQueryKey] = useState<QueryKey>(queryKey);

  const queryFnRef = useRef(queryFn);
  queryFnRef.current = queryFn;

  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;

  const requestSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const serializedKey = useMemo(() => serializeQueryKey(queryKey), [queryKey]);

  const executeQuery = useCallback(async (): Promise<T | undefined> => {
    if (!enabled) {
      setIsFetching(false);
      return undefined;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const seq = ++requestSeqRef.current;
    const activeKey = queryKeyRef.current;

    setIsFetching(true);
    setError(null);

    try {
      const result = await queryFnRef.current({
        signal: controller.signal,
        queryKey: activeKey,
      });

      if (controller.signal.aborted || seq !== requestSeqRef.current) {
        return undefined;
      }

      setData(result);
      setHasResolvedOnce(true);
      setDataUpdatedAt(Date.now());
      setLastQueryKey(activeKey);
      setRefetchCount((c) => c + 1);
      return result;
    } catch (err: unknown) {
      if (controller.signal.aborted || seq !== requestSeqRef.current) {
        return undefined;
      }
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
          ? err
          : 'Veriler yüklenirken hata oluştu.';
      setError(message);
      setHasResolvedOnce(true);
      return undefined;
    } finally {
      if (seq === requestSeqRef.current) {
        setIsFetching(false);
      }
    }
  }, [enabled, serializedKey]);

  useEffect(() => {
    if (!enabled) {
      setIsFetching(false);
      return;
    }

    void executeQuery();

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [enabled, executeQuery]);

  useEffect(() => {
    if (!enabled || !refetchOnWindowFocus || typeof window === 'undefined') {
      return;
    }

    const handleFocus = () => {
      void executeQuery();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void executeQuery();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, refetchOnWindowFocus, executeQuery]);

  return {
    data,
    isLoading: Boolean(enabled) && !hasResolvedOnce && isFetching,
    isFetching,
    error,
    dataUpdatedAt,
    refetchCount,
    lastQueryKey,
    refetch: executeQuery,
  };
}
