// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DirectoryPerson } from "../domain/types";
import type { BookingRepository } from "../data/BookingRepository";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttendeePicker } from "./AttendeePicker";

interface Deferred<T> {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T): void;
}

interface DirectoryRequest extends Deferred<DirectoryPerson[]> {
  query: string;
}

const directoryBoundary = vi.hoisted(() => ({
  searchDirectory: (_query: string): Promise<DirectoryPerson[]> => Promise.resolve([]),
}));

vi.mock("../data", () => ({
  repo: {
    searchDirectory(query: string) {
      return directoryBoundary.searchDirectory(query);
    },
  },
}));

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createDirectoryBoundary(): DirectoryRequest[] {
  const requests: DirectoryRequest[] = [];
  const repository: Pick<BookingRepository, "searchDirectory"> = {
    searchDirectory(query) {
      const request = { query, ...deferred<DirectoryPerson[]>() };
      requests.push(request);
      return request.promise;
    },
  };
  directoryBoundary.searchDirectory = repository.searchDirectory;
  return requests;
}

function person(name: string, email: string): DirectoryPerson {
  return { name, email, detail: "제품팀" };
}

function renderPicker(selected: DirectoryPerson[] = []) {
  return render(<AttendeePicker selected={selected} onChange={() => undefined} />);
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function fulfill(request: DirectoryRequest, rows: DirectoryPerson[]): Promise<void> {
  await act(async () => {
    request.resolve(rows);
    await request.promise;
  });
}

async function fail(request: DirectoryRequest, error: Error): Promise<void> {
  await act(async () => {
    request.reject(error);
    await request.promise.catch(() => undefined);
  });
}

function search(query: string): void {
  fireEvent.change(screen.getByRole("textbox", { name: "참석자 검색" }), {
    target: { value: query },
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AttendeePicker directory search", () => {
  // Mutation caught: removing the request-generation guard lets query A replace newer query B results.
  it("keeps newer query results visible when an older request resolves afterward", async () => {
    vi.useFakeTimers();
    const requests = createDirectoryBoundary();
    renderPicker();

    search("older");
    await advance(250);
    search("newer");
    await advance(250);

    const newer = person("새 결과", "newer@example.com");
    await fulfill(requests[1]!, [newer]);
    expect(screen.queryByRole("button", { name: /새 결과/ })).not.toBeNull();

    await fulfill(requests[0]!, [person("오래된 결과", "older@example.com")]);
    expect(screen.queryByRole("button", { name: /새 결과/ })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /오래된 결과/ })).toBeNull();
  });

  // Mutation caught: removing the stale catch guard lets query A's failure replace visible query B results.
  it("keeps visible newer results free of a stale error when an older request rejects", async () => {
    vi.useFakeTimers();
    const requests = createDirectoryBoundary();
    renderPicker();

    search("older");
    await advance(250);
    search("newer");
    await advance(250);

    const newer = person("새 결과", "newer@example.com");
    await fulfill(requests[1]!, [newer]);
    expect(screen.queryByRole("button", { name: /새 결과/ })).not.toBeNull();

    await fail(requests[0]!, new Error("older request failed"));
    expect(screen.queryByRole("button", { name: /새 결과/ })).not.toBeNull();
    expect(
      screen.queryByText("주소록을 불러오지 못했어요. 이메일을 직접 입력하면 추가할 수 있어요."),
    ).toBeNull();
  });

  // Mutation caught: removing only the stale finally guard lets query A end query B's visible loading state.
  it("keeps the newer query visibly loading when an older request rejects", async () => {
    vi.useFakeTimers();
    const requests = createDirectoryBoundary();
    renderPicker();

    search("older");
    await advance(250);
    search("newer");
    await advance(250);

    await fail(requests[0]!, new Error("older request failed"));
    expect(
      screen.queryByText("찾는 중…"),
    ).not.toBeNull();

    expect(
      screen.queryByText("주소록을 불러오지 못했어요. 이메일을 직접 입력하면 추가할 수 있어요."),
    ).toBeNull();
  });

  // Mutation caught: skipping empty-query invalidation lets an older success repopulate a directly cleared picker.
  it("keeps a directly cleared picker empty when its started request resolves", async () => {
    vi.useFakeTimers();
    const requests = createDirectoryBoundary();
    const view = renderPicker();

    search("older");
    await advance(250);
    search("");

    await fulfill(requests[0]!, [person("되돌아오면 안 되는 결과", "stale@example.com")]);

    expect(view.container.querySelector(".mr-picker__results")).toBeNull();
    expect(
      screen.queryByText("주소록을 불러오지 못했어요. 이메일을 직접 입력하면 추가할 수 있어요."),
    ).toBeNull();
  });

  // Mutation caught: depending only on selected.length leaves a newly selected same-length attendee searchable.
  it("refreshes filtering after selected changes to a different collection of the same length", async () => {
    vi.useFakeTimers();
    const requests = createDirectoryBoundary();
    const initiallySelected = person("처음 선택", "first@example.com");
    const newlySelected = person("새 선택", "new@example.com");
    const view = renderPicker([initiallySelected]);

    search("new");
    await advance(250);
    await fulfill(requests[0]!, [newlySelected]);
    expect(view.container.querySelector(".mr-picker__results")).not.toBeNull();

    view.rerender(<AttendeePicker selected={[newlySelected]} onChange={() => undefined} />);
    await advance(250);
    expect(requests, "changing selected must start a fresh search for current filtering").toHaveLength(2);
    if (requests.length !== 2) return;
    await fulfill(requests[1]!, [newlySelected]);

    expect(view.container.querySelector(".mr-picker__results")).toBeNull();
  });

  // Mutation caught: shortening the debounce starts visible directory completion before the documented 250 ms boundary.
  it("renders a directory result only after the 250 ms debounce boundary", async () => {
    vi.useFakeTimers();
    const requests = createDirectoryBoundary();
    renderPicker();
    const boundaryResult = person("경계 결과", "boundary@example.com");

    search("boundary");
    await advance(249);
    expect(requests).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /경계 결과/ })).toBeNull();

    await advance(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.query).toBe("boundary");

    await fulfill(requests[0]!, [boundaryResult]);
    expect(screen.queryByRole("button", { name: /경계 결과/ })).not.toBeNull();
  });
});
