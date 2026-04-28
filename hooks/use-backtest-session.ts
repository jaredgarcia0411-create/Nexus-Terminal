'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { reduceActions, type SimPosition } from '@/lib/backtest-math';
import type { BacktestAction, BacktestActionType, BacktestSession } from '@/lib/types';

type SessionsResponse = {
  session?: BacktestSession | null;
  reviews?: BacktestSession[];
  error?: string;
};

type SessionDetailResponse = {
  session?: BacktestSession;
  actions?: BacktestAction[];
  error?: string;
};

type SessionMutationResponse = {
  session?: BacktestSession;
  error?: string;
};

type ActionMutationResponse = {
  action?: BacktestAction;
  error?: string;
};

export type PlaceBacktestActionInput = {
  actionType: BacktestActionType;
  price: number;
  shares: number;
  stopPrice: number | null;
  barTime: string;
};

type ReviewModeState = {
  session: BacktestSession;
  actions: BacktestAction[];
};

interface UseBacktestSessionInput {
  ticker: string | null;
  date: string | null;
  riskDollars: number;
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T;
}

export function useBacktestSession({ ticker, date, riskDollars }: UseBacktestSessionInput) {
  const [activeSession, setActiveSession] = useState<BacktestSession | null>(null);
  const [activeActions, setActiveActions] = useState<BacktestAction[]>([]);
  const [reviews, setReviews] = useState<BacktestSession[]>([]);
  const [reviewMode, setReviewMode] = useState<ReviewModeState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const session = reviewMode?.session ?? activeSession;
  const actions = reviewMode?.actions ?? activeActions;
  const isReadOnly = reviewMode != null;
  const effectiveRiskDollars = session?.riskDollars ?? riskDollars;
  const position = useMemo<SimPosition>(
    () => reduceActions(actions, effectiveRiskDollars),
    [actions, effectiveRiskDollars],
  );

  const loadSessionDetails = useCallback(async (sessionId: string, signal?: AbortSignal) => {
    const response = await fetch(`/api/backtest/sessions/${sessionId}`, { signal });
    const payload = await parseJson<SessionDetailResponse>(response);
    if (!response.ok || !payload.session) {
      throw new Error(payload.error ?? 'Could not load backtest session');
    }
    return payload;
  }, []);

  useEffect(() => {
    if (!ticker || !date) {
      setActiveSession(null);
      setActiveActions([]);
      setReviews([]);
      setReviewMode(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setError(null);
      setReviewMode(null);

      try {
        const params = new URLSearchParams({ ticker, date });
        const response = await fetch(`/api/backtest/sessions?${params.toString()}`, { signal: controller.signal });
        const payload = await parseJson<SessionsResponse>(response);
        if (!response.ok) {
          throw new Error(payload.error ?? 'Could not load backtest sessions');
        }

        setReviews(payload.reviews ?? []);

        if (payload.session) {
          const details = await loadSessionDetails(payload.session.id, controller.signal);
          setActiveSession(details.session ?? payload.session);
          setActiveActions(details.actions ?? []);
        } else {
          setActiveSession(null);
          setActiveActions([]);
        }
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setActiveSession(null);
        setActiveActions([]);
        setReviews([]);
        setError(toErrorMessage(loadError, 'Could not load backtest sessions'));
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => controller.abort();
  }, [date, loadSessionDetails, ticker]);

  const ensureActiveSession = useCallback(async (nextRiskDollars = riskDollars) => {
    if (!ticker || !date) {
      throw new Error('Pick a ticker and date first');
    }
    if (activeSession) return activeSession;

    const response = await fetch('/api/backtest/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, date, riskDollars: nextRiskDollars }),
    });
    const payload = await parseJson<SessionMutationResponse>(response);
    if (!response.ok || !payload.session) {
      throw new Error(payload.error ?? 'Could not create backtest session');
    }

    setActiveSession(payload.session);
    return payload.session;
  }, [activeSession, date, riskDollars, ticker]);

  const placeAction = useCallback(async (input: PlaceBacktestActionInput) => {
    if (reviewMode) {
      throw new Error('Viewing a saved review');
    }

    setIsMutating(true);
    setError(null);

    const currentActions = [...activeActions];

    try {
      const ensuredSession = await ensureActiveSession(activeSession?.riskDollars ?? riskDollars);
      const optimisticAction: BacktestAction = {
        id: `optimistic-${crypto.randomUUID()}`,
        userId: activeSession?.userId ?? session?.userId ?? 'local',
        sessionId: ensuredSession.id,
        actionType: input.actionType,
        price: input.price,
        shares: input.shares,
        stopPrice: input.stopPrice,
        barTime: input.barTime,
        sequence: currentActions.at(-1)?.sequence ? currentActions.at(-1)!.sequence + 1 : 1,
        createdAt: new Date().toISOString(),
      };

      setActiveActions((prev) => [...prev, optimisticAction]);

      const response = await fetch('/api/backtest/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: ensuredSession.id,
          actionType: input.actionType,
          price: input.price,
          shares: input.shares,
          stopPrice: input.stopPrice,
          barTime: input.barTime,
        }),
      });
      const payload = await parseJson<ActionMutationResponse>(response);
      if (!response.ok || !payload.action) {
        throw new Error(payload.error ?? 'Could not place action');
      }

      setActiveActions((prev) => prev.map((action) => (
        action.id === optimisticAction.id ? payload.action as BacktestAction : action
      )));
    } catch (mutationError) {
      setActiveActions(currentActions);
      const message = toErrorMessage(mutationError, 'Could not place action');
      setError(message);
      throw new Error(message);
    } finally {
      setIsMutating(false);
    }
  }, [activeActions, activeSession?.riskDollars, ensureActiveSession, reviewMode, riskDollars, session?.userId, activeSession?.userId]);

  const undoLast = useCallback(async () => {
    if (reviewMode || activeActions.length === 0) return;

    const previousActions = [...activeActions];
    const lastAction = previousActions.at(-1);
    if (!lastAction) return;

    setIsMutating(true);
    setError(null);
    setActiveActions(previousActions.slice(0, -1));

    try {
      const response = await fetch(`/api/backtest/actions/${lastAction.id}`, { method: 'DELETE' });
      const payload = await parseJson<{ error?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.error ?? 'Could not undo last action');
      }
    } catch (mutationError) {
      setActiveActions(previousActions);
      const message = toErrorMessage(mutationError, 'Could not undo last action');
      setError(message);
      throw new Error(message);
    } finally {
      setIsMutating(false);
    }
  }, [activeActions, reviewMode]);

  const clear = useCallback(async () => {
    if (reviewMode || !activeSession) return;

    const previousActions = [...activeActions];
    setIsMutating(true);
    setError(null);
    setActiveActions([]);

    try {
      const response = await fetch(`/api/backtest/sessions/${activeSession.id}/clear`, { method: 'POST' });
      const payload = await parseJson<{ error?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.error ?? 'Could not clear backtest actions');
      }
    } catch (mutationError) {
      setActiveActions(previousActions);
      const message = toErrorMessage(mutationError, 'Could not clear backtest actions');
      setError(message);
      throw new Error(message);
    } finally {
      setIsMutating(false);
    }
  }, [activeActions, activeSession, reviewMode]);

  const updateRisk = useCallback(async (nextRiskDollars: number) => {
    if (!Number.isFinite(nextRiskDollars) || nextRiskDollars <= 0 || reviewMode) return;
    if (!activeSession) return;

    const previousSession = activeSession;
    setIsMutating(true);
    setError(null);
    setActiveSession({ ...activeSession, riskDollars: nextRiskDollars });

    try {
      const response = await fetch(`/api/backtest/sessions/${activeSession.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riskDollars: nextRiskDollars }),
      });
      const payload = await parseJson<SessionMutationResponse>(response);
      if (!response.ok || !payload.session) {
        throw new Error(payload.error ?? 'Could not update risk');
      }
      setActiveSession(payload.session);
    } catch (mutationError) {
      setActiveSession(previousSession);
      const message = toErrorMessage(mutationError, 'Could not update risk');
      setError(message);
      throw new Error(message);
    } finally {
      setIsMutating(false);
    }
  }, [activeSession, reviewMode]);

  const saveReview = useCallback(async (label?: string, notes?: string) => {
    if (!activeSession || activeActions.length === 0 || reviewMode) return;

    const previousSession = activeSession;
    const previousActions = [...activeActions];
    const previousReviews = [...reviews];

    setIsMutating(true);
    setError(null);
    setActiveSession(null);
    setActiveActions([]);

    try {
      const response = await fetch(`/api/backtest/sessions/${activeSession.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSession.id, label, notes }),
      });
      const payload = await parseJson<SessionMutationResponse>(response);
      if (!response.ok || !payload.session) {
        throw new Error(payload.error ?? 'Could not save review');
      }
      setReviews([payload.session, ...previousReviews]);
    } catch (mutationError) {
      setActiveSession(previousSession);
      setActiveActions(previousActions);
      setReviews(previousReviews);
      const message = toErrorMessage(mutationError, 'Could not save review');
      setError(message);
      throw new Error(message);
    } finally {
      setIsMutating(false);
    }
  }, [activeActions, activeSession, reviewMode, reviews]);

  const loadReview = useCallback(async (reviewId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const details = await loadSessionDetails(reviewId);
      setReviewMode({
        session: details.session as BacktestSession,
        actions: details.actions ?? [],
      });
    } catch (loadError) {
      const message = toErrorMessage(loadError, 'Could not load review');
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, [loadSessionDetails]);

  const startNewSession = useCallback(() => {
    setReviewMode(null);
    setError(null);
  }, []);

  return {
    session,
    actions,
    position,
    reviews,
    isLoading,
    isMutating,
    isReadOnly,
    error,
    effectiveRiskDollars,
    placeAction,
    undoLast,
    clear,
    updateRisk,
    saveReview,
    loadReview,
    startNewSession,
  };
}
