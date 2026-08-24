import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  AccountMatrixError,
  validateAccountMatrix,
} from "./account-matrix.mjs";
import matrix from "../../../docs/spikes/google-workspace/account-matrix.json" with { type: "json" };

const testRoot = dirname(fileURLToPath(import.meta.url));
const spikeRoot = join(testRoot, "..");
const fixturesRoot = join(spikeRoot, "fixtures");
const validateAccountMatrixCli = join(spikeRoot, "validate-account-matrix.mjs");
const matrixPath = join(spikeRoot, "..", "..", "docs", "spikes", "google-workspace", "account-matrix.json");
const temporaryRoots = [];
const sharedEnvText = [
  "VITE_GOOGLE_CLIENT_ID=synthetic.apps.googleusercontent.com",
  "VITE_ALLOWED_HD=molcube.com",
  "GOOGLE_SPIKE_AUTHORIZED_ORIGINS=http://localhost:5184,https://molroom.molcube.com",
  "GOOGLE_SPIKE_ORDINARY_ACCOUNT=ordinary@molcube.com",
  "GOOGLE_SPIKE_ADMIN_ACCOUNT=admin@molcube.com",
  "GOOGLE_SPIKE_ROOM_A_CALENDAR_ID=room-a@molcube.com",
  "GOOGLE_SPIKE_ROOM_B_CALENDAR_ID=room-b@molcube.com",
].join("\n");
const task5EnvText = [
  "GOOGLE_SPIKE_ORDINARY_ACCOUNT=ordinary@molcube.com",
  "GOOGLE_SPIKE_ADMIN_ACCOUNT=admin@molcube.com",
  "GOOGLE_SPIKE_ROOM_A_CALENDAR_ID=room-a@molcube.com",
  "GOOGLE_SPIKE_ROOM_B_CALENDAR_ID=room-b@molcube.com",
].join("\n");

async function writeAccountInput(path, contents, mode = 0o644) {
  await writeFile(path, contents, { mode });
}

