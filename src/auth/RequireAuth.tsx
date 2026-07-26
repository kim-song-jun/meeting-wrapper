import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { BootSplash } from "./BootSplash";

/**
 * 보호 라우트 가드. 미인증이면 /login 으로 보내되 원래 경로(state.from)를
 * 들고 가 로그인 성공 시 그 경로로 정확히 되돌아가게 한다(QR 시나리오).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === "checking") return <BootSplash />;
  if (auth.status === "signed-out") {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}
