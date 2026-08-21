import type { AuthAdapter } from "../../auth/types";
import type { BookingRepository } from "../../data/BookingRepository";
import type { AppConfig } from "../env";

export interface RuntimeServices {
  readonly auth: AuthAdapter;
  readonly repository: BookingRepository;
}

export type RuntimeFactory = (config: AppConfig) => RuntimeServices;
export type RuntimeFactories = Readonly<Record<AppConfig["adapter"], RuntimeFactory>>;

export function createRuntimeServices(config: AppConfig, factories: RuntimeFactories): RuntimeServices {
  return factories[config.adapter](config);
}
