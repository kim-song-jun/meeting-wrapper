import { NavLink, Route, Routes } from "react-router-dom";
import { GridScreen } from "./screens/GridScreen";
import { RoomLandingScreen } from "./screens/RoomLandingScreen";
import { MyBookingsScreen } from "./screens/MyBookingsScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { RequireAuth } from "./auth/RequireAuth";
import { BrandMark } from "./auth/BrandMark";

/**
 * 앱바 우측 계정 클러스터. 이메일은 정보 표시 전용(클릭 불가), 로그아웃은
 * 기존 .mr-navlink 스타일을 재사용한다(새 클래스 불필요).
 * /r/:roomId(QR 랜딩)는 이 Shell 을 쓰지 않으므로 여기 나타나지 않는다 —
 * 그 화면은 의도적으로 최소 크롬을 유지한다(DESIGN.md §13).
 */
function AccountCluster() {
  const auth = useAuth();
  if (auth.status !== "signed-in" || !auth.user) return null;
  return (
    <span className="mr-appbar__account">
      <span className="t-cap mr-appbar__email">
        {auth.user.name} · {auth.user.email}
      </span>
      <button type="button" className="mr-navlink mr-appbar__signout" onClick={() => void auth.signOut()}>
        로그아웃
      </button>
    </span>
  );
}

/*
 * pane: 예약 현황(격자) 화면 전용. 문서 스크롤을 잠그고 격자 판(.grid-scroll,
 * grid.css)만 세로로 스크롤되게 한다 — 이중 스크롤 제거. /me 같은 리스트
 * 화면은 pane 을 켜지 않는다: 지금처럼 페이지 전체가 스크롤돼야 자연스럽다.
 * CSS 쪽 구현은 screens.css(.mr-shell--pane)와 grid.css(.grid-scroll 등)를 본다.
 */
function Shell({ children, pane = false }: { children: React.ReactNode; pane?: boolean }) {
  return (
    <div className={pane ? "mr-shell mr-shell--pane" : "mr-shell"}>
      <header className="mr-appbar">
        <span className="mr-appbar__brand">
          <BrandMark className="mr-appbar__mark" />
          MolRoom
        </span>
        <nav className="mr-appbar__nav">
          <NavLink to="/" end className="mr-navlink">
            예약 현황
          </NavLink>
          <NavLink to="/me" className="mr-navlink">
            내 예약
          </NavLink>
        </nav>
        <AccountCluster />
      </header>
      <main className="mr-main">{children}</main>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* 로그인은 셸도 가드도 없는 유일한 공개 라우트 */}
        <Route path="/login" element={<LoginScreen />} />

        {/* QR 랜딩도 셸 없는 단독 화면이지만 인증은 필요하다 — 이 프로젝트엔
         * 서버가 없고 Calendar 호출도 사용자 본인 토큰으로 하므로 "보기만"
         * 하는 것도 로그인이 있어야 한다(loginSpec 참고). */}
        <Route
          path="/r/:roomId"
          element={
            <RequireAuth>
              <RoomLandingScreen />
            </RequireAuth>
          }
        />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Shell pane>
                <GridScreen />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/me"
          element={
            <RequireAuth>
              <Shell>
                <MyBookingsScreen />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="*"
          element={
            <RequireAuth>
              <Shell>
                <p className="t-body">페이지를 찾을 수 없어요.</p>
              </Shell>
            </RequireAuth>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
