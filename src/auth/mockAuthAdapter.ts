import type { AuthAdapter, AuthResult, AuthUser } from "./types";
import { MOCK_IDENTITY } from "../config/currentUser";

/**
 * 모의 인증 어댑터. mockAdapter.ts(BookingRepository)와 같은 스타일 —
 * sleep 으로 왕복 지연을 흉내내고, URL 쿼리로 결정적 분기를 재현한다.
 *
 * ?mockAuth=wrong-domain | denied | error 로 4가지 결과를 재현한다.
 * 쿼리가 없으면(기본) 로그인은 항상 성공한다.
 *
 * identity 는 src/config/currentUser.ts 하나를 mockAdapter.ts 와 함께 참조한다 —
 * 값을 양쪽에 적으면 한쪽만 바뀌었을 때 "로그인한 나"와 "예약 데이터의 나"
 * (isMine 판정)가 조용히 어긋난다.
 */
const MOCK_USER: AuthUser = { ...MOCK_IDENTITY, picture: null };

const SESSION_KEY = "molroom.mockAuth.session";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function readMockAuthQuery(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("mockAuth");
}

async function signIn(): Promise<AuthResult> {
  await sleep(150);

  const mode = readMockAuthQuery();

  if (mode === "wrong-domain") {
    return { ok: false, reason: "wrong-domain", email: "someone@gmail.com" };
  }
  if (mode === "denied") {
    return { ok: false, reason: "denied" };
  }
  if (mode === "error") {
    return { ok: false, reason: "error", message: "네트워크 연결을 확인해 주세요." };
  }

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(MOCK_USER));
  return { ok: true, user: MOCK_USER };
}

async function signOut(): Promise<void> {
  await sleep(80);
  sessionStorage.removeItem(SESSION_KEY);
}

async function restoreSession(): Promise<AuthUser | null> {
  await sleep(150);
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export const mockAuthAdapter: AuthAdapter = { signIn, signOut, restoreSession };
