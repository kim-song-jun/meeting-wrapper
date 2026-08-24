# MolRoom Google Workspace provisioning gate

> 현재 상태 / Current state: **INCOMPLETE · UNOBSERVED**
>
> 이 문서는 운영자가 실제 Google Cloud 및 Workspace 콘솔에서 확인해야 할
> 절차를 정의합니다. 로컬 테스트 통과는 운영 설정 완료를 뜻하지 않습니다.
>
> This document defines the checks that an authorized operator must perform in
> the live Google Cloud and Workspace consoles. Passing local tests does not
> mean that production provisioning is complete.

## 안전 경계 / Safety boundary

- 한국어: 저장소에는 고정 메타데이터, 불리언, 제한된 열거값, 별칭, 공개 Web
  client ID의 마지막 8자만 기록합니다. 전체 client ID, 계정·회의실 주소,
  프로젝트 식별자, 원본 origin 목록, 비밀번호, MFA 코드, client secret,
  refresh material, service-account material은 기록하지 않습니다.
- English: The repository stores only fixed metadata, booleans, bounded enums,
  aliases, and the final eight characters of the public Web client ID. Never
  store a full client ID, account or room address, project identifier, raw
  origin list, password, MFA code, client secret, refresh material, or
  service-account material.
- 한국어: 이 작업은 domain-wide delegation을 만들거나 승인하지 않습니다.
- English: This task neither creates nor approves domain-wide delegation.
- 한국어: 에이전트는 Google 로그인, MFA, 콘솔 변경을 수행하지 않습니다.
  권한 있는 사람이 자신의 브라우저 프로필에서 직접 수행합니다.
- English: An agent does not perform Google sign-in, MFA, or console changes.
  An authorized human performs them in their own browser profile.

## 15단계 운영 체크리스트 / 15-step operator checklist

1. **조직 소유 프로젝트 / Organization-owned project**
   - 한국어: `molcube.com` Google Workspace 조직이 소유한 Cloud 프로젝트를
     사용하고, 개인 프로젝트를 재사용하지 않습니다.
   - English: Use a Cloud project owned by the `molcube.com` Google Workspace
     organization; do not reuse a personal project.

2. **Internal 대상 / Internal audience**
   - 한국어: Google Auth Platform의 대상 또는 사용자 유형을 `Internal`로
     설정합니다. 조직 관리자가 내부 앱도 차단할 수 있으므로 정책 결과는
     별도로 확인합니다.
   - English: Set the Google Auth Platform audience or user type to `Internal`.
     An organization administrator can still block an internal app, so verify
     the tenant-policy result separately.

3. **Web client와 origin / Web client and origins**
   - 한국어: 애플리케이션 유형이 `Web application`인 client를 만들고,
     Authorized JavaScript origins에 아래 두 값만 등록합니다. 경로, query,
     fragment, wildcard, user information은 넣지 않습니다.
   - English: Create a client whose application type is `Web application` and
     register only the two values below as Authorized JavaScript origins. Do
     not add a path, query, fragment, wildcard, or user information.

   ```text
   http://localhost:5184
   https://molroom.molcube.com
   ```

4. **client secret 금지 / No client secret**
   - 한국어: 이 브라우저 SPA용으로 client secret을 다운로드하거나 사용하지
     않습니다. 브라우저 앱은 기밀값을 안전하게 보관할 수 없습니다.
   - English: Do not download or use a client secret for this browser SPA. A
     browser application cannot keep confidential material safely.

5. **API 세 개 / Three APIs**
   - 한국어: probe에서 승인한 Calendar API, Drive API, People API 세 개가 모두
     활성화되어 있는지 확인합니다. 프로젝트의 다른 API를 끄거나 변경하지 않습니다.
   - English: Ensure that the three probe-approved APIs—Calendar API, Drive API,
     and People API—are enabled. Do not disable or alter other project APIs.

