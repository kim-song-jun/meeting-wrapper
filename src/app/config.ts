import roomsJson from "../config/rooms.json";
import policyJson from "../config/policy.json";
import teamsJson from "../config/teams.json";
import type { Policy, Room, Team } from "../domain/types";

export const ROOMS: readonly Room[] = roomsJson;
export const POLICY: Policy = policyJson;

/**
 * 프리셋 팀. 설정 파일이라 API 의존이 없고 항상 동작한다.
 * 주소록 자동완성(People API)이 관리자 설정으로 막혀도 이쪽은 살아 있다.
 */
export const TEAMS: readonly Team[] = teamsJson.map((t) => ({
  ...t,
  members: t.members.map((m) => ({ ...m, detail: m.detail as string | null })),
}));

export function roomById(id: string): Room | null {
  return ROOMS.find((r) => r.id === id) ?? null;
}
