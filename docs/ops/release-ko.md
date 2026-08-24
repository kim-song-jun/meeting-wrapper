# MolRoom production release runbook

현재 Google provisioning/account matrix는 INCOMPLETE / UNOBSERVED,
operatorVerified=false입니다. AWS bootstrap, production deploy, smoke, restore도
실행·관찰되지 않았습니다. 이 runbook은 권한 있는 사람이 외부 gate를 완료할
때의 절차이며 live 상태를 주장하지 않습니다.

## 사전 조건

Node 24.19.0과 npm 11.17.0을 같은 pinned installation에서 사용합니다. host
preflight와 소유 PID cleanup을 적용합니다. Google 설정은
[provisioning guide](../spikes/google-workspace/provisioning.md)의 contract를
그대로 따릅니다.

권한 있는 운영자가 직접 수행하십시오.
사람이 관찰하기 전에는 성공으로 기록하지 마십시오.

molcube.com Workspace 조직 소유 Google Cloud project를 사용하고 OAuth audience를
Internal, client type을 Web application으로 설정하십시오. Authorized JavaScript
origins에는 `http://localhost:5184`와 `https://molroom.molcube.com`만 등록하십시오.
Calendar API, Drive API, People API를 켜고 초기 scope는
`https://www.googleapis.com/auth/calendar.events`,
`https://www.googleapis.com/auth/calendar.readonly`,
`https://www.googleapis.com/auth/drive.appdata` 셋으로 제한하십시오.

서로 다른 ordinary와 room-writer-admin 계정, room-a와 room-b Calendar resource를
준비합니다. ACL은 domain read, ordinary non-writer, room-writer-admin writer를
직접 확인하고 두 room의 auto-accept도 UI에서 관찰합니다. profile은 정확히
ordinary-chrome-desktop, ordinary-safari-desktop, admin-chrome-desktop,
admin-safari-desktop 네 개로 격리합니다. 막히면 TENANT_POLICY_BLOCKED이며
INCOMPLETE / UNOBSERVED와 operatorVerified=false를 유지합니다.

GitHub/AWS 설정 inventory는 다음과 같습니다.

~~~text
public.env.keys=VITE_DEPLOYMENT,VITE_ADAPTER,VITE_GOOGLE_CLIENT_ID,VITE_ALLOWED_HD
private.env.keys=VITE_GOOGLE_CLIENT_ID,VITE_ALLOWED_HD,GOOGLE_SPIKE_AUTHORIZED_ORIGINS,GOOGLE_SPIKE_ORDINARY_ACCOUNT,GOOGLE_SPIKE_ADMIN_ACCOUNT,GOOGLE_SPIKE_ROOM_A_CALENDAR_ID,GOOGLE_SPIKE_ROOM_B_CALENDAR_ID
task5.env.keys=GOOGLE_SPIKE_ORDINARY_ACCOUNT,GOOGLE_SPIKE_ADMIN_ACCOUNT,GOOGLE_SPIKE_ROOM_A_CALENDAR_ID,GOOGLE_SPIKE_ROOM_B_CALENDAR_ID
github.repository.variables=VITE_GOOGLE_CLIENT_ID,VITE_ALLOWED_HD
github.production_environment.variables=AWS_ACCOUNT_ID,AWS_DEPLOY_ROLE_ARN,CLOUDFORMATION_ROLE_ARN,HOSTED_ZONE_ID
release.controller.ref=refs/tags/molroom-release-controller-v1
release.controller.sha=7ba2814f491dccee9462c7bf01958dd28600b048
release.controller.inputs=mode,version,target_sha,candidate_run_id,security_gate_run_id,execute_cutover,confirmation
~~~

GitHub production Environment에는 required reviewer와 no self-approval을 적용하고,
deployment ref는 protected molroom-release-controller-v1 tag만 허용합니다.
controller tag와 v* tag를 보호합니다. repository에는 장기 AWS key를 두지 않습니다
(no long-lived AWS credentials).

AWS root가 아닌 AWS SSO 관리자로 us-east-1에서
infra/aws/molroom-bootstrap.yml을 배포합니다. parameter는
ControllerTag=molroom-release-controller-v1, HostedZoneId,
ProductionStackName=molroom-production, optional ExistingGitHubOidcProviderArn,
GitHubOidcSubject=repo:kim-song-jun/meeting-wrapper:environment:production입니다.
trust workflow_ref는
.github/workflows/release-controller.yml@refs/tags/molroom-release-controller-v1입니다.
GitHubDeployRoleArn→AWS_DEPLOY_ROLE_ARN,
CloudFormationExecutionRoleArn→CLOUDFORMATION_ROLE_ARN, account ID→AWS_ACCOUNT_ID,
HostedZoneId→HOSTED_ZONE_ID로 매핑합니다.

