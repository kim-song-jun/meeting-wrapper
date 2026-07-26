/**
 * 인증 계약 — 실제 Google OAuth 로 갈아끼울 seam.
 *
 * src/data/index.ts 가 BookingRepository 구현체를 한 줄로 스위치하는 것과
 * 같은 패턴이다. 이 인터페이스만 만족하면 AuthProvider 는 어떤 구현체를
 * 받아도 동작한다 — mockAuthAdapter 대신 googleAuthAdapter 를 주입하는
 * 순간이 실제 전환이고, LoginScreen/RequireAuth/App 은 손대지 않는다.
 */

export interface AuthUser {
  email: string;
  name: string;
  /** Google 프로필 사진 URL. mock 은 항상 null. */
  picture: string | null;
}

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: "wrong-domain"; email: string }
  | { ok: false; reason: "denied" }
  | { ok: false; reason: "error"; message: string };

export interface AuthAdapter {
  signIn(): Promise<AuthResult>;
  signOut(): Promise<void>;
  /** 새로고침 시 기존 세션 복원. 세션 없으면 null(에러 아님). */
  restoreSession(): Promise<AuthUser | null>;
}
