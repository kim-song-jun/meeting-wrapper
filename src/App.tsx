import { NavLink, Route, Routes } from "react-router-dom";
import { GridScreen } from "./screens/GridScreen";
import { RoomLandingScreen } from "./screens/RoomLandingScreen";
import { MyBookingsScreen } from "./screens/MyBookingsScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { RequireAuth } from "./auth/RequireAuth";
import { BrandMark } from "./auth/BrandMark";
import { ROOMS } from "./app/config";
import { useRoomVisibility } from "./app/roomVisibility";

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

/**
 * 사이드바 — macOS 앱의 얼굴.
 *
 * 캘린더·메일·메모 모두 반투명 사이드바 + 콘텐츠 2단 창이고, 그게 "맥 앱처럼
 * 보이는" 첫째 요인이다. 상단 내비바만 있으면 색과 폰트를 다 맞춰도 웹사이트로 읽힌다.
 * 유리(vibrancy)의 원래 자리도 여기다 — 뒤에 캔버스와 앰비언트가 있어 실제로 비친다.
 *
 * 회의실 목록은 장식이 아니라 캘린더 목록과 같은 컨트롤이다: 체크를 끄면 격자에서 빠진다.
 * 1024px 미만에서는 접히고(screens.css) 기존 상단 내비로 돌아간다 — 손가락으로 220px
 * 사이드바를 두면 격자가 남지 않는다.
 */
function Sidebar() {
  const auth = useAuth();
  const rooms = useRoomVisibility();
  return (
    <aside className="mr-sidebar">
      <div className="mr-sidebar__brand">
        <BrandMark className="mr-sidebar__mark" />
        MolRoom
      </div>

      <nav className="mr-sidebar__nav" aria-label="화면 이동">
        <NavLink to="/" end className={({ isActive }) => (isActive ? "mr-sidebar__item active" : "mr-sidebar__item")}>
          예약 현황
        </NavLink>
        <NavLink to="/me" className={({ isActive }) => (isActive ? "mr-sidebar__item active" : "mr-sidebar__item")}>
          내 예약
        </NavLink>
      </nav>

      <div className="mr-sidebar__section">
        <h2 className="mr-sidebar__heading">회의실</h2>
        <p className="mr-sidebar__note t-cap">켠 회의실만 격자에 보여요.</p>
        {ROOMS.map((room) => {
          const on = rooms.isVisible(room.id);
          /*
           * 네이티브 체크박스를 버렸다.
           *
           * 13px 짜리 파란 사각형은 브라우저가 그리는 물건이라 Weak 쌍도 12px radius 도
           * 적용되지 않았다 — 흰 사이드바에서 유일하게 OS 문법으로 남은 컨트롤이었다.
           * 대신 행 전체를 role="switch" 버튼으로 만들고 켜짐을 Weak 채움으로 낸다
           * (DESIGN.md §4 MolRoom Sidebar: 48px 행 · radius 12px · 선택은 Weak 쌍).
           * 상태는 색만이 아니라 우측 점(--roomdot)으로도 나가므로 색각 이상에서도 읽힌다.
           */
          const last = on && ROOMS.filter((r) => rooms.isVisible(r.id)).length <= 1;
          return (
            <button
              key={room.id}
              type="button"
              role="switch"
              aria-checked={on}
              disabled={last}
              className={on ? "mr-sidebar__room is-on" : "mr-sidebar__room"}
              onClick={() => rooms.toggle(room.id)}
            >
              <span className="mr-sidebar__roomdot" aria-hidden="true" />
              <span className="mr-sidebar__roomname">{room.name}</span>
              <span className="mr-sidebar__roomfloor t-cap">{room.floor}</span>
            </button>
          );
        })}
        {/* 비활성 사유는 상시 노출한다 — 왜 못 끄는지 툴팁으로 숨기지 않는다(DESIGN.md §4·§10) */}
        {ROOMS.filter((r) => rooms.isVisible(r.id)).length <= 1 ? (
          <p className="mr-sidebar__reason t-cap">회의실을 모두 끄면 격자가 비어요. 하나는 켜 둬요.</p>
        ) : null}
      </div>

      {auth.status === "signed-in" && auth.user ? (
        <div className="mr-sidebar__foot">
          <span className="mr-sidebar__user t-cap">{auth.user.email}</span>
          <button type="button" className="mr-sidebar__signout" onClick={() => void auth.signOut()}>
            로그아웃
          </button>
        </div>
      ) : null}
    </aside>
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
      <Sidebar />
      {/* 좁은 폭에서만 보이는 상단 바 — 사이드바가 접히면 이쪽이 내비게이션을 맡는다 */}
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
