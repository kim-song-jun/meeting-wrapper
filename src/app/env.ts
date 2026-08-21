import roomsJson from "../config/rooms.json";
import policyJson from "../config/policy.json";
import type { Policy, Room } from "../domain/types";

export type Deployment = "local" | "preview" | "production";
export type AdapterMode = "mock" | "google";

export interface AppConfig {
  readonly deployment: Deployment;
  readonly adapter: AdapterMode;
  readonly googleClientId: string | null;
  readonly allowedHostedDomain: string;
  readonly rooms: readonly Readonly<Room>[];
  readonly policy: Omit<Readonly<Policy>, "admins"> & { readonly admins: readonly string[] };
}

type Env = Readonly<Record<string, string | undefined>>;

export interface ParseAppConfigInput {
  readonly commandEnv?: Env;
  readonly modeEnv?: Env;
  readonly rooms?: readonly Room[];
  readonly policy?: Policy;
}

const DEPLOYMENTS = new Set<Deployment>(["local", "preview", "production"]);
const ADAPTERS = new Set<AdapterMode>(["mock", "google"]);

function resolveEnv(
  commandEnv: Env | undefined,
  modeEnv: Env | undefined,
  name: string,
  defaultValue: string | undefined,
): string | undefined {
  return commandEnv?.[name] ?? modeEnv?.[name] ?? defaultValue;
}

function invalid(deployment: Deployment | undefined, field: string): never {
  const prefix = deployment === "production" ? "Invalid production configuration" : "Invalid configuration";
  throw new Error(`${prefix}: ${field}`);
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

function validateRooms(rooms: readonly Room[], deployment: Deployment): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  const emails = new Set<string>();

  for (const room of rooms) {
    if (!isNonEmptyString(room.id) || !isNonEmptyString(room.name) || !isNonEmptyString(room.email)) {
      invalid(deployment, "rooms");
    }

    if (ids.has(room.id) || names.has(room.name) || emails.has(room.email)) {
      invalid(deployment, "rooms");
    }

    ids.add(room.id);
    names.add(room.name);
    emails.add(room.email);
  }
}

function validatePolicy(policy: Policy, deployment: Deployment): void {
  const values = [
    policy.maxDurationMinutes,
    policy.maxAdvanceDays,
    policy.gridStartHour,
    policy.gridEndHour,
    policy.slotMinutes,
    policy.checkInGraceMinutes,
    policy.extendStepMinutes,
  ];

  if (
    values.some((value) => !Number.isInteger(value)) ||
    policy.maxDurationMinutes <= 0 ||
    policy.maxAdvanceDays <= 0 ||
    policy.slotMinutes <= 0 ||
    policy.checkInGraceMinutes <= 0 ||
    policy.extendStepMinutes <= 0 ||
    policy.gridStartHour < 0 ||
    policy.gridEndHour > 24 ||
    policy.gridStartHour >= policy.gridEndHour ||
    ((policy.gridEndHour - policy.gridStartHour) * 60) % policy.slotMinutes !== 0 ||
    policy.maxDurationMinutes < policy.slotMinutes ||
    policy.slotMinutes % policy.extendStepMinutes !== 0 ||
    policy.admins.some((admin) => !isNonEmptyString(admin)) ||
    new Set(policy.admins).size !== policy.admins.length
  ) {
    invalid(deployment, "policy");
  }
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      freeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

export function parseAppConfig(input: ParseAppConfigInput = {}): AppConfig {
  const deploymentValue = resolveEnv(input.commandEnv, input.modeEnv, "VITE_DEPLOYMENT", "local");
  if (!DEPLOYMENTS.has(deploymentValue as Deployment)) {
    invalid(undefined, "VITE_DEPLOYMENT");
  }
  const deployment = deploymentValue as Deployment;

  const adapterValue = resolveEnv(input.commandEnv, input.modeEnv, "VITE_ADAPTER", "mock");
  if (!ADAPTERS.has(adapterValue as AdapterMode)) {
    invalid(deployment, "VITE_ADAPTER");
  }
  const adapter = adapterValue as AdapterMode;
  const googleClientId = resolveEnv(input.commandEnv, input.modeEnv, "VITE_GOOGLE_CLIENT_ID", undefined) ?? null;
  const allowedHostedDomain = resolveEnv(input.commandEnv, input.modeEnv, "VITE_ALLOWED_HD", "molcube.com")!;

  if (deployment === "production" && adapter !== "google") {
    invalid(deployment, "VITE_ADAPTER");
  }
  if (adapter === "google" && (!googleClientId || !googleClientId.endsWith(".apps.googleusercontent.com"))) {
    invalid(deployment, "VITE_GOOGLE_CLIENT_ID");
  }
  if (deployment === "production" && allowedHostedDomain !== "molcube.com") {
    invalid(deployment, "VITE_ALLOWED_HD");
  }

  const rooms = (input.rooms ?? roomsJson).map((room) => ({ ...room }));
  const policySource = input.policy ?? policyJson;
  const policy: Policy = { ...policySource, admins: [...policySource.admins] };
  validateRooms(rooms, deployment);
  validatePolicy(policy, deployment);

  return freeze({ deployment, adapter, googleClientId, allowedHostedDomain, rooms, policy });
}

export function assertBrowserConfiguration(modeEnv: Env): void {
  parseAppConfig({ modeEnv });
}
