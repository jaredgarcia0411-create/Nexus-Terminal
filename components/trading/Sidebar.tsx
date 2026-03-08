'use client';

import { Activity, BarChart3, Bot, Filter, LayoutGrid, List, User } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import SettingsMenu from '@/components/trading/SettingsMenu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useIsMobile } from '@/hooks/use-mobile';
import type { Trade } from '@/lib/types';

export type TabKey = 'dashboard' | 'journal' | 'performance' | 'filter' | 'jarvis';

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
  const isMobile = useIsMobile();

  const navItems: Array<{ tab: TabKey; title: string; icon: typeof LayoutGrid }> = [
    { tab: 'dashboard', title: 'Dashboard', icon: LayoutGrid },
    { tab: 'performance', title: 'Performance', icon: BarChart3 },
    { tab: 'journal', title: 'Journal', icon: List },
    { tab: 'filter', title: 'Trades', icon: Filter },
    { tab: 'jarvis', title: 'Jarvis', icon: Bot },
  ];

  if (isMobile) {
    return (
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/5 bg-[#0A0A0B] px-2 py-2">
        <div className="flex items-center justify-around text-zinc-500">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.tab}
                onClick={() => setActiveTab(item.tab)}
                className={`rounded-lg p-2 transition-colors ${activeTab === item.tab ? 'bg-emerald-500/10 text-emerald-500' : 'hover:text-white'}`}
                title={item.title}
                aria-label={item.title}
              >
                <Icon className="h-5 w-5" />
              </button>
            );
          })}

          <SettingsMenu trades={trades} onClearAllData={onClearAllData} />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-lg p-2 transition-colors hover:text-white" title="User Menu" aria-label="User Menu">
                <User className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 border-white/10 bg-[#121214] text-white">
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

  return (
    <nav className="fixed left-0 top-0 z-50 flex h-full w-56 flex-col gap-6 border-r border-white/5 bg-[#0A0A0B] px-3 py-6">
      <div className="flex items-center gap-3 px-2">
        <div className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl bg-emerald-500 shadow-lg shadow-emerald-500/20">
        <Activity className="h-6 w-6 text-black" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Nexus</p>
          <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Terminal</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 text-zinc-500">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.tab}
              onClick={() => setActiveTab(item.tab)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${activeTab === item.tab ? 'bg-emerald-500/10 text-emerald-500' : 'hover:bg-white/5 hover:text-white'}`}
              title={item.title}
              aria-label={item.title}
            >
              <Icon className="h-5 w-5" />
              <span className="text-sm font-medium">{item.title}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-auto flex flex-col gap-2 text-zinc-500">
        <SettingsMenu trades={trades} onClearAllData={onClearAllData} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-white/5 hover:text-white" title="User Menu" aria-label="User Menu">
              <User className="h-5 w-5" />
              <span className="text-sm font-medium">Account</span>
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
