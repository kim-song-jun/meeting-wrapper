# MolRoom operations and release guide

This is the operator-followable sequence from Google Cloud/Workspace setup
through AWS deployment and recovery. The browser runtime still uses mock
adapters. Google evidence and the account matrix remain
INCOMPLETE / UNOBSERVED with operatorVerified=false. AWS bootstrap, OIDC,
CloudFormation, CloudFront, DNS, smoke, and restore have not been executed or
observed in the real accounts.

## [release.toolchain] 1. Pinned tools and safe start

Use exactly Node 24.19.0 and npm 11.17.0. From the repository root, point to
the installation root; do not hard-code another person's home or rely on bare
shell node/npm. Check host load, swap, owned PIDs, and ports before a workload.

~~~bash
MOLROOM_NODE_ROOT="${MOLROOM_NODE_ROOT:?set to the Node 24.19.0 installation root}"
MOLROOM_NODE="$MOLROOM_NODE_ROOT/bin/node"
MOLROOM_NPM_CLI="$MOLROOM_NODE_ROOT/lib/node_modules/npm/bin/npm-cli.js"
test -x "$MOLROOM_NODE"
test -r "$MOLROOM_NPM_CLI"
test "$("$MOLROOM_NODE" --version)" = "v24.19.0"
test "$("$MOLROOM_NODE" "$MOLROOM_NPM_CLI" --version)" = "11.17.0"
~~~

## [release.google-oauth] 2. Google Cloud OAuth and Workspace

An authorized operator must perform these steps.
Do not record success until a human has observed it.

Complete the [Google provisioning gate](docs/spikes/google-workspace/provisioning.md)
first. Use a Cloud project owned by the molcube.com Workspace organization,
set the OAuth consent audience to Internal, and create an OAuth client of type
Web application. Do not download or use a client secret for the SPA. The
Authorized JavaScript origins are exactly:

~~~text
http://localhost:5184
https://molroom.molcube.com
~~~

Enable Calendar API, Drive API, and People API. Initial consent contains only
the three scopes below; defer the People directory scope until its separately
approved incremental-consent gate.

~~~text
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/drive.appdata
~~~

Choose two distinct real hosted-domain accounts and map them to ordinary and
room-writer-admin. Map exactly two Calendar resources to room-a and room-b.
For each room, the ACL allows domain read, denies writer to ordinary, and
grants writer only to room-writer-admin. Inspect Google Admin and Calendar UI
to confirm auto-accept of non-conflicting invitations.

Create four fresh operator-owned profiles: ordinary-chrome-desktop,
ordinary-safari-desktop, admin-chrome-desktop, and admin-safari-desktop.
Sign in only ordinary in the first two and only room-writer-admin in the last
two. Account switching, multiple sign-ins, and guest/incognito are not
substitutes. If permissions or tenant policy block the work, do not bypass it;
record TENANT_POLICY_BLOCKED. Until a human verifies every fact, keep
INCOMPLETE / UNOBSERVED and operatorVerified=false.

## [release.env] 3. Public/private env and local validation

[.env.example](.env.example) is the committed template for exactly four
public browser VITE assignments.
[.env.google-spike.example](.env.google-spike.example) is the exact seven-key
private template for non-secret identifiers; the Task 5 subset is the two
accounts and two room calendars.

~~~text
public.env.keys=VITE_DEPLOYMENT,VITE_ADAPTER,VITE_GOOGLE_CLIENT_ID,VITE_ALLOWED_HD
private.env.keys=VITE_GOOGLE_CLIENT_ID,VITE_ALLOWED_HD,GOOGLE_SPIKE_AUTHORIZED_ORIGINS,GOOGLE_SPIKE_ORDINARY_ACCOUNT,GOOGLE_SPIKE_ADMIN_ACCOUNT,GOOGLE_SPIKE_ROOM_A_CALENDAR_ID,GOOGLE_SPIKE_ROOM_B_CALENDAR_ID
task5.env.keys=GOOGLE_SPIKE_ORDINARY_ACCOUNT,GOOGLE_SPIKE_ADMIN_ACCOUNT,GOOGLE_SPIKE_ROOM_A_CALENDAR_ID,GOOGLE_SPIKE_ROOM_B_CALENDAR_ID
~~~

The receipt permits only these closed JSON keys: schemaVersion, observation,
appType, domain, clientIdSuffix, workspaceEdition, enabledApis, initialScopes,
directoryScopeTiming, origins, accounts, rooms, tenantPolicy,
operatorVerified. Never put a password, MFA value, OAuth client secret, token,
refresh material, or service-account material in either local env.

Create the ignored 0600 files and run all four validators in this order:

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

Never promote an unobserved or failed value to success. COMPLETE is derived
only when operator evidence and the validators agree.

## [release.validation] 4. Static validation and candidate gate

Run only the required commands, serially, with the same pinned toolchain.

~~~bash
"$MOLROOM_NODE" "$MOLROOM_NPM_CLI" ci
"$MOLROOM_NODE" "$MOLROOM_NPM_CLI" run typecheck
"$MOLROOM_NODE" "$MOLROOM_NPM_CLI" test
"$MOLROOM_NODE" "$MOLROOM_NPM_CLI" run build
"$MOLROOM_NODE" "$MOLROOM_NPM_CLI" run scan:production-bundle
"$MOLROOM_NODE" "$MOLROOM_NPM_CLI" run validate:readmes
"$MOLROOM_NODE" "$MOLROOM_NPM_CLI" run verify:release-contract
~~~

