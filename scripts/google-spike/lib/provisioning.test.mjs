import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { validateEvidence } from "./evidence.mjs";
import {
  assertProvisioningReady,
  createProvisioningEvidence,
  parseProvisioningEnv,
  validateProvisioningReceipt,
} from "./provisioning.mjs";

const testRoot = dirname(fileURLToPath(import.meta.url));
const spikeRoot = join(testRoot, "..");
const validateProvisioningCli = join(spikeRoot, "validate-provisioning.mjs");
const provisioningGuide = join(
  spikeRoot,
  "..",
  "..",
  "docs",
  "spikes",
  "google-workspace",
  "provisioning.md",
);
const temporaryRoots = [];
const accountSeparator = String.fromCharCode(64);
const hostedDomain = ["molcube", "com"].join(".");
const clientId = [
  "123456789012-fixtureclienta1b2c3d4",
  "apps",
  "googleusercontent",
  "com",
].join(".");

const safeEnvValues = Object.freeze({
  VITE_GOOGLE_CLIENT_ID: clientId,
  VITE_ALLOWED_HD: hostedDomain,
  GOOGLE_SPIKE_AUTHORIZED_ORIGINS:
    "http://localhost:5184,https://molroom.molcube.com",
  GOOGLE_SPIKE_ORDINARY_ACCOUNT: ["ordinary.fixture", hostedDomain].join(accountSeparator),
  GOOGLE_SPIKE_ADMIN_ACCOUNT: ["admin.fixture", hostedDomain].join(accountSeparator),
  GOOGLE_SPIKE_ROOM_A_CALENDAR_ID: ["fixture-room-a", hostedDomain].join(accountSeparator),
  GOOGLE_SPIKE_ROOM_B_CALENDAR_ID: ["fixture-room-b", hostedDomain].join(accountSeparator),
});

const unobservedReceipt = {
  schemaVersion: 1,
  observation: "UNOBSERVED",
  appType: "UNOBSERVED",
  domain: "MOLCUBE_COM",
  clientIdSuffix: "UNOBSERVED",
  workspaceEdition: "UNOBSERVED",
  enabledApis: {
    calendar: false,
    drive: false,
    people: false,
  },
  initialScopes: {
    calendarEvents: false,
    calendarReadonly: false,
    driveAppdata: false,
  },
  directoryScopeTiming: "DEFERRED_TO_TASK_11",
  origins: {
    localhostSpike: false,
    production: false,
  },
  accounts: {
    ordinary: {
      alias: "ordinary",
      present: false,
    },
    roomWriterAdmin: {
      alias: "room-writer-admin",
      present: false,
    },
    distinct: false,
  },
  rooms: [
    {
      alias: "room-a",
      present: false,
      domainReadAcl: false,
      ordinaryRoomWriter: false,
      adminRoomWriter: false,
      autoAccept: "UNOBSERVED",
    },
    {
      alias: "room-b",
      present: false,
      domainReadAcl: false,
      ordinaryRoomWriter: false,
      adminRoomWriter: false,
      autoAccept: "UNOBSERVED",
    },
  ],
  tenantPolicy: "UNOBSERVED",
  operatorVerified: false,
};

const completeReceipt = {
  ...unobservedReceipt,
  observation: "OPERATOR_OBSERVED",
  observedAt: "2026-08-23T00:00:00.000Z",
  appType: "INTERNAL",
  clientIdSuffix: "a1b2c3d4",
  workspaceEdition: "BUSINESS",
  enabledApis: {
    calendar: true,
    drive: true,
    people: true,
  },
  initialScopes: {
    calendarEvents: true,
    calendarReadonly: true,
    driveAppdata: true,
  },
  origins: {
    localhostSpike: true,
    production: true,
  },
  accounts: {
    ordinary: {
      alias: "ordinary",
      present: true,
    },
    roomWriterAdmin: {
      alias: "room-writer-admin",
      present: true,
    },
    distinct: true,
  },
  rooms: unobservedReceipt.rooms.map((room) => ({
    ...room,
    present: true,
    domainReadAcl: true,
    adminRoomWriter: true,
    autoAccept: "ENABLED",
  })),
  tenantPolicy: "ALLOWED",
  operatorVerified: true,
};

