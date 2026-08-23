import { describe, expect, test } from "vitest";
import { assertBrowserConfiguration, parseAppConfig } from "./env";
import type { Policy, Room } from "../domain/types";

const productionEnv = {
  VITE_DEPLOYMENT: "production",
  VITE_ADAPTER: "google",
  VITE_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
  VITE_ALLOWED_HD: "molcube.com",
} as const;

const rooms: readonly Room[] = [
  {
    id: "small",
    email: "small@resource.calendar.google.com",
    name: "Small room",
    short: "S",
    floor: "3F",
  },
  {
    id: "large",
    email: "large@resource.calendar.google.com",
    name: "Large room",
    short: "L",
    floor: "3F",
  },
];

const policy: Policy = {
  maxDurationMinutes: 240,
  maxAdvanceDays: 28,
  gridStartHour: 8,
  gridEndHour: 20,
  slotMinutes: 30,
  checkInGraceMinutes: 10,
  extendStepMinutes: 15,
  admins: ["admin@molcube.com"],
};

function production(overrides: Record<string, string | undefined> = {}) {
  return parseAppConfig({ commandEnv: { ...productionEnv, ...overrides } });
}

function configuration(overrides: {
  readonly rooms?: readonly Room[];
  readonly policy?: Policy;
} = {}) {
  return parseAppConfig({ rooms: overrides.rooms ?? rooms, policy: overrides.policy ?? policy });
}

describe("parseAppConfig", () => {
  test("uses local mock defaults", () => {
    expect(parseAppConfig()).toMatchObject({
      deployment: "local",
      adapter: "mock",
      googleClientId: null,
      allowedHostedDomain: "molcube.com",
    });
  });

  test("prefers command environment over Vite mode environment", () => {
    expect(
      parseAppConfig({
        modeEnv: { VITE_DEPLOYMENT: "preview", VITE_ADAPTER: "mock" },
        commandEnv: productionEnv,
      }).deployment,
    ).toBe("production");
  });

  test("allows an explicitly selected mock adapter outside production", () => {
    expect(
      parseAppConfig({
        commandEnv: { VITE_DEPLOYMENT: "preview", VITE_ADAPTER: "mock" },
        rooms,
        policy,
      }),
    ).toMatchObject({ deployment: "preview", adapter: "mock" });
  });

  test("rejects an unknown adapter without executing a fallback", () => {
    expect(() =>
      parseAppConfig({
        commandEnv: { VITE_DEPLOYMENT: "preview", VITE_ADAPTER: "unexpected" },
        rooms,
        policy,
      }),
    ).toThrow("Invalid configuration: VITE_ADAPTER");
  });

  test.each([
    ["VITE_ADAPTER", { VITE_ADAPTER: "mock" }],
    ["VITE_GOOGLE_CLIENT_ID", { VITE_GOOGLE_CLIENT_ID: "" }],
    ["VITE_GOOGLE_CLIENT_ID", { VITE_GOOGLE_CLIENT_ID: ".apps.googleusercontent.com" }],
    ["VITE_GOOGLE_CLIENT_ID", { VITE_GOOGLE_CLIENT_ID: " \t.apps.googleusercontent.com" }],
    ["VITE_GOOGLE_CLIENT_ID", { VITE_GOOGLE_CLIENT_ID: "client.example.com" }],
    ["VITE_ALLOWED_HD", { VITE_ALLOWED_HD: "example.com" }],
  ] as const)("rejects invalid production %s", (field, overrides) => {
    expect(() => production(overrides)).toThrow(`Invalid production configuration: ${field}`);
  });

  test.each([
    ["id", (room: Room) => ({ ...room, id: "" })],
    ["name", (room: Room) => ({ ...room, name: "" })],
    ["email", (room: Room) => ({ ...room, email: "" })],
  ])("rejects an empty room %s", (_field, invalidRoom) => {
    expect(() => configuration({ rooms: [invalidRoom(rooms[0]!)] })).toThrow("Invalid configuration: rooms");
  });

  test.each([
    ["id", (room: Room) => ({ ...room, id: rooms[0]!.id })],
    ["name", (room: Room) => ({ ...room, name: rooms[0]!.name })],
    ["email", (room: Room) => ({ ...room, email: rooms[0]!.email })],
  ])("rejects duplicate room %s", (_field, duplicateRoom) => {
    expect(() => configuration({ rooms: [rooms[0]!, duplicateRoom(rooms[1]!)] })).toThrow(
      "Invalid configuration: rooms",
    );
  });

  test.each([
    ["id", { ...rooms[0]!, id: 1 }],
    ["name", { ...rooms[0]!, name: null }],
    ["email", { ...rooms[0]!, email: [] }],
  ])("rejects malformed room %s without a native type error", (_field, malformedRoom) => {
    expect(() => parseAppConfig({ rooms: [malformedRoom] as unknown as readonly Room[] })).toThrow(
      "Invalid configuration: rooms",
    );
  });

  test("reports malformed rooms as production configuration errors", () => {
    expect(() =>
      parseAppConfig({
        commandEnv: productionEnv,
        rooms: [{ ...rooms[0]!, id: null }] as unknown as readonly Room[],
      }),
    ).toThrow("Invalid production configuration: rooms");
  });

  test.each([
    ["non-integer values", { ...policy, slotMinutes: 30.5 }],
    ["non-positive durations", { ...policy, maxDurationMinutes: 0 }],
    ["reversed grid hours", { ...policy, gridStartHour: 20, gridEndHour: 20 }],
    ["hours outside the day", { ...policy, gridEndHour: 25 }],
    ["grid span not divisible by slots", { ...policy, gridEndHour: 19, slotMinutes: 40 }],
    ["maximum duration shorter than a slot", { ...policy, maxDurationMinutes: 15 }],
    ["extension step not dividing slots", { ...policy, extendStepMinutes: 20 }],
  ])("rejects policy with %s", (_reason, invalidPolicy) => {
    expect(() => configuration({ policy: invalidPolicy })).toThrow("Invalid configuration: policy");
  });

  test.each([
    ["missing admins", (() => {
      const malformedPolicy = { ...policy } as Record<string, unknown>;
      delete malformedPolicy.admins;
      return malformedPolicy;
    })()],
    ["non-array admins", { ...policy, admins: "admin@molcube.com" }],
  ])("rejects policy with %s without a native type error", (_reason, malformedPolicy) => {
    expect(() => parseAppConfig({ policy: malformedPolicy as unknown as Policy })).toThrow(
      "Invalid configuration: policy",
    );
  });

  test("returns deeply frozen tracked configuration copies", () => {
    const config = configuration();

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.rooms)).toBe(true);
    expect(config.rooms.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(config.policy)).toBe(true);
    expect(Object.isFrozen(config.policy.admins)).toBe(true);
    expect(() => {
      (config.rooms as Room[])[0] = rooms[1]!;
    }).toThrow();
  });
});

describe("assertBrowserConfiguration", () => {
  test("returns the immutable configuration that passed browser validation", () => {
    const config = assertBrowserConfiguration({
      VITE_DEPLOYMENT: "preview",
      VITE_ADAPTER: "mock",
    });

    expect(config).toMatchObject({ deployment: "preview", adapter: "mock" });
    expect(Object.isFrozen(config)).toBe(true);
  });

  test("fails closed instead of falling back from invalid production settings", () => {
    expect(() =>
      assertBrowserConfiguration({
        VITE_DEPLOYMENT: "production",
        VITE_ADAPTER: "mock",
        VITE_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
        VITE_ALLOWED_HD: "molcube.com",
      }),
    ).toThrow("Invalid production configuration: VITE_ADAPTER");
  });
});
