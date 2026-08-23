# MolRoom Production Release Runbook (English)

This is the execution checklist for [README.en.md](../../README.en.md). Google
provisioning is currently `INCOMPLETE / UNOBSERVED`, and AWS/GitHub OIDC deploy
automation is defined but live success is not verified; this runbook describes
prerequisites, not passed gates.

## Prerequisites

- Node `24.19.0`, npm `11.17.0`, and serial verification
- The 14-step [Google provisioning gate](../spikes/google-workspace/provisioning.md)
  with `COMPLETE` evidence
- Organization-owned Google Cloud project and `Internal` OAuth Web client
- origins: `http://localhost:5184`, `https://molroom.molcube.com`
- initial scopes: Calendar events, Calendar readonly, Drive appdata
- no client secret, refresh token, MFA code, or AWS access key

## Sequence

1. The operator creates ignored `0600` env/receipt files from `.env.example`.
2. Run `validate-evidence`, `validate-provisioning`, and the sensitive scan.
3. Run `npm run typecheck`, `npm test`, `npm run build`,
   `npm run scan:production-bundle`, and `npm run validate:readmes`
   serially.
4. Use required reviewer approval on the GitHub `production` Environment and
   OIDC role to run `.github/workflows/release.yml`. The security gate is
   `.github/workflows/security-gate.yml`; provision
   `infra/aws/molroom-bootstrap.yml` before `infra/aws/molroom-production.yml`.
   Current GitHub environments=0, AWS session expired, and
   `molroom.molcube.com` is unresolved.
5. Run the following clean-room PLAN commands; verify the same-SHA artifact checksum,
   immutable `releases/${release_sha}/` prefix, CloudFront invalidation, Google
   evidence, and production smoke result; local tag/push is prohibited and the
   protected production workflow alone creates the tag and GitHub Release;
   local plans use `--dry-run` only;
   then use the guarded clean-tree SHA sequence to create the `v0.1.0` release.
6. Smoke `https://molroom.molcube.com` for TLS, deep links, login/logout,
   room read, create/edit/cancel, and secret exposure.

```bash
release_sha="$(git rev-parse HEAD)"
node scripts/build-release-manifest.mjs --artifact-root dist --commit-sha "$release_sha" --package-version "$(node -p 'require(\"./package.json\").version')" --source-date-epoch "$(git show -s --format=%ct "$release_sha")"
node scripts/upload-release-prefix.mjs --artifact-root dist --bucket "molroom-<account>-us-east-1-origin" --commit-sha "$release_sha" --dry-run
npm run verify:release-contract
```

## Rollback

Do not move tags or force-push. Verify and reuse the approved **previous artifact**
already present at immutable `releases/${release_sha}/`; do not re-upload or copy it.
Change only `ActiveReleaseSha`, invalidate CloudFront, run smoke, and record the
incident. The protected workflow verifies and reuses the remote immutable prefix;
it does not build, upload, or copy a local artifact. Follow [SECURITY.md](../../SECURITY.md) for
secret rotation.

## Operator input contract

`.env.google-spike.local` permits exactly seven unquoted keys. Blank lines and
`#` comments are the only extras; duplicate/unknown keys, quoting, and
interpolation fail closed.

```dotenv
VITE_GOOGLE_CLIENT_ID=<web-client-id>
VITE_ALLOWED_HD=molcube.com
GOOGLE_SPIKE_AUTHORIZED_ORIGINS=http://localhost:5184,https://molroom.molcube.com
GOOGLE_SPIKE_ORDINARY_ACCOUNT=<ordinary-account>
GOOGLE_SPIKE_ADMIN_ACCOUNT=<room-writer-admin-account>
GOOGLE_SPIKE_ROOM_A_CALENDAR_ID=<room-a-calendar-identifier>
GOOGLE_SPIKE_ROOM_B_CALENDAR_ID=<room-b-calendar-identifier>
```

`provisioning-receipt.local` is closed JSON and permits only `schemaVersion`,
`observation`, `appType`, `domain`, `clientIdSuffix`, `workspaceEdition`,
`enabledApis`, `initialScopes`, `directoryScopeTiming`, `origins`, `accounts`,
`rooms`, `tenantPolicy`, and `operatorVerified`. The validator derives `kind`,
`probeId`, `status`, and `capability`. Initial state is
`INCOMPLETE / UNOBSERVED`, `observation=UNOBSERVED`, `operatorVerified=false`.

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

`COMPLETE` is derived only after every live fact is observed and the three
commands succeed in that order.
The tag prerequisite is `test "$(git rev-parse origin/main)" = "$release_sha"`.

```bash
git fetch origin main --quiet
release_sha="$(git rev-parse HEAD)"
test "$(git rev-parse origin/main)" = "${release_sha}"
```