6. **초기 scope 최소화 / Minimal initial scopes**
   - 한국어: 초기 동의에는 Calendar events, Calendar read-only, Drive
     app-data scope만 선언합니다.
   - English: Declare only Calendar events, Calendar read-only, and Drive
     app-data scopes in initial consent.

   ```text
   https://www.googleapis.com/auth/calendar.events
   https://www.googleapis.com/auth/calendar.readonly
   https://www.googleapis.com/auth/drive.appdata
   ```

7. **People scope 지연 / Defer the People scope**
   - 한국어: People directory scope는 초기 scope에 넣지 않습니다. 별도로 승인된
     incremental-consent gate까지 미룹니다.
   - English: Do not put the People directory scope in initial consent. Defer
     it to a separately approved incremental-consent gate.

8. **회의실 두 개 / Exactly two rooms**
   - 한국어: 권한 있는 Workspace 운영자가 Calendar resource 두 개를 선택하거나
     조직 정책에 따라 생성한 뒤, 정확히 `room-a`, `room-b` 별칭으로 매핑합니다.
     스크립트나 에이전트는 resource를 만들거나 수정하지 않습니다. 원본 calendar
     identifier는 ignored 로컬 파일에만 둡니다.
   - English: An authorized Workspace operator selects, or creates under
     organization policy, exactly two Calendar resources and maps them to
     `room-a` and `room-b`. No script or agent creates or edits a resource.
     Keep raw calendar identifiers only in the ignored local file.

9. **역할 계정 두 개 / Two role accounts**
   - 한국어: 서로 다른 실제 계정 두 개를 골라 `ordinary`와
     `room-writer-admin`으로 매핑합니다. 두 계정 모두 hosted domain에 있어야
     합니다.
   - English: Select two distinct real accounts and map them to `ordinary` and
     `room-writer-admin`. Both accounts must belong to the hosted domain.

10. **브라우저 profile 격리 / Browser-profile isolation**
   - 한국어: 다른 사용자 profile을 수정하지 않고, 운영자 소유의 새 profile 네
     개를 정확히 `ordinary-chrome-desktop`, `ordinary-safari-desktop`,
     `admin-chrome-desktop`, `admin-safari-desktop`로 준비합니다. 앞의 두
     profile에는 `ordinary` 계정 하나만, 뒤의 두 profile에는
     `room-writer-admin` 계정 하나만 로그인합니다. 계정 전환기, 같은 profile의
     복수 로그인, guest/incognito 창은 대체 수단이 아닙니다. profile 간 account
     crossover가 보이면 local evidence를 만들지 말고 `UNOBSERVED`로 유지합니다.
   - English: Without changing another user's profile, prepare four fresh
     operator-owned profiles named exactly `ordinary-chrome-desktop`,
     `ordinary-safari-desktop`, `admin-chrome-desktop`, and
     `admin-safari-desktop`. Sign in only the `ordinary` account in the first
     two and only the `room-writer-admin` account in the latter two. An account
     switcher, multiple sign-ins in one profile, or guest/incognito windows do
     not substitute. If any account crosses profile roles, do not create local
     evidence; keep the fact `UNOBSERVED`.

11. **ACL과 최소 권한 / ACL and least privilege**
   - 한국어: Calendar의 `Manage Calendars` 권한이 있는 운영자 계정으로 Google
     Calendar를 엽니다. 왼쪽 **다른 캘린더**에서 각 회의실을 추가한 다음 각
     회의실의 **더보기 → 설정 및 공유**를 엽니다. **일정의 액세스 권한**과
     **특정 사용자 또는 그룹과 공유**에서 domain이 읽을 수 있는지,
     `ordinary`가 writer가 아닌지, `room-writer-admin`이 writer인지 각각
     확인하고, 필요한 변경은 권한 있는 운영자만 직접 수행합니다. 두 room 모두
     domain read를 허용하고, `ordinary`에는 writer 권한을 주지 않으며,
     `room-writer-admin`에만 room writer 권한을 줍니다. 설정 뒤 화면에서 역할을
     재확인한 결과만 receipt 불리언으로 기록합니다. 화면에서 역할을 확인할 수
     없으면 `false`나 추측값을 넣지 말고 `UNOBSERVED` 상태를 유지합니다.
   - English: Using an operator account with the Calendar `Manage Calendars`
     privilege, open Google Calendar. Add each room under **Other calendars**,
     then open the room's **More → Settings and sharing** page. Under **Access
     permissions for events** and **Share with specific people or groups**,
     verify domain-read access, that `ordinary` is not a writer, and that
     `room-writer-admin` is a writer; only an authorized operator performs a
     required change. Both rooms must allow domain read, deny writer access to
     `ordinary`, and grant room-writer access only to `room-writer-admin`.
     Recheck the roles in the UI and record only observed receipt booleans. If
     the UI does not expose a role, keep the fact unobserved rather than
     inferring it.
   - 한국어 / English: 승인된 별도 관리자 도구로 API 확인이 필요한 경우 Google
     Calendar `acl.list`가 해당 캘린더 ACL 규칙을 반환합니다. MolRoom의 초기
     consent scope를 늘리지 말고, 원본 ACL 주소나 응답을 저장소에 복사하지
     않습니다. / If an approved separate admin tool is required, Google
     Calendar `acl.list` returns that calendar's ACL rules. Do not expand
     MolRoom's initial consent scopes or copy raw ACL addresses or responses
     into the repository.

