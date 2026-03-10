export interface CircuitBreakerState {
  status: 'closed' | 'open' | 'half-open';
  consecutiveFailures: number;
  lastFailureAt: number | null;
  openedAt: number | null;
}

const DEFAULT_THRESHOLD = 5;
const DEFAULT_RESET_MS = 60_000;

const state: CircuitBreakerState = {
  status: 'closed',
  consecutiveFailures: 0,
  lastFailureAt: null,
  openedAt: null,
};

let halfOpenProbeAvailable = false;

function getThreshold() {
  const value = Number(process.env.JARVIS_CIRCUIT_BREAKER_THRESHOLD);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_THRESHOLD;
  return Math.floor(value);
}

function getResetMs() {
  const value = Number(process.env.JARVIS_CIRCUIT_BREAKER_RESET_MS);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_RESET_MS;
  return Math.floor(value);
}

export function getCircuitBreakerState(): CircuitBreakerState {
  return { ...state };
}

export function isCircuitOpen(): boolean {
  if (state.status === 'closed') return false;

  if (state.status === 'open') {
    const resetMs = getResetMs();
    const openedAt = state.openedAt ?? Date.now();
    if (Date.now() - openedAt >= resetMs) {
      state.status = 'half-open';
      halfOpenProbeAvailable = true;
    } else {
      return true;
    }
  }

  if (state.status === 'half-open') {
    if (halfOpenProbeAvailable) {
      halfOpenProbeAvailable = false;
      return false;
    }
    return true;
  }

  return false;
}

export function recordLlmSuccess(): void {
  state.status = 'closed';
  state.consecutiveFailures = 0;
  state.lastFailureAt = null;
  state.openedAt = null;
  halfOpenProbeAvailable = false;
}

export function recordLlmFailure(): void {
  state.consecutiveFailures += 1;
  state.lastFailureAt = Date.now();

  if (state.status === 'half-open') {
    state.status = 'open';
    state.openedAt = Date.now();
    halfOpenProbeAvailable = false;
    return;
  }

  const threshold = getThreshold();
  if (state.consecutiveFailures >= threshold) {
    state.status = 'open';
    state.openedAt = Date.now();
    halfOpenProbeAvailable = false;
  }
}

export function resetCircuitBreaker(): void {
  state.status = 'closed';
  state.consecutiveFailures = 0;
  state.lastFailureAt = null;
  state.openedAt = null;
  halfOpenProbeAvailable = false;
}
