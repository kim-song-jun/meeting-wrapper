import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AuthAdapter, AuthResult, AuthUser } from "./types";
import { mockAuthAdapter } from "./mockAuthAdapter";

export type AuthStatus = "checking" | "signed-out" | "signed-in";

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
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
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    adapter.restoreSession().then((restored) => {
      if (cancelled) return;
      setUser(restored);
      setStatus(restored ? "signed-in" : "signed-out");
    });
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  const signIn = useCallback(async (): Promise<AuthResult> => {
    const result = await adapter.signIn();
    if (result.ok) {
      setUser(result.user);
      setStatus("signed-in");
    }
    return result;
  }, [adapter]);

  const signOut = useCallback(async () => {
    await adapter.signOut();
    setUser(null);
    setStatus("signed-out");
  }, [adapter]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, signIn, signOut }),
    [status, user, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 는 AuthProvider 안에서만 사용할 수 있습니다");
  return ctx;
}
