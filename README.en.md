# MolRoom Operations and Release Guide

This guide covers the reproducible path from Google Cloud setup to AWS
CloudFront deployment and rollback. The repository is **not production-ready**:
the browser runtime still uses mock auth/booking adapters, Google provisioning
is `INCOMPLETE / UNOBSERVED`, and AWS CloudFormation, CloudFront, and GitHub OIDC
deployment are not implemented.

## [release.toolchain] 1. Pinned tools and safe start

Use Node `24.19.0` and npm `11.17.0`. Before tests/builds inspect host load,
memory/swap, Node/browser processes, and ports; run serially and reap task-owned
PIDs. In the shared worktree do not use stash, reset, clean, or branch switching.

```bash
node --version                 # v24.19.0
npm --version                  # 11.17.0
npm ci
npm run verify:toolchain
```

## [release.google-oauth] 2. Google OAuth and Workspace

An authorized operator performs the 14-step [provisioning gate](docs/spikes/google-workspace/provisioning.md)
in their own browser. Use an organization-owned project and `Internal` OAuth.
The Web client must contain only these origins:

```text
http://localhost:5184
https://molroom.molcube.com
```

Verify Calendar, Drive, and People API; limit initial consent to the following
three scopes and defer People directory scope to Task 11:

```text
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/drive.appdata
```

Do not create/download a browser client secret. Never record a full client ID,
refresh material, password, or MFA code in the repository.

## [release.env] 3. Operator env and validation

The operator uses [.env.example](.env.example) and creates ignored
`.env.google-spike.local` and `provisioning-receipt.local`, both mode `0600`,
with observed values only, including `VITE_GOOGLE_CLIENT_ID`.

Exactly these seven env keys are allowed. Values are unquoted `KEY=value`; only
blank lines and `#` comments may be added. Observed account and calendar values
remain in the local file and committed documents/evidence use aliases only.

```dotenv
VITE_GOOGLE_CLIENT_ID=<web-client-id>
VITE_ALLOWED_HD=molcube.com
GOOGLE_SPIKE_AUTHORIZED_ORIGINS=http://localhost:5184,https://molroom.molcube.com
GOOGLE_SPIKE_ORDINARY_ACCOUNT=<ordinary-account>
GOOGLE_SPIKE_ADMIN_ACCOUNT=<room-writer-admin-account>
GOOGLE_SPIKE_ROOM_A_CALENDAR_ID=<room-a-calendar-identifier>
GOOGLE_SPIKE_ROOM_B_CALENDAR_ID=<room-b-calendar-identifier>
```

The receipt is closed and permits only these keys: `schemaVersion`,
`observation`, `appType`, `domain`, `clientIdSuffix`, `workspaceEdition`,
`enabledApis`, `initialScopes`, `directoryScopeTiming`, `origins`, `accounts`,
`rooms`, `tenantPolicy`, `operatorVerified`. The validator derives `kind`,
`probeId`, `status`, and `capability`; do not enter them. Before live observation
keep `observation=UNOBSERVED` and `operatorVerified=false`.

```bash
umask 077
spike_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/molroom-spike.XXXXXX")"
trap 'rm -f -- "$spike_tmp_dir"/*; rmdir -- "$spike_tmp_dir"' EXIT
touch .env.google-spike.local provisioning-receipt.local
chmod 600 .env.google-spike.local provisioning-receipt.local
git check-ignore -v .env.google-spike.local provisioning-receipt.local
```

`COMPLETE` is derived only after every live fact is observed and the exact
`validate-evidence`, `validate-provisioning`, `scan-sensitive-paths` sequence
succeeds.

```bash
umask 077
chmod 600 .env.google-spike.local provisioning-receipt.local
git check-ignore -v .env.google-spike.local provisioning-receipt.local
node scripts/google-spike/validate-evidence.mjs docs/spikes/google-workspace/evidence/provisioning.json
node scripts/google-spike/validate-provisioning.mjs .env.google-spike.local provisioning-receipt.local
node scripts/google-spike/scan-sensitive-paths.mjs --redact docs/spikes/google-workspace/provisioning.md docs/spikes/google-workspace/evidence/provisioning.json scripts/google-spike/lib/provisioning.mjs scripts/google-spike/lib/provisioning.test.mjs scripts/google-spike/validate-provisioning.mjs
```

Do not start the next capability probe or production runtime work unless status
is `COMPLETE`.

## [release.validation] 4. Verification and build gate

```bash
npm run typecheck
npm test
npm run build
npm run scan:production-bundle
npm run validate:readmes
node scripts/build-design-standalone.mjs
node scripts/validate-design-examples.mjs
```

The production bundle must not contain mock identity, QA backdoors, title
sentinels, OAuth secrets, or AWS keys. UI changes also require real screenshots.

## [release.aws-oidc] 5. GitHub Environment and OIDC

There is currently no GitHub Environment, OIDC role, or AWS workflow. When
implemented, protect a `production` Environment with required reviewers and
tags, use an AWS OIDC role restricted to this repository/Environment, and never
create long-lived AWS access keys. CloudFormation must reproduce private S3,
CloudFront Origin Access Control, ACM (`us-east-1`), Route 53 alias
`molroom.molcube.com`, SPA fallback, and security headers. Do not put real IDs,
ARNs, or client IDs in docs.

## [release.first-release] 6. First release and smoke

Only after Google provisioning is `COMPLETE`, Google runtime acceptance passes,
security scan High/Critical is zero, CI build/bundle scan passes, and CloudFront
deploys the same commit:

```bash
git fetch origin main --quiet
release_sha="$(git rev-parse HEAD)"
test -z "$(git status --porcelain)"
git diff --quiet "${release_sha}^" "${release_sha}"
test "$(git rev-parse origin/main)" = "${release_sha}"
git tag --list v0.1.0 | grep -q '^v0.1.0$' && { echo 'tag exists; abort'; exit 1; } || true
git tag -a v0.1.0 "${release_sha}" -m "MolRoom v0.1.0"
git push --atomic origin "v0.1.0"
```

The GitHub Release records SHA, artifact checksum, evidence reference, and smoke
result. Smoke `https://molroom.molcube.com` for TLS, deep links, login/logout,
room read, create/edit/cancel, and secret exposure. This has not run yet.

## [release.rollback] 7. Rollback and incident response

Do not move tags or force-push. Deploy an approved **previous artifact** as a new
deployment: record current SHA, CloudFront distribution ID, and checksum; upload
the verified artifact to S3; invalidate CloudFront; run production smoke; then
fix the cause in a new commit/tag. Follow [SECURITY.md](SECURITY.md) for the
secret rotation and incident response procedure.

## [release.security] 8. Security and incident response

Follow [SECURITY.md](SECURITY.md) for the complete secret rotation and incident
response procedure.
