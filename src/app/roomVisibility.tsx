import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ROOMS } from "./config";

/**
 * 어느 회의실을 격자에 표시할지.
 *
 * macOS 캘린더의 사이드바 캘린더 목록과 같은 역할이다 — 체크를 끄면 그 방이
 * 격자에서 빠진다. 사이드바(앱 셸)와 격자(화면)가 서로 다른 컴포넌트 트리에 있어
 * 상태를 위로 올린다. 회의실이 둘뿐이라 "둘 다 끄기" 는 막는다: 아무 방도 없는
 * 빈 격자는 사용자가 의도한 상태가 아니라 실수다.
 */
interface RoomVisibility {
  hidden: ReadonlySet<string>;
  isVisible: (roomId: string) => boolean;
  toggle: (roomId: string) => void;
}

const Ctx = createContext<RoomVisibility | null>(null);

export function RoomVisibilityProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set<string>());

  const toggle = useCallback((roomId: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) {
        next.delete(roomId);
      } else {
        // 마지막 남은 방은 끌 수 없다
        if (ROOMS.length - next.size <= 1) return prev;
        next.add(roomId);
      }
      return next;
    });
  }, []);

  const value = useMemo<RoomVisibility>(
    () => ({ hidden, isVisible: (id) => !hidden.has(id), toggle }),
    [hidden, toggle],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRoomVisibility(): RoomVisibility {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRoomVisibility 는 RoomVisibilityProvider 안에서만 쓸 수 있습니다");
  return v;
}
