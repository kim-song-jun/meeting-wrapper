import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui";
import { TEAMS } from "../app/config";
import { repo } from "../data";
import type { DirectoryPerson } from "../domain/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 참석자 선택.
 *
 * 세 겹으로 쌓는다 — 아래로 갈수록 확실히 동작한다:
 *   1. 주소록 자동완성 (People API) — 가장 자연스럽지만 관리자가 디렉터리 공개를
 *      끄면 빈 결과가 온다. 그때 에러를 띄우지 않고 조용히 2·3번으로 넘어간다.
 *   2. 프리셋 팀 (teams.json) — API 의존이 없어 항상 동작한다.
 *   3. 이메일 직접 입력 — 외부 참석자를 부를 때 유일한 방법.
 */
export function AttendeePicker({
  selected,
  onChange,
}: {
  selected: DirectoryPerson[];
  onChange: (next: DirectoryPerson[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryPerson[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const timer = useRef<number | null>(null);

  const has = (email: string) => selected.some((p) => p.email === email);

  function add(person: DirectoryPerson) {
    if (has(person.email)) return;
    onChange([...selected, person]);
    setQuery("");
    setResults([]);
  }

  function addAll(people: DirectoryPerson[]) {
    const merged = [...selected];
    for (const p of people) {
      if (!merged.some((m) => m.email === p.email)) merged.push(p);
    }
    onChange(merged);
  }

  function remove(email: string) {
    onChange(selected.filter((p) => p.email !== email));
  }

  // 타이핑마다 API 를 때리지 않는다
  useEffect(() => {
    const q = query.trim();
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (q.length < 1) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = window.setTimeout(() => {
      repo
        .searchDirectory(q)
        .then((rows) => {
          setResults(rows.filter((r) => !has(r.email)));
          setSearchFailed(false);
        })
        .catch(() => {
          // 디렉터리를 못 읽는 것은 치명적이지 않다 — 직접 입력으로 넘어가면 된다.
          // 다만 조용히 삼키지 않고 아래에 안내를 띄운다.
          setResults([]);
          setSearchFailed(true);
        })
        .finally(() => setSearching(false));
    }, 250);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selected.length]);

  const typedEmail = query.trim();
  const canAddRaw = EMAIL_RE.test(typedEmail) && !has(typedEmail);
  const noMatch = !searching && typedEmail.length > 0 && results.length === 0;

  return (
    <div className="mr-picker">
      {TEAMS.length > 0 ? (
        <div className="mr-picker__teams">
          {TEAMS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="mr-picker__team"
              onClick={() => addAll(t.members)}
            >
              {t.name}
              <span className="mr-picker__teamcount">{t.members.length}</span>
            </button>
          ))}
        </div>
      ) : null}

      <input
        className="mr-input"
        placeholder="이름 또는 이메일로 찾기"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="참석자 검색"
      />

      {searching ? <p className="mr-field__hint">찾는 중…</p> : null}

      {results.length > 0 ? (
        <ul className="mr-picker__results">
          {results.map((p) => (
            <li key={p.email}>
              <button type="button" className="mr-picker__result" onClick={() => add(p)}>
                <span className="mr-picker__name">{p.name}</span>
                <span className="mr-picker__detail">{p.detail ?? p.email}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {noMatch ? (
        canAddRaw ? (
          <div className="mr-row" style={{ marginTop: 8 }}>
            <Button
              variant="compact-quiet"
              onClick={() => add({ email: typedEmail, name: typedEmail, detail: null })}
            >
              {typedEmail} 직접 추가
            </Button>
          </div>
        ) : (
          <p className="mr-field__hint">
            {searchFailed
              ? "주소록을 불러오지 못했어요. 이메일을 직접 입력하면 추가할 수 있어요."
              : "찾는 사람이 없어요. 이메일 전체를 입력하면 직접 추가할 수 있어요."}
          </p>
        )
      ) : null}

      {selected.length > 0 ? (
        <ul className="mr-picker__chips">
          {selected.map((p) => (
            <li key={p.email}>
              <span className="mr-picker__chip">
                {p.name}
                <button
                  type="button"
                  className="mr-picker__remove"
                  onClick={() => remove(p.email)}
                  aria-label={p.name + " 빼기"}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
