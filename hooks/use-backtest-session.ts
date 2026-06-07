'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';

import { reduceActions, type SimPosition } from '@/lib/backtest-math';
import type { BacktestAction, BacktestActionType, BacktestChartState, BacktestSession } from '@/lib/types';

type SessionsResponse = {
  currentUserId?: string | null;
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
  backtestId: string | null;
  sheetRowId?: string | null;
  autoLoadReviewId?: string | null;
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T;
}

export function useBacktestSession({
  ticker,
  date,
  riskDollars,
  backtestId,
  sheetRowId = null,
  autoLoadReviewId = null,
}: UseBacktestSessionInput) {
  const { data: sessionData } = useSession();
  const clientUserId = (sessionData?.user as { id?: string | null } | undefined)?.id ?? null;
  const [serverUserId, setServerUserId] = useState<string | null>(null);
  const currentUserId = serverUserId ?? clientUserId;
  const [activeSession, setActiveSession] = useState<BacktestSession | null>(null);
  const [activeActions, setActiveActions] = useState<BacktestAction[]>([]);
  const [reviews, setReviews] = useState<BacktestSession[]>([]);
  const [reviewMode, setReviewMode] = useState<ReviewModeState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCurrentReviewMode = reviewMode != null
    && reviewMode.session.ticker === ticker
    && reviewMode.session.date === date;
  const session = isCurrentReviewMode ? reviewMode.session : activeSession;
  const actions = isCurrentReviewMode ? reviewMode.actions : activeActions;
  const isReadOnly = isCurrentReviewMode;
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
        if (backtestId) params.set('backtestId', backtestId);
        if (sheetRowId) params.set('sheetRowId', sheetRowId);
        const response = await fetch(`/api/backtest/sessions?${params.toString()}`, { signal: controller.signal });
        const payload = await parseJson<SessionsResponse>(response);
        if (!response.ok) {
          throw new Error(payload.error ?? 'Could not load backtest sessions');
        }

        setServerUserId(payload.currentUserId ?? null);
        setReviews(payload.reviews ?? []);

        const ownActiveSession = payload.session ?? null;

        if (autoLoadReviewId) {
          const details = await loadSessionDetails(autoLoadReviewId, controller.signal);
          setActiveSession(null);
          setActiveActions([]);
          setReviewMode({
            session: details.session as BacktestSession,
            actions: details.actions ?? [],
          });
        } else if (ownActiveSession) {
          const details = await loadSessionDetails(ownActiveSession.id, controller.signal);
          setActiveSession(details.session ?? ownActiveSession);
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
  }, [autoLoadReviewId, backtestId, date, loadSessionDetails, sheetRowId, ticker]);

  const ensureActiveSession = useCallback(async (nextRiskDollars = riskDollars) => {
    if (!ticker || !date) {
      throw new Error('Pick a ticker and date first');
    }
    if (
      activeSession &&
      activeSession.riskDollars === nextRiskDollars &&
      activeSession.backtestId === backtestId &&
      activeSession.sheetRowId === sheetRowId
    ) {
      return activeSession;
    }

    const response = await fetch('/api/backtest/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, date, riskDollars: nextRiskDollars, backtestId, sheetRowId }),
    });
    const payload = await parseJson<SessionMutationResponse>(response);
    if (!response.ok || !payload.session) {
      throw new Error(payload.error ?? 'Could not create backtest session');
    }

    setActiveSession(payload.session);
    return payload.session;
  }, [activeSession, backtestId, date, riskDollars, sheetRowId, ticker]);

  const placeAction = useCallback(async (input: PlaceBacktestActionInput) => {
    if (isReadOnly) {
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
  }, [activeActions, activeSession?.riskDollars, ensureActiveSession, isReadOnly, riskDollars, session?.userId, activeSession?.userId]);

  const undoLast = useCallback(async () => {
    if (isReadOnly || activeActions.length === 0) return;

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
  }, [activeActions, isReadOnly]);

  const clear = useCallback(async () => {
    if (isReadOnly) {
      setReviewMode(null);
      setError(null);
      return;
    }

    if (!activeSession) return;

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
  }, [activeActions, activeSession, isReadOnly]);

  const deleteReview = useCallback(async (reviewId: string) => {
    const previousReviews = [...reviews];
    const previousReviewMode = reviewMode;

    setIsMutating(true);
    setError(null);
    setReviews((current) => current.filter((review) => review.id !== reviewId));
    if (reviewMode?.session.id === reviewId) {
      setReviewMode(null);
    }

    try {
      const response = await fetch(`/api/backtest/sessions/${reviewId}`, { method: 'DELETE' });
      const payload = await parseJson<{ error?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.error ?? 'Could not delete review');
      }
    } catch {
      setReviews(previousReviews);
      setReviewMode(previousReviewMode);
      const message = 'Could not delete review';
      setError(message);
      throw new Error(message);
    } finally {
      setIsMutating(false);
    }
  }, [reviewMode, reviews]);

  const updateRisk = useCallback(async (nextRiskDollars: number) => {
    if (!Number.isFinite(nextRiskDollars) || nextRiskDollars <= 0 || isReadOnly) return;
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
  }, [activeSession, isReadOnly]);

  const saveReview = useCallback(async (
    label?: string,
    notes?: string,
    chartState?: BacktestChartState,
  ) => {
    if (!activeSession || activeActions.length === 0 || isReadOnly) return;

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
        body: JSON.stringify({ sessionId: activeSession.id, label, notes, chartState: chartState ?? {} }),
      });
      const payload = await parseJson<SessionMutationResponse>(response);
      if (!response.ok || !payload.session) {
        throw new Error(payload.error ?? 'Could not save review');
      }
      setReviews([payload.session, ...previousReviews]);
      setReviewMode({
        session: payload.session,
        actions: previousActions,
      });
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
  }, [activeActions, activeSession, isReadOnly, reviews]);

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
    currentUserId,
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
    deleteReview,
    startNewSession,
  };
}