12. **자동 수락 관찰 / Observe auto-accept**
   - 한국어: 먼저 Google Admin 콘솔에서 **메뉴 → 디렉터리 → 건물 및 리소스 →
     개요 → 리소스 관리 열기**로 이동해 `room-a`와 `room-b`에 매핑할 두
     리소스가 실제로 존재하는지 확인합니다. 조회에는 `Buildings and Resources`
     또는 `View Resources` 권한이 필요하며, 이 작업에서는 리소스를 만들거나
     수정하지 않습니다. 이어서 Google Calendar의 해당 회의실 **설정 및 공유 →
     초대 자동 수락**에서 표시된 옵션을 직접 확인합니다. 충돌 없는 초대를 자동
     수락하도록 권한 있는 운영자가 설정하고, 그 옵션이면 `ENABLED`, 그렇지
     않으면 `DISABLED`로 기록합니다. 제어가 보이지 않으면 `UNOBSERVED`를
     유지하고 권한 있는 운영자에게 넘깁니다.
   - English: First, in the Google Admin console, go to **Menu → Directory →
     Buildings and resources → Overview → Open resource management** and
     confirm that the two resources mapped to `room-a` and `room-b` exist.
     Viewing requires the `Buildings and Resources` or `View Resources`
     privilege; do not create or modify a resource in this task. Then, on the
     room's Google Calendar **Settings and sharing → Auto-accept invitations**
     surface, have an authorized operator configure and inspect the selected
     option. Record `ENABLED` only when the non-conflicting-invitations
     auto-accept option is selected; otherwise record `DISABLED`. If the
     control is unavailable, keep `UNOBSERVED` and hand the check to an
     authorized operator.

13. **edition과 tenant 정책 / Edition and tenant policy**
   - 한국어: Workspace edition 범주를 기록하고, 요청한 초기 scope를 tenant
     정책이 허용하는지 확인합니다. 차단되면 `BLOCKED`를 기록하고 우회하지
     않습니다.
   - English: Record the Workspace edition category and verify whether tenant
     policy permits the requested initial scopes. If blocked, record `BLOCKED`
     and do not work around it.

14. **ignored 0600 파일 / Ignored 0600 files**
   - 한국어: 아래 두 파일을 운영자가 직접 만들고 권한을 `0600`으로 제한합니다.
     비밀번호, MFA 코드, client secret, refresh material, service-account
     material, domain-wide delegation 정보는 넣지 않습니다.
   - English: The operator creates the two files below and restricts each to
     mode `0600`. Do not include passwords, MFA codes, a client secret,
     refresh material, service-account material, or domain-wide delegation
     information.

15. **검증 후 다음 gate / Verify before the next gate**
   - 한국어: ignore 증명, 공통 evidence 검증, readiness 검증, 명시적인 5개
     경로 sensitive scan을 순서대로 통과한 뒤에만 다음 live gate를 요청합니다.
   - English: Request the next live gate only after the ignore proof, common
     evidence validation, readiness validation, and explicit five-path
     sensitive scan all pass in order.

