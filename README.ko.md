# MolRoom 운영·릴리즈 가이드

이 문서는 Google Cloud/Workspace 준비부터 AWS 배포·복구까지 운영자가 그대로
따를 수 있는 순서입니다. 현재 브라우저 runtime은 mock adapter를 사용합니다.
Google evidence와 계정 행렬은 INCOMPLETE / UNOBSERVED이며
operatorVerified=false입니다. AWS bootstrap, OIDC, CloudFormation, CloudFront,
DNS, smoke, restore는 실제 계정에서 실행·관찰되지 않았습니다.

## [release.toolchain] 1. 고정 도구와 안전한 시작

Node 24.19.0과 npm 11.17.0 한 벌만 사용합니다. repository root에서 다음처럼
설치 root를 지정하고, 다른 사람의 home 경로나 shell의 bare node/npm에
의존하지 않습니다. 테스트 전에는 host load, swap, 소유 PID와 포트를 확인합니다.

~~~bash
MOLROOM_NODE_ROOT="${MOLROOM_NODE_ROOT:?set to the Node 24.19.0 installation root}"
MOLROOM_NODE="$MOLROOM_NODE_ROOT/bin/node"
MOLROOM_NPM_CLI="$MOLROOM_NODE_ROOT/lib/node_modules/npm/bin/npm-cli.js"
test -x "$MOLROOM_NODE"
test -r "$MOLROOM_NPM_CLI"
test "$("$MOLROOM_NODE" --version)" = "v24.19.0"
test "$("$MOLROOM_NODE" "$MOLROOM_NPM_CLI" --version)" = "11.17.0"
~~~

## [release.google-oauth] 2. Google Cloud OAuth와 Workspace

권한 있는 운영자가 직접 수행하십시오.
사람이 관찰하기 전에는 성공으로 기록하지 마십시오.

[Google provisioning gate](docs/spikes/google-workspace/provisioning.md)를 먼저
완료합니다. molcube.com Workspace 조직 소유 Cloud 프로젝트에서 OAuth consent
audience를 Internal로 두고, client type이 Web application인 OAuth client를
만듭니다. SPA용 client secret은 다운로드하거나 사용하지 않습니다.
Authorized JavaScript origins는 정확히 다음 둘입니다.

~~~text
http://localhost:5184
https://molroom.molcube.com
~~~

Calendar API, Drive API, People API가 켜져 있어야 합니다. 초기 consent scope는
아래 셋뿐이며 People directory scope는 별도 incremental-consent gate까지
미룹니다.

~~~text
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/drive.appdata
~~~

hosted domain의 서로 다른 실제 계정 두 개를 ordinary와 room-writer-admin으로
지정하고, Calendar resource 두 개를 room-a와 room-b로 매핑합니다. 두 room의
ACL은 domain read를 허용하고 ordinary에는 writer를 주지 않으며
room-writer-admin에만 writer를 줍니다. Google Admin과 Calendar UI에서 각 room의
auto-accept가 충돌 없는 초대를 수락하도록 직접 확인합니다.

운영자 소유의 새 profile 네 개
ordinary-chrome-desktop, ordinary-safari-desktop, admin-chrome-desktop,
admin-safari-desktop을 분리합니다. 앞의 둘에는 ordinary만, 뒤의 둘에는
room-writer-admin만 로그인합니다. 계정 전환기·복수 로그인·guest/incognito는
대체 수단이 아닙니다. 권한이나 tenant policy가 막히면 우회하지 않고
TENANT_POLICY_BLOCKED로 기록합니다. 사람이 모든 사실을 확인하기 전에는
INCOMPLETE / UNOBSERVED와 operatorVerified=false를 유지합니다.

## [release.env] 3. public/private env와 로컬 검증

[.env.example](.env.example)은 브라우저에 공개되는 정확한 네 VITE assignment의
committed template입니다. [.env.google-spike.example](.env.google-spike.example)은
비밀이 아닌 식별자만 허용하는 정확한 일곱-key private template이며, 그중 Task 5
필수 subset은 계정 둘과 room calendar 둘입니다.

