import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { jarvisKnowledgeChunks } from '@/lib/db/schema';

function names(rows: Array<{ name: string }>) {
  return rows.map((row) => row.name);
}

describe('jarvis knowledge chunk schema', () => {
  it('defines expected unique key for source hash dedupe', () => {
    const config = getTableConfig(jarvisKnowledgeChunks);
    const uniqueConstraint = config.uniqueConstraints.find((constraint) => constraint.name === 'uq_jarvis_knowledge_chunks_source_hash');
    expect(uniqueConstraint).toBeDefined();
    expect(names(uniqueConstraint!.columns as Array<{ name: string }>)).toEqual(['source_type', 'source_host', 'hash']);
  });

  it('contains required metadata columns for retrieval and memory controls', () => {
    const config = getTableConfig(jarvisKnowledgeChunks);
    const columns = names(config.columns as Array<{ name: string }>);

    expect(columns).toEqual(expect.arrayContaining([
      'user_id',
      'source_url',
      'source_host',
      'source_title',
      'source_type',
      'text',
      'hash',
      'source_tags',
      'text_search',
      'embedding',
      'seen_count',
      'last_seen_at',
    ]));
  });
});
