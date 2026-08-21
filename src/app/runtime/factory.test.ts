import { describe, expect, it } from "vitest";
import { createRuntimeServices } from "./factory";
import type { RuntimeFactories, RuntimeServices } from "./factory";
import type { AppConfig } from "../env";

const services = (label: string) => ({ label }) as unknown as RuntimeServices;
const config = (adapter: "mock" | "google") => ({ adapter }) as AppConfig;

describe("runtime factory", () => {
  it.each(["mock", "google"] as const)("selects only the %s factory", (adapter) => {
    const calls: string[] = [];
    const mockResult = services("mock");
    const googleResult = services("google");
    const mock = () => {
      calls.push("mock");
      return mockResult;
    };
    const google = () => {
      calls.push("google");
      return googleResult;
    };
    const factories: RuntimeFactories = { mock, google };

    const result = createRuntimeServices(config(adapter), factories);

    expect(result).toBe(adapter === "mock" ? mockResult : googleResult);
    expect(calls).toEqual([adapter]);
  });
});
