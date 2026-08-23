import type { AuthAdapter, AuthUser } from "./types";

export type SessionRestoreState =
  | { readonly status: "signed-in"; readonly user: AuthUser; readonly restoreError: null }
  | {
      readonly status: "signed-out";
      readonly user: null;
      readonly restoreError: "session-restore-failed" | null;
    };

export type AuthSessionState =
  | { readonly status: "checking"; readonly user: null; readonly restoreError: null }
  | SessionRestoreState;

export type AdapterBoundAuthState = AuthSessionState & { readonly adapter: AuthAdapter };

export interface AuthOperationCoordinator {
  run<T>(operation: () => Promise<T>, commit: (value: T) => void): Promise<T>;
  invalidate(): void;
}

export function createAuthOperationCoordinator(): AuthOperationCoordinator {
  let generation = 0;

  return {
    async run<T>(operation: () => Promise<T>, commit: (value: T) => void): Promise<T> {
      const operationGeneration = ++generation;
      const value = await operation();
      if (operationGeneration === generation) {
        commit(value);
      }
      return value;
    },
    invalidate(): void {
      generation += 1;
    },
  };
}

export function createCheckingAuthState(adapter: AuthAdapter): AdapterBoundAuthState {
  return { adapter, status: "checking", user: null, restoreError: null };
}

export function bindAuthState(
  adapter: AuthAdapter,
  state: SessionRestoreState,
): AdapterBoundAuthState {
  return { adapter, ...state };
}

export function getVisibleAuthState(
  adapter: AuthAdapter,
  state: AdapterBoundAuthState,
): AuthSessionState {
  if (state.adapter !== adapter) {
    return { status: "checking", user: null, restoreError: null };
  }
  if (state.status === "signed-in") {
    return { status: "signed-in", user: state.user, restoreError: null };
  }
  if (state.status === "signed-out") {
    return { status: "signed-out", user: null, restoreError: state.restoreError };
  }
  return { status: "checking", user: null, restoreError: null };
}

export async function resolveSessionRestore(
  restoreSession: () => Promise<AuthUser | null>,
): Promise<SessionRestoreState> {
  try {
    const user = await restoreSession();
    return user
      ? { status: "signed-in", user, restoreError: null }
      : { status: "signed-out", user: null, restoreError: null };
  } catch {
    return { status: "signed-out", user: null, restoreError: "session-restore-failed" };
  }
}
