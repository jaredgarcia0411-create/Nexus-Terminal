'use client';

import { Activity, BarChart3, Filter, LayoutGrid, List, Search, User } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import SettingsMenu from '@/components/trading/SettingsMenu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { Trade } from '@/lib/types';

export type TabKey = 'dashboard' | 'journal' | 'performance' | 'filter' | 'backtesting';

type UserSession = { id?: string; name?: string | null; email?: string | null; image?: string | null } | undefined;

interface SidebarProps {
  activeTab: TabKey;
  setActiveTab: Dispatch<SetStateAction<TabKey>>;
  user: UserSession;
  trades: Trade[];
  onClearAllData: () => void;
  onSignOut: () => void;
}

export default function Sidebar({
  activeTab,
  setActiveTab,
  user,
  trades,
  onClearAllData,
  onSignOut,
}: SidebarProps) {
  return (
    <nav className="fixed left-0 top-0 z-50 flex h-full w-16 flex-col items-center gap-8 border-r border-white/5 bg-[#0A0A0B] py-6">
      <div className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl bg-emerald-500 shadow-lg shadow-emerald-500/20">
        <Activity className="h-6 w-6 text-black" />
      </div>

      <div className="flex flex-col gap-6 text-zinc-500">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`rounded-lg p-2 transition-colors ${activeTab === 'dashboard' ? 'bg-emerald-500/10 text-emerald-500' : 'hover:text-white'}`}
          title="Dashboard"
        >
          <LayoutGrid className="h-5 w-5" />
        </button>
        <button
          onClick={() => setActiveTab('performance')}
          className={`rounded-lg p-2 transition-colors ${activeTab === 'performance' ? 'bg-emerald-500/10 text-emerald-500' : 'hover:text-white'}`}
          title="Performance"
        >
          <BarChart3 className="h-5 w-5" />
        </button>
        <button
          onClick={() => setActiveTab('journal')}
          className={`rounded-lg p-2 transition-colors ${activeTab === 'journal' ? 'bg-emerald-500/10 text-emerald-500' : 'hover:text-white'}`}
          title="Journal"
        >
          <List className="h-5 w-5" />
        </button>
        <button
          onClick={() => setActiveTab('filter')}
          className={`rounded-lg p-2 transition-colors ${activeTab === 'filter' ? 'bg-emerald-500/10 text-emerald-500' : 'hover:text-white'}`}
          title="Filter"
        >
          <Filter className="h-5 w-5" />
        </button>
        <button
          onClick={() => setActiveTab('backtesting')}
          className={`rounded-lg p-2 transition-colors ${activeTab === 'backtesting' ? 'bg-emerald-500/10 text-emerald-500' : 'hover:text-white'}`}
          title="Backtesting"
        >
          <Search className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-auto flex flex-col gap-6 text-zinc-500">
        <SettingsMenu trades={trades} onClearAllData={onClearAllData} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-lg p-2 transition-colors hover:text-white" title="User Menu">
              <User className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64 border-white/10 bg-[#121214] text-white">
            <div className="border-b border-white/10 px-3 py-2">
              <p className="text-xs text-zinc-400">{user?.name}</p>
              <p className="text-[11px] text-zinc-500">{user?.email}</p>
            </div>
            <DropdownMenuItem onClick={onSignOut} className="cursor-pointer text-rose-400">
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