## 로컬 env 계약 / Local env contract

저장소 root에서 `.env.google-spike.example`을 복사해 ignored
`.env.google-spike.local`을 만들고, local editor로 placeholder만 교체한 뒤 mode를
`0600`으로 제한합니다. template 이외의 key는 추가하지 않습니다.

From the repository root, copy `.env.google-spike.example` to the ignored
`.env.google-spike.local`, replace only placeholders in a local editor, and
restrict its mode to `0600`. Do not add a key outside the template.

```bash
umask 077
cp .env.google-spike.example .env.google-spike.local
chmod 600 .env.google-spike.local
```

`.env.google-spike.local` permits blank lines, `#` comments, and exactly the
following seven unquoted `KEY=value` entries once each. `export`, quoting,
interpolation, controls, duplicate keys, malformed or trimmed values, and
unknown keys fail closed.

```dotenv
VITE_GOOGLE_CLIENT_ID=<google-oauth-web-client-id>
VITE_ALLOWED_HD=<workspace-hosted-domain>
GOOGLE_SPIKE_AUTHORIZED_ORIGINS=<authorized-origin-list>
GOOGLE_SPIKE_ORDINARY_ACCOUNT=<ordinary-workspace-account>
GOOGLE_SPIKE_ADMIN_ACCOUNT=<room-writer-admin-workspace-account>
GOOGLE_SPIKE_ROOM_A_CALENDAR_ID=<room-a-calendar-id>
GOOGLE_SPIKE_ROOM_B_CALENDAR_ID=<room-b-calendar-id>
```

한국어: Task 5 account-matrix gate가 요구하는 subset은
`GOOGLE_SPIKE_ORDINARY_ACCOUNT`, `GOOGLE_SPIKE_ADMIN_ACCOUNT`,
`GOOGLE_SPIKE_ROOM_A_CALENDAR_ID`, `GOOGLE_SPIKE_ROOM_B_CALENDAR_ID` 네 개뿐입니다.
나머지 세 key는 같은 private file에 허용되지만 provisioning 사실을 충족했다는
주장은 하지 않습니다.

English: Task 5's account-matrix gate requires only
`GOOGLE_SPIKE_ORDINARY_ACCOUNT`, `GOOGLE_SPIKE_ADMIN_ACCOUNT`,
`GOOGLE_SPIKE_ROOM_A_CALENDAR_ID`, and `GOOGLE_SPIKE_ROOM_B_CALENDAR_ID`. The
other three keys are allowed in the same private file, but they do not claim
that provisioning facts have been satisfied.

한국어: angle bracket placeholder를 그대로 저장하지 말고 운영자가 확인한 실제
값으로 교체합니다. 비밀번호, MFA 코드, client secret, token, refresh material,
service-account material은 넣지 않습니다. English: Replace every angle-bracket
placeholder with the operator-verified value; do not save placeholders literally.
Do not put passwords, MFA codes, a client secret, token, refresh material, or
service-account material in this file.

계정과 회의실 calendar identifier는 정규화된 lowercase 형식이어야 합니다.
local-part는 dot-atom 형식이라 맨 앞·맨 뒤 점과 연속 점을 허용하지 않으며,
domain label도 lowercase만 허용합니다. validator는 대소문자를 몰래 바꾸지 않고
비정규 입력을 거부합니다.

Account and room calendar identifiers must already be in canonical lowercase
form. Their local part uses dot-atom form, so a leading, trailing, or repeated
dot is invalid, and domain labels must also be lowercase. The validator rejects
non-canonical input instead of silently changing its case.

## 로컬 receipt 계약 / Local receipt contract

`provisioning-receipt.local`은 closed JSON입니다. `kind`, `probeId`, `status`,
`capability`는 validator가 파생하므로 넣으면 실패합니다. 아래는 정직한 최초
상태이며, 실제로 확인한 항목만 변경합니다.

`provisioning-receipt.local` is closed JSON. The validator derives `kind`,
`probeId`, `status`, and `capability`, so including any of them fails. The
following is the honest initial state; change only facts that were observed.