async function createAccountCliInputs(root, envText = `${sharedEnvText}\n`) {
  const matrixFile = join(root, "account-matrix.json");
  const envFile = join(root, "operator.env");
  await writeAccountInput(matrixFile, `${JSON.stringify(matrix)}\n`);
  await writeAccountInput(envFile, envText, 0o600);
  return { matrixFile, envFile };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("account matrix contract", () => {
  it("validates the complete alias-only contract", () => {
    expect(validateAccountMatrix(matrix).rows).toHaveLength(8);
  });

  it("accepts the complete shared seven-key env while consuming the four matrix bindings", () => {
    expect(validateAccountMatrix(matrix, { envText: sharedEnvText })).toBe(matrix);
  });

  it("accepts the four Task 5 bindings without claiming provisioning readiness", () => {
    expect(validateAccountMatrix(matrix, { envText: task5EnvText })).toBe(matrix);
  });

  it.each([
    [
      "embedded tab",
      sharedEnvText.replace(
        "VITE_GOOGLE_CLIENT_ID=synthetic.apps.googleusercontent.com",
        "VITE_GOOGLE_CLIENT_ID=synthetic\t.apps.googleusercontent.com",
      ),
    ],
    [
      "bare carriage return",
      sharedEnvText.replace(
        "VITE_GOOGLE_CLIENT_ID=synthetic.apps.googleusercontent.com",
        "VITE_GOOGLE_CLIENT_ID=synthetic\r.apps.googleusercontent.com",
      ),
    ],
  ])("rejects lexical %s through the Task 5 public consumer", (_case, envText) => {
    expect(() => validateAccountMatrix(matrix, { envText })).toThrowError(
      expect.objectContaining({
        category: "INVALID_ACCOUNT_MATRIX_ENV",
        pointer: "/env",
      }),
    );
  });

  it.each([
    ["ordinary account", "GOOGLE_SPIKE_ORDINARY_ACCOUNT=ordinary@molcube.com", "/env/GOOGLE_SPIKE_ORDINARY_ACCOUNT"],
    ["admin account", "GOOGLE_SPIKE_ADMIN_ACCOUNT=admin@molcube.com", "/env/GOOGLE_SPIKE_ADMIN_ACCOUNT"],
    ["room A", "GOOGLE_SPIKE_ROOM_A_CALENDAR_ID=room-a@molcube.com", "/env/GOOGLE_SPIKE_ROOM_A_CALENDAR_ID"],
    ["room B", "GOOGLE_SPIKE_ROOM_B_CALENDAR_ID=room-b@molcube.com", "/env/GOOGLE_SPIKE_ROOM_B_CALENDAR_ID"],
  ])("requires the %s Task 5 binding", (_label, bindingLine, pointer) => {
    const envText = task5EnvText.replace(bindingLine, "");
    expect(() => validateAccountMatrix(matrix, { envText })).toThrowError(
      expect.objectContaining({
        category: "INVALID_ACCOUNT_MATRIX_ENV",
        pointer,
      }),
    );
  });

  it("rejects a truly unsupported shared env key at a non-sensitive pointer", () => {
    expect(() => validateAccountMatrix(matrix, {
      envText: `${sharedEnvText}\nGOOGLE_SPIKE_UNSUPPORTED=value`,
    })).toThrowError(expect.objectContaining({
      category: "INVALID_ACCOUNT_MATRIX_ENV",
      pointer: "/env/_unknown",
    }));
  });

  it("reports malformed lexical env through the account-matrix CLI without echoing it", async () => {
    const root = await mkdtemp(join(tmpdir(), "molroom-account-matrix-env-"));
    temporaryRoots.push(root);
    const envPath = join(root, "operator.env");
    const forbiddenValue = "ordinary@molcube.com";
    await writeFile(
      envPath,
      `export GOOGLE_SPIKE_ORDINARY_ACCOUNT=${forbiddenValue}\n${task5EnvText.replace("GOOGLE_SPIKE_ORDINARY_ACCOUNT=ordinary@molcube.com\n", "")}`,
      { mode: 0o600 },
    );

    const result = spawnSync(process.execPath, [
      validateAccountMatrixCli,
      matrixPath,
      envPath,
    ], { encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("INVALID_ACCOUNT_MATRIX_ENV pointer=/env\n");
    expect(`${result.stdout}${result.stderr}`).not.toContain(forbiddenValue);
  });

  it("accepts the public account-matrix CLI only with a private complete seven-key env", async () => {
    const root = await mkdtemp(join(tmpdir(), "molroom-account-matrix-cli-"));
    temporaryRoots.push(root);
    const { matrixFile, envFile } = await createAccountCliInputs(root);

    const result = spawnSync(process.execPath, [
      validateAccountMatrixCli,
      matrixFile,
      envFile,
    ], { encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("account-matrix-valid schemaVersion=1 status=UNBOUND\n");
    expect(result.stderr).toBe("");
  });

  it.each([
    [
      "embedded tab",
      sharedEnvText.replace(
        "VITE_GOOGLE_CLIENT_ID=synthetic.apps.googleusercontent.com",
        "VITE_GOOGLE_CLIENT_ID=synthetic\t.apps.googleusercontent.com",
      ),
    ],
    [
      "bare carriage return",
      sharedEnvText.replace(
        "VITE_GOOGLE_CLIENT_ID=synthetic.apps.googleusercontent.com",
        "VITE_GOOGLE_CLIENT_ID=synthetic\r.apps.googleusercontent.com",
      ),
    ],
  ])("keeps public account CLI lexical %s failures redacted", async (_case, envText) => {
    const root = await mkdtemp(join(tmpdir(), "molroom-account-matrix-control-"));
    temporaryRoots.push(root);
    const { matrixFile, envFile } = await createAccountCliInputs(root, `${envText}\n`);
    const result = spawnSync(process.execPath, [
      validateAccountMatrixCli,
      matrixFile,
      envFile,
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("INVALID_ACCOUNT_MATRIX_ENV pointer=/env\n");
    expect(`${result.stdout}${result.stderr}`).not.toContain("synthetic");
  });

  it("fails closed for account CLI symlink, overlarge, duplicate, and non-private inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "molroom-account-matrix-input-"));
    temporaryRoots.push(root);
    const { matrixFile, envFile } = await createAccountCliInputs(root);
    const linkedMatrixFile = join(root, "linked-account-matrix.json");
    const overlargeMatrixFile = join(root, "overlarge-account-matrix.json");
    const duplicateMatrixFile = join(root, "duplicate-account-matrix.json");
    const unsafeEnvFile = join(root, "unsafe.env");
    const directoryMatrixFile = join(root, "matrix-directory");
    await symlink(matrixFile, linkedMatrixFile);
    await writeAccountInput(overlargeMatrixFile, " ".repeat(16 * 1024 + 1));
    await writeAccountInput(
      duplicateMatrixFile,
      `${JSON.stringify(matrix).replace(
        '"schemaVersion":1',
        String.raw`"schemaVersion":1,"schema\u0056ersion":1`,
      )}\n`,
    );
    await writeAccountInput(unsafeEnvFile, `${sharedEnvText}\n`, 0o600);
    await chmod(unsafeEnvFile, 0o644);
    await mkdir(directoryMatrixFile, { mode: 0o700 });

    const cases = [
      [linkedMatrixFile, envFile, "ACCOUNT_MATRIX_PATH_NOT_READABLE", "/matrixFile"],
      [overlargeMatrixFile, envFile, "ACCOUNT_MATRIX_PATH_TOO_LARGE", "/matrixFile"],
      [duplicateMatrixFile, envFile, "INVALID_ACCOUNT_MATRIX_JSON", "/matrix"],
      [directoryMatrixFile, envFile, "ACCOUNT_MATRIX_PATH_NOT_REGULAR", "/matrixFile"],
      [matrixFile, unsafeEnvFile, "ACCOUNT_MATRIX_PATH_NOT_PRIVATE", "/envFile"],
    ];
    for (const [candidateMatrix, candidateEnv, category, pointer] of cases) {
      const result = spawnSync(process.execPath, [
        validateAccountMatrixCli,
        candidateMatrix,
        candidateEnv,
      ], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(`${category} pointer=${pointer}\n`);
    }
  });

  it("rejects an ordinary/admin identity collapse from local bindings", () => {
    const sameAccountEnv = sharedEnvText.replace(
      "GOOGLE_SPIKE_ADMIN_ACCOUNT=admin@molcube.com",
      "GOOGLE_SPIKE_ADMIN_ACCOUNT=ordinary@molcube.com",
    );
    let caught;
    try {
      validateAccountMatrix(matrix, { envText: sameAccountEnv });
    } catch (error) {
      caught = error;
    }
    expect(caught).toEqual(expect.objectContaining({
      category: "INVALID_ACCOUNT_MATRIX_ENV",
      pointer: "/env/accounts/distinct",
    }));
    expect(String(caught)).not.toContain("ordinary@molcube.com");
  });

  it("rejects non-canonical bound account or room identifiers without echoing them", () => {
    const envText = sharedEnvText.replace(
      "GOOGLE_SPIKE_ORDINARY_ACCOUNT=ordinary@molcube.com",
      "GOOGLE_SPIKE_ORDINARY_ACCOUNT=ordinary@Example.com",
    );
    expect(() => validateAccountMatrix(matrix, { envText })).toThrow(AccountMatrixError);
  });

  it.each([
    ["duplicate env key", `${sharedEnvText}\nGOOGLE_SPIKE_ORDINARY_ACCOUNT=other@molcube.com`, "/env"],
    ["export prefix", sharedEnvText.replace("VITE_GOOGLE_CLIENT_ID=", "export VITE_GOOGLE_CLIENT_ID="), "/env"],
    ["quoted env value", sharedEnvText.replace("GOOGLE_SPIKE_ORDINARY_ACCOUNT=ordinary@molcube.com", "GOOGLE_SPIKE_ORDINARY_ACCOUNT='ordinary@molcube.com'"), "/env"],
    ["interpolated env value", sharedEnvText.replace("VITE_GOOGLE_CLIENT_ID=synthetic.apps.googleusercontent.com", "VITE_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"), "/env"],
    ["control character", `${sharedEnvText}\n#\u0000`, "/env"],
    ["oversized env", `${sharedEnvText}\n#${"x".repeat(16 * 1024)}`, "/env"],
    ["whitespace env value", sharedEnvText.replace("GOOGLE_SPIKE_ORDINARY_ACCOUNT=ordinary@molcube.com", "GOOGLE_SPIKE_ORDINARY_ACCOUNT=ordinary@molcube.com "), "/env"],
  ])("rejects %s", (_label, envText, pointer) => {
    expect(() => validateAccountMatrix(matrix, { envText })).toThrowError(
      expect.objectContaining({ category: "INVALID_ACCOUNT_MATRIX_ENV", pointer }),
    );
  });

  it("rejects a browser profile reused across account roles", () => {
    const value = structuredClone(matrix);
    value.accounts[1].browserProfiles[0] = value.accounts[0].browserProfiles[0];
    expect(() => validateAccountMatrix(value)).toThrowError(expect.objectContaining({
      category: "INVALID_ACCOUNT_MATRIX",
      pointer: "/accounts/1/browserProfiles/0",
    }));
  });

  it("rejects a non-canonical browser profile even when it is globally unique", () => {
    const value = structuredClone(matrix);
    value.accounts[1].browserProfiles[0] = "admin-firefox-desktop";
    expect(() => validateAccountMatrix(value)).toThrowError(expect.objectContaining({
      category: "INVALID_ACCOUNT_MATRIX",
      pointer: "/accounts/1/browserProfiles/0",
    }));
  });

  it("rejects non-canonical mutable fixture IDs so real meetings cannot be selected", () => {
    const value = structuredClone(matrix);
    value.fixtures[0].mutableId = "external-event-id";
    expect(() => validateAccountMatrix(value)).toThrowError(expect.objectContaining({
      category: "INVALID_ACCOUNT_MATRIX",
      pointer: "/fixtures/0/mutableId",
    }));
  });

  it("rejects fixture sets that diverge from the six-tuple evidence schema", () => {
    const value = structuredClone(matrix);
    value.fixtures.push({
      alias: "extra-test-fixture",
      mutableId: "fixture:extra-test-fixture",
      owner: "ordinary",
      room: "room-a",
    });
    expect(() => validateAccountMatrix(value)).toThrowError(expect.objectContaining({
      category: "INVALID_ACCOUNT_MATRIX",
      pointer: "/fixtures",
    }));
  });

  it("rejects a row tuple that diverges from the evidence schema", () => {
    const value = structuredClone(matrix);
    value.rows[0].concurrencyGroup = "different-read-group";
    expect(() => validateAccountMatrix(value)).toThrowError(expect.objectContaining({
      category: "INVALID_ACCOUNT_MATRIX",
      pointer: "/rows/0/concurrencyGroup",
    }));
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
    ["same account alias", (value) => ({ ...value, accounts: value.accounts.map((account) => account.alias === "room-writer-admin" ? { ...account, bindingAlias: "account:ordinary" } : account) })],
    ["ordinary writer", (value) => ({ ...value, accounts: value.accounts.map((account) => account.alias === "ordinary" ? { ...account, roomWriter: true } : account) })],
    ["shared mutable fixture", (value) => ({ ...value, fixtures: value.fixtures.map((fixture, index) => index === 1 ? { ...fixture, mutableId: value.fixtures[0].mutableId } : fixture) })],
    ["wrong cleanup owner", (value) => ({ ...value, rows: value.rows.map((row) => row.alias === "ordinary-room-copy-write" ? { ...row, cleanupOwner: "room-writer-admin" } : row) })],
    ["wrong conflict room", (value) => ({ ...value, rows: value.rows.map((row) => row.alias === "two-browser-conflict-b" ? { ...row, resource: "room-a" } : row) })],
  ])("rejects %s", (_label, mutate) => {
    expect(() => validateAccountMatrix(mutate(structuredClone(matrix)))).toThrow(AccountMatrixError);
  });

  it.each([
    ["same user", "account-matrix-invalid-same-user.json", "/accounts/1/bindingAlias"],
    ["ordinary writer", "account-matrix-invalid-writer.json", "/accounts/0/roomWriter"],
    ["shared mutable fixture", "account-matrix-invalid-shared-fixture.json", "/fixtures/1/mutableId"],
  ])("rejects the committed %s fixture through the CLI", (_label, fixtureName, pointer) => {
    const result = spawnSync(process.execPath, [
      validateAccountMatrixCli,
      join(fixturesRoot, fixtureName),
    ], { encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`INVALID_ACCOUNT_MATRIX pointer=${pointer}\n`);
  });
});
