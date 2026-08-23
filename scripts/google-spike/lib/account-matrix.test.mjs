import { describe, expect, it } from "vitest";
import {
  AccountMatrixError,
  validateAccountMatrix,
} from "./account-matrix.mjs";
import matrix from "../../../docs/spikes/google-workspace/account-matrix.json" with { type: "json" };

describe("account matrix contract", () => {
  it("validates the complete alias-only contract", () => {
    expect(validateAccountMatrix(matrix).rows).toHaveLength(8);
  });

  it("rejects non-canonical bound account or room identifiers without echoing them", () => {
    expect(() => validateAccountMatrix(matrix, { envText: [
      "GOOGLE_SPIKE_ORDINARY_ACCOUNT=ordinary@Example.com",
      "GOOGLE_SPIKE_ADMIN_ACCOUNT=admin@molcube.com",
      "GOOGLE_SPIKE_ROOM_A_CALENDAR_ID=room-a@molcube.com",
      "GOOGLE_SPIKE_ROOM_B_CALENDAR_ID=room-b@molcube.com",
    ].join("\n") })).toThrow(AccountMatrixError);
  });

  it.each([
    ["duplicate env key", "GOOGLE_SPIKE_ORDINARY_ACCOUNT=ordinary@molcube.com\nGOOGLE_SPIKE_ORDINARY_ACCOUNT=other@molcube.com", "/env"],
    ["quoted env value", "GOOGLE_SPIKE_ORDINARY_ACCOUNT='ordinary@molcube.com'", "/env"],
    ["whitespace env value", "GOOGLE_SPIKE_ORDINARY_ACCOUNT=ordinary@molcube.com ", "/env/accounts"],
  ])("rejects %s", (_label, fragment, pointer) => {
    const env = [fragment, "GOOGLE_SPIKE_ADMIN_ACCOUNT=admin@molcube.com", "GOOGLE_SPIKE_ROOM_A_CALENDAR_ID=room-a@molcube.com", "GOOGLE_SPIKE_ROOM_B_CALENDAR_ID=room-b@molcube.com"].join("\n");
    expect(() => validateAccountMatrix(matrix, { envText: env })).toThrowError(
      expect.objectContaining({ category: "INVALID_ACCOUNT_MATRIX_ENV", pointer }),
    );
  });

  it("keeps the committed matrix synthetic and unbound", () => {
    const result = validateAccountMatrix(matrix);
    expect(result.status).toBe("UNBOUND");
    expect(result.observation).toBe("UNOBSERVED");
    expect(result.accounts.map(({ alias }) => alias)).toEqual([
      "ordinary",
      "room-writer-admin",
    ]);
    expect(result.rooms.map(({ alias }) => alias)).toEqual(["room-a", "room-b"]);
    expect(JSON.stringify(result)).not.toMatch(/@|calendarId|client_secret|refresh_token/i);
  });

  it.each([
    ["same account", (value) => ({ ...value, accounts: value.accounts.map((account) => ({ ...account, identityBinding: "same" })) })],
    ["ordinary writer", (value) => ({ ...value, accounts: value.accounts.map((account) => account.alias === "ordinary" ? { ...account, roomWriter: true } : account) })],
    ["shared mutable fixture", (value) => ({ ...value, fixtures: value.fixtures.map((fixture, index) => index === 1 ? { ...fixture, mutableId: value.fixtures[0].mutableId } : fixture) })],
    ["wrong cleanup owner", (value) => ({ ...value, rows: value.rows.map((row) => row.alias === "ordinary-room-copy-write" ? { ...row, cleanupOwner: "room-writer-admin" } : row) })],
    ["wrong conflict room", (value) => ({ ...value, rows: value.rows.map((row) => row.alias === "two-browser-conflict-b" ? { ...row, resource: "room-a" } : row) })],
  ])("rejects %s", (_label, mutate) => {
    expect(() => validateAccountMatrix(mutate(structuredClone(matrix)))).toThrow(AccountMatrixError);
  });
});
