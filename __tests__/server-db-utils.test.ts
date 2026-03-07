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

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn(() => ({
    where: updateWhere,
  }));
  const update = vi.fn(() => ({
    set: updateSet,
  }));

  const conflictUpdate = vi.fn(async () => {
    if (insertError) {
      throw insertError;
    }
    return undefined;
  });
  const insertValues = vi.fn(() => ({
    onConflictDoUpdate: conflictUpdate,
  }));
  const insert = vi.fn(() => ({
    values: insertValues,
  }));

  return {
    select,
    update,
    insert,
    _mocks: {
      whereSelect,
      updateSet,
      updateWhere,
      insertValues,
      conflictUpdate,
    },
  } as unknown as {
    select: typeof select;
    update: typeof update;
    insert: typeof insert;
    _mocks: {
      whereSelect: typeof whereSelect;
      updateSet: typeof updateSet;
      updateWhere: typeof updateWhere;
      insertValues: typeof insertValues;
      conflictUpdate: typeof conflictUpdate;
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

    await ensureUser(db as any, authUser);

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db._mocks.updateSet).toHaveBeenCalledWith({
      name: authUser.name,
      picture: authUser.picture,
    });
    expect(authUser.id).toBe('user-1');
  });

  it('inserts a user when no match exists', async () => {
    const db = createDb({ selectRows: [[]] });

    const authUser = { id: 'user-1', email: 'user@example.com', name: 'Name', picture: null };

    await ensureUser(db as any, authUser);

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db._mocks.insertValues).toHaveBeenCalledWith({
      id: authUser.id,
      email: authUser.email,
      name: authUser.name,
      picture: authUser.picture,
    });
    expect(db._mocks.conflictUpdate).toHaveBeenCalledWith({
      target: users.id,
      set: {
        name: authUser.name,
        picture: authUser.picture,
      },
    });
    expect(db.update).not.toHaveBeenCalled();
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

    await ensureUser(db as any, authUser);

    expect(db.select).toHaveBeenCalledTimes(2);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(authUser.id).toBe('canonical-user');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('reuses matching email row and updates auth user id', async () => {
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

    await ensureUser(db as any, authUser);

    expect(authUser.id).toBe('canonical-user');
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
});
