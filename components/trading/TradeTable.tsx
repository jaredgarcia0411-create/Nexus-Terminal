'use client';

import React, { useState } from 'react';
import { Trade } from '@/lib/types';
import { formatCurrency, getPnLColor, formatR } from '@/lib/trading-utils';
import { format } from 'date-fns';
import { X, Plus } from 'lucide-react';

interface TradeTableProps {
  trades: Trade[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onAddTag: (tradeId: string, tagName: string) => void;
  onRemoveTag: (tradeId: string, tagName: string) => void;
  onUpdateNotes?: (tradeId: string, notes: string) => void;
  onDeleteGlobalTag?: (tagName: string) => void;
  globalTags: string[];
  readOnly?: boolean;
}

export default function TradeTable({ 
  trades, 
  selectedIds, 
  onToggleSelect, 
  onSelectAll,
  onAddTag,
  onRemoveTag,
  onUpdateNotes,
  onDeleteGlobalTag,
  globalTags,
  readOnly = false
}: TradeTableProps) {
  const allSelected = trades.length > 0 && trades.every(t => selectedIds.has(t.id));
  const [activeTagInput, setActiveTagInput] = useState<string | null>(null);
  const [newTagValue, setNewTagValue] = useState('');
  const [activeNotesInput, setActiveNotesInput] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');

  return (
    <div className="overflow-x-auto rounded-xl border border-white/5 bg-[#121214]">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-white/5 bg-white/5 text-zinc-500 font-medium">
          <tr>
            {!readOnly && (
              <th className="px-4 py-3 w-10">
                <input 
                  type="checkbox" 
                  className="rounded border-white/10 bg-white/5 text-emerald-500 focus:ring-emerald-500/20"
                  checked={allSelected}
                  onChange={() => onSelectAll(trades.map(t => t.id))}
                />
              </th>
            )}
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Symbol</th>
            <th className="px-4 py-3">Side</th>
            <th className="px-4 py-3">Tags</th>
            <th className="px-4 py-3">Notes</th>
            <th className="px-4 py-3 text-right">Avg Entry</th>
            <th className="px-4 py-3 text-right">Avg Exit</th>
            <th className="px-4 py-3 text-right">Qty</th>
            <th className="px-4 py-3 text-right">Risk ($)</th>
            <th className="px-4 py-3 text-right">PnL</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {trades.map((trade) => (
            <tr 
              key={trade.id} 
              className={`hover:bg-white/5 transition-colors cursor-pointer group ${!readOnly && selectedIds.has(trade.id) ? 'bg-emerald-500/5' : ''}`}
              onClick={() => !readOnly && onToggleSelect(trade.id)}
            >
              {!readOnly && (
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <input 
                    type="checkbox" 
                    className="rounded border-white/10 bg-white/5 text-emerald-500 focus:ring-emerald-500/20"
                    checked={selectedIds.has(trade.id)}
                    onChange={() => onToggleSelect(trade.id)}
                  />
                </td>
              )}
              <td className="px-4 py-3 text-zinc-400 font-mono whitespace-nowrap">
                {format(new Date(trade.date), 'MMM dd, yyyy')}
              </td>
              <td className="px-4 py-3 font-medium">{trade.symbol}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  trade.direction === 'LONG' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
                }`}>
                  {trade.direction}
                </span>
              </td>
              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex flex-wrap gap-1 items-center max-w-[200px]">
                  {(trade.tags || []).map(tag => (
                    <span key={tag} className="flex items-center gap-1 px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[10px] text-zinc-400 group/tag">
                      {tag}
                      {!readOnly && (
                        <button 
                          onClick={() => onRemoveTag(trade.id, tag)}
                          className="opacity-0 group-hover/tag:opacity-100 hover:text-rose-500 transition-all"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </span>
                  ))}
                  
                  {!readOnly && (
                    <div className="relative">
                      {activeTagInput === trade.id ? (
                        <div className="absolute left-0 bottom-0 z-50 bg-[#18181b] border border-white/10 rounded-lg p-2 shadow-2xl min-w-[150px] max-h-[200px] overflow-y-auto">
                          <input
                            autoFocus
                            type="text"
                            placeholder="New tag..."
                            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-emerald-500/50"
                            value={newTagValue}
                            onChange={(e) => setNewTagValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                onAddTag(trade.id, newTagValue);
                                setNewTagValue('');
                                setActiveTagInput(null);
                              } else if (e.key === 'Escape') {
                                setActiveTagInput(null);
                              }
                            }}
                          />
                          {globalTags.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-white/5 space-y-1 max-h-[100px] overflow-y-auto">
                              {globalTags.filter(t => !(trade.tags || []).includes(t)).map(tag => (
                                <div key={tag} className="flex items-center justify-between group/global-tag">
                                  <button
                                    onClick={() => {
                                      onAddTag(trade.id, tag);
                                      setActiveTagInput(null);
                                    }}
                                    className="flex-1 text-left px-2 py-1 text-[10px] text-zinc-400 hover:bg-white/5 hover:text-white rounded transition-colors"
                                  >
                                    {tag}
                                  </button>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onDeleteGlobalTag?.(tag);
                                    }}
                                    className="p-1 opacity-0 group-hover/global-tag:opacity-100 hover:text-rose-500 transition-all"
                                    title="Delete Tag Globally"
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <button 
                          onClick={() => setActiveTagInput(trade.id)}
                          className="p-1 hover:bg-white/10 rounded text-zinc-500 hover:text-emerald-500 transition-colors"
                          title="Add Tag"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 max-w-[220px]" onClick={(e) => e.stopPropagation()}>
                {readOnly ? (
                  <span className="text-zinc-500 text-xs line-clamp-2">{trade.notes?.trim() || '-'}</span>
                ) : activeNotesInput === trade.id ? (
                  <div className="space-y-2">
                    <textarea
                      autoFocus
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      rows={3}
                      className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-emerald-500/50 resize-none"
                      placeholder="Add trade notes..."
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          onUpdateNotes?.(trade.id, notesDraft.trim());
                          setActiveNotesInput(null);
                          setNotesDraft('');
                        }}
                        className="text-[10px] uppercase font-bold text-emerald-500 hover:text-emerald-400"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setActiveNotesInput(null);
                          setNotesDraft('');
                        }}
                        className="text-[10px] uppercase font-bold text-zinc-500 hover:text-zinc-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setActiveNotesInput(trade.id);
                      setNotesDraft(trade.notes || '');
                    }}
                    className="text-xs text-left text-zinc-400 hover:text-white transition-colors"
                  >
                    {trade.notes?.trim() ? trade.notes : 'Add note'}
                  </button>
                )}
              </td>
              <td className="px-4 py-3 text-right font-mono">{formatCurrency(trade.avgEntryPrice)}</td>
              <td className="px-4 py-3 text-right font-mono">{formatCurrency(trade.avgExitPrice)}</td>
              <td className="px-4 py-3 text-right font-mono text-zinc-400">{trade.totalQuantity}</td>
              <td className="px-4 py-3 text-right font-mono text-zinc-500">
                {trade.initialRisk ? formatCurrency(trade.initialRisk) : '-'}
              </td>
              <td className={`px-4 py-3 text-right font-mono font-medium ${getPnLColor(trade.pnl)}`}>
                <div className="flex flex-col items-end">
                  <span>{formatCurrency(trade.pnl)}</span>
                  {trade.initialRisk && (
                    <span className="text-[10px] opacity-70">
                      {formatR(trade.pnl / trade.initialRisk)}
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {trades.length === 0 && (
            <tr>
              <td colSpan={readOnly ? 11 : 12} className="px-4 py-12 text-center text-zinc-500 italic">
                No trades found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      
      {(activeTagInput || activeNotesInput) && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => {
            setActiveTagInput(null);
            setNewTagValue('');
            setActiveNotesInput(null);
            setNotesDraft('');
          }} 
        />
      )}
    </div>
  );
}
