'use client';

import { Fragment } from 'react';

// Matches three URL shapes:
//   1. Full protocol — https://example.com/path
//   2. www-prefixed — www.example.com/path
//   3. Bare domain w/ path — news.google.com/read/abc
// The bare-domain branch *requires* a "/path" so prose like "e.g." or
// "Mr.Smith" doesn't accidentally linkify. TLD-ish segments must start with
// a letter (rules out IP-style 1.2.3.4 and "version 2.0"). Stops at
// whitespace and bracketing chars so trailing punctuation stays in the prose.
const URL_REGEX = /((?:https?:\/\/|www\.)[^\s<>"'()]+|\b[a-z0-9][\w-]*(?:\.[a-z][\w-]+)+\/[^\s<>"'()]*)/gi;
// Strip sentence punctuation that almost always belongs to the surrounding
// prose, not the URL itself (e.g. "see https://foo.com." → link is foo.com).
const TRAILING_PUNCT = /[.,;:!?]+$/;

interface LinkifiedTextProps {
  value: string;
  className?: string;
}

export default function LinkifiedText({ value, className }: LinkifiedTextProps) {
  if (!value) return null;

  const segments: Array<{ text: string; href?: string }> = [];
  let cursor = 0;

  for (const match of value.matchAll(URL_REGEX)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({ text: value.slice(cursor, start) });
    }

    let url = match[0];
    let trailing = '';
    const trailingMatch = url.match(TRAILING_PUNCT);
    if (trailingMatch) {
      trailing = trailingMatch[0];
      url = url.slice(0, url.length - trailing.length);
    }

    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    segments.push({ text: url, href });
    if (trailing) segments.push({ text: trailing });

    cursor = start + match[0].length;
  }

  if (cursor < value.length) {
    segments.push({ text: value.slice(cursor) });
  }

  return (
    <span className={className}>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {segment.href ? (
            <a
              href={segment.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 underline decoration-emerald-400/40 underline-offset-2 hover:text-emerald-300 hover:decoration-emerald-300"
            >
              {segment.text}
            </a>
          ) : (
            segment.text
          )}
        </Fragment>
      ))}
    </span>
  );
}
