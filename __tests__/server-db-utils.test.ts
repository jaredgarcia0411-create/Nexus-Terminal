import { describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth-config', () => ({
  auth: authMock,
}));

import { users } from '@/lib/db/schema';
import { ensureUser } from '@/lib/server-db-utils';

type DbRow = { id: string; email: string; name: string | null; picture: string | null };

function createErrorWithCode(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function createDb({
  selectRows = [[]],
  insertError,
}: {
  selectRows?: DbRow[][];
  insertError?: Error;
}) {
  const whereSelect = vi.fn(async () => selectRows.shift() ?? []);
  const selectFrom = vi.fn(() => ({
    where: whereSelect,
  }));
  const select = vi.fn(() => ({
    from: selectFrom,
  }));

  const state = {
    lastUpdatedUser: null as Partial<DbRow> | null,
    lastInsertedUser: null as DbRow | null,
    lastConflictUpdateArgs: null as { target: unknown; set: Partial<DbRow> } | null,
  };

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn((value: Partial<DbRow>) => {
    state.lastUpdatedUser = value;
    return {
      where: updateWhere,
    };
  });
  const update = vi.fn(() => ({
    set: updateSet,
  }));

  const conflictUpdate = vi.fn(async (value: { target: unknown; set: Partial<DbRow> }) => {
    state.lastConflictUpdateArgs = value;
    if (insertError) {
      throw insertError;
    }
    return undefined;
  });
  const insertValues = vi.fn((value: DbRow) => {
    state.lastInsertedUser = value;
    return {
      onConflictDoUpdate: conflictUpdate,
    };
  });
  const insert = vi.fn(() => ({
    values: insertValues,
  }));

  return {
    select,
    update,
    insert,
    _state: state,
    _mocks: {
      whereSelect,
      updateWhere,
    },
  } as unknown as {
    select: typeof select;
    update: typeof update;
    insert: typeof insert;
    _state: typeof state;
    _mocks: {
      whereSelect: typeof whereSelect;
      updateWhere: typeof updateWhere;
    };
  };
}

describe('ensureUser', () => {
  it('updates an existing user by id when metadata changes', async () => {
    const db = createDb({
      selectRows: [[
        {
          id: 'user-1',
          email: 'user@example.com',
          name: 'Old Name',
          picture: 'old-pic.png',
        },
      ]],
    });

    const authUser = { id: 'user-1', email: 'user@example.com', name: 'New Name', picture: 'new-pic.png' };

    const ensured = await ensureUser(db as any, authUser);

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db._state.lastUpdatedUser).toEqual({
      name: authUser.name,
      picture: authUser.picture,
    });
    expect(authUser.id).toBe('user-1');
    expect(ensured).toEqual({
      id: 'user-1',
      email: authUser.email,
      name: authUser.name,
      picture: authUser.picture,
    });
  });

  it('inserts a user when no match exists', async () => {
    const db = createDb({ selectRows: [[]] });

    const authUser = { id: 'user-1', email: 'user@example.com', name: 'Name', picture: null };

    const ensured = await ensureUser(db as any, authUser);

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db._state.lastInsertedUser).toEqual({
      id: authUser.id,
      email: authUser.email,
      name: authUser.name,
      picture: authUser.picture,
    });
    expect(db._state.lastConflictUpdateArgs).toEqual({
      target: users.id,
      set: {
        name: authUser.name,
        picture: authUser.picture,
      },
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(ensured).toEqual(authUser);
  });

  it('falls back to canonical row if insert races on unique email', async () => {
    const db = createDb({
      selectRows: [
        [],
        [
          {
            id: 'canonical-user',
            email: 'race@example.com',
            name: 'Canonical',
            picture: 'canonical.png',
          },
        ],
      ],
      insertError: createErrorWithCode('23505', 'duplicate key value violates unique constraint users_email_unique'),
    });

    const authUser = {
      id: 'nextauth-id',
      email: 'race@example.com',
      name: 'Canonical',
      picture: 'canonical.png',
    };

    const ensured = await ensureUser(db as any, authUser);

    expect(db.select).toHaveBeenCalledTimes(2);
    expect(db.insert).toHaveBeenCalledTimes(1);
    // Session ID was remapped to canonical DB ID (no PK update)
    expect(db.update).not.toHaveBeenCalled();
    expect(authUser.id).toBe('canonical-user');
    expect(ensured.id).toBe('canonical-user');
  });

  it('reuses matching email row and remaps session id to canonical', async () => {
    const db = createDb({
      selectRows: [
        [
          {
            id: 'canonical-user',
            email: 'user@example.com',
            name: 'Stored Name',
            picture: 'stored.png',
          },
        ],
      ],
    });

    const authUser = { id: 'nextauth-id', email: 'user@example.com', name: 'Stored Name', picture: 'stored.png' };

    const ensured = await ensureUser(db as any, authUser);

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
    // No update needed — name and picture haven't changed
    expect(db.update).not.toHaveBeenCalled();
    // Session ID was remapped to canonical DB ID
    expect(authUser.id).toBe('canonical-user');
    expect(ensured.id).toBe('canonical-user');
  });
});