function envText(values = safeEnvValues) {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

function expectPolicyFailure(action, category, pointer, forbiddenValues = []) {
  try {
    action();
    throw new Error("expected provisioning policy rejection");
  } catch (error) {
    expect(error).toEqual(expect.objectContaining({ category, pointer }));
    for (const value of forbiddenValues) {
      expect(error.message).not.toContain(value);
    }
  }
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [validateProvisioningCli, ...args], {
    cwd: join(spikeRoot, "..", ".."),
    encoding: "utf8",
    ...options,
  });
}

async function writePrivate(path, contents) {
  await writeFile(path, contents, { mode: 0o600 });
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("Google Workspace provisioning policy", () => {
  it("parses only the exact dotenv contract and recursively freezes it", () => {
    const parsed = parseProvisioningEnv(`# operator-owned values\n\n${envText()}`);

    expect(parsed).toEqual(safeEnvValues);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.keys(parsed)).toEqual(Object.keys(safeEnvValues));
  });

  it("rejects a receipt with escaped-equivalent duplicate keys without echoing receipt material", async () => {
    const root = await mkdtemp(join(tmpdir(), "molroom-provisioning-duplicate-"));
    temporaryRoots.push(root);
    const envPath = join(root, "operator.env");
    const receiptPath = join(root, "operator-receipt.json");
    await writePrivate(envPath, envText());
    await writePrivate(
      receiptPath,
      JSON.stringify(completeReceipt).replace(
        '"schemaVersion":1',
        String.raw`"schemaVersion":1,"schema\u0056ersion":1`,
      ),
    );

    const result = runCli([envPath, receiptPath]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("INVALID_PROVISIONING_RECEIPT_JSON pointer=/receipt\n");
    expect(result.stderr).not.toContain("schemaVersion");
    expect(result.stderr).not.toContain(completeReceipt.workspaceEdition);
  });

  it.each([
    ["unknown key", `${envText()}GOOGLE_SPIKE_UNEXPECTED=value\n`],
    [
      "duplicate key",
      `${envText()}VITE_ALLOWED_HD=${safeEnvValues.VITE_ALLOWED_HD}\n`,
    ],
    [
      "missing key",
      envText(
        Object.fromEntries(
          Object.entries(safeEnvValues).filter(([key]) => key !== "VITE_ALLOWED_HD"),
        ),
      ),
    ],
    ["export statement", `export ${envText()}`],
    ["quoted value", envText({ ...safeEnvValues, VITE_ALLOWED_HD: `"${hostedDomain}"` })],
    ["interpolation", envText({ ...safeEnvValues, VITE_ALLOWED_HD: "${NOT_ALLOWED}" })],
    ["bare interpolation", envText({ ...safeEnvValues, VITE_ALLOWED_HD: "$NOT_ALLOWED" })],
    ["command quoting", envText({ ...safeEnvValues, VITE_ALLOWED_HD: "`NOT_ALLOWED`" })],
    ["control byte", `${envText()}\u0000`],
  ])("rejects %s without echoing local values", (_case, contents) => {
    expectPolicyFailure(
      () => parseProvisioningEnv(contents),
      "INVALID_PROVISIONING_ENV",
      "/env",
      Object.values(safeEnvValues),
    );
  });

  it("rejects wrong client/domain/origin/account/room env facts", () => {
    const cases = [
      {
        values: { ...safeEnvValues, VITE_GOOGLE_CLIENT_ID: "not-a-web-client" },
        pointer: "/clientIdSuffix",
      },
      {
        values: { ...safeEnvValues, VITE_ALLOWED_HD: "example.invalid" },
        pointer: "/domain",
      },
      {
        values: {
          ...safeEnvValues,
          GOOGLE_SPIKE_AUTHORIZED_ORIGINS: "http://localhost:5184",
        },
        pointer: "/origins",
      },
      {
        values: {
          ...safeEnvValues,
          GOOGLE_SPIKE_ADMIN_ACCOUNT: safeEnvValues.GOOGLE_SPIKE_ORDINARY_ACCOUNT,
        },
        pointer: "/accounts/distinct",
      },
      {
        values: {
          ...safeEnvValues,
          GOOGLE_SPIKE_ROOM_B_CALENDAR_ID:
            safeEnvValues.GOOGLE_SPIKE_ROOM_A_CALENDAR_ID,
        },
        pointer: "/rooms",
      },
    ];

    for (const { values, pointer } of cases) {
      expectPolicyFailure(
        () => parseProvisioningEnv(envText(values)),
        "INVALID_PROVISIONING_ENV",
        pointer,
        Object.values(values),
      );
    }
  });

  it.each([
    [
      "uppercase ordinary account",
      {
        ...safeEnvValues,
        GOOGLE_SPIKE_ORDINARY_ACCOUNT: ["Ordinary.fixture", hostedDomain].join(
          accountSeparator,
        ),
      },
      "/accounts/ordinary",
    ],
    [
      "uppercase account domain",
      {
        ...safeEnvValues,
        GOOGLE_SPIKE_ADMIN_ACCOUNT: ["admin.fixture", "Molcube.com"].join(
          accountSeparator,
        ),
      },
      "/accounts/roomWriterAdmin",
    ],
    [
      "uppercase room calendar",
      {
        ...safeEnvValues,
        GOOGLE_SPIKE_ROOM_A_CALENDAR_ID: ["Fixture-room-a", hostedDomain].join(
          accountSeparator,
        ),
      },
      "/rooms/0",
    ],
    [
      "leading dot",
      {
        ...safeEnvValues,
        GOOGLE_SPIKE_ORDINARY_ACCOUNT: [".ordinary", hostedDomain].join(
          accountSeparator,
        ),
      },
      "/accounts/ordinary",
    ],
    [
      "consecutive dots",
      {
        ...safeEnvValues,
        GOOGLE_SPIKE_ADMIN_ACCOUNT: ["admin..fixture", hostedDomain].join(
          accountSeparator,
        ),
      },
      "/accounts/roomWriterAdmin",
    ],
    [
      "trailing dot",
      {
        ...safeEnvValues,
        GOOGLE_SPIKE_ROOM_B_CALENDAR_ID: ["fixture-room-b.", hostedDomain].join(
          accountSeparator,
        ),
      },
      "/rooms/1",
    ],
  ])("rejects non-canonical %s identifiers", (_case, values, pointer) => {
    expectPolicyFailure(
      () => parseProvisioningEnv(envText(values)),
      "INVALID_PROVISIONING_ENV",
      pointer,
      Object.values(values),
    );
  });

  it("validates the closed receipt and rejects derived or nested unknown fields", () => {
    const validated = validateProvisioningReceipt(completeReceipt);
    expect(validated).toEqual(completeReceipt);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.accounts.ordinary)).toBe(true);
    expect(Object.isFrozen(validated.rooms)).toBe(true);

    expectPolicyFailure(
      () => validateProvisioningReceipt({ ...completeReceipt, status: "COMPLETE" }),
      "FORBIDDEN_EVIDENCE_FIELD",
      "/_unknown",
    );

    const { workspaceEdition: _missing, ...missingRequired } = completeReceipt;
    expectPolicyFailure(
      () => validateProvisioningReceipt(missingRequired),
      "INVALID_EVIDENCE_SHAPE",
      "/workspaceEdition",
    );

    const nestedCases = [
      ["enabledApis", "/enabledApis/_unknown"],
      ["initialScopes", "/initialScopes/_unknown"],
      ["origins", "/origins/_unknown"],
      ["accounts", "/accounts/_unknown"],
    ];
    for (const [field, pointer] of nestedCases) {
      const nestedUnknown = structuredClone(completeReceipt);
      nestedUnknown[field].unexpected = "fixture-private-material";
      expectPolicyFailure(
        () => validateProvisioningReceipt(nestedUnknown),
        "FORBIDDEN_EVIDENCE_FIELD",
        pointer,
        [nestedUnknown[field].unexpected],
      );
    }

    for (const [mutate, pointer] of [
      [
        (value) => (value.accounts.ordinary.unexpected = "fixture-private-material"),
        "/accounts/ordinary/_unknown",
      ],
      [
        (value) => (value.rooms[0].unexpected = "fixture-private-material"),
        "/rooms/0/_unknown",
      ],
    ]) {
      const nestedUnknown = structuredClone(completeReceipt);
      mutate(nestedUnknown);
      expectPolicyFailure(
        () => validateProvisioningReceipt(nestedUnknown),
        "FORBIDDEN_EVIDENCE_FIELD",
        pointer,
        ["fixture-private-material"],
      );
    }
  });

  it("derives a complete immutable evidence record without retaining raw env values", () => {
    const env = parseProvisioningEnv(envText());
    const evidence = createProvisioningEvidence(env, completeReceipt);
    const serialized = JSON.stringify(evidence);

    expect(evidence.status).toBe("COMPLETE");
    expect(evidence.capability).toBe("SUPPORTED");
    expect(evidence.kind).toBe("provisioning");
    expect(assertProvisioningReady(evidence)).toBe("COMPLETE");
    expect(validateEvidence(evidence)).toBe(evidence);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.rooms[0])).toBe(true);
    for (const value of Object.values(safeEnvValues)) {
      expect(serialized).not.toContain(value);
    }
  });

  it("keeps an unobserved receipt honestly incomplete", () => {
    const evidence = createProvisioningEvidence(
      parseProvisioningEnv(envText()),
      unobservedReceipt,
    );

    expect(evidence.status).toBe("INCOMPLETE");
    expect(evidence.capability).toBe("INCONCLUSIVE");
    expectPolicyFailure(
      () => assertProvisioningReady(evidence),
      "PROVISIONING_INCOMPLETE",
      "/observation",
    );
  });

  it.each([
    ["external app", (value) => (value.appType = "EXTERNAL"), "/appType"],
    [
      "missing API",
      (value) => (value.enabledApis.calendar = false),
      "/enabledApis/calendar",
    ],
    [
      "missing scope",
      (value) => (value.initialScopes.calendarReadonly = false),
      "/initialScopes/calendarReadonly",
    ],
    [
      "missing origin",
      (value) => (value.origins.production = false),
      "/origins/production",
    ],
    [
      "missing room",
      (value) => (value.rooms[0].present = false),
      "/rooms/0/present",
    ],
    [
      "missing domain read",
      (value) => (value.rooms[0].domainReadAcl = false),
      "/rooms/0/domainReadAcl",
    ],
    [
      "ordinary writer",
      (value) => (value.rooms[0].ordinaryRoomWriter = true),
      "/rooms/0/ordinaryRoomWriter",
    ],
    [
      "missing admin writer",
      (value) => (value.rooms[0].adminRoomWriter = false),
      "/rooms/0/adminRoomWriter",
    ],
    [
      "unobserved auto accept",
      (value) => (value.rooms[0].autoAccept = "UNOBSERVED"),
      "/rooms/0/autoAccept",
    ],
    [
      "missing account",
      (value) => (value.accounts.ordinary.present = false),
      "/accounts/ordinary/present",
    ],
    [
      "accounts not distinct",
      (value) => (value.accounts.distinct = false),
      "/accounts/distinct",
    ],
  ])("reports the first fixed missing fact for %s", (_case, mutate, pointer) => {
    const receipt = structuredClone(completeReceipt);
    mutate(receipt);
    const evidence = createProvisioningEvidence(parseProvisioningEnv(envText()), receipt);

    expect(evidence.status).toBe("INCOMPLETE");
    expectPolicyFailure(
      () => assertProvisioningReady(evidence),
      "PROVISIONING_INCOMPLETE",
      pointer,
    );
  });

  it("gives an observed tenant block precedence over generic incompleteness", () => {
    const receipt = {
      ...structuredClone(unobservedReceipt),
      observation: "OPERATOR_OBSERVED",
      observedAt: "2026-08-23T00:00:00.000Z",
      tenantPolicy: "BLOCKED",
      operatorVerified: true,
    };
    const evidence = createProvisioningEvidence(parseProvisioningEnv(envText()), receipt);

    expect(evidence.status).toBe("TENANT_POLICY_BLOCKED");
    expect(evidence.capability).toBe("TENANT_BLOCKED");
    expectPolicyFailure(
      () => assertProvisioningReady(evidence),
      "TENANT_POLICY_BLOCKED",
      "/tenantPolicy",
    );
  });

  it("requires the redacted client suffix to correlate with the env client", () => {
    const receipt = { ...completeReceipt, clientIdSuffix: "z9y8x7w6" };
    expectPolicyFailure(
      () => createProvisioningEvidence(parseProvisioningEnv(envText()), receipt),
      "PROVISIONING_ENV_MISMATCH",
      "/clientIdSuffix",
      [clientId, receipt.clientIdSuffix],
    );
  });

  it("keeps readiness and redacted-emission CLI output exact and secret-free", async () => {
    const root = await mkdtemp(join(tmpdir(), "molroom-provisioning-cli-"));
    temporaryRoots.push(root);
    const envPath = join(root, "operator.env");
    const receiptPath = join(root, "operator-receipt.json");
    await writePrivate(envPath, envText());
    await writePrivate(receiptPath, `${JSON.stringify(completeReceipt)}\n`);

    const ready = runCli([envPath, receiptPath]);
    expect(ready.status).toBe(0);
    expect(ready.stdout).toBe("provisioning-valid schemaVersion=1 status=COMPLETE\n");
    expect(ready.stderr).toBe("");

    const emitted = runCli(["--emit-redacted", envPath, receiptPath]);
    expect(emitted.status).toBe(0);
    expect(emitted.stderr).toBe("");
    const evidence = JSON.parse(emitted.stdout);
    expect(validateEvidence(evidence)).toEqual(evidence);
    expect(evidence.status).toBe("COMPLETE");
    for (const value of Object.values(safeEnvValues)) {
      expect(`${ready.stdout}${ready.stderr}${emitted.stdout}${emitted.stderr}`).not.toContain(
        value,
      );
    }
  });

  it("emits an honest incomplete record but keeps readiness mode nonzero", async () => {
    const root = await mkdtemp(join(tmpdir(), "molroom-provisioning-incomplete-"));
    temporaryRoots.push(root);
    const envPath = join(root, "operator.env");
    const receiptPath = join(root, "operator-receipt.json");
    await writePrivate(envPath, envText());
    await writePrivate(receiptPath, `${JSON.stringify(unobservedReceipt)}\n`);

    const ready = runCli([envPath, receiptPath]);
    expect(ready.status).not.toBe(0);
    expect(ready.stdout).toBe("");
    expect(ready.stderr).toBe("PROVISIONING_INCOMPLETE pointer=/observation\n");

    const emitted = runCli(["--emit-redacted", envPath, receiptPath]);
    expect(emitted.status).toBe(0);
    const evidence = JSON.parse(emitted.stdout);
    expect(evidence.status).toBe("INCOMPLETE");
    expect(evidence.observation).toBe("UNOBSERVED");
  });

  it("fails closed for unsafe, malformed, non-regular, missing, and overlarge inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "molroom-provisioning-files-"));
    temporaryRoots.push(root);
    const envPath = join(root, "valid.env");
    const receiptPath = join(root, "valid-receipt.json");
    const unsafeEnvPath = join(root, "unsafe.env");
    const unsafeReceiptPath = join(root, "unsafe-receipt.json");
    const symlinkPath = join(root, "linked.env");
    const directoryPath = join(root, "directory.env");
    const malformedEnvPath = join(root, "malformed.env");
    const malformedReceiptPath = join(root, "malformed-receipt.json");
    const invalidUtf8Path = join(root, "invalid-utf8.env");
    const overlargePath = join(root, "overlarge.env");
    const missingPath = join(root, "missing.env");
    await writePrivate(envPath, envText());
    await writePrivate(receiptPath, `${JSON.stringify(completeReceipt)}\n`);
    await writePrivate(unsafeEnvPath, envText());
    await chmod(unsafeEnvPath, 0o644);
    await writePrivate(unsafeReceiptPath, `${JSON.stringify(completeReceipt)}\n`);
    await chmod(unsafeReceiptPath, 0o644);
    await symlink(envPath, symlinkPath);
    await mkdir(directoryPath, { mode: 0o700 });
    await writePrivate(malformedEnvPath, "not-a-dotenv-assignment\n");
    await writePrivate(malformedReceiptPath, "{\n");
    await writePrivate(invalidUtf8Path, Buffer.from([0xff]));
    await writePrivate(overlargePath, `#${"x".repeat(16 * 1024)}\n`);

    const cases = [
      [unsafeEnvPath, receiptPath, "PROVISIONING_PATH_NOT_PRIVATE", "/envFile"],
      [envPath, unsafeReceiptPath, "PROVISIONING_PATH_NOT_PRIVATE", "/receiptFile"],
      [symlinkPath, receiptPath, "PROVISIONING_PATH_NOT_READABLE", "/envFile"],
      [directoryPath, receiptPath, "PROVISIONING_PATH_NOT_REGULAR", "/envFile"],
      [missingPath, receiptPath, "PROVISIONING_PATH_NOT_READABLE", "/envFile"],
      [overlargePath, receiptPath, "PROVISIONING_PATH_TOO_LARGE", "/envFile"],
      [invalidUtf8Path, receiptPath, "PROVISIONING_PATH_NOT_UTF8", "/envFile"],
      [malformedEnvPath, receiptPath, "INVALID_PROVISIONING_ENV", "/env"],
      [envPath, malformedReceiptPath, "INVALID_PROVISIONING_RECEIPT_JSON", "/receipt"],
    ];

    for (const [candidateEnv, candidateReceipt, category, pointer] of cases) {
      const result = runCli([candidateEnv, candidateReceipt]);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(`${category} pointer=${pointer}\n`);
      for (const value of Object.values(safeEnvValues)) {
        expect(`${result.stdout}${result.stderr}`).not.toContain(value);
      }
    }
  });

  it("rejects a FIFO without waiting for a writer", async () => {
    const root = await mkdtemp(join(tmpdir(), "molroom-provisioning-fifo-"));
    temporaryRoots.push(root);
    const fifoPath = join(root, "operator.env");
    const receiptPath = join(root, "operator-receipt.json");
    await writePrivate(receiptPath, `${JSON.stringify(completeReceipt)}\n`);
    const created = spawnSync("mkfifo", [fifoPath], { encoding: "utf8" });
    expect(created.status).toBe(0);

    const result = runCli([fifoPath, receiptPath], {
      timeout: 1_500,
      killSignal: "SIGTERM",
    });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("PROVISIONING_PATH_NOT_REGULAR pointer=/envFile\n");
  });

  it("documents a private, captured temporary path for redacted output", async () => {
    const guide = await readFile(provisioningGuide, "utf8");

    expect(guide).toContain("umask 077");
    expect(guide).toContain("mktemp -d");
    expect(guide).toContain("trap '");
    expect(guide).toContain('provisioning_tmp_file="$provisioning_tmp_dir/provisioning.json"');
    expect(guide).not.toContain("/tmp/molroom-provisioning-redacted.json");
  });

  it("rejects invalid CLI arguments without exposing them", () => {
    const result = runCli(["--emit-redacted", "only-one-path"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("INVALID_PROVISIONING_ARGUMENTS pointer=/\n");
    expect(`${result.stdout}${result.stderr}`).not.toContain("only-one-path");
  });
});
