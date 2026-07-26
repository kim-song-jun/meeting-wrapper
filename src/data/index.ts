import type { BookingRepository } from "./BookingRepository";
import { mockAdapter } from "./mockAdapter";

/**
 * 데이터 계층 스위치.
 *
 * 스파이크 테스트(설계 스펙 §10)가 끝나고 환경변수를 붙일 때
 * 이 한 줄만 googleCalendarAdapter 로 바꾼다. 화면은 손대지 않는다.
 */
export const repo: BookingRepository = mockAdapter;

export type { BookingRepository } from "./BookingRepository";
export type { CreateResult, ChangeResult } from "./BookingRepository";
