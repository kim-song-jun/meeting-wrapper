import { NavLink, Route, Routes } from "react-router-dom";
import { GridScreen } from "./screens/GridScreen";
import { RoomLandingScreen } from "./screens/RoomLandingScreen";
import { MyBookingsScreen } from "./screens/MyBookingsScreen";

/** MolCube 로고 마크. index.html 파비콘과 같은 아이소메트릭 큐브를 JSX 로 재작성. */
function BrandMark() {
  return (
    <svg
      className="mr-appbar__mark"
      width="20"
      height="20"
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <polygon points="50,6 90,28 50,50 10,28" fill="#73FEDD" stroke="#202362" strokeWidth="5" strokeLinejoin="round" />
      <polygon points="10,28 50,50 50,94 10,72" fill="#4279BC" stroke="#202362" strokeWidth="5" strokeLinejoin="round" />
      <polygon points="90,28 50,50 50,94 90,72" fill="#FFC006" stroke="#202362" strokeWidth="5" strokeLinejoin="round" />
    </svg>
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
          <BrandMark />
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
      </header>
      <main className="mr-main">{children}</main>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      {/* QR 랜딩은 셸 없이 단독 화면 — 복도에서 단일 결정에 최적화한다 */}
      <Route path="/r/:roomId" element={<RoomLandingScreen />} />
      <Route
        path="/"
        element={
          <Shell pane>
            <GridScreen />
          </Shell>
        }
      />
      <Route
        path="/me"
        element={
          <Shell>
            <MyBookingsScreen />
          </Shell>
        }
      />
      <Route
        path="*"
        element={
          <Shell>
            <p className="t-body">페이지를 찾을 수 없어요.</p>
          </Shell>
        }
      />
    </Routes>
  );
}
