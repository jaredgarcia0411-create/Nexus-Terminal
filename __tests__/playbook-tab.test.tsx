// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import type React from 'react';

import PlaybookTab from '@/components/trading/PlaybookTab';
import type { Trade } from '@/lib/types';
import type { PlaybookSections } from '@/lib/validations/playbook';

const { toastMock } = vi.hoisted(() => ({
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: toastMock }));

vi.mock('motion/react', () => ({
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      ...props
    }: React.ComponentProps<'div'> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
    }) => <div {...props}>{children}</div>,
  },
}));

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  const SelectContext = React.createContext<(value: string) => void>(() => undefined);

  return {
    Select: ({
      children,
      onValueChange,
    }: {
      children: React.ReactNode;
      value?: string;
      onValueChange?: (value: string) => void;
    }) => (
      <SelectContext.Provider value={onValueChange ?? (() => undefined)}>
        <div>{children}</div>
      </SelectContext.Provider>
    ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => {
      const onValueChange = React.useContext(SelectContext);
      return <button type="button" onClick={() => onValueChange(value)}>{children}</button>;
    },
  };
});

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (html: string) => void;
  }) => (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

interface Strategy {
  id: string;
  name: string;
  description: string;
  tag: string;
  sections: PlaybookSections;
  createdAt: string;
  updatedAt: string;
}

const baseStrategies: Strategy[] = [
  {
    id: 'strategy-1',
    name: 'Opening Range Breakout',
    description: 'Trade first pullback after range break',
    tag: 'Momentum',
    sections: {
      overview: 'Only A+ range breaks',
      checklist: '',
      entry: 'Enter pullback',
      invalidation: '',
      risk: '',
      targets: '',
      notes: '',
    },
    createdAt: '2026-05-31T12:00:00.000Z',
    updatedAt: '2026-05-31T12:00:00.000Z',
  },
  {
    id: 'strategy-2',
    name: 'VWAP Reclaim',
    description: 'Reclaim and hold VWAP',
    tag: 'VWAP',
    sections: {
      overview: 'Reclaim setup',
      checklist: '',
      entry: '',
      invalidation: '',
      risk: '',
      targets: '',
      notes: '',
    },
    createdAt: '2026-05-31T12:05:00.000Z',
    updatedAt: '2026-05-31T12:05:00.000Z',
  },
];

const templateFields = [
  { id: 'overview', label: 'Overview', type: 'text' as const, required: false },
  { id: 'entry', label: 'Entry Criteria', type: 'text' as const, required: false },
];

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'trade-1',
    date: new Date('2026-05-31T00:00:00'),
    sortKey: '2026-05-31',
    symbol: 'AAPL',
    direction: 'LONG',
    avgEntryPrice: 10,
    avgExitPrice: 12,
    totalQuantity: 100,
    grossPnl: 200,
    netPnl: 190,
    entryTime: '09:30',
    exitTime: '10:00',
    executionCount: 2,
    rawExecutions: [],
    pnl: 190,
    executions: 2,
    initialRisk: 100,
    tags: ['Momentum'],
    ...overrides,
  };
}

function installFetch(overrides: {
  createStrategy?: Strategy;
  updateStrategy?: Strategy;
  templateFields?: typeof templateFields;
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();

    if (url === '/api/playbook' && !init) {
      return jsonResponse({ strategies: baseStrategies });
    }

    if (url === '/api/report-templates?type=playbook') {
      return jsonResponse({ template: { id: 'template-1', fields: templateFields } });
    }

    if (url === '/api/playbook' && init?.method === 'POST') {
      return jsonResponse({ strategy: overrides.createStrategy ?? {
        id: 'strategy-new',
        name: 'New Strategy',
        description: '',
        tag: '',
        sections: { overview: '', entry: '' },
        createdAt: '2026-05-31T13:00:00.000Z',
        updatedAt: '2026-05-31T13:00:00.000Z',
      } });
    }

    if (url.startsWith('/api/playbook?id=') && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as Partial<Strategy>;
      return jsonResponse({ strategy: overrides.updateStrategy ?? {
        ...baseStrategies[0],
        ...body,
        id: 'strategy-1',
        updatedAt: '2026-05-31T14:00:00.000Z',
      } });
    }

    if (url.startsWith('/api/playbook?id=') && init?.method === 'DELETE') {
      return jsonResponse({ success: true, id: decodeURIComponent(url.split('id=')[1] ?? '') });
    }

    if (url === '/api/report-templates' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { fields: typeof templateFields };
      return jsonResponse({ template: { id: 'template-1', fields: overrides.templateFields ?? body.fields } });
    }

    return jsonResponse({ error: 'unexpected fetch' }, { status: 500 });
  }) as MockedFunction<typeof fetch>;

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderLoaded() {
  render(<PlaybookTab trades={[makeTrade(), makeTrade({ id: 'trade-2', tags: ['VWAP'], symbol: 'MSFT', netPnl: -50, pnl: -50 })]} globalTags={['Momentum', 'VWAP', 'Gap']} />);
  await waitFor(() => {
    expect(screen.getByDisplayValue('Opening Range Breakout')).toBeTruthy();
  });
}

