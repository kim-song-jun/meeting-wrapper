import { useCallback, useEffect, useRef, useState } from "react";

interface AsyncSnapshot<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

interface LatestRequestCoordinator<T> {
  activate(): void;
  deactivate(): void;
  start(loader: () => Promise<T>): void;
  run(loader: () => Promise<T>): Promise<void>;
  acknowledgeCommit(snapshot: AsyncSnapshot<T>): void;
}

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
   * 다시 옮긴 자리로 튄다. 더 최신 조회가 이 요청을 대체하면 그 최신 결과가
   * 반영될 때까지 함께 기다린다.
   */
  reloadAsync: () => Promise<void>;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * `useAsync`가 effect/reload 경로 모두에서 공유하는 세대 조정기다.
 *
 * 테스트 가능한 순수 경계로만 export한다. 요청을 취소했다고 주장하지 않고,
 * 최신 세대만 상태를 commit하도록 보장한다.
 *
 * @internal
 */
export function createLatestRequestCoordinator<T>(
  initial: AsyncSnapshot<T>,
  commit: (snapshot: AsyncSnapshot<T>) => void,
): LatestRequestCoordinator<T> {
  let current = initial;
  let latestGeneration = 0;
  let pendingCompletion: AsyncSnapshot<T> | null = null;
  let active = false;
  const completionWaiters = new Set<() => void>();

  function resolveCompletions() {
    const waiters = [...completionWaiters];
    completionWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  async function settleRequest(generation: number, loader: () => Promise<T>) {
    try {
      const data = await loader();
      if (generation !== latestGeneration) return;
      current = { data, error: null, loading: false };
    } catch (cause: unknown) {
      if (generation !== latestGeneration) return;
      current = { data: current.data, error: toError(cause), loading: false };
    }

    pendingCompletion = current;
    commit(current);
  }

  function begin(loader: () => Promise<T>) {
    const generation = ++latestGeneration;
    pendingCompletion = null;
    current = { data: current.data, error: null, loading: true };
    commit(current);
    void settleRequest(generation, loader);
  }

  return {
    activate() {
      active = true;
    },
    deactivate() {
      active = false;
      latestGeneration += 1;
      pendingCompletion = null;
      resolveCompletions();
    },
    start(loader) {
      if (!active) return;
      begin(loader);
    },
    run(loader) {
      if (!active) return Promise.resolve();
      const completion = new Promise<void>((resolve) => completionWaiters.add(resolve));
      begin(loader);
      return completion;
    },
    acknowledgeCommit(snapshot) {
      if (snapshot !== pendingCompletion) return;
      pendingCompletion = null;
      resolveCompletions();
    },
  };
}

/**
 * 로딩·에러를 삼키지 않는 최소 비동기 훅.
 * 실패를 조용히 넘기지 않는 것이 요점이다 (빈 catch 금지).
 *
 * 재조회 중에도 **이전 data 를 들고 있는다.** 호출부는 그걸 계속 그리면 되고,
 * 첫 로드인지는 `data === null` 로 구분한다. 그래야 갱신 때마다 화면이 비지 않는다.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const initialSnapshot: AsyncSnapshot<T> = { data: null, error: null, loading: true };
  const [snapshot, setSnapshot] = useState<AsyncSnapshot<T>>(initialSnapshot);
  const [tick, setTick] = useState(0);

  const coordinatorRef = useRef<LatestRequestCoordinator<T> | null>(null);
  if (coordinatorRef.current === null) {
    coordinatorRef.current = createLatestRequestCoordinator(initialSnapshot, setSnapshot);
  }
  const coordinator = coordinatorRef.current;

  // 최신 fn 을 항상 참조한다 — reloadAsync 가 옛 클로저를 부르면 옛 날짜를 조회한다.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(() => setTick((n) => n + 1), []);

  const reloadAsync = useCallback(() => coordinator.run(fnRef.current), [coordinator]);

  // 조회 Effect보다 먼저 lifetime을 연다. StrictMode의 setup → cleanup → setup
  // 재생에서도 두 번째 조회가 다시 활성화되고, unmount 뒤 캡처된 callback은
  // loader나 waiter를 만들지 않고 즉시 끝난다.
  useEffect(() => {
    coordinator.activate();
    return () => {
      coordinator.deactivate();
    };
  }, [coordinator]);

  useEffect(() => {
    coordinator.start(fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinator, ...deps, tick]);

  // 조회 Effect 다음에 실행되어, 최신 요청의 상태가 실제 DOM commit을 마친 뒤
  // reloadAsync 대기자를 해제한다. 같은 commit에서 deps가 바뀌면 위 Effect가
  // 먼저 세대를 올리므로 이전 snapshot은 승인되지 않는다.
  useEffect(() => {
    coordinator.acknowledgeCommit(snapshot);
  }, [coordinator, snapshot]);

  return { ...snapshot, reload, reloadAsync };
}
