import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  EvidencePolicyError,
  hashLocator,
  redactEvidence,
  validateEvidence,
  validateManifest,
  GOOGLE_ENDPOINT_TEMPLATES,
} from "./evidence.mjs";

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

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Google spike evidence policy", () => {
  it("accepts the complete safe evidence contract", () => {
    expect(validateEvidence(safeEvidence)).toEqual(safeEvidence);
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

  it("validates a strict manifest and rejects nested unknown fields", () => {
    const manifest = {
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

    expect(validateManifest(manifest)).toEqual(manifest);
    expect(
      validateManifest({
        ...manifest,
        architectureTriggers: ["SHARED_SERIES_COPY_MISMATCH"],
      }).architectureTriggers,
    ).toEqual(["SHARED_SERIES_COPY_MISMATCH"]);
    expect(() =>
      validateManifest({
        ...manifest,
        coverage: [{ ...manifest.coverage[0], accountEmail: "fixture.person@example.invalid" }],
      }),
    ).toThrowError(
      expect.objectContaining({
        category: "FORBIDDEN_EVIDENCE_FIELD",
        pointer: "/coverage/0/_unknown",
      }),
    );
    expect(() =>
      validateManifest({
        ...manifest,
        evidence: [{ ...manifest.evidence[0], path: "docs/../private.json" }],
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
    expect(evidenceSchema.additionalProperties).toBe(false);
    expect(evidenceSchema.properties.responseCounts.additionalProperties).toBe(false);
    expect(evidenceSchema.properties.fieldPresence.additionalProperties).toBe(false);
    expect(evidenceSchema.properties.locatorHashes.additionalProperties).toBe(false);
    expect(evidenceSchema.properties.aliases.additionalProperties).toBe(false);
    expect(evidenceSchema.properties.endpoint.enum).toEqual(GOOGLE_ENDPOINT_TEMPLATES);

    expect(manifestSchema.$id.endsWith("manifest-v1.json")).toBe(true);
    expect(manifestSchema.additionalProperties).toBe(false);
    expect(manifestSchema.properties.probeCommitShas.additionalProperties).toBe(false);
    expect(manifestSchema.properties.coverage.items.additionalProperties).toBe(false);
    expect(manifestSchema.properties.evidence.items.additionalProperties).toBe(false);
    const manifestPathPattern = new RegExp(
      manifestSchema.properties.evidence.items.properties.path.pattern,
    );
    expect(manifestPathPattern.test("docs/spikes/google-workspace/evidence/teardown.json")).toBe(true);
    expect(manifestPathPattern.test("docs/../private.json")).toBe(false);
    expect(manifestSchema.properties.architectureTriggers.items.enum).toContain(
      "SHARED_SERIES_COPY_MISMATCH",
    );
  });

  it("keeps CLI success and failure output stable and redacted", () => {
    const safe = runNode(validateEvidenceCli, [join(fixturesRoot, "safe-evidence.json")]);
    expect(safe.status).toBe(0);
    expect(safe.stdout.trim()).toBe("evidence-valid schemaVersion=1 probeId=fixture-safe");
    expect(safe.stderr).toBe("");

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

  it("scans only explicit regular files and never prints matched material", async () => {
    const root = await mkdtemp(join(tmpdir(), "molroom-google-spike-scan-"));
    temporaryRoots.push(root);
    const safePath = join(root, "safe.json");
    const forbiddenPath = join(root, "forbidden.json");
    const rawLocatorPath = join(root, "raw-locator.json");
    const directoryPath = join(root, "directory");
    const symlinkPath = join(root, "safe-link.json");
    await writeFile(safePath, JSON.stringify(safeEvidence));
    await writeFile(forbiddenPath, JSON.stringify({ credential: "Bearer fixture-secret-material" }));
    await writeFile(rawLocatorPath, JSON.stringify({ fileId: "fixture-raw-file-id" }));
    await mkdir(directoryPath);
    await symlink(safePath, symlinkPath);

    const safe = runNode(scanSensitivePathsCli, ["--redact", safePath]);
    expect(safe.status).toBe(0);
    expect(safe.stdout.trim()).toBe("sensitive-scan-valid files=1");

    const forbidden = runNode(scanSensitivePathsCli, ["--redact", forbiddenPath]);
    expectRedactedFailure(forbidden, "FORBIDDEN_PATH_CONTENT", "fixture-secret-material");
    expect(`${forbidden.stdout}${forbidden.stderr}`).toContain(`path=${forbiddenPath}`);

    const rawLocator = runNode(scanSensitivePathsCli, ["--redact", rawLocatorPath]);
    expectRedactedFailure(rawLocator, "FORBIDDEN_PATH_CONTENT", "fixture-raw-file-id");

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
});
