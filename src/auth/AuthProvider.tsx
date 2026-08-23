import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AuthAdapter, AuthResult, AuthUser } from "./types";
import { mockAuthAdapter } from "./mockAuthAdapter";
import {
  bindAuthState,
  createAuthOperationCoordinator,
  createCheckingAuthState,
  getVisibleAuthState,
  resolveSessionRestore,
} from "./sessionRestore";
import type {
  AdapterBoundAuthState,
  AuthOperationCoordinator,
  SessionRestoreState,
} from "./sessionRestore";

export type AuthStatus = "checking" | "signed-out" | "signed-in";
export type AuthRestoreError = SessionRestoreState["restoreError"];

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  restoreError: AuthRestoreError;
  /** LoginScreen 이 실패 사유(wrong-domain/denied/error)를 직접 분기하려면 결과를 그대로 돌려줘야 한다. */
  signIn: () => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * 인증 상태 컨테이너. mount 시 adapter.restoreSession() 을 1회 호출해
 * checking → signed-in|signed-out 을 정한다.
 *
 * adapter prop 은 실제 Google OAuth 전환용 seam 이다 — 기본값(mockAuthAdapter)만
 * googleAuthAdapter 로 바꿔 끼우면 되고 이 컴포넌트의 나머지 로직은 그대로 쓴다.
 */
export function AuthProvider({
  children,
  adapter = mockAuthAdapter,
}: {
  children: ReactNode;
  adapter?: AuthAdapter;
}) {
  const coordinatorRef = useRef<AuthOperationCoordinator | null>(null);
  if (coordinatorRef.current === null) {
    coordinatorRef.current = createAuthOperationCoordinator();
  }
  const coordinator = coordinatorRef.current;
  const [authState, setAuthState] = useState<AdapterBoundAuthState>(() =>
    createCheckingAuthState(adapter),
  );
  const { status, user, restoreError } = getVisibleAuthState(adapter, authState);

  useEffect(() => {
    setAuthState(createCheckingAuthState(adapter));
    void coordinator.run(
      () => resolveSessionRestore(() => adapter.restoreSession()),
      (restored) => setAuthState(bindAuthState(adapter, restored)),
    );
    return () => {
      coordinator.invalidate();
    };
  }, [adapter, coordinator]);

  const signIn = useCallback(
    (): Promise<AuthResult> =>
      coordinator.run(
        () => adapter.signIn(),
        (result) => {
          const nextState: SessionRestoreState = result.ok
            ? { status: "signed-in", user: result.user, restoreError: null }
            : { status: "signed-out", user: null, restoreError: null };
          setAuthState(bindAuthState(adapter, nextState));
        },
      ),
    [adapter, coordinator],
  );

  const signOut = useCallback(async () => {
    await coordinator.run(
      () => adapter.signOut(),
      () =>
        setAuthState(
          bindAuthState(adapter, { status: "signed-out", user: null, restoreError: null }),
        ),
    );
  }, [adapter, coordinator]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, restoreError, signIn, signOut }),
    [status, user, restoreError, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 는 AuthProvider 안에서만 사용할 수 있습니다");
  return ctx;
}
