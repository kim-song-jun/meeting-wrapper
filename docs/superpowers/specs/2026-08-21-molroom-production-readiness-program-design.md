# MolRoom 운영 전환 프로그램 설계

- 작성일: 2026-08-21
- 대상 저장소: `kim-song-jun/meeting-wrapper`
- 운영 URL: `https://molroom.molcube.com`
- 릴리즈 목표: `v0.1.0`
- 상태: 실행 방식 A(각 Wave 독립 완료·검증) 사용자 승인
- 선행 설계: `docs/superpowers/specs/2026-07-26-molroom-design.md`

## 1. 목표

현재 mock 기반 MolRoom을 실제 `molcube.com` Google Workspace에서 사용하는 운영 서비스로 전환한다.

완료 범위는 다음을 모두 포함한다.

1. 현재 공유 작업트리의 모든 변경과 역사 문서를 분류하고 저장소 구조를 정리한다.
2. Google Identity Services, Calendar API, Drive `appDataFolder`를 실제 Workspace 계정으로 검증한다.
3. 실제 Google auth/data adapter와 안전한 요청·오류·세션 처리를 구현한다.
4. 측정과 경쟁 상태 증거가 있는 경로에만 debounce, latest-request, dedupe 또는 frame coalescing을 적용한다.
5. AWS CloudFormation으로 private S3, CloudFront, ACM, Route 53을 재현 가능하게 만든다.
6. GitHub OIDC 기반 CI/CD로 장기 AWS access key 없이 검증·배포·smoke·release를 자동화한다.
7. 한국어와 영어 운영 문서로 Google Cloud 생성부터 rollback까지 처음부터 재현할 수 있게 한다.
8. 공식 Deep Security Scan과 최종 수동 보안 검토에서 Critical/High 0건을 확인한 동일 커밋을 배포하고 `v0.1.0`으로 고정한다.

## 2. 비목표

- Calendar와 별도의 예약 데이터베이스를 미리 도입하지 않는다.
- 실제 spike가 필요성을 증명하기 전에는 인증 백엔드, Firestore, Lambda, WAF를 추가하지 않는다.
- 모든 이벤트에 일괄적으로 debounce/throttle을 넣지 않는다.
- 검증 없이 대형 화면 파일을 기계적으로 잘게 나누지 않는다.
- OAuth client secret, refresh token, service-account key, AWS access key를 저장소나 Vite 번들에 넣지 않는다.
- 다른 예약 서비스와의 동기화, 이용률 통계, 자동 노쇼 취소는 `v0.1.0`에 포함하지 않는다.

## 3. 운영 원칙

### 3.1 Wave 경계

Wave는 순차 의존성을 가진다. 한 Wave의 종료 조건이 충족되기 전에는 다음 Wave의 운영 변경을 시작하지 않는다. 같은 Wave 안에서 서로 다른 파일·책임·검증은 병렬로 수행한다.

각 Wave는 다음 순서를 지킨다.

1. 범위와 계약을 문서로 확정한다.
2. 기존 동작을 깨뜨리는 최소 RED 증거를 만든다.
3. 소유 파일을 나눠 병렬 구현한다.
4. 독립 리뷰와 직렬 통합 검증을 수행한다.
5. 정확한 pathspec만 커밋한다.
6. 커밋본 기준 검증이 끝나야 Wave를 닫는다.

### 3.2 공유 작업트리

- `main`에서만 작업하고 branch, worktree, stash를 만들지 않는다.
- 기존 미커밋 파일은 먼저 의도와 테스트를 복원한 뒤 커밋한다. 이해하지 못한 변경을 삭제하거나 덮어쓰지 않는다.
- 커밋은 정확한 pathspec만 사용한다. `.codex-artifacts/`, `.env`, `dist/`는 커밋하지 않는다.
- rollback은 새 배포로 수행하며 `git reset --hard`, 강제 push, 태그 이동을 사용하지 않는다.

### 3.3 기술부채와 구조 정리

파일 크기만으로 리팩터링하지 않는다. 다음 조건을 모두 만족할 때만 추출한다.

- 추출 단위가 하나의 독립 책임을 가진다.
- 기존 공개 인터페이스와 사용자 동작이 유지된다.
- 변경 전후를 비교할 테스트 또는 브라우저 증거가 있다.
- 추출 뒤 원본에 중복 구현이나 호환용 dead code가 남지 않는다.

## 4. 목표 아키텍처

```text
사용자 브라우저
  │
  ├─ Google Identity Services ── 사용자 OAuth access token
  │
  ├─ Google Calendar API
  │    ├─ 회의실 calendar 조회
  │    ├─ 사용자 본인 event 생성·수정·취소
  │    └─ resource attendee 수락 상태 확인
  │
  └─ Google Drive API
       └─ appDataFolder 사용자 설정

GitHub Actions
  │ OIDC 단기 자격증명
  ▼
AWS CloudFormation
  ├─ private S3 origin
  ├─ CloudFront + Origin Access Control
  ├─ ACM certificate (us-east-1)
  ├─ Route 53 alias: molroom.molcube.com
  └─ CloudFront Function + response security headers
```

기본 아키텍처는 정적 SPA다. Wave 1의 spike가 정적 구조의 필수 전제를 깨뜨릴 때만 얇은 백엔드 대안을 별도 사용자 결정으로 올린다.

### 4.1 Runtime composition

`src/app/runtime/`이 인증과 repository의 유일한 composition root가 된다.

- `SessionManager`가 메모리 안의 access token, expiry, 연결 상태, 사용자 identity를 단독 소유한다.
- `RuntimeServices`는 같은 `SessionManager`를 사용하는 `AuthAdapter`와 `BookingRepository`를 함께 생성한다.
- `RuntimeServicesProvider`가 서비스를 React tree에 주입한다.
- `AuthProvider`는 `SessionManager` 상태를 구독해 `checking | signed-out | signed-in | reconnect-required`를 노출한다.
- 화면은 전역 `repo` singleton 대신 `useRepository()`로 동일 repository를 받는다.
- 현재 `BookingRepository.getCurrentUser()`는 제거하고, 모든 화면 identity는 `useAuth().user` 하나만 사용한다.
- `SessionManager.getValidAccessToken()`이 재연결 필요 상태면 모든 새 read/mutation은 Google API 호출 전에 `ReconnectRequiredError`로 중단된다. 화면은 마지막 성공 데이터를 유지하되 오래됨 상태와 “Google 다시 연결” 동작을 표시한다.
- mutation을 시작하려면 token TTL이 최소 60초 남아 있어야 한다. 부족하면 쓰기 전에 `reconnect-required`로 전환한다. recurring create/cancel은 각 회차 시작 전에 같은 budget을 다시 확인한다.

