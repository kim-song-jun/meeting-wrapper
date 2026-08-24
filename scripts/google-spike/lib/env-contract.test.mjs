import { describe, expect, it } from "vitest";
import { EnvContractError, parseSharedEnv } from "./env-contract.mjs";

const sharedEnvLines = [
  "VITE_GOOGLE_CLIENT_ID=synthetic.apps.googleusercontent.com",
  "VITE_ALLOWED_HD=molcube.com",
  "GOOGLE_SPIKE_AUTHORIZED_ORIGINS=http://localhost:5184,https://molroom.molcube.com",
  "GOOGLE_SPIKE_ORDINARY_ACCOUNT=ordinary@molcube.com",
  "GOOGLE_SPIKE_ADMIN_ACCOUNT=admin@molcube.com",
  "GOOGLE_SPIKE_ROOM_A_CALENDAR_ID=room-a@molcube.com",
  "GOOGLE_SPIKE_ROOM_B_CALENDAR_ID=room-b@molcube.com",
];

describe("shared Google spike env lexical contract", () => {
  it.each([
    ["embedded tab", sharedEnvLines.join("\n").replace("synthetic.", "synthetic\t.")],
    ["bare carriage return", sharedEnvLines.join("\n").replace("synthetic.", "synthetic\r.")],
  ])("rejects %s in a value", (_case, text) => {
    expect(() => parseSharedEnv(text, { category: "INVALID_ENV" })).toThrowError(
      expect.objectContaining({
        category: "INVALID_ENV",
        pointer: "/env",
      }),
    );
  });

  it.each(["\n", "\r\n"])("accepts %j as a line delimiter", (delimiter) => {
    const parsed = parseSharedEnv(sharedEnvLines.join(delimiter), {
      category: "INVALID_ENV",
      requiredKeys: sharedEnvLines.map((line) => line.slice(0, line.indexOf("="))),
    });
    expect(parsed.GOOGLE_SPIKE_ADMIN_ACCOUNT).toBe("admin@molcube.com");
  });

  it("keeps its public errors typed without a value payload", () => {
    let caught;
    try {
      parseSharedEnv("VITE_GOOGLE_CLIENT_ID=synthetic\t.apps.googleusercontent.com", {
        category: "INVALID_ENV",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvContractError);
    expect(String(caught)).not.toContain("synthetic");
  });
});
