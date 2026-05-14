'use client';

import LinkifiedText from '@/components/ui/linkified-text';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { TemplateField } from '@/lib/validations/reviews';

interface TemplateFieldRendererProps {
  field: TemplateField;
  value: unknown;
  onChange?: (value: unknown) => void;
  readOnly?: boolean;
}

export default function TemplateFieldRenderer({
  field,
  value,
  onChange,
  readOnly = false,
}: TemplateFieldRendererProps) {
  if (field.type === 'auto') {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
        <p className="text-xs font-medium capitalize text-white">{field.label}</p>
        <p className="mt-1 text-sm font-medium text-zinc-200">
          {value != null ? String(value) : '—'}
        </p>
      </div>
    );
  }

  if (field.type === 'bool') {
    const checked = Boolean(value);
    return (
      <label
        className={`flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3 ${
          readOnly ? '' : 'cursor-pointer hover:bg-white/[0.07]'
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={readOnly}
          onChange={(event) => onChange?.(event.target.checked)}
          className="h-4 w-4 accent-emerald-500"
        />
        <span className="text-sm text-zinc-200">{field.label}</span>
      </label>
    );
  }

  if (field.type === 'text') {
    const stringValue = typeof value === 'string' ? value : '';

    // Read-only view (e.g. archived reviews) swaps the textarea for a div so
    // URLs in the saved text become clickable anchors. whitespace-pre-wrap
    // preserves the user's line breaks the same way a textarea would.
    if (readOnly) {
      return (
        <div className="space-y-1">
          <p className="text-xs font-medium capitalize text-white">{field.label}</p>
          <div className="whitespace-pre-wrap break-words rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200">
            {stringValue ? <LinkifiedText value={stringValue} /> : <span className="text-zinc-500">—</span>}
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-1">
        <p className="text-xs font-medium capitalize text-white">{field.label}</p>
        <Textarea
          value={stringValue}
          onChange={(event) => onChange?.(event.target.value)}
          rows={3}
          className="border-white/10 bg-white/5 text-sm"
        />
      </div>
    );
  }

  if (field.type === 'number') {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium capitalize text-white">{field.label}</p>
        <input
          type="number"
          value={typeof value === 'number' ? value : ''}
          readOnly={readOnly}
          disabled={readOnly}
          onChange={(event) => onChange?.(Number(event.target.value))}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500/50 focus:outline-none"
        />
      </div>
    );
  }

  if (field.type === 'enum' && Array.isArray(field.options)) {
    if (readOnly) {
      return (
        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
          <p className="text-xs font-medium capitalize text-white">{field.label}</p>
          <p className="mt-1 text-sm font-medium text-zinc-200">{typeof value === 'string' ? value : '—'}</p>
        </div>
      );
    }

    return (
      <div className="space-y-1">
        <p className="text-xs font-medium capitalize text-white">{field.label}</p>
        <Select value={typeof value === 'string' ? value : ''} onValueChange={(nextValue) => onChange?.(nextValue)}>
          <SelectTrigger className="border-white/10 bg-white/5 text-sm text-zinc-200">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent className="border-white/10 bg-[#18181b] text-white">
            {field.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return null;
}
