# MolRoom production release runbook

Google provisioning and the account matrix remain INCOMPLETE / UNOBSERVED
with operatorVerified=false. AWS bootstrap, production deployment, smoke, and
restore have not been executed or observed. This runbook defines the sequence
for authorized humans after external gates; it makes no live claim.

## Prerequisites

Use Node 24.19.0 and npm 11.17.0 from one pinned installation. Apply host
preflight and owned-PID cleanup. Follow the
[provisioning guide](../spikes/google-workspace/provisioning.md) exactly.

An authorized operator must perform these steps.
Do not record success until a human has observed it.

Use a Google Cloud project owned by the molcube.com Workspace organization.
Set the OAuth audience to Internal and client type to Web application. Register
only `http://localhost:5184` and `https://molroom.molcube.com` as Authorized
JavaScript origins. Enable Calendar API, Drive API, and People API. Restrict
the initial scopes to
`https://www.googleapis.com/auth/calendar.events`,
`https://www.googleapis.com/auth/calendar.readonly`, and
`https://www.googleapis.com/auth/drive.appdata`.

Prepare distinct ordinary and room-writer-admin accounts plus room-a and
room-b Calendar resources. Inspect each ACL for domain read, ordinary
non-writer, and room-writer-admin writer, then observe each room's auto-accept
in the UI. Isolate exactly four profiles: ordinary-chrome-desktop,
ordinary-safari-desktop, admin-chrome-desktop, and admin-safari-desktop.
A block is TENANT_POLICY_BLOCKED; keep INCOMPLETE / UNOBSERVED and
operatorVerified=false rather than bypassing or guessing.

The exact GitHub/AWS setup inventory is:

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

On the GitHub production Environment, configure a required reviewer, prohibit
self-approval, and restrict deployment refs to the protected
molroom-release-controller-v1 tag. Protect that controller tag and v* tags.
Do not store AWS access keys (no long-lived AWS credentials).

As an AWS SSO administrator, never AWS root, deploy
infra/aws/molroom-bootstrap.yml in us-east-1. Parameters are
ControllerTag=molroom-release-controller-v1, HostedZoneId,
ProductionStackName=molroom-production, optional
ExistingGitHubOidcProviderArn, and
GitHubOidcSubject=repo:kim-song-jun/meeting-wrapper:environment:production.
The trust workflow_ref is
.github/workflows/release-controller.yml@refs/tags/molroom-release-controller-v1.
Map GitHubDeployRoleArn→AWS_DEPLOY_ROLE_ARN,
CloudFormationExecutionRoleArn→CLOUDFORMATION_ROLE_ARN, account ID→AWS_ACCOUNT_ID,
and HostedZoneId→HOSTED_ZONE_ID.

~~~bash
AWS_CLI="${AWS_CLI:?set to the approved AWS CLI executable}"
"$AWS_CLI" sts get-caller-identity
"$AWS_CLI" cloudformation deploy --region us-east-1 --stack-name molroom-bootstrap --template-file infra/aws/molroom-bootstrap.yml --capabilities CAPABILITY_NAMED_IAM --parameter-overrides ControllerTag=molroom-release-controller-v1 HostedZoneId="${HOSTED_ZONE_ID:?set hosted zone}" ProductionStackName=molroom-production ExistingGitHubOidcProviderArn="${EXISTING_GITHUB_OIDC_PROVIDER_ARN:-}" GitHubOidcSubject=repo:kim-song-jun/meeting-wrapper:environment:production
~~~

.github/workflows/release.yml is the unprivileged candidate producer, and
.github/workflows/security-gate.yml is the approved gate. The controller runs
from an independently protected immutable tag/SHA and binds the approved
security-gate workflow blob plus dispatch_actor to the server run. PLAN,
release, repair, rollback, smoke, and restore all require real reviewer
approval and observation.

## Sequence

1. Confirm the exact target SHA is origin/main.
2. Dispatch .github/workflows/release.yml with target_sha and retain its
   candidate artifact.
3. Run the approved security gate for the same SHA and retain
   security-gate-<sha>.
4. From molroom-release-controller-v1 at exact SHA
   7ba2814f491dccee9462c7bf01958dd28600b048, dispatch the protected release workflow
   .github/workflows/release-controller.yml with mode, version,
   target_sha, candidate_run_id, security_gate_run_id, execute_cutover, and
   confirmation.
5. For mode=release, review PLAN with execute_cutover=false before approving
   execute_cutover=true and confirmation=RELEASE.

repair uses confirmation=REPAIR to restore active-target metadata/Release
without cutover. rollback uses confirmation=ROLLBACK and only an existing
verified prefix. Keep fresh prepare→protected deploy→fresh publish authority
separation. After invalidation, a failed target-SHA smoke restores prior state
and runs restored-SHA smoke. A failed first release restores
UNRELEASED/false. Workflow-file self-pinning is not a trust boundary.

## Committed archive clean-room verification

Even when the shared worktree is dirty, this command inspects only a committed
archive in a separate temp area and emits redacted output plus the retained
artifact/receipt. Candidate execution receives no local AWS SSO or GitHub
credential.

~~~bash
node scripts/verify-release-archive.mjs
~~~

Do not push, tag, or release unless this exact one-line gate is green.

## Rollback

mode=rollback verifies and reuses the exact objects, checksums, and metadata in
the immutable releases/${release_sha}/ prefix; it is not re-upload/copy.
Capture prior ActiveReleaseSha and DistributionEnabled before
cutover/invalidation/smoke. A failed restore or restored-SHA smoke is fatal;
never move a tag or force-push around it.

## Operator input contract

Copy the exact public four from [.env.example](../../.env.example) to the
ignored .env and the exact private seven from
[.env.google-spike.example](../../.env.google-spike.example) to
.env.google-spike.local. The allowed keys are VITE_GOOGLE_CLIENT_ID,
VITE_ALLOWED_HD, GOOGLE_SPIKE_AUTHORIZED_ORIGINS,
GOOGLE_SPIKE_ORDINARY_ACCOUNT, GOOGLE_SPIKE_ADMIN_ACCOUNT,
GOOGLE_SPIKE_ROOM_A_CALENDAR_ID, and GOOGLE_SPIKE_ROOM_B_CALENDAR_ID; Task 5
requires only the last four.
Receipt closed keys are schemaVersion, observation, appType, domain,
clientIdSuffix, workspaceEdition, enabledApis, initialScopes,
directoryScopeTiming, origins, accounts, rooms, tenantPolicy, and
operatorVerified.

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

Never enter a secret, password, MFA value, token, refresh material, or
service-account material. Real bootstrap, GitHub protection, Google human
evidence, and release smoke remain external; do not report configured,
deployed, or live before them. Follow [SECURITY.md](../../SECURITY.md) for
incident response.
