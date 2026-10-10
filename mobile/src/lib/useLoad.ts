import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

// Loads data every time the screen comes into view; supports pull-to-refresh.
export function useLoad<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fn());
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  return { data, error, loading, reload };
}