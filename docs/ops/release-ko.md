# MolRoom 운영 릴리즈 runbook (한국어)

이 runbook은 [README.ko.md](../../README.ko.md)의 실행용 체크리스트입니다.
현재 Google provisioning은 `INCOMPLETE / UNOBSERVED`이고 AWS/GitHub OIDC
배포 자동화는 정의되어 있지만 live 성공은 확인되지 않았으므로, 아래 절차는 prerequisite를 설명할 뿐 완료를
주장하지 않습니다.

## 사전 조건

- Node `24.19.0`, npm `11.17.0`, 직렬 테스트 환경
- [Google provisioning gate](../spikes/google-workspace/provisioning.md)의
  14단계와 `COMPLETE` evidence
- 조직 소유 Google Cloud project, `Internal` OAuth Web client
- origin: `http://localhost:5184`, `https://molroom.molcube.com`
- 초기 scope: Calendar events, Calendar readonly, Drive appdata
- client secret, refresh token, MFA, AWS access key 미사용

## 실행 순서

1. `.env.example`를 참고해 ignored `0600` env/receipt를 운영자가 생성합니다.
2. `validate-evidence`, `validate-provisioning`, sensitive scan을 수행합니다.
3. `npm run typecheck`, `npm test`, `npm run build`,
   `npm run scan:production-bundle`, `npm run validate:readmes`를
   직렬 실행합니다.
4. GitHub `production` Environment의 required reviewer 승인과 OIDC role로만
   `.github/workflows/release.yml`을 실행합니다. security gate는
   `.github/workflows/security-gate.yml`, 인프라는
   `infra/aws/molroom-bootstrap.yml` 다음 `infra/aws/molroom-production.yml` 순서입니다.
   현재 GitHub environments=0, AWS session expired, `molroom.molcube.com` unresolved입니다.
5. 아래 clean-room PLAN 명령으로 동일 SHA의 artifact checksum을 확인하고
   immutable `releases/${release_sha}/` prefix, CloudFront invalidation,
   production smoke 결과를 확인한 뒤, local plan은 `--dry-run`으로만 생성하고
   clean-tree SHA를 확인하고 release workflow의 guarded sequence로 `v0.1.0`
   GitHub Release에 고정합니다. 로컬 tag/push는 수행하지 않습니다.
6. `https://molroom.molcube.com`에서 TLS, deep link, login/logout,
   room read, create/edit/cancel, secret 노출을 smoke합니다.

```bash
release_sha="$(git rev-parse HEAD)"
node scripts/build-release-manifest.mjs --artifact-root dist --commit-sha "$release_sha" --package-version "$(node -p 'require(\"./package.json\").version')" --source-date-epoch "$(git show -s --format=%ct "$release_sha")"
node scripts/upload-release-prefix.mjs --artifact-root dist --bucket "molroom-<account>-us-east-1-origin" --commit-sha "$release_sha" --dry-run
npm run verify:release-contract
```

## 롤백

tag를 이동하거나 force push하지 않습니다. 승인된 **previous artifact**의 기존
immutable `releases/${release_sha}/` prefix를 checksum으로 확인·재사용하고
재업로드/복사하지 않습니다(not re-upload/copy). `ActiveReleaseSha`만 변경한 뒤 CloudFront invalidation,
smoke, incident 기록을 수행합니다. 자세한 secret rotation은
[SECURITY.md](../../SECURITY.md)를 따릅니다.

## 운영 입력 계약

`.env.google-spike.local`은 정확한 7개 unquoted key만 허용하며 blank line과
`#` comment 외의 줄, 중복·unknown key, quoting, interpolation은 거부합니다.

```dotenv
VITE_GOOGLE_CLIENT_ID=<web-client-id>
VITE_ALLOWED_HD=molcube.com
GOOGLE_SPIKE_AUTHORIZED_ORIGINS=http://localhost:5184,https://molroom.molcube.com
GOOGLE_SPIKE_ORDINARY_ACCOUNT=<ordinary-account>
GOOGLE_SPIKE_ADMIN_ACCOUNT=<room-writer-admin-account>
GOOGLE_SPIKE_ROOM_A_CALENDAR_ID=<room-a-calendar-identifier>
GOOGLE_SPIKE_ROOM_B_CALENDAR_ID=<room-b-calendar-identifier>
```

`provisioning-receipt.local`은 closed JSON이며 `schemaVersion`, `observation`,
`appType`, `domain`, `clientIdSuffix`, `workspaceEdition`, `enabledApis`,
`initialScopes`, `directoryScopeTiming`, `origins`, `accounts`, `rooms`,
`tenantPolicy`, `operatorVerified`만 허용합니다. `kind`, `probeId`, `status`,
`capability`는 validator가 파생합니다. 최초 상태는 `INCOMPLETE / UNOBSERVED`,
`observation=UNOBSERVED`, `operatorVerified=false`입니다.

```bash
umask 077
spike_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/molroom-spike.XXXXXX")"
trap 'rm -f -- "$spike_tmp_dir"/*; rmdir -- "$spike_tmp_dir"' EXIT
touch .env.google-spike.local provisioning-receipt.local
chmod 600 .env.google-spike.local provisioning-receipt.local
git check-ignore -v .env.google-spike.local provisioning-receipt.local
node scripts/google-spike/validate-evidence.mjs
node scripts/google-spike/validate-provisioning.mjs
node scripts/google-spike/scan-sensitive-paths.mjs
```

`COMPLETE`는 모든 live fact 관찰과 위 세 명령의 순서 있는 성공에서만 파생됩니다.
tag 전제는 `test "$(git rev-parse origin/main)" = "$release_sha"` 입니다.

```bash
git fetch origin main --quiet
release_sha="$(git rev-parse HEAD)"
test "$(git rev-parse origin/main)" = "${release_sha}"
```
