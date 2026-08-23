import { describe, expect, it } from "vitest";
import {
  createAuthOperationCoordinator,
  getVisibleAuthState,
  resolveSessionRestore,
} from "./sessionRestore";
import type { AuthAdapter, AuthUser } from "./types";

const user: AuthUser = {
  email: "member@molcube.com",
  name: "Member",
  picture: null,
};

function authAdapter(): AuthAdapter {
  return {
    signIn: async () => ({ ok: false, reason: "denied" }),
    signOut: async () => undefined,
    restoreSession: async () => null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("resolveSessionRestore", () => {
  it("settles a rejected restore as signed out with a non-secret failure category", async () => {
    const state = await resolveSessionRestore(async () => {
      throw new Error("sensitive provider detail");
    });

    expect(state).toEqual({
      status: "signed-out",
      user: null,
      restoreError: "session-restore-failed",
    });
    expect(JSON.stringify(state)).not.toContain("sensitive provider detail");
  });

  it("settles an absent session as signed out without an error", async () => {
    await expect(resolveSessionRestore(async () => null)).resolves.toEqual({
      status: "signed-out",
      user: null,
      restoreError: null,
    });
  });

  it("settles a restored user as signed in", async () => {
    await expect(resolveSessionRestore(async () => user)).resolves.toEqual({
      status: "signed-in",
      user,
      restoreError: null,
    });
  });
});

describe("auth operation coordination", () => {
  it("commits only the newest auth operation", async () => {
    const coordinator = createAuthOperationCoordinator();
    const first = deferred<string>();
    const commits: string[] = [];
    const firstRun = coordinator.run(() => first.promise, (value) => commits.push(value));
    const secondRun = coordinator.run(async () => "newer", (value) => commits.push(value));

    await secondRun;
    first.resolve("stale");
    await firstRun;

    expect(commits).toEqual(["newer"]);
  });

  it("does not commit an operation after cleanup invalidates it", async () => {
    const coordinator = createAuthOperationCoordinator();
    const pending = deferred<string>();
    const commits: string[] = [];
    const run = coordinator.run(() => pending.promise, (value) => commits.push(value));

    coordinator.invalidate();
    pending.resolve("after-unmount");
    await run;

    expect(commits).toEqual([]);
  });

  it("masks a previous adapter identity immediately during replacement", () => {
    const previousAdapter = authAdapter();
    const nextAdapter = authAdapter();

    expect(
      getVisibleAuthState(nextAdapter, {
        adapter: previousAdapter,
        status: "signed-in",
        user,
        restoreError: null,
      }),
    ).toEqual({ status: "checking", user: null, restoreError: null });
  });
});
