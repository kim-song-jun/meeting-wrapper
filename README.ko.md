# MolRoom 운영·릴리즈 가이드

이 문서는 Google Cloud 설정부터 AWS CloudFront 배포·롤백까지의 재현 절차입니다.
현재 상태는 **출시 전**입니다. 브라우저 runtime은 mock auth/booking adapter를
사용하고, Google provisioning evidence는 `INCOMPLETE / UNOBSERVED`이며,
AWS CloudFormation·CloudFront·GitHub OIDC 배포 경로는 committed/defined 되어
있지만 아직 configured/deployed/live 상태가 아닙니다.

## [release.toolchain] 1. 고정 도구와 안전한 시작

Node `24.19.0`, npm `11.17.0`을 사용합니다. 테스트·빌드 전 host load,
memory/swap, Node·브라우저 프로세스와 포트를 확인하고 직렬 실행합니다.
작업 중 만든 PID·포트는 끝에서 회수합니다. 공유 작업트리에서 stash, reset,
clean, branch 전환을 하지 않습니다.

```bash
node --version                 # v24.19.0
npm --version                  # 11.17.0
npm ci
npm run verify:toolchain
```

## [release.google-oauth] 2. Google OAuth와 Workspace

권한 있는 운영자가 [provisioning gate](docs/spikes/google-workspace/provisioning.md)의
14단계를 자신의 브라우저에서 수행합니다. 조직 소유 프로젝트와 `Internal`
OAuth를 사용하고 Web client origin에는 다음 두 값만 둡니다.

```text
http://localhost:5184
https://molroom.molcube.com
```

Calendar/Drive/People API를 확인하고 초기 scope는 다음 세 개로 제한합니다.
People directory scope는 Task 11까지 지연합니다.

```text
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/drive.appdata
```

브라우저 SPA client secret은 만들거나 다운로드하지 않습니다. 전체 client ID,
refresh material, 비밀번호, MFA 코드는 저장소에 기록하지 않습니다.

## [release.env] 3. 운영 env와 검증

운영자가 [.env.example](.env.example)를 참고해 ignored `.env.google-spike.local`과
`provisioning-receipt.local`을 직접 만들고 `0600`으로 제한합니다.
`VITE_GOOGLE_CLIENT_ID`를 포함해 placeholder가 아닌 관찰된 값만 사용합니다.

허용되는 정확한 7개 env key는 다음뿐입니다. 값은 unquoted `KEY=value`이며
blank line과 `#` comment만 추가할 수 있습니다. account와 calendar 값은
로컬 파일에만 두고 committed 문서와 evidence에는 alias만 남깁니다.

```dotenv
VITE_GOOGLE_CLIENT_ID=<web-client-id>
VITE_ALLOWED_HD=molcube.com
GOOGLE_SPIKE_AUTHORIZED_ORIGINS=http://localhost:5184,https://molroom.molcube.com
GOOGLE_SPIKE_ORDINARY_ACCOUNT=<ordinary-account>
GOOGLE_SPIKE_ADMIN_ACCOUNT=<room-writer-admin-account>
GOOGLE_SPIKE_ROOM_A_CALENDAR_ID=<room-a-calendar-identifier>
GOOGLE_SPIKE_ROOM_B_CALENDAR_ID=<room-b-calendar-identifier>
```

receipt는 다음 closed JSON key만 사용합니다: `schemaVersion`, `observation`,
`appType`, `domain`, `clientIdSuffix`, `workspaceEdition`, `enabledApis`,
`initialScopes`, `directoryScopeTiming`, `origins`, `accounts`, `rooms`,
`tenantPolicy`, `operatorVerified`. `kind`, `probeId`, `status`, `capability`는
validator가 파생하므로 입력하지 않습니다. 실제 확인 전에는
`observation=UNOBSERVED`, `operatorVerified=false`를 유지합니다.

```bash
umask 077
spike_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/molroom-spike.XXXXXX")"
trap 'rm -f -- "$spike_tmp_dir"/*; rmdir -- "$spike_tmp_dir"' EXIT
touch .env.google-spike.local provisioning-receipt.local
chmod 600 .env.google-spike.local provisioning-receipt.local
git check-ignore -v .env.google-spike.local provisioning-receipt.local
```

`COMPLETE`는 모든 live fact를 관찰하고 exact `validate-evidence`,
`validate-provisioning`, `scan-sensitive-paths` 순서가 성공할 때만 파생됩니다.