~~~bash
AWS_CLI="${AWS_CLI:?set to the approved AWS CLI executable}"
"$AWS_CLI" sts get-caller-identity
"$AWS_CLI" cloudformation deploy --region us-east-1 --stack-name molroom-bootstrap --template-file infra/aws/molroom-bootstrap.yml --capabilities CAPABILITY_NAMED_IAM --parameter-overrides ControllerTag=molroom-release-controller-v1 HostedZoneId="${HOSTED_ZONE_ID:?set hosted zone}" ProductionStackName=molroom-production ExistingGitHubOidcProviderArn="${EXISTING_GITHUB_OIDC_PROVIDER_ARN:-}" GitHubOidcSubject=repo:kim-song-jun/meeting-wrapper:environment:production
~~~

.github/workflows/release.yml은 unprivileged candidate producer이고,
.github/workflows/security-gate.yml은 approved gate입니다. controller는 independently
protected immutable tag/SHA에서 실행하며 approved security-gate workflow blob과
dispatch_actor를 server run에 묶습니다. PLAN, release, repair, rollback, smoke,
restore는 모두 실제 reviewer 승인·관찰 대상입니다.

## 실행 순서

1. exact target SHA가 origin/main인지 확인합니다.
2. .github/workflows/release.yml을 target_sha로 dispatch하여 retained candidate
   artifact를 만듭니다.
3. 같은 SHA의 approved security gate를 실행해 security-gate-<sha>를 얻습니다.
4. molroom-release-controller-v1의 exact controller SHA
   7ba2814f491dccee9462c7bf01958dd28600b048에서 protected release workflow
   .github/workflows/release-controller.yml을 dispatch합니다. inputs는 mode, version,
   target_sha, candidate_run_id, security_gate_run_id, execute_cutover,
   confirmation입니다.
5. mode=release, execute_cutover=false로 PLAN을 검토한 뒤에만
   execute_cutover=true/confirmation=RELEASE를 승인합니다.

repair는 confirmation=REPAIR로 active target의 metadata/Release만 복구하고
cutover하지 않습니다. rollback은 confirmation=ROLLBACK으로 existing verified
prefix만 재사용합니다. fresh prepare→protected deploy→fresh publish 순서를
유지합니다. invalidation 뒤 target-SHA smoke가 실패하면 prior state를 restore하고
restored-SHA smoke를 수행합니다. 첫 release는 UNRELEASED/false로 restore합니다.
workflow-file self-pinning은 trust boundary가 아닙니다.

## 커밋 archive clean-room 검증

shared worktree가 dirty여도 이 command는 committed archive만 별도 temp에서 검사하며
redacted output과 retained artifact/receipt를 냅니다. local AWS SSO나 GitHub
credential은 candidate에 전달되지 않습니다.

~~~bash
node scripts/verify-release-archive.mjs
~~~

이 한 줄이 green이 아니면 push, tag, release를 진행하지 않습니다.

## 롤백

mode=rollback은 immutable releases/${release_sha}/ prefix의 exact object,
checksum, metadata를 확인하고 not re-upload/copy로 재사용합니다. prior
ActiveReleaseSha와 DistributionEnabled를 저장한 뒤 cutover/invalidation/smoke를
실행합니다. restore나 restored-SHA smoke 실패는 fatal이며 tag 이동이나 force
push로 우회하지 않습니다.

## 운영 입력 계약

[.env.example](../../.env.example)의 exact public four를 ignored .env로,
[.env.google-spike.example](../../.env.google-spike.example)의 exact private
seven을 .env.google-spike.local로 복사합니다. 허용 key는
VITE_GOOGLE_CLIENT_ID, VITE_ALLOWED_HD, GOOGLE_SPIKE_AUTHORIZED_ORIGINS,
GOOGLE_SPIKE_ORDINARY_ACCOUNT, GOOGLE_SPIKE_ADMIN_ACCOUNT,
GOOGLE_SPIKE_ROOM_A_CALENDAR_ID, GOOGLE_SPIKE_ROOM_B_CALENDAR_ID이며, Task 5는
뒤 네 key만 필수 subset으로 사용합니다. receipt closed keys는 schemaVersion, observation,
appType, domain, clientIdSuffix, workspaceEdition, enabledApis, initialScopes,
directoryScopeTiming, origins, accounts, rooms, tenantPolicy, operatorVerified입니다.

~~~bash
MOLROOM_NODE_ROOT="${MOLROOM_NODE_ROOT:?set to the Node 24.19.0 installation root}"
MOLROOM_NODE="$MOLROOM_NODE_ROOT/bin/node"
MOLROOM_NPM_CLI="$MOLROOM_NODE_ROOT/lib/node_modules/npm/bin/npm-cli.js"
test -x "$MOLROOM_NODE"
test -r "$MOLROOM_NPM_CLI"
test "$("$MOLROOM_NODE" --version)" = "v24.19.0"
test "$("$MOLROOM_NODE" "$MOLROOM_NPM_CLI" --version)" = "11.17.0"

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

secret, password, MFA, token, refresh/service-account material은 입력하지 않습니다.
실제 bootstrap/GitHub protection/Google human evidence/release smoke가 남아 있으므로
그 전까지 configured/deployed/live로 기록하지 않습니다. 사고 대응은
[SECURITY.md](../../SECURITY.md)를 따릅니다.
