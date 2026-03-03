'use client';

import { ChevronDown, File, Folder, Upload } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface ImportDropdownProps {
  onImportFiles: () => void;
  onImportFolder: () => void;
}

export default function ImportDropdown({ onImportFiles, onImportFolder }: ImportDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10">
          <Upload className="h-4 w-4" />
          Import
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 border-white/10 bg-[#121214] text-white">
        <DropdownMenuItem onClick={onImportFiles} className="cursor-pointer gap-2">
          <File className="h-4 w-4" />
          Import Files
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImportFolder} className="cursor-pointer gap-2">
          <Folder className="h-4 w-4" />
          Import Folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
