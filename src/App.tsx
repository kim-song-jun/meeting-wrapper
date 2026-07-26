import { NavLink, Route, Routes } from "react-router-dom";
import { GridScreen } from "./screens/GridScreen";
import { RoomLandingScreen } from "./screens/RoomLandingScreen";
import { MyBookingsScreen } from "./screens/MyBookingsScreen";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mr-shell">
      <header className="mr-appbar">
        <span className="mr-appbar__brand">molroom</span>
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
          <Shell>
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
