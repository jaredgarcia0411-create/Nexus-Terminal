'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DEFAULT_FIBONACCI_LEVELS } from './plugins/FibonacciPrimitive';

interface FibonacciSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  currentLevels: number[];
  onSave: (levels: number[]) => void;
}

export default function FibonacciSettings({
  isOpen,
  onClose,
  currentLevels,
  onSave,
}: FibonacciSettingsProps) {
  const [levels, setLevels] = useState<number[]>(currentLevels.length > 0 ? currentLevels : DEFAULT_FIBONACCI_LEVELS);
  const [newLevel, setNewLevel] = useState('');

  const handleAddLevel = () => {
    const value = parseFloat(newLevel);
    if (!Number.isNaN(value) && value >= 0 && value <= 1 && !levels.includes(value)) {
      setLevels([...levels, value].sort((a, b) => a - b));
      setNewLevel('');
    }
  };

  const handleRemoveLevel = (level: number) => {
    setLevels(levels.filter((l) => l !== level));
  };

  const handleReset = () => {
    setLevels(DEFAULT_FIBONACCI_LEVELS);
  };

  const handleSave = () => {
    onSave(levels);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="border-white/10 bg-[#111319] text-white sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Fibonacci Levels</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current levels */}
          <div className="space-y-2">
            <label className="text-xs text-zinc-400">Active Levels</label>
            <div className="flex flex-wrap gap-2">
              {levels.map((level) => (
                <div
                  key={level}
                  className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-xs"
                >
                  <span>{(level * 100).toFixed(level % 1 === 0 ? 0 : 1)}%</span>
                  <button
                    onClick={() => handleRemoveLevel(level)}
                    className="ml-1 text-zinc-400 hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Add new level */}
          <div className="space-y-2">
            <label className="text-xs text-zinc-400">Add Level (0.00 - 1.00)</label>
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={newLevel}
                onChange={(e) => setNewLevel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddLevel();
                }}
                placeholder="0.618"
                className="h-8 border-white/10 bg-white/5 text-xs"
              />
              <Button
                onClick={handleAddLevel}
                size="sm"
                className="h-8 bg-emerald-500 px-3 text-xs text-black hover:bg-emerald-400"
              >
                Add
              </Button>
            </div>
            <p className="text-[10px] text-zinc-500">
              Enter a value between 0 and 1 (e.g., 0.5 for 50%)
            </p>
          </div>

          {/* Presets */}
          <div className="space-y-2">
            <label className="text-xs text-zinc-400">Presets</label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="h-7 border-white/10 bg-transparent text-xs hover:bg-white/5"
              >
                Reset to Default
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="border-white/10 bg-transparent text-xs hover:bg-white/5"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            size="sm"
            className="bg-emerald-500 text-xs text-black hover:bg-emerald-400"
          >
            Save Levels
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
