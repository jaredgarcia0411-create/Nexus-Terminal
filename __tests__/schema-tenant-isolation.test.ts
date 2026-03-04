import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { tradeTags, trades } from '@/lib/db/schema';

function columnNames(columns: Array<{ name: string }>) {
  return columns.map((column) => column.name);
}

describe('tenant-safe trade schema', () => {
  it('uses a composite primary key on trades (user_id, id)', () => {
    const config = getTableConfig(trades);
    expect(config.primaryKeys).toHaveLength(1);
    expect(columnNames(config.primaryKeys[0].columns as Array<{ name: string }>)).toEqual(['user_id', 'id']);
  });

  it('uses a user-scoped composite key and FK on trade_tags', () => {
    const config = getTableConfig(tradeTags);

    expect(config.primaryKeys).toHaveLength(1);
    expect(columnNames(config.primaryKeys[0].columns as Array<{ name: string }>)).toEqual(['user_id', 'trade_id', 'tag']);

    const tradeForeignKey = config.foreignKeys.find((fk) => fk.reference().columns.length === 2);
    expect(tradeForeignKey).toBeDefined();
    expect(columnNames(tradeForeignKey!.reference().columns as Array<{ name: string }>)).toEqual(['user_id', 'trade_id']);
    expect(columnNames(tradeForeignKey!.reference().foreignColumns as Array<{ name: string }>)).toEqual(['user_id', 'id']);
    expect(tradeForeignKey!.onDelete).toBe('cascade');
  });
});
