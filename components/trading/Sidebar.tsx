'use client';

import { Activity, ChartCandlestick, ChevronLeft, ChevronRight, File, FileSpreadsheet, Folder, LayoutGrid, List, Plus, Search, Upload, User } from 'lucide-react';
import { useState, type Dispatch, type SetStateAction } from 'react';
import SettingsMenu from '@/components/trading/SettingsMenu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useIsMobile } from '@/hooks/use-mobile';
import type { Trade } from '@/lib/types';

export type TabKey = 'dashboard' | 'management' | 'charts' | 'research';

type UserSession = { id?: string; name?: string | null; email?: string | null; image?: string | null } | undefined;

interface SidebarProps {
  activeTab: TabKey;
  setActiveTab: Dispatch<SetStateAction<TabKey>>;
  user: UserSession;
  trades: Trade[];
  onClearAllData: () => void;
  onSignOut: () => void;
  onNewTradeClick: () => void;
  onImportClick: () => void;
  onFolderImportClick: () => void;
  onTraderVueImportClick: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Sidebar({
  activeTab,
  setActiveTab,
  user,
  trades,
  onClearAllData,
  onSignOut,
  onNewTradeClick,
  onImportClick,
  onFolderImportClick,
  onTraderVueImportClick,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const isMobile = useIsMobile();
  const [importMenuOpen, setImportMenuOpen] = useState(false);

  const navItems: Array<{ tab: TabKey; title: string; icon: typeof LayoutGrid }> = [
    { tab: 'dashboard', title: 'Dashboard', icon: LayoutGrid },
    { tab: 'management', title: 'Management', icon: List },
    { tab: 'charts', title: 'Charts', icon: ChartCandlestick },
    { tab: 'research', title: 'Research', icon: Search },
  ];

  if (isMobile) {
    return (
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/5 bg-[#0A0A0B] px-2 py-2">
        {/* TODO: collapse behind More on mobile when nav items exceed screen width */}
        <div className="flex items-center justify-around overflow-x-auto text-zinc-500">
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
    <nav className={`fixed left-0 top-0 z-50 flex h-full flex-col gap-4 border-r border-white/5 bg-[#0A0A0B] transition-all duration-300 ${collapsed ? 'w-16 px-2 py-4' : 'w-56 px-3 py-6'}`}>
      {/* Header: Logo + Collapse Toggle */}
      <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3 px-2'}`}>
        {!collapsed && (
          <>
            <div className="flex cursor-pointer items-center justify-center rounded-xl bg-emerald-500 shadow-lg shadow-emerald-500/20 transition-all h-12 w-12">
              <Activity className="text-black transition-all h-7 w-7" />
            </div>
            <div className="flex flex-1 flex-col">
              <p className="text-base font-semibold text-white">Nexus</p>
              <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Terminal</p>
            </div>
          </>
        )}
        <button
          onClick={onToggleCollapse}
          className={`flex items-center justify-center rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-white ${collapsed ? 'mx-auto' : ''}`}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Navigation Items */}
      <div className={`flex flex-col gap-1 text-zinc-500 ${collapsed ? 'px-1' : 'px-2'}`}>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.tab}
              onClick={() => setActiveTab(item.tab)}
              className={`flex items-center gap-3 rounded-lg transition-colors ${activeTab === item.tab ? 'bg-emerald-500/10 text-emerald-500' : 'hover:bg-white/5 hover:text-white'} ${collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2'}`}
              title={item.title}
              aria-label={item.title}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span className="text-sm font-medium">{item.title}</span>}
            </button>
          );
        })}
      </div>

  {/* Footer - Grouped buttons */}
  <div className={`mt-auto flex flex-col gap-2 text-zinc-500 ${collapsed ? 'px-1' : 'px-2'}`}>
    {/* New Trade */}
    <button
      onClick={onNewTradeClick}
      className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-500 transition-colors hover:bg-emerald-500/20"
      title="New Trade"
      aria-label="New Trade"
    >
      <Plus className="h-4 w-4 shrink-0" />
      {!collapsed && <span>New Trade</span>}
    </button>

    {/* Import */}
    {!collapsed ? (
      <DropdownMenu open={importMenuOpen} onOpenChange={setImportMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
            title="Import"
            aria-label="Import"
          >
            <Upload className="h-4 w-4 shrink-0" />
            Import
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48 border-white/10 bg-[#121214] text-white">
          <DropdownMenuItem onClick={onImportClick} className="cursor-pointer gap-2">
            <File className="h-4 w-4" />
            Import Files
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onFolderImportClick} className="cursor-pointer gap-2">
            <Folder className="h-4 w-4" />
            Import Folder
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onTraderVueImportClick} className="cursor-pointer gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Import from TraderVue
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <DropdownMenu open={importMenuOpen} onOpenChange={setImportMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className="flex cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white transition-colors hover:bg-white/10"
            title="Import"
            aria-label="Import"
          >
            <Upload className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" className="w-48 border-white/10 bg-[#121214] text-white">
          <DropdownMenuItem onClick={onImportClick} className="cursor-pointer gap-2">
            <File className="h-4 w-4" />
            Import Files
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onFolderImportClick} className="cursor-pointer gap-2">
            <Folder className="h-4 w-4" />
            Import Folder
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onTraderVueImportClick} className="cursor-pointer gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Import from TraderVue
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )}

    {/* Settings */}
    <SettingsMenu trades={trades} onClearAllData={onClearAllData} collapsed={collapsed} />

    {/* Account */}
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`flex items-center gap-3 rounded-lg transition-colors hover:bg-white/5 hover:text-white ${collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2'}`}
          title="User Menu"
          aria-label="User Menu"
        >
          <User className="h-5 w-5 shrink-0" />
          {!collapsed && <span className="text-sm font-medium">Account</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={collapsed ? 'start' : 'start'} side={collapsed ? 'right' : 'bottom'} className="w-64 border-white/10 bg-[#121214] text-white">
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
