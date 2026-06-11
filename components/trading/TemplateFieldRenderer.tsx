'use client';

import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
      <div className="rounded-lg border border-border bg-accent p-3">
        <p className="text-xs font-medium capitalize text-foreground">{field.label}</p>
        <p className="mt-1 text-sm font-medium text-foreground">
          {value != null ? String(value) : '—'}
        </p>
      </div>
    );
  }

  if (field.type === 'bool') {
    const checked = Boolean(value);
    return (
      <label
        className={`flex items-center gap-3 rounded-lg border border-border bg-accent p-3 ${
          readOnly ? '' : 'cursor-pointer hover:bg-accent/80'
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={readOnly}
          onChange={(event) => onChange?.(event.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        <span className="text-sm text-foreground">{field.label}</span>
      </label>
    );
  }

  if (field.type === 'text') {
    const stringValue = typeof value === 'string' ? value : '';
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium capitalize text-foreground">{field.label}</p>
        <RichTextEditor
          value={stringValue}
          editable={!readOnly}
          onChange={(html) => onChange?.(html)}
        />
      </div>
    );
  }

  if (field.type === 'number') {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium capitalize text-foreground">{field.label}</p>
        <input
          type="number"
          value={typeof value === 'number' ? value : ''}
          readOnly={readOnly}
          disabled={readOnly}
          onChange={(event) => onChange?.(Number(event.target.value))}
          className="w-full rounded-lg border border-border bg-accent px-3 py-2 text-sm text-foreground focus:border-ring/50 focus:outline-none"
        />
      </div>
    );
  }

  if (field.type === 'enum' && Array.isArray(field.options)) {
    if (readOnly) {
      return (
        <div className="rounded-lg border border-border bg-accent p-3">
          <p className="text-xs font-medium capitalize text-foreground">{field.label}</p>
          <p className="mt-1 text-sm font-medium text-foreground">{typeof value === 'string' ? value : '—'}</p>
        </div>
      );
    }

    return (
      <div className="space-y-1">
        <p className="text-xs font-medium capitalize text-foreground">{field.label}</p>
        <Select value={typeof value === 'string' ? value : ''} onValueChange={(nextValue) => onChange?.(nextValue)}>
          <SelectTrigger className="border-border bg-accent text-sm text-foreground">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent className="border-border bg-card text-foreground">
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