.github/workflows/release.yml accepts only target_sha and is a
credential-free candidate artifact producer. It receives the exact four
public VITE values and no secrets, OIDC, production Environment, or write
permission. A trusted verifier from the protected annotated controller tag
controls the disposable container and emits the retained artifact.

## [release.aws-oidc] 5. GitHub and AWS bootstrap

These lines are the exact setup inventory:

~~~text
github.repository.variables=VITE_GOOGLE_CLIENT_ID,VITE_ALLOWED_HD
github.production_environment.variables=AWS_ACCOUNT_ID,AWS_DEPLOY_ROLE_ARN,CLOUDFORMATION_ROLE_ARN,HOSTED_ZONE_ID
release.controller.ref=refs/tags/molroom-release-controller-v1
release.controller.sha=7ba2814f491dccee9462c7bf01958dd28600b048
release.controller.inputs=mode,version,target_sha,candidate_run_id,security_gate_run_id,execute_cutover,confirmation
~~~

Set only the two VITE values as GitHub repository variables. Put the four AWS
values in the production Environment, require a required reviewer, and forbid
self-approval. Its deployment branch/tag restriction permits only the
protected controller tag molroom-release-controller-v1. Make that controller
tag and v* release tags immutable/protected. Store no access keys
(no long-lived AWS credentials).

Use an AWS SSO administrator session, never AWS root, in us-east-1. Supply
ExistingGitHubOidcProviderArn when the account-wide provider already exists;
otherwise leave it empty for the template to create. The exact OIDC subject is
repo:kim-song-jun/meeting-wrapper:environment:production and the trust
workflow_ref is
.github/workflows/release-controller.yml@refs/tags/molroom-release-controller-v1.

~~~bash
AWS_CLI="${AWS_CLI:?set to the approved AWS CLI executable}"
"$AWS_CLI" sts get-caller-identity
"$AWS_CLI" cloudformation deploy --region us-east-1 --stack-name molroom-bootstrap --template-file infra/aws/molroom-bootstrap.yml --capabilities CAPABILITY_NAMED_IAM --parameter-overrides ControllerTag=molroom-release-controller-v1 HostedZoneId="${HOSTED_ZONE_ID:?set hosted zone}" ProductionStackName=molroom-production ExistingGitHubOidcProviderArn="${EXISTING_GITHUB_OIDC_PROVIDER_ARN:-}" GitHubOidcSubject=repo:kim-song-jun/meeting-wrapper:environment:production
~~~

Map stack output GitHubDeployRoleArn to AWS_DEPLOY_ROLE_ARN and
CloudFormationExecutionRoleArn to CLOUDFORMATION_ROLE_ARN. Set the current
account ID as AWS_ACCOUNT_ID and the input HostedZoneId as HOSTED_ZONE_ID.
The real infra/aws/molroom-bootstrap.yml deployment and outputs have not been
executed or observed.

## [release.first-release] 6. PLAN, release, and repair

The order is fixed:

1. Dispatch .github/workflows/release.yml with target_sha from origin/main to produce
   the verified-release artifact.
2. Run the approved .github/workflows/security-gate.yml for the same SHA and
   obtain security-gate-<sha> evidence.
3. Dispatch the protected release workflow
   .github/workflows/release-controller.yml from the protected tag
   with mode, version, target_sha, candidate_run_id, security_gate_run_id,
   execute_cutover, and confirmation.

The controller runs only from the independently protected immutable tag/SHA.
It byte-compares the approved security-gate workflow blob with the target-SHA
blob and binds evidence dispatch_actor to the server workflow-run actor.
Workflow-file self-pinning is not a trust boundary.

For mode=release, review a PLAN with execute_cutover=false, then use
execute_cutover=true and confirmation=RELEASE after approval. mode=repair uses
confirmation=REPAIR to repair active-target metadata/GitHub Release without
cutover. mode=rollback uses confirmation=ROLLBACK and only an existing
verified prefix. Candidate, security-gate, and controller run IDs must bind to
the same target SHA.

Fresh unprivileged prepare, fresh protected AWS deploy, and fresh
contents-write publish jobs separate authority. After invalidation, deployment
runs target-SHA release-metadata smoke. A failure must restore the prior SHA
and run restored-SHA smoke; a first-release failure restores
UNRELEASED/false. This document makes no live release, smoke, or restore claim.

## [release.rollback] 7. Rollback and recovery

Rollback verifies and reuses the existing immutable
releases/${release_sha}/ prefix; it is not re-upload/copy. Never move a tag or
force-push. Capture prior ActiveReleaseSha/DistributionEnabled first, and
treat a failed restore or smoke as fatal. Correct the cause with a separate
new-SHA/new-version release.

## [release.security] 8. External blockers and incident response

Real Google tenant verification, human checks for the two accounts/two rooms,
GitHub protection/Environment settings, AWS SSO bootstrap, DNS/TLS,
release/repair/rollback, and smoke/restore remain external operator work. Do
not call the system configured, deployed, or live before those observations.
Follow [SECURITY.md](SECURITY.md) for rotation and incident response.