```bash
umask 077
chmod 600 .env.google-spike.local provisioning-receipt.local
git check-ignore -v .env.google-spike.local provisioning-receipt.local
node scripts/google-spike/validate-evidence.mjs docs/spikes/google-workspace/evidence/provisioning.json
node scripts/google-spike/validate-provisioning.mjs .env.google-spike.local provisioning-receipt.local
node scripts/google-spike/scan-sensitive-paths.mjs --redact docs/spikes/google-workspace/provisioning.md docs/spikes/google-workspace/evidence/provisioning.json scripts/google-spike/lib/provisioning.mjs scripts/google-spike/lib/provisioning.test.mjs scripts/google-spike/validate-provisioning.mjs
```

상태가 `COMPLETE`가 아니면 다음 capability probe나 production runtime 작업을
시작하지 않습니다.

## [release.validation] 4. 검증과 빌드 gate

```bash
npm run typecheck
npm test
npm run build
npm run scan:production-bundle
npm run validate:readmes
node scripts/build-design-standalone.mjs
node scripts/validate-design-examples.mjs
```

Production bundle에 mock identity, QA backdoor, title sentinel, OAuth secret,
AWS key가 없어야 합니다. UI 변경은 실제 화면 screenshot도 확인합니다.
`npm run build:release-manifest`, `npm run upload:release-prefix`,
`npm run verify:release-contract`로 release contract를 확인합니다.

## [release.aws-oidc] 5. GitHub Environment와 OIDC

GitHub Environment, OIDC role, AWS workflow는 다음 canonical 경로를 사용합니다:
`.github/workflows/release.yml`, `.github/workflows/security-gate.yml`,
`infra/aws/molroom-bootstrap.yml`, `infra/aws/molroom-production.yml`.
현재 GitHub environments=0, AWS session expired, `molroom.molcube.com` unresolved입니다.
구성 시
`production` Environment required reviewer와 tag 보호를 설정하고, repository와
Environment에 제한된 AWS OIDC role만 사용합니다. 장기 AWS access key는 만들지
않습니다. CloudFormation은 private S3, CloudFront Origin Access Control, ACM
(`us-east-1`), Route 53 alias `molroom.molcube.com`, SPA fallback과 security
headers를 재현해야 합니다. 실제 IDs·ARN·client ID는 문서에 쓰지 않습니다.

## [release.first-release] 6. 첫 릴리즈와 smoke

Google provisioning `COMPLETE`, Google runtime acceptance, security scan High/
Critical 0, CI build/bundle scan, CloudFront deploy가 같은 commit에서 통과한
뒤에만 GitHub Release를 만듭니다.

```bash
git fetch origin main --quiet
release_sha="$(git rev-parse HEAD)"
test -z "$(git status --porcelain)"
git diff --quiet "${release_sha}^" "${release_sha}"
test "$(git rev-parse origin/main)" = "${release_sha}"
test "$(git rev-parse origin/main)" = "$release_sha"
node scripts/build-release-manifest.mjs --artifact-root dist --commit-sha "${release_sha}" --package-version "$(node -p 'require(\"./package.json\").version')" --source-date-epoch "$(git show -s --format=%ct "${release_sha}")"
node scripts/upload-release-prefix.mjs --artifact-root dist --bucket "molroom-<account>-us-east-1-origin" --commit-sha "${release_sha}" --dry-run
# 실제 tag/Release 생성과 cutover는 protected production workflow에서만 수행합니다.
```

Release에는 SHA, artifact checksum, evidence reference, smoke 결과를 남깁니다.
immutable object prefix는 `releases/${release_sha}/`이며, production smoke와
CloudFront invalidation을 통과해야 합니다.
`https://molroom.molcube.com`에서 TLS, deep link, login/logout, room read,
create/edit/cancel과 secret 노출을 확인합니다. 현재 실행되지 않았습니다.

## [release.rollback] 7. 롤백과 사고 대응

tag 이동·force push 대신 승인된 **previous artifact**의 기존 immutable
`releases/${release_sha}/` prefix를 checksum으로 확인하고 재사용합니다.
재업로드나 복사는 하지 않습니다(not re-upload/copy). 현재 SHA·CloudFront distribution ID·artifact checksum을 기록하고,
ActiveReleaseSha만 이전 SHA로 바꾼 뒤 CloudFront invalidation과 production smoke를
수행합니다. 원인 수정 후 새 commit/tag를 배포합니다. 자세한 secret rotation과
incident response는 [SECURITY.md](SECURITY.md)를 따릅니다.

## [release.security] 8. 보안과 사고 대응

자세한 secret rotation과 incident response는 [SECURITY.md](SECURITY.md)의
절차를 따릅니다.
