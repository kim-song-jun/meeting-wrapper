import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  EvidencePolicyError,
  containsSensitiveMaterial,
  hashLocator,
  parseStrictJson,
  redactEvidence,
  validateEvidence,
  validateManifest,
  GOOGLE_ENDPOINT_TEMPLATES,
} from "./evidence.mjs";
import accountMatrix from "../../../docs/spikes/google-workspace/account-matrix.json" with { type: "json" };

const testRoot = dirname(fileURLToPath(import.meta.url));
const spikeRoot = join(testRoot, "..");
const fixturesRoot = join(spikeRoot, "fixtures");
const schemasRoot = join(spikeRoot, "schemas");
const validateEvidenceCli = join(spikeRoot, "validate-evidence.mjs");
const scanSensitivePathsCli = join(spikeRoot, "scan-sensitive-paths.mjs");
const temporaryRoots = [];

const safeEvidence = {
  schemaVersion: 1,
  probeId: "fixture-safe",
  runId: "run-fixture-001",
  candidateSha: "0123456789abcdef0123456789abcdef01234567",
  observedAt: "2026-08-22T00:00:00.000Z",
  roleAlias: "ordinary",
  browserAlias: "chrome-desktop",
  deviceAlias: "desktop",
  aliases: {
    account: "ordinary",
    room: "room-a",
    calendar: "room-a-calendar",
  },
  operationId: "operation-fixture-001",
  endpoint: "https://www.googleapis.com/calendar/v3/calendars/{calendar}/events",
  httpStatus: 200,
  googleRequestId: "request-fixture-001",
  capability: "SUPPORTED",
  result: "SUCCESS",
  responseCounts: { items: 1 },
  fieldPresence: { sharedProperty: true },
  locatorHashes: {
    event: "sha256:4e738ca5563c06cfd0018299933d58db1dd8bf97f6973dc99bf6cdc64b5550bd",
  },
  teardownStatus: "NOT_REQUIRED",
  notes: ["FIXTURE"],
};

const fullGoogleClientId = [
  "123456789012-fixtureclienta1b2c3d4",
  "apps",
  "googleusercontent",
  "com",
].join(".");

const credentialCorpus = [
  "AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q",
  "AKIA1234567890ABCDEF",
  '{"AWS_SECRET_ACCESS_KEY":"abcdefghijklmnopqrstuvwxzy12345678901234567890"}',
  "AWS_SESSION_TOKEN='IQoJb3JpZ2luX2VjEAEaCXVzLWVhc3QtMQJHMEUCIQ'",
  "-----BEGIN PRIVATE KEY-----",
  fullGoogleClientId,
];

const unobservedProvisioningEvidence = {
  schemaVersion: 1,
  kind: "provisioning",
  probeId: "provisioning",
  status: "INCOMPLETE",
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
  capability: "INCONCLUSIVE",
};

const completeProvisioningEvidence = {
  ...unobservedProvisioningEvidence,
  status: "COMPLETE",
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
  rooms: unobservedProvisioningEvidence.rooms.map((room) => ({
    ...room,
    present: true,
    domainReadAcl: true,
    adminRoomWriter: true,
    autoAccept: "ENABLED",
  })),
  tenantPolicy: "ALLOWED",
  operatorVerified: true,
  capability: "SUPPORTED",
};

const safeManifest = {
  schemaVersion: 1,
  candidateSha: "0123456789abcdef0123456789abcdef01234567",
  generatedAt: "2026-08-22T00:00:00.000Z",
  harnessCommitSha: "89abcdef0123456789abcdef0123456789abcdef",
  probeCommitShas: { "gis-lifecycle": "fedcba9876543210fedcba9876543210fedcba98" },
  officialDocs: ["https://developers.google.com/identity/oauth2/web/guides/how-user-authz-works"],
  coverage: [
    {
      roleAlias: "ordinary",
      browserAlias: "chrome-desktop",
      deviceAlias: "desktop",
      status: "COMPLETE",
    },
  ],
  evidence: [
    {
      probeId: "gis-lifecycle",
      path: "docs/spikes/google-workspace/evidence/gis-lifecycle.json",
      sha256: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      capability: "SUPPORTED",
    },
  ],
  architectureTriggers: [],
  teardownStatus: "COMPLETE",
};

function runNode(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: join(spikeRoot, "..", ".."),
    encoding: "utf8",
  });
}

