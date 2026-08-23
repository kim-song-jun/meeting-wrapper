import { describe, expect, it } from "vitest";
import { createRuntimeServices } from "./factory";
import type { RuntimeFactories, RuntimeServices } from "./factory";
import type { AdapterMode, AppConfig, Deployment } from "../env";

const services = (label: string) => ({ label }) as unknown as RuntimeServices;
const config = (deployment: Deployment, adapter: AdapterMode | string) =>
  ({ deployment, adapter }) as AppConfig;

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected runtime composition to fail");
}

describe("runtime factory", () => {
  it.each(["local", "preview"] as const)("allows the mock factory for %s deployment", (deployment) => {
    const calls: string[] = [];
    const mockResult = services("mock");
    const mock = () => {
      calls.push("mock");
      return mockResult;
    };
    const factories: RuntimeFactories = { mock };

    const result = createRuntimeServices(config(deployment, "mock"), factories);

    expect(result).toBe(mockResult);
    expect(calls).toEqual(["mock"]);
  });

  it("selects only an explicitly registered Google factory", () => {
    const calls: string[] = [];
    const googleResult = services("google");
    const factories: RuntimeFactories = {
      mock: () => {
        calls.push("mock");
        return services("unexpected-mock");
      },
      google: () => {
        calls.push("google");
        return googleResult;
      },
    };

    const result = createRuntimeServices(config("production", "google"), factories);

    expect(result).toBe(googleResult);
    expect(calls).toEqual(["google"]);
  });

  it("rejects a production mock before any registered factory can run", () => {
    const calls: string[] = [];
    const factories: RuntimeFactories = {
      mock: () => {
        calls.push("mock");
        return services("mock");
      },
      google: () => {
        calls.push("google");
        return services("google");
      },
    };

    const error = captureError(() => createRuntimeServices(config("production", "mock"), factories));

    expect(error).toMatchObject({
      name: "RuntimeUnavailableError",
      code: "PRODUCTION_RUNTIME_UNAVAILABLE",
      deployment: "production",
      adapter: "mock",
    });
    expect(calls).toEqual([]);
  });

  it("fails closed when the production Google factory is not registered", () => {
    const calls: string[] = [];
    const error = captureError(() =>
      createRuntimeServices(config("production", "google"), {
        mock: () => {
          calls.push("mock");
          return services("mock");
        },
      }),
    );

    expect(error).toMatchObject({
      name: "RuntimeUnavailableError",
      code: "PRODUCTION_RUNTIME_UNAVAILABLE",
      deployment: "production",
      adapter: "google",
    });
    expect(calls).toEqual([]);
  });

  it("normalizes a production Google initialization failure without trying mock", () => {
    const cause = new Error("provider initialization failed");
    const calls: string[] = [];
    const factories: RuntimeFactories = {
      mock: () => {
        calls.push("mock");
        return services("mock");
      },
      google: () => {
        calls.push("google");
        throw cause;
      },
    };

    const error = captureError(() => createRuntimeServices(config("production", "google"), factories));

    expect(error).toMatchObject({
      name: "RuntimeUnavailableError",
      code: "PRODUCTION_RUNTIME_UNAVAILABLE",
      deployment: "production",
      adapter: "google",
      cause,
    });
    expect(calls).toEqual(["google"]);
  });

  it("rejects an unknown adapter before any factory can run", () => {
    const calls: string[] = [];
    const factories: RuntimeFactories = {
      mock: () => {
        calls.push("mock");
        return services("mock");
      },
      google: () => {
        calls.push("google");
        return services("google");
      },
    };

    const error = captureError(() => createRuntimeServices(config("preview", "unexpected"), factories));

    expect(error).toMatchObject({
      name: "RuntimeUnavailableError",
      code: "RUNTIME_ADAPTER_UNAVAILABLE",
      deployment: "preview",
      adapter: "unexpected",
    });
    expect(calls).toEqual([]);
  });
});
