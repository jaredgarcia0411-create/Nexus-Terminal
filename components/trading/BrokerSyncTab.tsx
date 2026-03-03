'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Activity, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { format, subDays } from 'date-fns';

type SchwabAccount = { accountId: string; type: string };
type SyncLog = { tradesImported: number; warnings: string[] };

export default function BrokerSyncTab() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<SchwabAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncLog | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/schwab/status');
      const data = (await res.json()) as { connected: boolean };
      setConnected(data.connected);

      if (data.connected) {
        const acctRes = await fetch('/api/schwab/accounts');
        if (acctRes.ok) {
          const acctData = (await acctRes.json()) as { accounts: SchwabAccount[] };
          setAccounts(acctData.accounts);
          if (acctData.accounts.length > 0 && !selectedAccount) {
            setSelectedAccount(acctData.accounts[0].accountId);
          }
        }
      }
    } catch {
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, [selectedAccount]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleConnectSchwab = async () => {
    try {
      const res = await fetch('/api/auth/schwab/url');
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start auth');
      window.open(data.url, 'schwab_login', 'width=600,height=700');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not connect');
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SCHWAB_AUTH_SUCCESS') {
        toast.success('Charles Schwab connected');
        loadStatus();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [loadStatus]);

  const handleSync = async () => {
    if (!selectedAccount) return;
    setSyncing(true);
    setLastResult(null);

    try {
      const res = await fetch('/api/schwab/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedAccount, startDate, endDate }),
      });

      const data = (await res.json()) as SyncLog & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Sync failed');

      setLastResult(data);
      toast.success(`Synced ${data.tradesImported} trade(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <motion.div key="sync" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
      <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-[#121214] p-5">
        <div>
          <h2 className="text-xl font-bold">Broker Sync</h2>
          <p className="mt-1 text-xs text-zinc-500">Auto-import trades from connected broker accounts</p>
        </div>
        {loading ? (
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-400">Checking...</span>
        ) : connected ? (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400">Connected</span>
        ) : (
          <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs text-rose-400">Not connected</span>
        )}
      </div>

      {!connected && !loading ? (
        <div className="rounded-2xl border border-white/5 bg-[#121214] p-8">
          <button
            onClick={handleConnectSchwab}
            className="flex w-fit items-center gap-3 rounded-xl bg-[#00338d] px-8 py-4 font-bold text-white shadow-lg shadow-blue-900/20 transition-all hover:bg-[#002a75]"
          >
            <Activity className="h-5 w-5" />
            Connect Charles Schwab API
          </button>
        </div>
      ) : null}

      {connected ? (
        <div className="space-y-6 rounded-2xl border border-white/5 bg-[#121214] p-8">
          <div className="grid max-w-2xl grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Account</label>
              <select
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm focus:border-emerald-500/50 focus:outline-none"
              >
                {accounts.map((acct) => (
                  <option key={acct.accountId} value={acct.accountId}>
                    {acct.accountId} ({acct.type})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm focus:border-emerald-500/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm focus:border-emerald-500/50 focus:outline-none"
              />
            </div>
          </div>

          <button
            onClick={handleSync}
            disabled={syncing || !selectedAccount}
            className="flex items-center gap-2 rounded-lg bg-emerald-500 px-6 py-2 text-sm font-medium text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync Trades'}
          </button>

          {lastResult ? (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
              <p className="text-sm font-medium text-emerald-400">{lastResult.tradesImported} trade(s) imported</p>
              {lastResult.warnings.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {lastResult.warnings.map((w, i) => (
                    <li key={i} className="text-xs text-yellow-400">{w}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </motion.div>
  );
}