~~~text
public.env.keys=VITE_DEPLOYMENT,VITE_ADAPTER,VITE_GOOGLE_CLIENT_ID,VITE_ALLOWED_HD
private.env.keys=VITE_GOOGLE_CLIENT_ID,VITE_ALLOWED_HD,GOOGLE_SPIKE_AUTHORIZED_ORIGINS,GOOGLE_SPIKE_ORDINARY_ACCOUNT,GOOGLE_SPIKE_ADMIN_ACCOUNT,GOOGLE_SPIKE_ROOM_A_CALENDAR_ID,GOOGLE_SPIKE_ROOM_B_CALENDAR_ID
task5.env.keys=GOOGLE_SPIKE_ORDINARY_ACCOUNT,GOOGLE_SPIKE_ADMIN_ACCOUNT,GOOGLE_SPIKE_ROOM_A_CALENDAR_ID,GOOGLE_SPIKE_ROOM_B_CALENDAR_ID
~~~

receipt는 다음 closed JSON key만 허용합니다: schemaVersion, observation, appType,
domain, clientIdSuffix, workspaceEdition, enabledApis, initialScopes,
directoryScopeTiming, origins, accounts, rooms, tenantPolicy, operatorVerified.
비밀번호, MFA, OAuth client secret, token, refresh material, service-account
material은 어느 로컬 env에도 넣지 않습니다.

아래 순서로 ignored 0600 파일을 만들고 네 validator를 실행합니다.

~~~bash
umask 077
cp .env.example .env
cp .env.google-spike.example .env.google-spike.local
touch provisioning-receipt.local
chmod 600 .env .env.google-spike.local provisioning-receipt.local
git check-ignore -v .env .env.google-spike.local provisioning-receipt.local

"$MOLROOM_NODE" scripts/google-spike/validate-evidence.mjs docs/spikes/google-workspace/evidence/provisioning.json
"$MOLROOM_NODE" scripts/google-spike/validate-provisioning.mjs .env.google-spike.local provisioning-receipt.local
"$MOLROOM_NODE" scripts/google-spike/validate-account-matrix.mjs docs/spikes/google-workspace/account-matrix.json .env.google-spike.local
"$MOLROOM_NODE" scripts/google-spike/scan-sensitive-paths.mjs --redact docs/spikes/google-workspace/provisioning.md docs/spikes/google-workspace/evidence/provisioning.json scripts/google-spike/lib/provisioning.mjs scripts/google-spike/lib/provisioning.test.mjs scripts/google-spike/validate-provisioning.mjs
~~~

검증 실패나 미관찰 값은 성공으로 바꾸지 않습니다. COMPLETE는 실제 운영자 증거와
validator가 함께 증명할 때만 파생합니다.

## [release.validation] 4. 정적 검증과 candidate gate

같은 pinned toolchain으로 필요한 명령만 직렬 실행합니다.

~~~bash
"$MOLROOM_NODE" "$MOLROOM_NPM_CLI" ci
"$MOLROOM_NODE" "$MOLROOM_NPM_CLI" run typecheck
"$MOLROOM_NODE" "$MOLROOM_NPM_CLI" test
"$MOLROOM_NODE" "$MOLROOM_NPM_CLI" run build
"$MOLROOM_NODE" "$MOLROOM_NPM_CLI" run scan:production-bundle
"$MOLROOM_NODE" "$MOLROOM_NPM_CLI" run validate:readmes
"$MOLROOM_NODE" "$MOLROOM_NPM_CLI" run verify:release-contract
~~~

.github/workflows/release.yml은 target_sha만 받는 credential-free candidate
producer입니다. exact four public VITE values 외 secret, OIDC, production
Environment, write permission이 없고, protected annotated controller tag의 trusted
verifier로 disposable container를 제어한 뒤 retained artifact를 만듭니다.

## [release.aws-oidc] 5. GitHub와 AWS bootstrap

다음 줄은 설정 inventory의 exact contract입니다.

~~~text
github.repository.variables=VITE_GOOGLE_CLIENT_ID,VITE_ALLOWED_HD
github.production_environment.variables=AWS_ACCOUNT_ID,AWS_DEPLOY_ROLE_ARN,CLOUDFORMATION_ROLE_ARN,HOSTED_ZONE_ID
release.controller.ref=refs/tags/molroom-release-controller-v1
release.controller.sha=7ba2814f491dccee9462c7bf01958dd28600b048
release.controller.inputs=mode,version,target_sha,candidate_run_id,security_gate_run_id,execute_cutover,confirmation
~~~

GitHub repository variables에는 위 두 VITE 값만 둡니다. production Environment에는
위 네 AWS 값을 두고 required reviewer를 지정하며 self-approval을 금지합니다.
deployment branch/tag restriction은 protected controller tag
molroom-release-controller-v1만 허용합니다. controller tag와 v* release tag를
immutable/protected로 만들고 장기 access key를 저장하지 않습니다
(no long-lived AWS credentials).