function expectRedactedFailure(result, category, forbiddenValue) {
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}${result.stderr}`).toContain(category);
  expect(`${result.stdout}${result.stderr}`).not.toContain(forbiddenValue);
}

function matchesSchemaDateTimeFormat(value) {
  const [datePart, timePartWithZone] = value.split("T");
  if (!datePart || !timePartWithZone?.endsWith("Z")) return false;
  const [yearText, monthText, dayText] = datePart.split("-");
  const [hourText, minuteText, secondAndFraction] = timePartWithZone
    .slice(0, -1)
    .split(":");
  const [secondText] = secondAndFraction?.split(".") ?? [];
  if (
    !yearText ||
    !monthText ||
    !dayText ||
    !hourText ||
    !minuteText ||
    !secondText
  ) {
    return false;
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1] &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  );
}

function acceptsTimestampSchema(timestampDefinition, value) {
  return (
    timestampDefinition.type === "string" &&
    timestampDefinition.format === "date-time" &&
    new RegExp(timestampDefinition.pattern).test(value) &&
    matchesSchemaDateTimeFormat(value)
  );
}

function schemaDeepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function resolveLocalSchemaRef(root, reference) {
  if (typeof reference !== "string" || !reference.startsWith("#/")) return undefined;
  return reference.slice(2).split("/").reduce(
    (value, segment) => value?.[segment.replace(/~1/g, "/").replace(/~0/g, "~")],
    root,
  );
}

function matchesJsonSchema(instance, definition, root) {
  if (definition === true) return true;
  if (definition === false || typeof definition !== "object" || definition === null) return false;
  if (definition.$ref && !matchesJsonSchema(instance, resolveLocalSchemaRef(root, definition.$ref), root)) {
    return false;
  }
  if (Object.hasOwn(definition, "const") && !schemaDeepEqual(instance, definition.const)) return false;
  if (definition.enum && !definition.enum.some((value) => schemaDeepEqual(instance, value))) return false;
  if (definition.type) {
    const typeMatches = {
      array: Array.isArray(instance),
      boolean: typeof instance === "boolean",
      integer: Number.isInteger(instance),
      object: typeof instance === "object" && instance !== null && !Array.isArray(instance),
      string: typeof instance === "string",
    };
    if (!typeMatches[definition.type]) return false;
  }
  if (definition.pattern && (typeof instance !== "string" || !new RegExp(definition.pattern).test(instance))) {
    return false;
  }
  if (definition.minLength !== undefined && (typeof instance !== "string" || instance.length < definition.minLength)) return false;
  if (definition.maxLength !== undefined && (typeof instance !== "string" || instance.length > definition.maxLength)) return false;
  if (definition.minimum !== undefined && (typeof instance !== "number" || instance < definition.minimum)) return false;
  if (definition.maximum !== undefined && (typeof instance !== "number" || instance > definition.maximum)) return false;
  if (definition.allOf && !definition.allOf.every((schema) => matchesJsonSchema(instance, schema, root))) return false;
  if (definition.oneOf && definition.oneOf.filter((schema) => matchesJsonSchema(instance, schema, root)).length !== 1) return false;
  if (definition.not && matchesJsonSchema(instance, definition.not, root)) return false;

  if (typeof instance === "object" && instance !== null && !Array.isArray(instance)) {
    if (definition.required?.some((key) => !Object.hasOwn(instance, key))) return false;
    if (definition.properties) {
      if (Object.entries(definition.properties).some(([key, schema]) => Object.hasOwn(instance, key) && !matchesJsonSchema(instance[key], schema, root))) return false;
      if (definition.additionalProperties === false && Object.keys(instance).some((key) => !Object.hasOwn(definition.properties, key))) return false;
    }
  }

  if (Array.isArray(instance)) {
    if (definition.minItems !== undefined && instance.length < definition.minItems) return false;
    if (definition.maxItems !== undefined && instance.length > definition.maxItems) return false;
    if (definition.uniqueItems && new Set(instance.map((value) => JSON.stringify(value))).size !== instance.length) return false;
    if (definition.prefixItems && definition.prefixItems.some((schema, index) => !matchesJsonSchema(instance[index], schema, root))) return false;
    if (definition.items === false && definition.prefixItems && instance.length > definition.prefixItems.length) return false;
    if (definition.items && definition.items !== false && instance.some((value) => !matchesJsonSchema(value, definition.items, root))) return false;
    if (definition.contains) {
      const matchCount = instance.filter((value) => matchesJsonSchema(value, definition.contains, root)).length;
      if (matchCount < (definition.minContains ?? 1) || (definition.maxContains !== undefined && matchCount > definition.maxContains)) return false;
    }
  }
  return true;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Google spike evidence policy", () => {
  it("accepts the complete safe evidence contract", () => {
    expect(validateEvidence(safeEvidence)).toEqual(safeEvidence);
  });

  it("keeps legacy probe evidence compatible and accepts an explicit probe kind", () => {
    expect(validateEvidence(safeEvidence)).toEqual(safeEvidence);
    const explicitProbe = { ...safeEvidence, kind: "probe" };
    expect(validateEvidence(explicitProbe)).toEqual(explicitProbe);
  });

  it("accepts strict unobserved and complete provisioning evidence", () => {
    expect(validateEvidence(unobservedProvisioningEvidence)).toEqual(
      unobservedProvisioningEvidence,
    );
    expect(validateEvidence(completeProvisioningEvidence)).toEqual(
      completeProvisioningEvidence,
    );
    expect(redactEvidence(completeProvisioningEvidence)).toEqual(
      completeProvisioningEvidence,
    );
  });

  it.each([
    ["offset timestamp", "2026-08-23T09:00:00+09:00"],
    ["non-millisecond fraction", "2026-08-23T00:00:00.12Z"],
    ["normalized invalid date", "2026-02-30T00:00:00Z"],
    ["normalized hour 24", "2026-08-23T24:00:00Z"],
    ["non-leap February 29", "2025-02-29T00:00:00Z"],
    ["leap second", "2016-12-31T23:59:60Z"],
  ])("rejects a provisioning %s at the observedAt pointer", (_case, observedAt) => {
    expect(() =>
      validateEvidence({
        ...completeProvisioningEvidence,
        observedAt,
      }),
    ).toThrowError(
      expect.objectContaining({
        category: "INVALID_EVIDENCE_SHAPE",
        pointer: "/observedAt",
      }),
    );
  });

  it("accepts an actual leap-day UTC timestamp", () => {
    const evidence = {
      ...completeProvisioningEvidence,
      observedAt: "2024-02-29T23:59:59.999Z",
    };

    expect(validateEvidence(evidence)).toBe(evidence);
  });

  it("rejects unknown evidence kinds at a trusted pointer", () => {
    const unsafeKind = ["fixture", "person.example.invalid"].join("@");
    for (const candidate of [
      { ...safeEvidence, kind: unsafeKind },
      { ...safeEvidence, kind: 42 },
      Object.fromEntries(
        Object.entries(unobservedProvisioningEvidence).filter(([key]) => key !== "kind"),
      ),
    ]) {
      try {
        validateEvidence(candidate);
        throw new Error("expected evidence rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(EvidencePolicyError);
        expect(error.category).toBe("INVALID_EVIDENCE_SHAPE");
        expect(error.pointer).toBe("/kind");
        expect(error.message).not.toContain(unsafeKind);
      }
    }
  });

  it("derives provisioning status instead of trusting a hand-edited label", () => {
    expect(() =>
      validateEvidence({
        ...completeProvisioningEvidence,
        appType: "EXTERNAL",
      }),
    ).toThrowError(
      expect.objectContaining({
        category: "INVALID_EVIDENCE_SHAPE",
        pointer: "/status",
      }),
    );

    expect(() =>
      validateEvidence({
        ...completeProvisioningEvidence,
        status: "INCOMPLETE",
        capability: "INCONCLUSIVE",
      }),
    ).toThrowError(
      expect.objectContaining({
        category: "INVALID_EVIDENCE_SHAPE",
        pointer: "/status",
      }),
    );

    expect(() =>
      validateEvidence({
        ...unobservedProvisioningEvidence,
        observedAt: "2026-08-23T00:00:00.000Z",
      }),
    ).toThrowError(
      expect.objectContaining({
        category: "INVALID_EVIDENCE_SHAPE",
        pointer: "/observedAt",
      }),
    );
  });

  it("rejects nested provisioning unknown keys without echoing attacker material", () => {
    const forbiddenValue = "fixture-private-material";
    try {
      validateEvidence({
        ...unobservedProvisioningEvidence,
        accounts: {
          ...unobservedProvisioningEvidence.accounts,
          ordinary: {
            ...unobservedProvisioningEvidence.accounts.ordinary,
            unexpected: forbiddenValue,
          },
        },
      });
      throw new Error("expected evidence rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(EvidencePolicyError);
      expect(error.category).toBe("FORBIDDEN_EVIDENCE_FIELD");
      expect(error.pointer).toBe("/accounts/ordinary/_unknown");
      expect(error.message).not.toContain(forbiddenValue);
    }
  });

  it("rejects unknown keys recursively without echoing their values", () => {
    const forbiddenValue = "fixture-private-material";

    expect(() =>
      validateEvidence({
        ...safeEvidence,
        responseCounts: { items: 1, unexpected: forbiddenValue },
      }),
    ).toThrowError(
      expect.objectContaining({
        category: "FORBIDDEN_EVIDENCE_FIELD",
        pointer: "/responseCounts/_unknown",
      }),
    );

    try {
      validateEvidence({ ...safeEvidence, unexpected: forbiddenValue });
    } catch (error) {
      expect(error).toBeInstanceOf(EvidencePolicyError);
      expect(error.pointer).toBe("/_unknown");
      expect(error.message).not.toContain(forbiddenValue);
    }
  });

  it("hashes raw event and email-shaped calendar locators before persistence", () => {
    const rawLocator = "fixture-calendar-event-raw-id";
    const rawCalendar = "room-a@resource.invalid";
    const rawICalUid = "series-fixture@ical.invalid";
    const { locatorHashes: _ignored, ...withoutHashes } = safeEvidence;
    const redacted = redactEvidence({
      ...withoutHashes,
      locatorInputs: {
        event: rawLocator,
        roomCalendar: rawCalendar,
        iCalUid: rawICalUid,
      },
    });

    expect(redacted.locatorHashes).toEqual({
      event: hashLocator(rawLocator),
      roomCalendar: hashLocator(rawCalendar),
      iCalUid: hashLocator(rawICalUid),
    });
    expect(redacted.locatorHashes.event).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(redacted)).not.toContain(rawLocator);
    expect(JSON.stringify(redacted)).not.toContain(rawCalendar);
    expect(JSON.stringify(redacted)).not.toContain(rawICalUid);
    expect(hashLocator(rawLocator)).toBe(hashLocator(rawLocator));
  });

  it.each([
    ["access_token", "fixture-access-material"],
    ["refresh_token", "fixture-refresh-material"],
    ["client_secret", "fixture-client-material"],
    ["cookie", "fixture-cookie-material"],
    ["attendees", ["fixture-person@example.invalid"]],
    ["summary", "fixture-private-title"],
    ["eventId", "fixture-raw-event-id"],
  ])("rejects forbidden field %s without exposing its value", (field, forbiddenValue) => {
    const candidate = { ...safeEvidence, [field]: forbiddenValue };

    try {
      validateEvidence(candidate);
      throw new Error("expected evidence rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(EvidencePolicyError);
      expect(error.category).toBe("FORBIDDEN_EVIDENCE_FIELD");
      expect(error.pointer).toBe("/_unknown");
      expect(error.message).not.toContain(String(forbiddenValue));
    }
  });

  it("never echoes a sensitive or control-character unknown key name", () => {
    const unsafeKey = "fixture.person@example.invalid\ninjected";

    try {
      validateEvidence({ ...safeEvidence, [unsafeKey]: "fixture-private-material" });
      throw new Error("expected evidence rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(EvidencePolicyError);
      expect(error.category).toBe("FORBIDDEN_EVIDENCE_FIELD");
      expect(error.pointer).toBe("/_unknown");
      expect(error.message).not.toContain("example.invalid");
      expect(error.message).not.toContain("\n");
    }
  });

  it("rejects secret, email, JWT, and query-string values without echoing them", () => {
    const forbiddenValues = [
      "Bearer fixture-secret-material",
      "ya29.fixtureAccessTokenMaterial",
      "GOCSPX-fixtureClientSecretMaterial",
      "fixture.person@example.invalid",
      "eyJmaXh0dXJlIjoiYSJ9.eyJmaXh0dXJlIjoiYiJ9.fixtureSignature",
      "https://www.googleapis.com/calendar/v3/events?privateExtendedProperty=fixture",
    ];

    for (const forbiddenValue of forbiddenValues) {
      try {
        validateEvidence({ ...safeEvidence, googleRequestId: forbiddenValue });
        throw new Error("expected evidence rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(EvidencePolicyError);
        expect(error.category).toBe("FORBIDDEN_EVIDENCE_FIELD");
        expect(error.message).not.toContain(forbiddenValue);
      }
    }
  });

  it("accepts only fixed endpoint templates and rejects concrete locator paths", () => {
    expect(GOOGLE_ENDPOINT_TEMPLATES).toContain(safeEvidence.endpoint);

    expect(() =>
      validateEvidence({
        ...safeEvidence,
        endpoint:
          "https://www.googleapis.com/calendar/v3/calendars/concrete-calendar/events/concrete-event",
      }),
    ).toThrowError(
      expect.objectContaining({
        category: "FORBIDDEN_EVIDENCE_FIELD",
        pointer: "/endpoint",
      }),
    );
  });

  it("registers only the two currently implemented probe contracts", () => {
    const safeSelfTest = {
      schemaVersion: 1,
      probeId: "safe-self-test",
      runId: "safe-self-test-1",
      candidateSha: safeEvidence.candidateSha,
      observedAt: safeEvidence.observedAt,
      roleAlias: "ordinary",
      browserAlias: "browser-local",
      deviceAlias: "local-device",
      aliases: { account: "ordinary" },
      operationId: "safe-self-test-1",
      endpoint: safeEvidence.endpoint,
      capability: "NOT_APPLICABLE",
      result: "SUCCESS",
      teardownStatus: "NOT_REQUIRED",
      notes: ["FIXTURE"],
    };

    expect(validateEvidence(safeEvidence)).toBe(safeEvidence);
    expect(validateEvidence(safeSelfTest)).toBe(safeSelfTest);

    expect(() =>
      validateEvidence({ ...safeEvidence, result: "DENIED", capability: "SUPPORTED" }),
    ).toThrowError(expect.objectContaining({
      category: "INVALID_EVIDENCE_SHAPE",
      pointer: "/result",
    }));

    expect(() =>
      validateEvidence({
        ...safeEvidence,
        probeId: "drive-appdata",
        runId: "run-drive-appdata-001",
        operationId: "op-drive-appdata-001",
        googleRequestId: "req-drive-appdata-001",
        endpoint: "https://www.googleapis.com/drive/v3/files",
        teardownStatus: "COMPLETE",
      }),
    ).toThrowError(expect.objectContaining({
      category: "INVALID_EVIDENCE_SHAPE",
      pointer: "/probeId",
    }));

    expect(() => validateEvidence({ ...safeEvidence, kind: "probe", probeId: "provisioning" }))
      .toThrowError(expect.objectContaining({
        category: "INVALID_EVIDENCE_SHAPE",
        pointer: "/probeId",
      }));
  });

  it("rejects one shared credential corpus in runtime evidence", () => {
    for (const credential of credentialCorpus) {
      expect(containsSensitiveMaterial(credential)).toBe(true);
      expect(() =>
        validateEvidence({ ...safeEvidence, googleRequestId: `request-${credential}` }),
      ).toThrowError(expect.objectContaining({
        category: "FORBIDDEN_EVIDENCE_FIELD",
        pointer: "/googleRequestId",
      }));
    }
  });

  it("does not mistake an official authorization guide URL for credential material", () => {
    const officialUrl = "https://developers.google.com/identity/protocols/oauth2/resources/best-practices#choose-authorization-model";
    expect(containsSensitiveMaterial(officialUrl)).toBe(false);
    expect(validateManifest({ ...safeManifest, officialDocs: [officialUrl] }).officialDocs).toEqual([officialUrl]);
  });

  it("validates a strict manifest and rejects nested unknown fields", () => {
    expect(validateManifest(safeManifest)).toEqual(safeManifest);
    expect(
      validateManifest({
        ...safeManifest,
        architectureTriggers: ["SHARED_SERIES_COPY_MISMATCH"],
      }).architectureTriggers,
    ).toEqual(["SHARED_SERIES_COPY_MISMATCH"]);
    expect(() =>
      validateManifest({
        ...safeManifest,
        coverage: [
          { ...safeManifest.coverage[0], accountEmail: "fixture.person@example.invalid" },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        category: "FORBIDDEN_EVIDENCE_FIELD",
        pointer: "/coverage/0/_unknown",
      }),
    );
    expect(() =>
      validateManifest({
        ...safeManifest,
        evidence: [{ ...safeManifest.evidence[0], path: "docs/../private.json" }],
      }),
    ).toThrowError(
      expect.objectContaining({
        category: "INVALID_EVIDENCE_SHAPE",
        pointer: "/evidence/0/path",
      }),
    );
    expect(
      validateManifest({
        ...safeManifest,
        probeCommitShas: {
          ...safeManifest.probeCommitShas,
          provisioning: "0123456789abcdef0123456789abcdef01234567",
        },
        evidence: [
          {
            probeId: "provisioning",
            path: "docs/spikes/google-workspace/evidence/provisioning.json",
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            capability: "INCONCLUSIVE",
          },
        ],
        architectureTriggers: ["TENANT_POLICY_BLOCKED"],
      }).evidence[0].probeId,
    ).toBe("provisioning");
  });

  it.each([
    ["single-dot", "docs/./private.json"],
    ["double-dot", "docs/../private.json"],
    ["over-256-character", `docs/${"a".repeat(252)}`],
  ])("rejects %s manifest evidence path at runtime", (_case, path) => {
    expect(() =>
      validateManifest({
        ...safeManifest,
        evidence: [{ ...safeManifest.evidence[0], path }],
      }),
    ).toThrowError(
      expect.objectContaining({
        category: "INVALID_EVIDENCE_SHAPE",
        pointer: "/evidence/0/path",
      }),
    );
  });

  it("keeps both versioned schemas fail-closed at every object boundary", async () => {
    const evidenceSchema = JSON.parse(
      await readFile(join(schemasRoot, "evidence.schema.json"), "utf8"),
    );
    const manifestSchema = JSON.parse(
      await readFile(join(schemasRoot, "manifest.schema.json"), "utf8"),
    );

    expect(evidenceSchema.$id.endsWith("evidence-v1.json")).toBe(true);
    expect(evidenceSchema.oneOf).toEqual([
      { $ref: "#/$defs/probeEvidence" },
      { $ref: "#/$defs/provisioningEvidence" },
      { $ref: "#/$defs/accountMatrixEvidence" },
    ]);
    expect(evidenceSchema.unevaluatedProperties).toBe(false);
    const probeSchema = evidenceSchema.$defs.probeEvidence;
    expect(probeSchema.additionalProperties).toBe(false);
    expect(probeSchema.properties.kind).toEqual({ const: "probe" });
    expect(probeSchema.properties.responseCounts.additionalProperties).toBe(false);
    expect(probeSchema.properties.fieldPresence.additionalProperties).toBe(false);
    expect(probeSchema.properties.locatorHashes.additionalProperties).toBe(false);
    expect(probeSchema.properties.aliases.additionalProperties).toBe(false);
    expect(probeSchema.properties.endpoint.enum).toEqual(GOOGLE_ENDPOINT_TEMPLATES);
    expect(probeSchema.properties.probeId.enum).toEqual(["fixture-safe", "safe-self-test"]);
    expect(probeSchema.oneOf.map((branch) => branch.properties.probeId.const)).toEqual([
      "fixture-safe",
      "safe-self-test",
    ]);
    expect(probeSchema.oneOf[0].properties.runId.pattern).toBe(
      "^run-[A-Za-z0-9][A-Za-z0-9._:-]{0,123}$",
    );
    expect(probeSchema.oneOf[0].properties.operationId.pattern).toBe(
      "^operation-[A-Za-z0-9][A-Za-z0-9._:-]{0,117}$",
    );
    expect(probeSchema.oneOf[0].properties.googleRequestId.pattern).toBe(
      "^request-[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$",
    );
    expect(probeSchema.oneOf[1].properties.runId.pattern).toBe("^safe-self-test-[1-9]\\d*$");
    expect(probeSchema.oneOf[1].properties.operationId.pattern).toBe("^safe-self-test-[1-9]\\d*$");
    expect(evidenceSchema.$defs.count.maximum).toBe(Number.MAX_SAFE_INTEGER);
    const schemaSensitivePatterns = evidenceSchema.$defs.sensitiveString.allOf
      .map((entry) => entry.not?.pattern)
      .filter(Boolean)
      .map((pattern) => new RegExp(pattern));
    for (const credential of credentialCorpus) {
      expect(schemaSensitivePatterns.some((pattern) => pattern.test(credential))).toBe(true);
    }
    const provisioningSchema = evidenceSchema.$defs.provisioningEvidence;
    expect(provisioningSchema.additionalProperties).toBe(false);
    expect(provisioningSchema.required).toContain("kind");
    expect(provisioningSchema.required).toEqual(
      Object.keys(unobservedProvisioningEvidence),
    );
    expect(provisioningSchema.properties.kind).toEqual({ const: "provisioning" });
    expect(evidenceSchema.$defs.provisioningAccounts.additionalProperties).toBe(false);
    expect(evidenceSchema.$defs.provisioningRoom.additionalProperties).toBe(false);
    expect(provisioningSchema.properties.status.enum).toEqual([
      "INCOMPLETE",
      "COMPLETE",
      "TENANT_POLICY_BLOCKED",
    ]);
    expect(provisioningSchema.allOf).toHaveLength(3);
    expect(evidenceSchema.$defs.timestamp).toEqual({
      type: "string",
      format: "date-time",
      pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:[0-5]\\d(?:\\.\\d{3})?Z$",
    });
    const timestampDefinition = evidenceSchema.$defs.timestamp;
    expect(
      new RegExp(timestampDefinition.pattern).test("2016-12-31T23:59:60Z"),
    ).toBe(false);
    for (const timestamp of [
      "2026-08-23T00:00:00Z",
      "2026-08-23T00:00:00.000Z",
      "2024-02-29T23:59:59.999Z",
    ]) {
      expect(acceptsTimestampSchema(timestampDefinition, timestamp)).toBe(true);
    }
    for (const timestamp of [
      "2026-08-23T09:00:00+09:00",
      "2026-08-23T00:00:00.12Z",
      "2026-02-30T00:00:00Z",
      "2026-08-23T24:00:00Z",
      "2025-02-29T00:00:00Z",
      "2016-12-31T23:59:60Z",
    ]) {
      expect(acceptsTimestampSchema(timestampDefinition, timestamp)).toBe(false);
    }

    expect(manifestSchema.$id.endsWith("manifest-v1.json")).toBe(true);
    expect(manifestSchema.additionalProperties).toBe(false);
    expect(manifestSchema.properties.probeCommitShas.additionalProperties).toBe(false);
    expect(manifestSchema.properties.coverage.items.additionalProperties).toBe(false);
    expect(manifestSchema.properties.evidence.items.additionalProperties).toBe(false);
    expect(manifestSchema.properties.generatedAt).toEqual(timestampDefinition);
    expect(acceptsTimestampSchema(
      manifestSchema.properties.generatedAt,
      "2026-08-23T09:00:00+09:00",
    )).toBe(false);
    expect(new RegExp(manifestSchema.properties.officialDocs.items.pattern).test(
      "https://developers.google.com/identity/protocols/oauth2/resources/best-practices#choose-authorization-model",
    )).toBe(true);
    const manifestPathContract = manifestSchema.properties.evidence.items.properties.path;
    const manifestPathPattern = new RegExp(manifestPathContract.pattern);
    expect(manifestPathPattern.test("docs/spikes/google-workspace/evidence/teardown.json")).toBe(true);
    expect(manifestPathPattern.test("docs/./private.json")).toBe(false);
    expect(manifestPathPattern.test("docs/../private.json")).toBe(false);
    expect(manifestPathContract.maxLength).toBe(256);
    expect(`docs/${"a".repeat(252)}`).toHaveLength(257);
    expect(manifestSchema.properties.architectureTriggers.items.enum).toContain(
      "SHARED_SERIES_COPY_MISMATCH",
    );
  });

  it("validates the account-matrix union branch and rejects kind mismatches", () => {
    expect(validateEvidence(accountMatrix)).toEqual(accountMatrix);
    expect(() => validateEvidence({ ...accountMatrix, kind: "probe" })).toThrowError(
      expect.objectContaining({ category: "FORBIDDEN_EVIDENCE_FIELD", pointer: "/_unknown" }),
    );
  });

  it("keeps account-matrix schema discriminators aligned with the runtime corpus", async () => {
    const schema = JSON.parse(await readFile(join(schemasRoot, "evidence.schema.json"), "utf8"));
    expect(schema.$defs.accountMatrixOrdinary.allOf[1].properties.bindingAlias).toEqual({ const: "account:ordinary" });
    expect(schema.$defs.accountMatrixAdmin.allOf[1].properties.roomWriter).toEqual({ const: true });
    expect(schema.$defs.accountMatrixOrdinary.allOf[1].properties.browserProfiles).toEqual({
      oneOf: expect.arrayContaining([
        expect.objectContaining({
          prefixItems: [{ const: "ordinary-chrome-desktop" }, { const: "ordinary-safari-desktop" }],
          items: false,
        }),
      ]),
    });
    expect(schema.$defs.accountMatrixAdmin.allOf[1].properties.browserProfiles).toEqual({
      oneOf: expect.arrayContaining([
        expect.objectContaining({
          prefixItems: [{ const: "admin-chrome-desktop" }, { const: "admin-safari-desktop" }],
          items: false,
        }),
      ]),
    });
    expect(schema.$defs.accountMatrixRoomA.allOf[1].properties.bindingAlias).toEqual({ const: "room:room-a" });
    const rowChecks = schema.$defs.accountMatrixEvidence.properties.rows.allOf.map(({ contains }) => contains.$ref);
    expect(rowChecks).toEqual(expect.arrayContaining(["#/$defs/accountMatrixRowOrdinaryCopy", "#/$defs/accountMatrixRowConflictA", "#/$defs/accountMatrixRowConflictB"]));
    const fixtureExpectations = {
      OrdinaryOwn: ["ordinary-own-event", "fixture:ordinary-own-event", "ordinary", "room-a"],
      OrdinaryCopy: ["ordinary-room-copy", "fixture:ordinary-room-copy", "ordinary", "room-b"],
      AdminCopy: ["admin-room-copy", "fixture:admin-room-copy", "room-writer-admin", "room-a"],
      CrossBrowser: ["cross-browser-preference", "fixture:cross-browser-preference", "ordinary", "room-a"],
      ConflictA: ["conflict-event-a", "fixture:conflict-event-a", "ordinary", "room-b"],
      ConflictB: ["conflict-event-b", "fixture:conflict-event-b", "room-writer-admin", "room-b"],
    };
    for (const [suffix, [alias, mutableId, owner, room]] of Object.entries(fixtureExpectations)) {
      const properties = schema.$defs[`accountMatrixFixture${suffix}`].allOf[1].properties;
      expect(properties.alias).toEqual({ const: alias });
      expect(properties.mutableId).toEqual({ const: mutableId });
      expect(properties.owner).toEqual({ const: owner });
      expect(properties.room).toEqual({ const: room });
    }
    const rowAliases = ["RoomRead", "OwnMutation", "OrdinaryCopy", "AdminCopy", "Drive", "People", "ConflictA", "ConflictB"];
    for (const suffix of rowAliases) {
      const properties = schema.$defs[`accountMatrixRow${suffix}`].allOf[1].properties;
      expect(properties.alias.const).toBeTruthy();
      expect(properties.actor.const).toBeTruthy();
      expect(properties.owner.const).toBeTruthy();
      expect(properties.resource.const).toBeTruthy();
      expect(properties.fixture.const).toBeTruthy();
      expect(properties.expectedCapability.const).toBeTruthy();
      expect(properties.cleanupOwner.const).toBeTruthy();
      expect(properties.concurrencyGroup.const).toBeTruthy();
      expect(typeof properties.concurrent.const).toBe("boolean");
    }
  });

  it("validates the canonical account matrix against JSON Schema fixture-id constraints", async () => {
    const schema = JSON.parse(await readFile(join(schemasRoot, "evidence.schema.json"), "utf8"));
    const fixtureIds = [
      "fixture:ordinary-own-event",
      "fixture:ordinary-room-copy",
      "fixture:admin-room-copy",
      "fixture:cross-browser-preference",
      "fixture:conflict-event-a",
      "fixture:conflict-event-b",
    ];
    expect(matchesJsonSchema(accountMatrix, schema, schema)).toBe(true);
    expect(schema.$defs.fixtureId).toEqual({ type: "string", enum: fixtureIds });

    const nonCanonicalFixtureId = structuredClone(accountMatrix);
    nonCanonicalFixtureId.fixtures[0].mutableId = "fixture:not-in-matrix";
    expect(matchesJsonSchema(nonCanonicalFixtureId, schema, schema)).toBe(false);
  });

  it("keeps CLI success and failure output stable and redacted", async () => {
    const safe = runNode(validateEvidenceCli, [join(fixturesRoot, "safe-evidence.json")]);
    expect(safe.status).toBe(0);
    expect(safe.stdout.trim()).toBe("evidence-valid schemaVersion=1 probeId=fixture-safe");
    expect(safe.stderr).toBe("");

    const root = await mkdtemp(join(tmpdir(), "molroom-google-spike-union-cli-"));
    temporaryRoots.push(root);
    const provisioningPath = join(root, "provisioning.json");
    await writeFile(provisioningPath, `${JSON.stringify(unobservedProvisioningEvidence)}\n`);
    const provisioning = runNode(validateEvidenceCli, [provisioningPath]);
    expect(provisioning.status).toBe(0);
    expect(provisioning.stdout.trim()).toBe(
      "evidence-valid schemaVersion=1 kind=provisioning status=INCOMPLETE",
    );
    expect(provisioning.stderr).toBe("");
    expect(`${provisioning.stdout}${provisioning.stderr}`).not.toContain("clientIdSuffix");

    const cases = [
      ["forbidden-token.json", "fixture-secret-material"],
      ["forbidden-pii.json", "fixture.person@example.invalid"],
      ["forbidden-locator.json", "fixture-raw-event-id"],
      ["forbidden-query.json", "privateExtendedProperty=fixture"],
      ["forbidden-unknown-key.json", "fixture-private-material"],
    ];

    for (const [fixture, forbiddenValue] of cases) {
      const result = runNode(validateEvidenceCli, [join(fixturesRoot, fixture)]);
      expectRedactedFailure(result, "FORBIDDEN_EVIDENCE_", forbiddenValue);
      expect(`${result.stdout}${result.stderr}`).toMatch(/pointer=\/[A-Za-z0-9_/-]+/);
    }
  });

  it("rejects duplicate JSON keys before validation, including escaped nested keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "molroom-google-spike-duplicate-json-"));
    temporaryRoots.push(root);
    const duplicatePath = join(root, "duplicate.json");
    await writeFile(
      duplicatePath,
      '{"schemaVersion":1,"probeId":"fixture-safe","runId":"run-fixture-001","candidateSha":"0123456789abcdef0123456789abcdef01234567","observedAt":"2026-08-22T00:00:00.000Z","roleAlias":"ordinary","browserAlias":"chrome-desktop","deviceAlias":"desktop","aliases":{"account":"ordinary","\\u0061ccount":"ordinary"},"operationId":"operation-fixture-001","endpoint":"https://www.googleapis.com/calendar/v3/calendars/{calendar}/events","capability":"SUPPORTED","result":"SUCCESS","teardownStatus":"NOT_REQUIRED"}',
    );

    const result = runNode(validateEvidenceCli, [duplicatePath]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("DUPLICATE_JSON_KEY");
    expect(`${result.stdout}${result.stderr}`).not.toContain("ordinary");
  });

  it("keeps strict JSON duplicate detection scoped, canonical, and depth-bounded", () => {
    expect(parseStrictJson('{"left":{"same":1},"right":{"same":2}}')).toEqual({
      left: { same: 1 },
      right: { same: 2 },
    });
    expect(parseStrictJson(JSON.stringify(safeEvidence))).toEqual(safeEvidence);
    expect(() => parseStrictJson('{"token":"Bearer hidden","token":"safe"}'))
      .toThrowError(expect.objectContaining({ category: "DUPLICATE_JSON_KEY" }));
    expect(() => parseStrictJson(`${"[".repeat(65)}0${"]".repeat(65)}`))
      .toThrowError(expect.objectContaining({ category: "JSON_NESTING_TOO_DEEP" }));
  });

  it("fails closed on oversized and invalid-UTF-8 evidence and scanned files", async () => {
    const root = await mkdtemp(join(tmpdir(), "molroom-google-spike-bounded-read-"));
    temporaryRoots.push(root);
    const oversizedPath = join(root, "oversized.json");
    const invalidUtf8Path = join(root, "invalid-utf8.json");
    await writeFile(oversizedPath, Buffer.alloc(1024 * 1024 + 1, 0x41));
    await writeFile(invalidUtf8Path, Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xc3, 0x28, 0x7d]));

    const oversizedEvidence = runNode(validateEvidenceCli, [oversizedPath]);
    expect(oversizedEvidence.status).not.toBe(0);
    expect(`${oversizedEvidence.stdout}${oversizedEvidence.stderr}`).toContain("EVIDENCE_TOO_LARGE");

    const invalidEvidence = runNode(validateEvidenceCli, [invalidUtf8Path]);
    expect(invalidEvidence.status).not.toBe(0);
    expect(`${invalidEvidence.stdout}${invalidEvidence.stderr}`).toContain("INVALID_EVIDENCE_UTF8");

    const oversizedScan = runNode(scanSensitivePathsCli, ["--redact", oversizedPath]);
    expect(oversizedScan.status).not.toBe(0);
    expect(`${oversizedScan.stdout}${oversizedScan.stderr}`).toContain("PATH_TOO_LARGE");

    const invalidScan = runNode(scanSensitivePathsCli, ["--redact", invalidUtf8Path]);
    expect(invalidScan.status).not.toBe(0);
    expect(`${invalidScan.stdout}${invalidScan.stderr}`).toContain("PATH_INVALID_UTF8");
  });

  it("keeps scanner opens, close failures, and error paths fail-closed", async () => {
    const root = await mkdtemp(join(tmpdir(), "molroom-google-spike-file-lifecycle-"));
    temporaryRoots.push(root);
    const fifoPath = join(root, "evidence.fifo");
    const safePath = join(root, "safe.json");
    const unsafeMissingPath = join(root, "Bearer fixture-secret\ninjected.json");
    expect(spawnSync("mkfifo", [fifoPath], { encoding: "utf8" }).status).toBe(0);
    await writeFile(safePath, JSON.stringify(safeEvidence));

    const fifo = spawnSync(process.execPath, [scanSensitivePathsCli, "--redact", fifoPath], {
      cwd: join(spikeRoot, "..", ".."),
      encoding: "utf8",
      timeout: 1_000,
    });
    expect(fifo.error).toBeUndefined();
    expect(fifo.status).not.toBe(0);
    expect(`${fifo.stdout}${fifo.stderr}`).toMatch(/PATH_(?:NOT_REGULAR|NOT_READABLE) path=-/);

    const validateModuleUrl = pathToFileURL(validateEvidenceCli).href;
    const closeFailureScript = `
      import fsPromises from "node:fs/promises";
      import { syncBuiltinESMExports } from "node:module";
      const originalOpen = fsPromises.open;
      fsPromises.open = async function openWithCloseFailure(...args) {
        const handle = await originalOpen(...args);
        const originalClose = handle.close;
        handle.close = async function closeWithFailure() {
          await originalClose.call(handle);
          throw new Error("simulated close failure");
        };
        return handle;
      };
      syncBuiltinESMExports();
      process.argv = ["node", "validate-evidence", ${JSON.stringify(safePath)}];
      await import(${JSON.stringify(validateModuleUrl)} + "?close-failure");
    `;
    const closeFailure = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", closeFailureScript],
      { cwd: join(spikeRoot, "..", ".."), encoding: "utf8" },
    );
    expect(closeFailure.status).not.toBe(0);
    expect(`${closeFailure.stdout}${closeFailure.stderr}`).toContain("EVIDENCE_PATH_CLOSE_FAILED");
    expect(`${closeFailure.stdout}${closeFailure.stderr}`).not.toContain("evidence-valid");

    const unsafePath = runNode(scanSensitivePathsCli, ["--redact", unsafeMissingPath]);
    expect(unsafePath.status).not.toBe(0);
    expect(`${unsafePath.stdout}${unsafePath.stderr}`).toContain("PATH_NOT_READABLE path=-");
    expect(`${unsafePath.stdout}${unsafePath.stderr}`).not.toContain("Bearer fixture-secret");
    expect(`${unsafePath.stdout}${unsafePath.stderr}`).not.toContain("injected.json");
  });

  it("scans only explicit regular files and never prints matched material", async () => {
    const root = await mkdtemp(join(tmpdir(), "molroom-google-spike-scan-"));
    temporaryRoots.push(root);
    const safePath = join(root, "safe.json");
    const forbiddenPath = join(root, "forbidden.json");
    const directoryPath = join(root, "directory");
    const symlinkPath = join(root, "safe-link.json");
    await writeFile(safePath, JSON.stringify(safeEvidence));
    await writeFile(forbiddenPath, JSON.stringify({ credential: "Bearer fixture-secret-material" }));
    await mkdir(directoryPath);
    await symlink(safePath, symlinkPath);

    const safe = runNode(scanSensitivePathsCli, ["--redact", safePath]);
    expect(safe.status).toBe(0);
    expect(safe.stdout.trim()).toBe("sensitive-scan-valid files=1");

    const forbidden = runNode(scanSensitivePathsCli, ["--redact", forbiddenPath]);
    expectRedactedFailure(forbidden, "FORBIDDEN_PATH_CONTENT", "fixture-secret-material");
    expect(`${forbidden.stdout}${forbidden.stderr}`).toContain("path=-");
    expect(`${forbidden.stdout}${forbidden.stderr}`).not.toContain(forbiddenPath);

    for (const fixture of [
      "forbidden-token.json",
      "forbidden-pii.json",
      "forbidden-locator.json",
      "forbidden-query.json",
    ]) {
      const fixturePath = join(fixturesRoot, fixture);
      const result = runNode(scanSensitivePathsCli, ["--redact", fixturePath]);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain("FORBIDDEN_PATH_CONTENT");
    }

    const missing = runNode(scanSensitivePathsCli, ["--redact", join(root, "missing.json")]);
    expect(missing.status).not.toBe(0);
    expect(`${missing.stdout}${missing.stderr}`).toContain("PATH_NOT_READABLE");

    const nonRegular = runNode(scanSensitivePathsCli, ["--redact", directoryPath]);
    expect(nonRegular.status).not.toBe(0);
    expect(`${nonRegular.stdout}${nonRegular.stderr}`).toContain("PATH_NOT_REGULAR");

    const symlinked = runNode(scanSensitivePathsCli, ["--redact", symlinkPath]);
    expect(symlinked.status).not.toBe(0);
    expect(`${symlinked.stdout}${symlinked.stderr}`).toContain("PATH_NOT_READABLE");
  });

  it.each([
    ["eventId", "fixture-raw-event-id"],
    ["fileId", "fixture-raw-file-id"],
    ["calendarId", "fixture-raw-calendar-id"],
    ["roomCalendarId", "fixture-raw-room-calendar-id"],
    ["iCalUID", "fixture-raw-ical-uid"],
  ])("rejects serialized raw locator key %s without printing its value", async (key, value) => {
    const root = await mkdtemp(join(tmpdir(), "molroom-google-spike-locator-scan-"));
    temporaryRoots.push(root);
    const locatorPath = join(root, `${key}.json`);
    await writeFile(locatorPath, JSON.stringify({ [key]: value }));

    const result = runNode(scanSensitivePathsCli, ["--redact", locatorPath]);
    expectRedactedFailure(result, "FORBIDDEN_PATH_CONTENT", value);
  });

  it("rejects the shared credential corpus in scanned files while allowing a redacted suffix", async () => {
    const root = await mkdtemp(join(tmpdir(), "molroom-google-spike-client-scan-"));
    temporaryRoots.push(root);
    const suffixPath = join(root, "client-suffix.json");
    await writeFile(suffixPath, JSON.stringify({ clientIdSuffix: "a1b2c3d4" }));

    for (const [index, credential] of credentialCorpus.entries()) {
      const credentialPath = join(root, `credential-${index}.txt`);
      await writeFile(credentialPath, credential);
      const rejected = runNode(scanSensitivePathsCli, ["--redact", credentialPath]);
      expectRedactedFailure(rejected, "FORBIDDEN_PATH_CONTENT", credential);
      expect(`${rejected.stdout}${rejected.stderr}`).toContain("path=-");
    }

    const accepted = runNode(scanSensitivePathsCli, ["--redact", suffixPath]);
    expect(accepted.status).toBe(0);
    expect(accepted.stdout.trim()).toBe("sensitive-scan-valid files=1");
  });
});
