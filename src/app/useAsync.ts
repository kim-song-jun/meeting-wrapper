import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
  /**
   * 재조회하고 **끝날 때까지 기다린다.**
   *
   * reload() 는 tick 만 올리고 즉시 반환하므로, 호출부는 "새 데이터가 화면에
   * 반영된 시점" 을 알 수 없다. 격자에서 예약을 옮긴 뒤 프리뷰를 언제 놓아야
   * 하는지가 정확히 그 시점이다 — 먼저 놓으면 블록이 원래 자리로 튀었다가
   * 다시 옮긴 자리로 튄다.
   */
  reloadAsync: () => Promise<void>;
}

/**
 * 로딩·에러를 삼키지 않는 최소 비동기 훅.
 * 실패를 조용히 넘기지 않는 것이 요점이다 (빈 catch 금지).
 *
 * 재조회 중에도 **이전 data 를 들고 있는다.** 호출부는 그걸 계속 그리면 되고,
 * 첫 로드인지는 `data === null` 로 구분한다. 그래야 갱신 때마다 화면이 비지 않는다.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  // 최신 fn 을 항상 참조한다 — reloadAsync 가 옛 클로저를 부르면 옛 날짜를 조회한다.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(() => setTick((n) => n + 1), []);

  const reloadAsync = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fnRef.current());
    } catch (e: unknown) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fn()
      .then((v) => {
        if (alive) setData(v);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, error, reload, reloadAsync };
}