AWS root가 아닌 AWS SSO 관리자 세션에서 us-east-1을 선택합니다. 기존 account-wide
OIDC provider가 있으면 ExistingGitHubOidcProviderArn에 넣고, 없으면 빈 값으로
template이 생성하게 합니다. exact OIDC subject는
repo:kim-song-jun/meeting-wrapper:environment:production이고 trust의 workflow_ref는
.github/workflows/release-controller.yml@refs/tags/molroom-release-controller-v1입니다.

~~~bash
AWS_CLI="${AWS_CLI:?set to the approved AWS CLI executable}"
"$AWS_CLI" sts get-caller-identity
"$AWS_CLI" cloudformation deploy --region us-east-1 --stack-name molroom-bootstrap --template-file infra/aws/molroom-bootstrap.yml --capabilities CAPABILITY_NAMED_IAM --parameter-overrides ControllerTag=molroom-release-controller-v1 HostedZoneId="${HOSTED_ZONE_ID:?set hosted zone}" ProductionStackName=molroom-production ExistingGitHubOidcProviderArn="${EXISTING_GITHUB_OIDC_PROVIDER_ARN:-}" GitHubOidcSubject=repo:kim-song-jun/meeting-wrapper:environment:production
~~~

stack output GitHubDeployRoleArn은 AWS_DEPLOY_ROLE_ARN,
CloudFormationExecutionRoleArn은 CLOUDFORMATION_ROLE_ARN에 매핑합니다. 현재 AWS
account ID는 AWS_ACCOUNT_ID, 입력 HostedZoneId는 HOSTED_ZONE_ID가 됩니다.
infra/aws/molroom-bootstrap.yml의 실제 deploy와 output 관찰은 아직 수행되지
않았습니다.

## [release.first-release] 6. PLAN, release, repair

순서는 고정입니다.

1. origin/main의 candidate SHA로 .github/workflows/release.yml을 target_sha 입력으로 실행해
   verified-release artifact를 만듭니다.
2. 같은 SHA의 approved .github/workflows/security-gate.yml을 실행하고
   security-gate-<sha> evidence를 얻습니다.
3. protected release workflow인 .github/workflows/release-controller.yml을
   protected tag에서 dispatch합니다.
   입력은 mode, version, target_sha, candidate_run_id, security_gate_run_id,
   execute_cutover, confirmation입니다.

controller는 independently protected immutable tag/SHA에서만 실행됩니다. approved
security-gate workflow blob을 target SHA의 blob과 byte 비교하고 evidence의
dispatch_actor를 server workflow-run actor에 묶습니다. workflow-file
self-pinning은 신뢰 근거가 아닙니다.

mode=release에서 먼저 execute_cutover=false로 PLAN을 검토하고, 승인 뒤
execute_cutover=true와 confirmation=RELEASE로 cutover합니다. mode=repair는
confirmation=REPAIR로 active target의 metadata/GitHub Release만 고치며 cutover하지
않습니다. mode=rollback은 confirmation=ROLLBACK으로 기존 verified prefix만
재사용합니다. candidate verification, security gate, controller dispatch의
run ID와 target SHA가 모두 같아야 합니다.

fresh unprivileged prepare, fresh protected AWS deploy, fresh contents-write publish
job은 권한을 나눕니다. 배포는 invalidation 뒤 target-SHA release-metadata smoke를
수행하고 실패하면 prior SHA로 restore한 뒤 restored-SHA smoke를 수행합니다.
첫 release 실패는 UNRELEASED/false 상태로 복구합니다. 아직 live release,
smoke, restore 성공을 주장하지 않습니다.

## [release.rollback] 7. rollback과 복구

rollback은 기존 immutable releases/${release_sha}/ prefix를 checksum과 metadata로
검증해 재사용하며 not re-upload/copy입니다. tag 이동이나 force push를 하지
않습니다. prior ActiveReleaseSha/DistributionEnabled를 먼저 저장하고, 실패한
restore 또는 smoke는 fatal입니다. 원인 수정은 새 SHA/version의 별도 release로
진행합니다.

## [release.security] 8. 외부 blocker와 사고 대응

실제 Google tenant 확인, 두 계정·두 room의 사람 검증, GitHub protection/Environment
설정, AWS SSO bootstrap, DNS/TLS, release/repair/rollback, smoke/restore는 외부
운영 작업으로 남아 있습니다. 완료 전에는 configured/deployed/live로 표현하지
않습니다. secret rotation과 사고 대응은 [SECURITY.md](SECURITY.md)를 따릅니다.
