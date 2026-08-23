import type { AuthAdapter } from "../../auth/types";
import type { BookingRepository } from "../../data/BookingRepository";
import type { AppConfig } from "../env";

export interface RuntimeServices {
  readonly auth: AuthAdapter;
  readonly repository: BookingRepository;
}

export type RuntimeFactory = (config: AppConfig) => RuntimeServices;
export type RuntimeFactories = Readonly<Partial<Record<AppConfig["adapter"], RuntimeFactory>>>;

export type RuntimeUnavailableCode =
  | "PRODUCTION_RUNTIME_UNAVAILABLE"
  | "RUNTIME_ADAPTER_UNAVAILABLE";

export class RuntimeUnavailableError extends Error {
  readonly name = "RuntimeUnavailableError";

  constructor(
    readonly code: RuntimeUnavailableCode,
    readonly deployment: string,
    readonly adapter: string,
    cause?: unknown,
  ) {
    super(
      code === "PRODUCTION_RUNTIME_UNAVAILABLE"
        ? "Production runtime is unavailable."
        : "The selected runtime adapter is unavailable.",
      cause === undefined ? undefined : { cause },
    );
  }
}

function unavailable(config: AppConfig, adapter: string, cause?: unknown): RuntimeUnavailableError {
  const code =
    config.deployment === "production"
      ? "PRODUCTION_RUNTIME_UNAVAILABLE"
      : "RUNTIME_ADAPTER_UNAVAILABLE";
  return new RuntimeUnavailableError(code, config.deployment, adapter, cause);
}

export function createRuntimeServices(config: AppConfig, factories: RuntimeFactories): RuntimeServices {
  const adapter: unknown = config.adapter;

  if (adapter !== "mock" && adapter !== "google") {
    throw unavailable(config, typeof adapter === "string" ? adapter : "invalid");
  }
  if (config.deployment === "production" && adapter !== "google") {
    throw unavailable(config, adapter);
  }

  const factory = factories[adapter];
  if (typeof factory !== "function") {
    throw unavailable(config, adapter);
  }

  try {
    return factory(config);
  } catch (cause) {
    throw unavailable(config, adapter, cause);
  }
}
