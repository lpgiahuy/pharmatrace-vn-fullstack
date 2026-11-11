'use client';

import { useCallback, useEffect, useState } from 'react';
import { App } from 'antd';
import { workflowErrorMessage } from '@/utils/workflow-error';

export function useLogisticsList<T>(load: () => Promise<T>, errorMessage: string, enabled = true) {
  const { message } = App.useApp();
  const [result, setResult] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      if (!enabled) { setLoading(false); return; }
      setLoading(true);
      try {
        const response = await load();
        if (!cancelled) setResult(response);
      } catch (error) {
        if (!cancelled) message.error(workflowErrorMessage(error, errorMessage));
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [load, errorMessage, enabled, revision, message]);

  return { result: enabled ? result : undefined, loading, reload };
}
