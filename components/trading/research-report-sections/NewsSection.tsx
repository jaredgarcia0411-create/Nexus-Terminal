'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ExternalLink } from 'lucide-react';

import { formatDateTimeLong, formatRelativeTime } from '@/lib/askedgar-utils';
import type { ResearchSnapshotNewsItem } from '@/lib/types';

import { NoDataBadge } from './_shared';

interface Props {
  news: ResearchSnapshotNewsItem[];
  ticker: string;
}

function formatListTimestamp(value: string | null): string {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function ArticleReader({
  item,
  ticker,
  onBack,
}: {
  item: ResearchSnapshotNewsItem;
  ticker: string;
  onBack: () => void;
}) {
  const paragraphs = item.summary
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <div className="space-y-4 p-3">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="rounded-sm bg-accent px-2 py-0.5 text-xs font-bold text-foreground">
          ${ticker.toUpperCase()}
        </span>
        <span>{formatDateTimeLong(item.filedAt)}</span>
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary transition-colors hover:text-primary/80"
          >
            Open original
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>

      <h2 className="text-2xl font-semibold tracking-tight text-foreground">{item.title}</h2>

      {paragraphs.length > 0 ? (
        <div className="space-y-4">
          {paragraphs.map((paragraph, index) => (
            <p key={index} className="text-sm leading-relaxed text-foreground">
              {paragraph}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">--</p>
      )}
    </div>
  );
}

export default function NewsSection({ news, ticker }: Props) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = selectedIndex !== null ? news[selectedIndex] : null;

  return (
    <AnimatePresence mode="wait">
      {selected ? (
        <motion.div
          key="reader"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <ArticleReader item={selected} ticker={ticker} onBack={() => setSelectedIndex(null)} />
        </motion.div>
      ) : (
        <motion.div
          key="list"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="space-y-2 p-3"
        >
          {news.map((item, index) => (
            <button
              key={`news-${index}`}
              type="button"
              onClick={() => setSelectedIndex(index)}
              className="block w-full cursor-pointer rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
            >
              <div className="text-xs text-muted-foreground">
                {formatRelativeTime(item.filedAt)} · {formatListTimestamp(item.filedAt)}
              </div>
              <div className="mt-1 text-sm font-semibold text-foreground">{item.title}</div>
            </button>
          ))}
          {news.length === 0 ? <NoDataBadge /> : null}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