```json
{
  "schemaVersion": 1,
  "observation": "UNOBSERVED",
  "appType": "UNOBSERVED",
  "domain": "MOLCUBE_COM",
  "clientIdSuffix": "UNOBSERVED",
  "workspaceEdition": "UNOBSERVED",
  "enabledApis": {
    "calendar": false,
    "drive": false,
    "people": false
  },
  "initialScopes": {
    "calendarEvents": false,
    "calendarReadonly": false,
    "driveAppdata": false
  },
  "directoryScopeTiming": "DEFERRED_TO_TASK_11",
  "origins": {
    "localhostSpike": false,
    "production": false
  },
  "accounts": {
    "ordinary": {
      "alias": "ordinary",
      "present": false
    },
    "roomWriterAdmin": {
      "alias": "room-writer-admin",
      "present": false
    },
    "distinct": false
  },
  "rooms": [
    {
      "alias": "room-a",
      "present": false,
      "domainReadAcl": false,
      "ordinaryRoomWriter": false,
      "adminRoomWriter": false,
      "autoAccept": "UNOBSERVED"
    },
    {
      "alias": "room-b",
      "present": false,
      "domainReadAcl": false,
      "ordinaryRoomWriter": false,
      "adminRoomWriter": false,
      "autoAccept": "UNOBSERVED"
    }
  ],
  "tenantPolicy": "UNOBSERVED",
  "operatorVerified": false
}
```

한국어: `observation`을 `OPERATOR_OBSERVED`로 바꿀 때만 ISO UTC `observedAt`을
추가하고 `operatorVerified`를 `true`로 설정합니다. client ID suffix는
`.apps.googleusercontent.com` 바로 앞의 opaque 부분 마지막 8개 lowercase
letter/digit이며 env 값과 일치해야 합니다.

English: Add an ISO UTC `observedAt` and set `operatorVerified` to `true` only
when changing `observation` to `OPERATOR_OBSERVED`. The client ID suffix is the
final eight lowercase letters or digits of the opaque component immediately
before `.apps.googleusercontent.com`, and it must correlate with the env value.

receipt 파일 생성 후 / After creating the receipt file:

```bash
umask 077
# Create the receipt with the operator's local editor, then verify its mode.
chmod 600 provisioning-receipt.local
```

## 정확한 검증 순서 / Exact validation sequence

모든 명령은 repository root에서 실행합니다. 다른 사람의 home directory를
hard-code하거나 shell의 unpinned `node`/`npm`을 사용하지 않습니다. 먼저
`MOLROOM_NODE_ROOT`를 Node `24.19.0` 설치 root로 설정합니다. npm CLI도 그 same
toolchain에서 직접 실행해 version `11.17.0`을 확인합니다.

Run every command from the repository root. Do not hard-code another person's
home directory or use an unpinned shell `node`/`npm`. First point
`MOLROOM_NODE_ROOT` at the Node `24.19.0` installation root, then run the npm
CLI directly from that same toolchain to confirm version `11.17.0`.

```bash
MOLROOM_NODE_ROOT="${MOLROOM_NODE_ROOT:?set to the Node 24.19.0 installation root}"
MOLROOM_NODE="$MOLROOM_NODE_ROOT/bin/node"
MOLROOM_NPM_CLI="$MOLROOM_NODE_ROOT/lib/node_modules/npm/bin/npm-cli.js"
test -x "$MOLROOM_NODE"
test -r "$MOLROOM_NPM_CLI"
test "$("$MOLROOM_NODE" --version)" = "v24.19.0"
test "$("$MOLROOM_NODE" "$MOLROOM_NPM_CLI" --version)" = "11.17.0"

git check-ignore -v .env.google-spike.local provisioning-receipt.local

"$MOLROOM_NODE" scripts/google-spike/validate-evidence.mjs \
  docs/spikes/google-workspace/evidence/provisioning.json

"$MOLROOM_NODE" scripts/google-spike/validate-provisioning.mjs \
  .env.google-spike.local provisioning-receipt.local

"$MOLROOM_NODE" scripts/google-spike/validate-account-matrix.mjs \
  docs/spikes/google-workspace/account-matrix.json \
  .env.google-spike.local

"$MOLROOM_NODE" scripts/google-spike/scan-sensitive-paths.mjs --redact \
  docs/spikes/google-workspace/provisioning.md \
  docs/spikes/google-workspace/evidence/provisioning.json \
  scripts/google-spike/lib/provisioning.mjs \
  scripts/google-spike/lib/provisioning.test.mjs \
  scripts/google-spike/validate-provisioning.mjs
```

