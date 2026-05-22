'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { formatDate } from '@/lib/askedgar-utils';
import type { ResearchSnapshotNewsItem } from '@/lib/types';

import { NoDataBadge } from './_shared';

interface Props {
  news: ResearchSnapshotNewsItem[];
}

function NewsArticle({
  item,
  open,
  onToggle,
}: {
  item: ResearchSnapshotNewsItem;
  open: boolean;
  onToggle: () => void;
}) {
  const formType = item.formType ?? 'News';
  const normalizedFormType = formType.toLowerCase();
  const sourceLabel = normalizedFormType.includes('grok')
    ? 'Groq'
    : normalizedFormType.includes('jmt415') || normalizedFormType.includes('jmt-415')
      ? 'JMT415'
      : 'News';

  return (
    <div className="p-2">
      <button
        type="button"
        onClick={onToggle}
        className="w-full cursor-pointer text-left text-sm font-bold text-foreground"
      >
        {item.title}
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="mt-2 space-y-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{sourceLabel}</span>
              <span className="text-muted-foreground">{formatDate(item.filedAt)}</span>
            </div>
            <p className="rounded border border-border bg-black p-2 text-sm text-muted-foreground">{item.summary || '--'}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function NewsSection({ news }: Props) {
  const [openNewsIndex, setOpenNewsIndex] = useState<number | null>(null);

  return (
    <div className="divide-y divide-border p-3">
      {news.map((item, index) => (
        <NewsArticle
          key={`news-filing-${index}`}
          item={item}
          open={openNewsIndex === index}
          onToggle={() => setOpenNewsIndex((prev) => (prev === index ? null : index))}
        />
      ))}
      {news.length === 0 ? <NoDataBadge /> : null}
    </div>
  );
}
