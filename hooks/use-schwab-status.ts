'use client';

import { useCallback, useEffect, useState } from 'react';

type SchwabLinkStatus = {
  linked: boolean;
  status: 'active' | 'expired' | 'revoked' | null;
  refreshExpiresAt?: string;
};

export function useSchwabStatus() {
  const [schwabStatus, setSchwabStatus] = useState<SchwabLinkStatus>({ linked: false, status: null });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/schwab/status');
      if (!response.ok) {
        setSchwabStatus({ linked: false, status: null });
        return;
      }

      const data = (await response.json()) as SchwabLinkStatus;
      setSchwabStatus(data);
    } catch {
      setSchwabStatus({ linked: false, status: null });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { schwabStatus, loading, refresh };
}
