import roomsJson from "../config/rooms.json";
import policyJson from "../config/policy.json";
import type { Policy, Room } from "../domain/types";

export const ROOMS: readonly Room[] = roomsJson;
export const POLICY: Policy = policyJson;

export function roomById(id: string): Room | null {
  return ROOMS.find((r) => r.id === id) ?? null;
}