Readiness mode exits `0` only for a derived `COMPLETE` state and prints exactly:

```text
provisioning-valid schemaVersion=1 status=COMPLETE
```

검토용 redacted evidence를 만들 때는 tracked 파일로 바로 쓰지 않습니다. 임시
파일을 공통 validator로 확인하고, 일곱 개 raw env 값이 없음을 운영자가 검토한
뒤 reviewed patch로만 반영합니다.

Do not write generated redacted evidence directly to the tracked file. Validate
an intermediate file with the common validator, have the operator confirm that
none of the seven raw env values survived, and apply it only through a reviewed
patch.

```bash
umask 077
provisioning_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/molroom-provisioning.XXXXXX")"
provisioning_tmp_file="$provisioning_tmp_dir/provisioning.json"
trap 'rm -f -- "$provisioning_tmp_file"; rmdir -- "$provisioning_tmp_dir"' EXIT

"$MOLROOM_NODE" scripts/google-spike/validate-provisioning.mjs --emit-redacted \
  .env.google-spike.local provisioning-receipt.local \
  > "$provisioning_tmp_file"

"$MOLROOM_NODE" scripts/google-spike/validate-evidence.mjs \
  "$provisioning_tmp_file"
```

## 상태 의미 / State meanings

- `INCOMPLETE`: 하나 이상의 필수 사실이 아직 확인되지 않았고 tenant policy가
  차단 상태는 아닙니다. / One or more required facts remain unverified and
  tenant policy is not blocked.
- `COMPLETE`: 모든 필수 사실을 사람이 관찰했고 최소 권한 조건을 만족합니다. /
  A human observed every required fact and the least-privilege conditions hold.
- `TENANT_POLICY_BLOCKED`: 관리 정책이 초기 scope를 차단했습니다. 우회하거나
  `INCOMPLETE`로 낮추지 않습니다. / Administrative policy blocked the initial
  scopes. Do not bypass it or downgrade it to `INCOMPLETE`.

## Google 공식 근거 / Official Google references

- [OAuth app state overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)
- [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Use the token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [OAuth for client-side web applications](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)
- [Choose Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Calendar domain concepts](https://developers.google.com/workspace/calendar/api/concepts/domain)
- [List a calendar ACL](https://developers.google.com/workspace/calendar/api/v3/reference/acl/list)
- [Create or add a room/shared-space calendar](https://support.google.com/calendar/answer/44105)
- [Administrator privilege definitions](https://knowledge.workspace.google.com/admin/users/administrator-privilege-definitions)
- [Create buildings, features, and Calendar resources](https://knowledge.workspace.google.com/admin/calendar/create-buildings-features-and-calendar-resources)
- [Store application-specific Drive data](https://developers.google.com/workspace/drive/api/guides/appdata)
- [Read domain contacts and profiles](https://developers.google.com/people/v1/directory)
- [Search directory people](https://developers.google.com/people/api/rest/v1/people/searchDirectoryPeople)

## 아직 남은 human gate / Remaining human gate

한국어: 이 저장소의 committed evidence는 운영자가 위 live 사실을 확인하고 두
ignored `0600` 파일을 만든 뒤 검토를 통과하기 전까지 `INCOMPLETE` /
`UNOBSERVED`로 유지합니다. 그 전에는 Task 5 또는 Google capability probe를
시작하지 않습니다.

English: The committed evidence remains `INCOMPLETE` / `UNOBSERVED` until an
authorized operator verifies the live facts, creates both ignored `0600` files,
and passes review. Do not start Task 5 or a Google capability probe before that
gate.