describe('PlaybookTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('loads existing strategies and selects the first one', async () => {
    const fetchMock = installFetch();

    await renderLoaded();

    expect(screen.getByText('Strategies')).toBeTruthy();
    expect(screen.getByDisplayValue('Opening Range Breakout')).toBeTruthy();
    expect(screen.getByDisplayValue('Trade first pullback after range break')).toBeTruthy();
    expect(screen.getByText('tag: Momentum')).toBeTruthy();
    expect(screen.getByText('AAPL')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/playbook');
    expect(fetchMock).toHaveBeenCalledWith('/api/report-templates?type=playbook');
  });

  it('creates a new strategy and selects it', async () => {
    const fetchMock = installFetch();
    await renderLoaded();

    fireEvent.click(screen.getByText('New Strategy'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('New Strategy')).toBeTruthy();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/playbook', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        name: 'New Strategy',
        description: '',
        tag: '',
        sections: { overview: '', entry: '' },
      }),
    }));
    expect(toastMock.success).toHaveBeenCalledWith('Strategy created');
  });

  it('edits strategy fields and saves the selected strategy', async () => {
    const fetchMock = installFetch();
    await renderLoaded();

    fireEvent.change(screen.getByDisplayValue('Opening Range Breakout'), { target: { value: 'Gap Continuation' } });
    fireEvent.change(screen.getByDisplayValue('Trade first pullback after range break'), { target: { value: 'Wait for first pullback' } });
    fireEvent.click(screen.getByText('Gap'));
    fireEvent.change(screen.getByDisplayValue('Only A+ range breaks'), { target: { value: 'Must hold premarket high' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/playbook?id=strategy-1', expect.objectContaining({ method: 'PATCH' }));
    });

    const patchCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/playbook?id=strategy-1' && init?.method === 'PATCH');
    expect(patchCall).toBeTruthy();
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual(expect.objectContaining({
      name: 'Gap Continuation',
      description: 'Wait for first pullback',
      tag: 'Gap',
      sections: expect.objectContaining({ overview: 'Must hold premarket high' }),
    }));
    expect(toastMock.success).toHaveBeenCalledWith('Saved');
  });

  it('deletes the selected strategy and selects the next one', async () => {
    const fetchMock = installFetch();
    vi.stubGlobal('confirm', vi.fn(() => true));
    await renderLoaded();

    fireEvent.click(screen.getByLabelText('Delete strategy'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/playbook?id=strategy-1', { method: 'DELETE' });
    });

    expect(screen.queryByDisplayValue('Opening Range Breakout')).toBeNull();
    expect(screen.getByDisplayValue('VWAP Reclaim')).toBeTruthy();
    expect(toastMock.success).toHaveBeenCalledWith('Deleted');
  });

  it('adds a template section and saves the playbook template', async () => {
    const fetchMock = installFetch();
    await renderLoaded();

    fireEvent.click(screen.getByText('Edit Template'));
    fireEvent.click(screen.getByText('Add Section'));
    fireEvent.change(screen.getByDisplayValue('New Section'), { target: { value: 'Execution Review' } });
    fireEvent.click(screen.getByText('Save Template'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/report-templates', expect.objectContaining({ method: 'PUT' }));
    });

    const putCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/report-templates' && init?.method === 'PUT');
    expect(putCall).toBeTruthy();
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual(expect.objectContaining({
      type: 'playbook',
      fields: expect.arrayContaining([
        expect.objectContaining({ id: 'section3', label: 'Execution Review', type: 'text' }),
      ]),
    }));
    expect(toastMock.success).toHaveBeenCalledWith('Template saved');
  });
});