mock과 google runtime은 같은 factory interface를 구현한다. production build는 google factory만 import하는 별도 composition entry를 사용해 mock identity와 fault fixture가 tree에 들어오지 않게 한다.

## 5. Google 연동 결정 규칙

### 5.1 인증

- Google Identity Services `initTokenClient`를 사용한다.
- OAuth consent screen은 `molcube.com` Workspace의 Internal 앱으로 만든다.
- 승인된 JavaScript origin은 로컬 개발 origin과 `https://molroom.molcube.com`만 등록한다.
- access token은 메모리에만 보관한다. `localStorage`, `sessionStorage`, IndexedDB, 쿠키에 저장하지 않는다.
- 새로고침·새 탭에서는 token을 복원하지 않고 `signed-out`으로 시작한다. 사용자의 로그인/재연결 버튼 동작 안에서만 GIS token client의 `requestAccessToken()`을 호출한다.
- access token이 만료되면 `reconnect-required`로 전환하고 자동·무음 갱신을 시도하지 않는다. 진행 중인 편집 draft와 마지막 성공 read는 메모리에 유지하되 새 API 요청을 막고, 사용자가 “Google 다시 연결”을 누른 뒤에만 재개한다.

Chrome·Safari의 데스크톱·모바일 acceptance는 로그인, 만료 감지, 명시적 재연결, 취소, scope 거절, 재연결 뒤 draft/route 복귀를 검증한다. popup은 반드시 사용자 gesture에서 열리고, 취소·차단되면 token 없이 signed-in으로 가장하지 않는다. v0.1.0은 이 상호작용 재연결을 정적 SPA의 명시적 운영 제약으로 문서화한다.

### 5.2 요청 스코프

v0.1.0의 최소 스코프는 다음과 같다.

- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/drive.appdata`

사내 디렉터리 검색은 Wave 1에서 일반 구성원 계정으로 사용 가능한 People API 범위와 반환 필드를 검증한다. 관리자 전용 Directory API만 가능한 경우 전체 도메인 디렉터리 검색을 제거하고 참석자 이메일 직접 입력을 유지한다. 서비스 계정과 domain-wide delegation은 도입하지 않는다.

### 5.3 예약 일관성

실제 adapter는 기존 3중 방어를 유지한다.

1. 화면 조회 시 점유 상태를 읽는다.
2. 쓰기 직전에 대상 회의실·시간을 다시 읽는다.
3. `events.insert` 뒤 resource attendee의 수락 상태를 확인한다.

각 create occurrence는 `crypto.randomUUID()`로 `operationId`를 만들고 organizer event의 `extendedProperties.private.molroomOperationId`에 기록한다. insert 응답을 잃으면 `primary` calendar를 해당 시간 범위와 `privateExtendedProperty=molroomOperationId=<id>`로 조회한다. 0건이면 아직 생성되지 않은 것으로, 1건이면 성공 응답을 복구한 것으로 처리한다. 2건 이상이면 가장 먼저 생성된 1건을 남기고 나머지를 검증 삭제한 뒤 중복 복구 사실을 사용자에게 알린다.

insert 뒤 resource attendee의 `responseStatus`를 organizer event에서 확인한다.

- 0~5초: 500ms 간격
- 5~20초: 1초 간격
- `accepted`: 예약 성공
- `declined`: 생성 이벤트 rollback 삭제
- `needsAction` 또는 응답 없음이 20초까지 지속: 확인 시간 초과로 rollback 삭제

rollback 삭제 뒤 event GET이 `404/410`인지 확인한다. 삭제와 확인이 모두 실패하면 결과를 성공/실패로 단정하지 않고 `unknown-outcome`과 `operationId`를 반환한다. UI는 “예약 상태를 확인할 수 없어요”와 operation ID, 캘린더 확인·지원 요청 동작을 지속적으로 보여준다.

patch 계열 mutation은 `extendedProperties.private.molroomMutationId`와 목표 필드를 한 요청에 기록하고, 응답 유실 시 event GET으로 mutation ID와 목표 필드를 함께 확인한다. delete 응답 유실은 GET의 `404/410`을 성공으로 판단한다. recurring create는 회차마다 다른 operation ID를 사용하고 결과를 회차별로 유지한다. cross-room reschedule은 하나의 organizer event에서 resource attendee를 바꾼 뒤 새 room의 수락을 확인하며, 실패하면 원래 room/time을 같은 mutation ID 계열로 복원·검증한다.

다단계 mutation 도중 API가 `401`/invalid-token을 반환하면 새 쓰기나 rollback을 추측해서 반복하지 않는다. `operationId`/`mutationId`, 이미 완료된 recurring 회차, 마지막 확인 단계, 필요한 cleanup 종류를 메모리의 resumable operation state에 보존하고 `reconnect-required`로 일시 중단한다. 사용자가 다시 연결하면 먼저 ID로 현재 Google 상태를 조회해 성공·rollback 필요·미생성을 판별하고, 그 복구가 끝난 뒤에만 다음 write/회차를 진행한다. 재연결을 취소하거나 페이지를 떠날 때는 operation ID와 Calendar 수동 확인 안내를 제공한다.

`CreateResult`, `RecurringCreateResult`, `ChangeResult`는 다음 terminal 상태를 공통으로 표현한다.

- `success`
- `conflict`
- `rolled-back` (`declined | confirmation-timeout`)
- `unknown-outcome` (`operationId`, `cleanupRequired: true`)
- `permission-denied`
- `error`

`reconnect-required`는 terminal result가 아니라 위 resumable operation state다. 재연결 뒤 reconciliation이 반드시 하나의 terminal 상태로 수렴해야 한다.

### 5.4 권한

- 화면의 `isMine`, `isAdmin`, 이메일 비교는 표시 제어일 뿐 보안 경계가 아니다.
- 본인 예약 수정은 Google이 허용한 본인 calendar event에만 수행한다.
- 관리자 취소는 Wave 1에서 검증된 room calendar writer 동작만 사용한다.
- 각 repository mutation은 소유자·관리자·리소스 범위를 명시한 권한 매트릭스 테스트를 가진다.
- production bundle에는 mock identity, QA query backdoor, title sentinel이 도달하지 않아야 한다.

### 5.5 Google event locator

room calendar copy와 organizer calendar event는 같은 event ID를 보장하지 않으므로 bare `bookingId`를 영속 locator로 사용하지 않는다. `Booking`은 UI용 도메인 필드와 별도로 다음 `GoogleEventRef`를 가진다.

```ts
interface GoogleEventRef {
  iCalUID: string;
  organizerCalendarId: "primary";
  organizerEventId: string | null;
  roomCalendarId: string;
  roomEventId: string;
  molroomSeriesId: string | null;
}
```

- room calendar 조회는 `roomCalendarId`, `roomEventId`, `iCalUID`와 room copy에서 readback한 shared `molroomSeriesId`를 채운다.
- 본인 mutation은 `organizerEventId`가 없으면 `primary` calendar를 `iCalUID`로 조회하고 start/end와 organizer identity가 일치하는 event 하나를 찾는다.
- create 응답은 organizer event ID를 즉시 보존한다.
- 관리자 취소는 spike로 검증된 `roomCalendarId + roomEventId` 경로만 사용한다.
- recurring booking은 Google RRULE master를 만들지 않는다. 각 회차를 독립 event로 생성하고 동일한 `extendedProperties.shared.molroomSeriesId`로 연결한다. series ID는 비밀값이나 권한 근거가 아니며, 각 event는 별도 private operation ID와 room acceptance 결과를 가진다.
- 본인 series cancel은 `primary` calendar를 `sharedExtendedProperty=molroomSeriesId=<id>`로 조회해 찾은 독립 event를 하나씩 organizer identity와 locator로 다시 검증한 뒤 삭제한다.
- 관리자 series cancel은 로그인 사용자의 `primary`를 사용하지 않는다. configured room calendar 각각을 같은 shared property로 조회하고 `iCalUID`로 중복 제거한 뒤, Wave 1에서 검증된 `roomCalendarId + roomEventId` writer 경로로 각 room copy를 삭제한다. 다른 room/series나 검증되지 않은 organizer event를 추측해서 삭제하지 않는다.
- 두 경로 모두 회차별 결과를 반환하고 일부 삭제 실패를 전체 성공으로 숨기지 않는다.
- Wave 1은 shared series ID가 organizer event와 room calendar copy 양쪽에서 동일하게 readback되는지 확인한다. 이 검증이 실패하면 관리자 series cancel을 구현하지 않고 architecture를 다시 사용자 결정으로 올린다.
- locator가 0건 또는 복수 건이면 추측해 쓰지 않고 typed `event-locator-ambiguous` 오류를 반환한다.

운영 출시 전 Google 데이터가 없으므로 RRULE master에서의 migration은 없다. 기존 mock `seriesId`는 그대로 `molroomSeriesId` 계약으로 승격한다. `toRRule()`이 production/runtime 소비자를 잃으면 테스트와 함께 완전히 제거하고 호환 dead code를 남기지 않는다.

### 5.6 Google acceptance matrix

Wave 1 spike와 Wave 2 최종 acceptance는 동일한 matrix를 일반 사용자와 관리자 계정으로 실행한다. 각 행은 요청/응답 요약, Google request ID, operation ID, 결과 event locator를 token·제목·참석자 이메일 없이 JSON evidence로 남긴다.

| Repository surface | 일반 사용자 기대 | 관리자 기대 | 필수 추가 검증 |
|---|---|---|---|
| day/range/room 조회 | 공유 room event 조회 | 동일 | 제목 비노출, organizer 표시 범위 |
| mine/future/past 조회 | 본인 primary event만 | 본인 primary event만 | pagination/time zone |
| single create | 본인 organizer event 생성 | 동일 | 직전 충돌, accepted/declined/timeout |
| recurring create | 독립 event 회차별 부분 성공 | 동일 | series ID, operation ID, 26회 cap |
| instance cancel | 본인 instance만 | 본인 또는 검증된 room copy | 다른 회차 유지 |
| series cancel | series ID의 본인 event 전체 | 검증된 관리자 경로 | 회차별 삭제 결과, 이미 삭제된 event |
| extend/shorten | 본인 event, 직전 충돌 조회 | 동일 | ambiguous response recovery |
| same/cross-room reschedule | 본인 event | 동일 | 원래 room 복원, 두 브라우저 경쟁 |
| admin cancel | 거절 | room writer만 성공 | 비관리자 UI 우회 호출 거절 |
| check-in | 본인 event shared property | 동일 | room copy readback |
| summary save/delete | 본인 event만 | 남의 event 거절 | 참석자 calendar 반영 |
| prefs read/write | 본인 appDataFolder | 동일 | 다른 기기 readback |
| directory search | 공개 범위 결과 또는 빈 결과 | 동일 | 최신 요청만 표시, 자유 입력 유지 |

두 브라우저가 같은 room/time을 동시에 예약하는 테스트에서 정확히 하나만 최종 `accepted`여야 한다. 모든 row는 배포 후보 SHA와 evidence manifest에 연결한다.

## 6. 요청·성능 계약

### 6.1 디렉터리 검색

기존 250ms 입력 debounce를 유지한다. 추가 debounce를 겹치지 않는다. 새 검색이 시작되면 이전 요청은 `AbortController` 또는 단조 증가 request ID로 무효화하고, 가장 최신 검색만 결과·오류 상태를 갱신한다.

### 6.2 공용 비동기 상태

`useAsync.reloadAsync()`에는 latest-request-wins 계약을 추가한다. 늦게 끝난 과거 요청이 새 데이터, 오류, loading 상태를 덮어쓸 수 없다. repository mutation 직전의 신선한 조회는 dedupe하지 않는다.

### 6.3 Drag·resize

현재 grid drag는 슬롯이 바뀌지 않으면 state 갱신을 생략한다. 이 경로에는 timer debounce를 추가하지 않는다.

측정은 production build를 Chrome stable, 1440×1000, fine pointer, 기본 2개 room/seed event 상태에서 수행한다. 같은 event를 10초 동안 두 room과 12개 slot을 왕복하는 scripted pointer path를 warm-up 1회 뒤 5회 실행한다. Playwright trace와 JSON에 pointer event 수, React commit 수, handler-to-next-paint 시간, long task, layout read 수, 최종 slot을 기록한다.

다음 중 하나가 5회 중 3회 이상 재현될 때만 `requestAnimationFrame` coalescing을 구현한다.

- handler-to-next-paint p95가 16.7ms 초과
- 10초 구간에서 50ms 초과 long task가 1개 이상
- pointer event당 `getBoundingClientRect()`가 평균 1회를 초과
- 최종 pointer 위치와 preview/commit slot이 한 slot 이상 불일치

구현 시 active drag 동안 최신 pointer 하나만 frame마다 계산하되 mouseup의 최종 좌표는 동기 반영한다. 같은 5회 측정에서 최종 slot 오차 0, 접근 가능한 모든 room/slot 유지, p95/long-task/layout-read 중 trigger가 된 지표의 개선을 확인한다. 조건이 재현되지 않으면 변경하지 않고 “coalescing 불필요” evidence를 남긴다.

### 6.4 API retry와 quota

- 안전한 read는 `429`, `500`, `502`, `503`, `504`에 한해 최대 3회 exponential backoff와 full jitter를 사용한다.
- `Retry-After`가 있으면 이를 우선한다.
- 인증 오류 `401`은 토큰 재연결 경로로 보내며 반복 재시도하지 않는다.
- 권한 오류 `403`은 사용자에게 필요한 Workspace/Calendar 설정을 알려준다.
- write는 반영 여부를 조회하지 않은 채 재전송하지 않는다.
- 모든 timer, listener, AbortController는 unmount 또는 요청 교체 시 정리한다.

## 7. AWS 배포 설계

### 7.1 CloudFormation

`infra/aws/`에 AWS native CloudFormation을 둔다. CDK와 Terraform 의존성을 추가하지 않는다.

첫 배포는 GitHub OIDC role이 아직 없으므로 두 stack으로 나눈다.

1. `molroom-bootstrap`: 사용자가 AWS SSO/login으로 인증한 로컬 CLI에서 한 번 배포한다. GitHub OIDC provider와 최소 권한 deploy role만 소유한다.
2. `molroom-production`: 이후 GitHub Actions가 OIDC role로 배포한다. 애플리케이션 hosting resource만 소유한다.

bootstrap template은 `ExistingGitHubOidcProviderArn` parameter를 받는다. 비어 있으면 account-wide provider를 만들고, 값이 있으면 기존 provider를 참조하며 삭제하지 않는다. bootstrap stack이 만든 provider도 다른 repository가 사용 중이면 stack 삭제 전에 retain/import 결정을 해야 한다. production stack 삭제는 bootstrap role/provider를 삭제하지 않는다.

AWS preflight는 다음 값을 evidence에 기록한다.

- `aws sts get-caller-identity` account ID와 caller ARN
- Route 53 `molcube.com` hosted-zone ID, 소유 account, public NS 일치
- ACM DNS validation record 생성 권한
- 기존 GitHub OIDC provider ARN과 소유 stack
- GitHub repository `kim-song-jun/meeting-wrapper`, branch `main`, workflow path
- GitHub `production` environment의 protection/variable 설정

hosted zone이 다른 AWS account에 있거나 SSO principal이 record/certificate 권한을 갖지 않으면 bootstrap을 실행하지 않고 cross-account DNS 설계를 사용자 결정으로 올린다.

운영 stack 이름은 `molroom-production`이며 `us-east-1`에 배포한다. stack은 다음을 생성한다.

production stack은 `ActiveReleaseSha`와 `DistributionEnabled` parameter를 받는다. `ActiveReleaseSha`가 현재 운영 릴리즈의 유일한 권위(source of truth)이며, `DistributionEnabled`는 첫 릴리즈 전 origin 노출을 막는 수명주기 flag일 뿐 별도 release locator가 아니다. viewer-request CloudFront Function 코드는 `ActiveReleaseSha`에서 생성되고 CloudFormation만 갱신한다. workflow, SSM, 로컬 파일은 별도의 active-release 상태를 저장하지 않는다.

첫 stack 생성은 `ActiveReleaseSha=UNRELEASED`, `DistributionEnabled=false`로 수행한다. 이 상태는 active release와 rollback 대상이 없으며 public distribution을 제공하지 않는다. 첫 verified release prefix가 준비된 뒤 release change set이 target SHA와 `DistributionEnabled=true`를 함께 적용한다. 첫 cutover smoke가 실패하면 새 change set으로 `UNRELEASED/false`에 복귀한다. 두 번째 릴리즈부터는 이전 active SHA가 rollback 대상이다. 일반 infrastructure change set은 두 parameter 모두 `UsePreviousValue=true`를 사용한다.

- account/region을 포함한 고유 이름의 private S3 bucket
- bucket public access block과 versioning
- CloudFront Origin Access Control과 S3 bucket policy
- `molroom.molcube.com` ACM certificate와 DNS validation
- CloudFront distribution
- Route 53 A/AAAA alias record
- viewer-request CloudFront Function
- custom response headers policy
- private CloudFront standard log bucket과 30일 lifecycle

배포 파일은 bucket root가 아니라 `releases/<commit-sha>/` 아래에 immutable하게 올린다. 각 prefix는 artifact 파일과 함께 `_manifest.sha256`, `_release.json`, `_security-gate.json`을 포함한다. `_manifest.sha256`은 runtime artifact object만 경로순으로 기록하고 metadata 파일 자체는 포함하지 않는다. `_release.json`은 schema version, package version, commit SHA, commit timestamp(`SOURCE_DATE_EPOCH`), manifest SHA-256만 담는 결정적 파일이다. workflow run URL, 실제 build 시각, runner tool version처럼 rerun마다 바뀔 수 있는 값은 넣지 않는다. `_security-gate.json`은 §8.1의 승인된 redacted attestation 원본이다. 최초 upload provenance와 실제 toolchain은 GitHub workflow artifact와 최종 Release note에 별도로 기록한다.

bucket versioning을 켠다. `releases/*`의 모든 upload는 `PutObject`의 `If-None-Match: *`를 사용하고 bucket policy가 `s3:if-none-match` 없는 쓰기를 거부한다. deploy role과 일반 운영 주체에는 `DeleteObject`, `DeleteObjectVersion`, `PutLifecycleConfiguration` 권한을 주지 않고 bucket policy도 이를 거부한다. workflow는 upload에 `aws s3 sync`를 쓰지 않고 `s3api put-object` 또는 SDK의 조건부 write만 사용한다. repair/rollback의 private temporary directory download는 remote bytes의 bounded controller reinspection을 위한 read-only `s3 sync`만 허용하며 re-upload/copy에는 사용하지 않는다. `412 Precondition Failed`이면 기존 object와 S3 metadata manifest를 읽어 hash가 모두 같을 때만 재사용하고, 다르면 immutable violation으로 실패한다. Object Lock은 새 current version 생성을 막지 못하므로 이 기본 계약에 사용하지 않는다.

CloudFront Function은 `ActiveReleaseSha`를 코드 상수로 받아 요청을 해당 prefix로 보낸다. 확장자가 없는 route는 `releases/<sha>/index.html`로, 실제 asset/file은 `releases/<sha>/<path>`로 보낸다. `/assets/*`와 실제 파일의 404를 SPA 문서로 바꾸지 않는다. release/rollback mode만 명시적으로 active parameter를 바꾸며, workflow 재시작 시 현재 상태는 stack parameter를 다시 조회해 복구한다.

### 7.2 Cache

- 해시가 붙은 `/assets/*`: `public, max-age=31536000, immutable`
- `index.html`, `_manifest.sha256`, `_release.json`, service-worker 계열 파일: `no-cache`
- active release 전환 뒤 CloudFront invalidation은 `/`, `/index.html`, 확장자 없는 route에 한정한다.
- S3 versioning과 release prefix를 유지한다. rollback은 기존 annotated tag/SHA와 S3의 `_manifest.sha256`이 일치하는 prefix로 `ActiveReleaseSha`를 되돌린다.
- 신규 prefix upload와 direct release-path asset 검증은 active 전환 전에 수행한다.
- active 전환 후 smoke가 실패하면 workflow가 이전 SHA를 넣은 CloudFormation change set을 생성·실행하고 rollback smoke를 수행한다. rollback smoke까지 실패하면 workflow는 Critical incident 상태로 끝나며 tag/release를 만들지 않는다.

### 7.3 보안 헤더

운영 응답은 다음 값을 사용한다.

```text
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' https://accounts.google.com; style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://lh3.googleusercontent.com; connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com; frame-src https://accounts.google.com; form-action 'self' https://accounts.google.com; manifest-src 'self'; worker-src 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin-allow-popups
```

외부 font/CDN은 production runtime 구현 전 self-hosting으로 전환한다. `style-src-attr 'unsafe-inline'`은 현재 grid/event의 숫자 기반 위치·크기와 제한된 layout 값을 React `style` attribute로 전달하기 위해 의도적으로 허용한다. 허용 값은 코드에서 만든 유한 enum 또는 검증된 number만 가능하며, 사용자 문자열·URL·CSS fragment를 style에 전달할 수 없다. inline script와 inline `<style>` element에는 `'unsafe-inline'`을 허용하지 않는다.

정적 보안 gate는 `dangerouslySetInnerHTML`, `style.cssText`, `setAttribute('style', ...)`, 문자열 기반 style spread, 사용자 입력에서 CSS custom property/URL로 이어지는 경로를 거부한다. 실제 브라우저 gate는 desktop/mobile의 모든 route와 drag/resize 상태에서 CSP console violation 0건을 요구한다. CSP 아래에서 GIS popup 로그인, 사용자 동작 재연결, Calendar/Drive fetch, profile image, 모든 SPA route를 smoke한다.

CloudFront access log는 private bucket에 암호화 저장하고 30일 뒤 삭제한다. query string, cookie, authorization header는 애플리케이션 로그로 수집하지 않는다.

## 8. CI/CD와 Release

### 8.1 CI

`main` push와 pull request에서 다음을 직렬 또는 의존 순서로 수행한다.

1. `npm ci`
2. design standalone 재생성 및 clean-diff 확인
3. design example/contract validation
4. focused unit suite
5. typecheck
6. production build
7. production bundle secret/backdoor scan
8. artifact upload

build toolchain은 `.node-version`의 정확한 Node patch와 `package.json#packageManager`의 정확한 npm version으로 고정한다. local, CI, release workflow 모두 같은 두 값을 읽고, major-only version(`22`, `24`)이나 runner bundled npm을 사용하지 않는다. toolchain을 바꾸는 변경은 새 commit/SHA에서만 가능하므로 기존 release SHA의 repair artifact를 바꾸지 않는다.

로컬 `scripts/build-security-attestation.mjs`는 완료된 manual threat review와 official Deep Security Scan 결과에서 공개 가능한 요약만 읽어 최대 32KB의 `security-gate-attestation.json`을 만든다. schema는 target SHA, 각 source report SHA-256, scan tool/version, completed timestamp, Critical/High count, redacted finding ID 목록만 허용한다. token, 이메일, 제목, request/operation ID, 로컬 절대 경로는 거부한다. 원본 report는 업로드하지 않고 로컬 제한 evidence로 유지한다.

별도 `security-gate.yml` 수동 workflow는 `target_sha`와 위 JSON의 base64 payload를 받고 GitHub `production` environment 승인을 요구한다. workflow는 payload size/schema, exact `origin/main` SHA, 두 64자리 digest, Critical/High 0을 직접 검사한다. 원본 report 내용 자체를 재실행·검증한다고 주장하지 않으며, production-environment reviewer가 두 digest와 zero-count가 원본 report와 일치함을 승인하는 서명된 attestation 경계다. GitHub의 environment deployment audit가 reviewer identity와 approval time을 보존하고, JSON에는 repository, run ID, dispatch actor, gate timestamp를 더한다. `security-gate-<sha>` workflow artifact는 public repository가 허용하는 최대 retention으로 보관하고, 장기 보존은 아래 S3/GitHub Release 복사가 담당한다.

최초 release upload 전에는 release workflow가 지정 run의 conclusion/repository/target SHA를 API로 확인하고 artifact의 exact JSON을 사용한다. `_security-gate.json`을 S3 release prefix에 조건부로 처음 쓴 순간부터 그 object가 장기 권위가 된다. 이후 repair는 Actions artifact가 만료됐어도 S3 JSON의 schema, target SHA, zero counts, source digests, 기록된 `security_gate_run_id`를 검증해 사용하고 누락된 GitHub Release asset을 같은 bytes로 복구한다. S3 JSON이 아직 없고 artifact만 만료된 pre-upload 실패라면 같은 SHA에 새 security-gate run을 만들 수 있지만, S3에 한 번 고정된 뒤에는 다른 attestation으로 덮어쓰지 않는다.

### 8.2 Production workflow

Release A의 exact machine-readable contract는 다음과 같다.

```text
public.env.keys=VITE_DEPLOYMENT,VITE_ADAPTER,VITE_GOOGLE_CLIENT_ID,VITE_ALLOWED_HD
private.env.keys=VITE_GOOGLE_CLIENT_ID,VITE_ALLOWED_HD,GOOGLE_SPIKE_AUTHORIZED_ORIGINS,GOOGLE_SPIKE_ORDINARY_ACCOUNT,GOOGLE_SPIKE_ADMIN_ACCOUNT,GOOGLE_SPIKE_ROOM_A_CALENDAR_ID,GOOGLE_SPIKE_ROOM_B_CALENDAR_ID
task5.env.keys=GOOGLE_SPIKE_ORDINARY_ACCOUNT,GOOGLE_SPIKE_ADMIN_ACCOUNT,GOOGLE_SPIKE_ROOM_A_CALENDAR_ID,GOOGLE_SPIKE_ROOM_B_CALENDAR_ID
github.repository.variables=VITE_GOOGLE_CLIENT_ID,VITE_ALLOWED_HD
github.production_environment.variables=AWS_ACCOUNT_ID,AWS_DEPLOY_ROLE_ARN,CLOUDFORMATION_ROLE_ARN,HOSTED_ZONE_ID
release.controller.ref=refs/tags/molroom-release-controller-v1
release.controller.sha=7ba2814f491dccee9462c7bf01958dd28600b048
release.controller.inputs=mode,version,target_sha,candidate_run_id,security_gate_run_id,execute_cutover,confirmation
```

권한 경계는 세 workflow로 분리한다.

1. `.github/workflows/release.yml`은 `target_sha`만 받는 credential-free candidate artifact producer다. independently protected annotated `refs/tags/molroom-release-controller-v1`을 checkout하고 peeled commit이 `7ba2814f491dccee9462c7bf01958dd28600b048`인지 확인한다. candidate install/test/build는 exact four public VITE 값만 가진 disposable container 안에서 수행한다. secret, Environment, OIDC, AWS, GitHub write는 없다. container wait/stop/copy/remove 뒤 trusted host가 stable copied tree를 최종 scan/digest하고 새 receipt를 만들며 retained artifact만 후속 단계의 source가 된다.
2. approved `.github/workflows/security-gate.yml`은 같은 target SHA의 사람 승인 evidence를 만든다. controller는 Actions API의 repository/path/head/event/conclusion/artifact ID/server digest를 검사하고, approved security-gate workflow blob을 target SHA의 blob과 byte 비교하며 evidence의 `dispatch_actor`를 server workflow-run actor에 묶는다.
3. `.github/workflows/release-controller.yml`은 separately dispatched trusted controller다. workflow file은 independently protected immutable controller tag에서만 실행하며 candidate commit을 checkout/import/execute하지 않는다. dispatch inputs는 정확히 `mode,version,target_sha,candidate_run_id,security_gate_run_id,execute_cutover,confirmation`이다. release mode만 두 run ID를 받고 repair/rollback에서는 비워 둔다.

release mode의 순서는 candidate run → security-gate run → controller dispatch다. 먼저 `execute_cutover=false` PLAN을 검토하고, required reviewer가 self-approval 없이 승인한 뒤 `execute_cutover=true`, `confirmation=RELEASE`로 실행한다. fresh unprivileged prepare는 exact artifact ID ZIP과 server digest를 검증하고 safe extractor로 candidate/security ZIP을 서로 다른 temp root에 푼다. fresh production Environment deploy만 `id-token: write`를 받아 AWS를 사용하며, fresh publish만 `contents: write`를 받는다.

deploy는 stable CloudFormation observer가 exact absence일 때만 CREATE, stable present일 때 UPDATE 또는 no-change를 선택한다. prior `ActiveReleaseSha`/`DistributionEnabled`와 stack absence를 먼저 기록한 뒤 conditional prefix upload, exact remote verification, invalidation, propagation, target-SHA release-metadata smoke를 수행한다. 어느 단계든 실패하면 prior pair로 restore하고 restored-SHA smoke를 수행한다. 최초 CREATE 실패는 DeleteStack+confirmed absence로 복구해 `UNRELEASED/false`가 된다. restore 실패는 fatal이다.

repair는 active target SHA/version의 existing immutable prefix와 `_release.json.package_version`을 검증하고 metadata/GitHub Release만 보수하며 cutover하지 않는다. rollback은 existing annotated version tag와 immutable prefix를 검증한 뒤 active pointer만 바꾸고 동일 smoke/restore 계약을 적용한다. repair/rollback은 candidate dependency, test, build, archive upload를 실행하지 않는다. publish는 origin/main과 annotated tag를 create 전후 다시 확인하고 Release body/assets를 exact 비교한다.

GitHub repository variable은 `VITE_GOOGLE_CLIENT_ID`, `VITE_ALLOWED_HD` 둘뿐이다. production Environment variable은 `AWS_ACCOUNT_ID`, `AWS_DEPLOY_ROLE_ARN`, `CLOUDFORMATION_ROLE_ARN`, `HOSTED_ZONE_ID` 넷뿐이다. Environment에는 required reviewer, no self-approval, protected controller tag deployment-ref restriction을 둔다. controller tag와 `v*` tag를 보호하며 no long-lived AWS credentials 원칙을 지킨다.

AWS root가 아닌 AWS SSO 관리자가 `us-east-1`에서 `infra/aws/molroom-bootstrap.yml`을 실행한다. parameter는 `ControllerTag=molroom-release-controller-v1`, `HostedZoneId`, `ProductionStackName=molroom-production`, optional `ExistingGitHubOidcProviderArn`, exact subject `repo:kim-song-jun/meeting-wrapper:environment:production`이다. trust는 `.github/workflows/release-controller.yml@refs/tags/molroom-release-controller-v1`에만 허용한다. stack output `GitHubDeployRoleArn`과 `CloudFormationExecutionRoleArn`을 각각 production Environment role ARN에 매핑한다.

위 GitHub protection/Environment, AWS bootstrap, Google human evidence, release/repair/rollback, DNS/TLS, smoke/restore는 아직 실제 외부 시스템에서 수행되지 않았다. configured/deployed/live 상태를 주장하지 않는다.

## 9. 구성과 비밀값

### 9.1 브라우저에 포함 가능한 공개 값

- `VITE_DEPLOYMENT=local | preview | production` (기본 `local`)
- `VITE_ADAPTER=mock | google` (`local` 기본 `mock`)
- `VITE_GOOGLE_CLIENT_ID`
- `VITE_ALLOWED_HD=molcube.com`
- `src/config/rooms.json`의 room resource calendar IDs
- `src/config/policy.json`의 booking policy와 표시용 관리자 이메일

`VITE_GOOGLE_CLIENT_ID`와 `VITE_ALLOWED_HD`만 GitHub repository variable로
관리한다. `VITE_DEPLOYMENT=production`과 `VITE_ADAPTER=google`은
credential-free candidate workflow가 고정한다. public VITE 값을 GitHub
`production` Environment에 복제하지 않는다. 이름에 `VITE_`가 붙은 값은
번들에서 공개된다는 사실을 README에 명시한다. `rooms.json`과 `policy.json`은
repository에 추적되는 공개 배포 구성이고 Environment variable이 아니다.

`src/app/env.ts`가 env와 JSON config를 한 번 파싱해 immutable `AppConfig`를 만든다. precedence는 명령 환경변수 → Vite mode env file → 위 기본값 순서다. room/policy/admin 값은 env JSON으로 복제하지 않고 tracked JSON을 단일 source로 유지한다.

validation 계약은 다음과 같다.

- `production`은 `VITE_ADAPTER=google`이어야 한다.
- google adapter는 `VITE_GOOGLE_CLIENT_ID`가 비어 있지 않고 `.apps.googleusercontent.com`으로 끝나야 한다.
- `production`의 `VITE_ALLOWED_HD`는 정확히 `molcube.com`이어야 한다.
- room ID, 이름, calendar ID는 비어 있지 않고 중복될 수 없다.
- policy의 slot/duration/advance 값은 양의 정수이며 서로의 기존 domain invariant를 만족해야 한다.
- production config 오류는 앱을 mock으로 fallback하지 않고 build와 boot를 `Invalid production configuration: <field>`로 실패시킨다.
- local mock 기본값은 현재 개발 경험을 유지한다.

### 9.2 금지 값

다음은 GitHub variable/secret 여부와 무관하게 Vite build에 전달하지 않는다.

- OAuth client secret
- authorization code 또는 refresh token
- service-account JSON/key
- AWS access key/secret key/session token
- privileged API key

정적 구조가 실패해 백엔드가 필요해질 때만 백엔드 비밀값을 AWS Secrets Manager에 저장하고 별도 threat model을 승인받는다.

### 9.3 진단과 개인정보

v0.1.0은 중앙 application telemetry를 추가하지 않는다. 브라우저는 메모리 안에 최대 100개의 redacted diagnostic event만 보관하고 사용자가 명시적으로 “진단 정보 복사”를 선택할 때 text로 내보낸다.

허용 필드는 timestamp, app version/SHA, operation ID, error category, HTTP status, Google request ID, route template이다. access token, authorization header, 이름, 이메일, 회의 제목, 요약, 참석자, room query string은 console·diagnostic·GitHub artifact에 남기지 않는다.

`unknown-outcome`과 rollback-delete failure는 사용자에게 operation ID와 수동 Calendar 확인 절차를 제공한다. 중앙 app log가 없다는 사실을 README 장애 대응 장에 명시한다. CloudFront access log는 가용성/edge 진단만 사용하며 application mutation 성공 여부의 증거로 사용하지 않는다.

## 10. 저장소 정리 설계

### 10.1 현재 변경 보존

현재 미커밋 product 변경은 삭제하지 않는다. `ui.tsx`, `MyBookingsScreen`, `RecurrenceResult`, `RoomLandingScreen`, `RoomsScreen`의 동작을 각각 focused test와 live browser로 검증한 뒤 의미별 커밋으로 보존한다.

### 10.2 문서와 도구

- root의 `DESIGN_DEPRECATED*.md`는 삭제하지 않고 `docs/archive/design/`으로 이동한다.
- `docs/liquid-glass-reference.md`와 기존 spec/plan은 역사·근거 문서로 보존한다.
- legacy `.omd` metadata와 OMD cursor rule은 새 `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/design-system.mdc`로 대체되었음을 확인한 뒤 제거한다.
- `src/data`, `src/domain`, `src/screens`의 scoped `AGENTS.md`를 커밋한다.
- `.codex-artifacts/`를 `.gitignore`에 추가하고 현재 세션 종료 시 로컬 artifact를 휴지통으로 이동한다.
- generated design standalone 파일은 generator로만 갱신한다.

### 10.3 코드 구조

Wave 0에서는 다음 대형 파일의 characterization evidence와 extraction boundary만 만든다. 실제 추출은 Wave 1 spike가 정적/백엔드 아키텍처를 확정한 뒤 Wave 2에서 수행한다.

- `GridScreen.tsx`: view range/query orchestration, pointer interaction, dialog orchestration, day/week/month view
- `grid.css`: axis/event/view/interaction/media-query sections
- `MyBookingsScreen.tsx`: booking item, past-summary editor, cancellation dialog, admin/settings tabs
- `mockAdapter.ts`: seed fixtures, fault fixtures, read model, mutation implementation
- `ui.tsx`: input primitives와 dialog lifecycle
- `validate-design-contract.mjs`: parser, runtime rules, canonical example rules, CLI

추출은 공개 import seam을 유지하고 각 단계에서 unused compatibility export를 남기지 않는다.

## 11. 한영 문서 구조

- `README.md`: 언어 선택과 1분 quick start
- `README.ko.md`: 한국어 전체 운영 가이드
- `README.en.md`: 영어 전체 운영 가이드

두 전체 README는 다음 canonical 8-section ID와 순서를 정확히 공유한다.

release.readme.sections=release.toolchain,release.google-oauth,release.env,release.validation,release.aws-oidc,release.first-release,release.rollback,release.security

1. [release.toolchain] 고정 toolchain과 host/process preflight
2. [release.google-oauth] Google Cloud OAuth, Workspace, room/account human setup
3. [release.env] public/private env, ignored 0600 files, local validators
4. [release.validation] static checks and credential-free candidate gate
5. [release.aws-oidc] GitHub protection/Environment and AWS SSO bootstrap
6. [release.first-release] candidate→security gate→controller PLAN/release/repair
7. [release.rollback] immutable-prefix rollback, smoke, restore
8. [release.security] external blockers, prohibited secrets, incident response

명령·URL·환경변수 이름·검증 결과는 두 언어에서 동일하게 유지한다. 문서 검증 스크립트가 양쪽 heading과 locked command block의 대응을 검사한다.

### 11.1 문서 재현성 검증

한국어 runbook은 최초 운영 provisioning의 실제 실행 문서다. 새 clone에서
committed `.env.example`과 `.env.google-spike.example`을 각각 ignored
`.env`와 `.env.google-spike.local`로 복사해 0600으로 제한하고, 새 브라우저
profile에서 시작한다. 필요한 Google Workspace/AWS/GitHub 관리자 권한을 가진
담당자가 `README.ko.md`만 보며 Google project/OAuth, room ACL, AWS SSO
bootstrap, GitHub Environment, archive verification, 첫 release, production
smoke, rollback rehearsal을 순서대로 수행한다. local archive verification은
AWS/GitHub credential을 받지 않으며 GitHub-only deploy role을 검사하지 않는다.
account ID·ARN·client ID는 일부 가린 checklist, 각 command exit code, 생성
resource 목록, smoke 결과, rollback 전후 active SHA를 evidence로 보존한다.

영문 runbook은 독립 검토자가 새 clone과 새 브라우저 profile에서 `README.en.md`만 보고 검증한다. 한국어 문서와 이 설계 문서는 참고하지 않는다. 실제 resource를 중복 생성하지 않고 read-only Google/AWS SSO preflight, retained archive receipt reinspection, CloudFormation template validation과 execute하지 않는 change set 작성, production route/header/OAuth smoke, rollback dry-run을 수행한다. command exit code, change-set diff, smoke 결과, dry-run 대상 SHA를 evidence로 남긴다.

parity validator는 두 문서의 heading 순서, section count, URL, environment variable 이름, workflow input, expected terminal state와 각 runbook의 byte-identical one-line archive command를 비교한다. 일반 shell allowlist나 문서 속 executable controller는 사용하지 않는다. 검증 중 문서 밖 설명이나 현장 수정이 한 번이라도 필요하면 두 문서를 함께 고치고 해당 언어 clean-room 절차를 처음부터 다시 수행한다.

## 12. Wave 계획

### Wave 0 — 기준선과 구조

- 현재 dirty product 변경 검증·보존
- OMD migration과 artifact hygiene 완료
- root 문서 구조 정리
- 대형 파일 characterization과 extraction contract 작성(실제 추출은 보류)
- Google spike harness에 필요한 runtime config parser와 adapter factory interface만 추가
- 현재 mock behavior와 production bundle guard의 RED evidence 작성

### Wave 1 — 실제 Google spike

- OAuth Internal app과 web client 생성
- `extendedProperties.shared`, event visibility, Meet, auto-accept/decline 검증
- independent-event recurrence의 shared series ID와 organizer/room copy readback 검증
- Drive `appDataFolder`, admin cancel, Workspace edition 검증
- Chrome/Safari desktop/mobile token 만료·사용자 재연결 검증
- 각 결과를 재현 가능한 spike report로 커밋

### Wave 2 — 운영 runtime

- Google auth adapter
- Calendar/Drive adapter와 adapter composition
- `GoogleEventRef`, exclusive terminal result, per-occurrence recurring result로 domain/repository 계약 migration
- RRULE production consumer가 없음을 전수 확인한 뒤 `toRRule()`과 해당 mock-era 테스트 완전 제거
- 권한·오류·retry·cancellation 계약
- mock/production bundle 분리
- directory search와 `useAsync` latest-request 계약
- architecture가 확정된 대형 파일의 책임별 추출
- 외부 font/CDN self-hosting
- drag/resize 측정과 trigger 충족 시에만 frame coalescing
- 실제 브라우저 acceptance와 concurrency 검증

### Wave 3 — AWS와 CD

- CloudFormation과 최소 권한 OIDC role
- CloudFront SPA routing, cache, headers
- CI artifact와 production workflow
- production 환경변수로 만든 local production-artifact browser smoke
- CloudFormation template validation과 `UNRELEASED/false` 최초 stack/change-set 검증
- release/rollback workflow dry-run과 조건부 S3 upload script 검증
- 이 Wave에서는 release prefix를 active로 전환하지 않는다.

### Wave 4 — 보안·문서·릴리즈

- README 한국어/영어 완성 및 parity validation
- release 후보 SHA에 대한 수동 threat checklist 검토
- official Deep Security Scan 실행·완료
- Critical/High finding 전부 수정
- 수정이 발생하면 동일 후보 SHA 기준 수동 검토와 Deep Security Scan 재실행
- 깨끗한 커밋 archive 전체 검증
- 최종 후보 SHA를 main에 push하고 정확한 `origin/main` SHA의 CI 성공 확인
- 그 SHA로 `security-gate.yml`을 실행해 `security-gate-<sha>` evidence 생성·검증
- CI/push 뒤 수정이 필요하면 새 SHA의 수동 검토·Deep Security Scan·archive 검증·push부터 반복
- immutable release prefix upload/direct 검증, production workflow cutover, 운영 OAuth/route/header smoke와 실패 시 자동 rollback
- `v0.1.0` annotated tag와 GitHub Release 확인

## 13. 최종 종료 증거

다음이 모두 실제 결과로 확인되어야 “운영 릴리즈 완료”라고 말할 수 있다.

1. 모든 기존 변경이 의도별 커밋으로 분류되고 미분류 tracked/untracked product 파일이 없다.
2. 새 `git archive`에서 `npm ci`, design generation/validation, tests, typecheck, build가 통과하고, 그 archive-built bytes를 no-follow copy·atomic rename·재검사로 retained artifact로 고정한다. protected release job은 같은 receipt/tree digest를 다시 검증한 bytes만 manifest와 upload 입력으로 사용한다.
3. production `dist/`에 금지된 secret, mock identity, QA backdoor 문자열이 없다.
4. §5.6의 Google OAuth, Calendar, Drive acceptance matrix 전체가 실제 `molcube.com` 일반 사용자와 관리자 계정으로 통과한다.
5. 최종 후보 SHA의 수동 threat checklist와 official Deep Security Scan이 완료되고 Critical/High finding이 0건이다.
6. `https://molroom.molcube.com`에서 `/`, `/login`, `/rooms`, `/me`, `/r/:roomId`가 새로고침을 포함해 정상 동작한다.
7. CloudFront cache와 보안 헤더가 설계값과 일치한다.
8. origin/main CI가 성공한다.
9. GitHub Release와 annotated `v0.1.0` tag가 active release manifest의 동일 SHA를 가리키고 release/rollback workflow rerun이 idempotent하다.
10. §11.1의 한국어 실제 provisioning과 영문 독립 clean-room 검증 evidence가 모두 통과해, README.ko.md와 README.en.md만으로 새 관리자가 생성·배포·검증·rollback을 재현할 수 있다.

## 14. 사용자 참여가 필요한 지점

자동화가 대신할 수 없는 다음 단계에서만 사용자 입력을 요청한다.

- Google Cloud/Workspace 관리자 콘솔 로그인과 Internal app 승인
- 일반 사용자·관리자 계정을 사용하는 실제 API spike
- 만료된 AWS SSO/login 재인증
- spike가 정적 아키텍처를 깨뜨릴 때의 backend/Firestore 결정
- spike가 요구하는 Google/AWS 관리자 권한 승인

그 외 repository 구현, 테스트, 문서, CI/CD, push, release 작업은 승인된 이 설계 범위 안에서 계속 진행한다.
