import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Location } from "react-router-dom";
import { Alert, Button } from "../components/ui";
import { useAuth } from "../auth/AuthProvider";
import { BrandMark } from "../auth/BrandMark";
import { BootSplash } from "../auth/BootSplash";
import "../styles/login.css";

/** 로그인 후 되돌아갈 원래 경로. RequireAuth 가 <Navigate state={{ from }}> 로 실어 보낸다. */
interface LoginLocationState {
  from?: Location;
}

type ScreenState =
  | { kind: "idle" }
  | { kind: "authenticating" }
  | { kind: "wrong-domain"; email: string }
  | { kind: "error"; message: string };

/**
 * /login — Shell 밖 단독 라우트. QR 랜딩과 같은 급의 화면이다.
 * 상태기계는 화면 스펙 그대로: idle → authenticating → (성공 시 redirect) |
 * wrong-domain | denied(조용히 idle 로) | error.
 */
export function LoginScreen() {
  const auth = useAuth();
  const location = useLocation();
  const [state, setState] = useState<ScreenState>({ kind: "idle" });
  const alertRef = useRef<HTMLDivElement>(null);

  const fromState = (location.state as LoginLocationState | null)?.from;

  // 상태 전환 시 Alert 로 시각 포커스를 옮긴다 — role="status" 가 스크린리더에는
  // 알리지만 이건 화면 전체가 바뀌는 전환이라 시각 포커스도 함께 옮기는 편이 맞다.
  useEffect(() => {
    if (state.kind === "wrong-domain" || state.kind === "error") {
      alertRef.current?.focus();
    }
  }, [state.kind]);

  // 세션 복원이 끝나기 전엔 로그인 폼도 보여주지 않는다(/login 직접 방문 포함).
  if (auth.status === "checking") return <BootSplash />;

  // 이미 로그인된 채로 /login 에 왔으면 폼을 그리지 않고 즉시 되돌린다.
  if (auth.status === "signed-in") {
    return <Navigate to={fromState?.pathname ?? "/"} replace />;
  }

  const handleSignIn = async () => {
    setState({ kind: "authenticating" });
    const result = await auth.signIn();
    if (result.ok) {
      // AuthProvider 가 status 를 signed-in 으로 바꾸면 위쪽 분기가 다음
      // 렌더에서 리다이렉트를 처리한다 — 여기서 따로 navigate 하지 않는다.
      return;
    }
    if (result.reason === "wrong-domain") {
      setState({ kind: "wrong-domain", email: result.email });
      return;
    }
    if (result.reason === "denied") {
      // 사용자가 스스로 취소한 것 — 실패로 서사화하지 않고 조용히 되돌린다.
      setState({ kind: "idle" });
      return;
    }
    setState({ kind: "error", message: result.message });
  };

  const handleRetryOtherAccount = () => {
    setState({ kind: "idle" });
    void handleSignIn();
  };

  const isAuthenticating = state.kind === "authenticating";

  return (
    <div className="mr-login">
      <div className="mr-login__col">
        <BrandMark size={56} className="mr-login__mark" />
        <h1 className="t-title mr-login__title">MolRoom</h1>
        <p className="t-small t-muted mr-login__subtitle">molcube 회의실 예약</p>

        {state.kind !== "wrong-domain" ? (
          <Button variant="primary" block disabled={isAuthenticating} onClick={handleSignIn}>
            {isAuthenticating ? "계속하는 중…" : "Google 계정으로 계속"}
          </Button>
        ) : null}

        <p className="t-cap t-muted mr-login__hint">molcube.com 계정만 사용할 수 있어요.</p>

        {state.kind === "wrong-domain" ? (
          <div className="mr-login__failure">
            <Alert tone="warn">
              <div ref={alertRef} tabIndex={-1}>
                {state.email}은 molcube.com 계정이 아니에요. 사내 Google 계정으로 다시 시도해
                주세요.
              </div>
            </Alert>
            <Button variant="secondary" block onClick={handleRetryOtherAccount}>
              다른 계정으로 다시 시도
            </Button>
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div className="mr-login__failure">
            <Alert tone="warn">
              <div ref={alertRef} tabIndex={-1}>
                로그인 중 문제가 생겼어요. 네트워크 상태를 확인하고 다시 시도해 주세요.
              </div>
            </Alert>
          </div>
        ) : null}
      </div>
    </div>
  );
}
