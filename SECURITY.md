# MolRoom Security Policy

## Current boundary

MolRoom is intended to be a static browser SPA. Google permissions, not client-side
domain checks, are the authorization boundary. The checked-in runtime is still
mock-based, so it is not a production authorization implementation. Do not ship
while Google provisioning is `INCOMPLETE / UNOBSERVED` or AWS deployment is absent.

## Never store

Never commit OAuth client secrets, refresh/access tokens, MFA codes, passwords,
service-account keys, domain-wide delegation material, AWS access keys, private
certificates, or raw account/room identifiers. Use ignored `0600` operator files
and the [provisioning gate](docs/spikes/google-workspace/provisioning.md).

## Reporting and response

Do not put a suspected secret or exploit in a public issue. Preserve the commit
SHA and sanitized reproduction through the approved private channel.

1. Stop release and record UTC time, SHA, environment, and artifact checksum;
   never copy the exposed value.
2. Revoke the affected Google OAuth client/token or disable the AWS OIDC role.
   Invalidate CloudFront when the artifact is compromised.
3. Preserve CI, GitHub audit, CloudTrail, and sanitized evidence.
4. Issue replacement short-lived credentials through authorized consoles; never
   create a long-lived AWS access key as a workaround.
5. Update only approved GitHub Environment stores, verify least privilege, and
   run the production bundle scan. Never put values in Vite source, docs, chat,
   or issues.
6. Deploy through the protected production Environment, run smoke, and document
   scope, timestamps, remediation, and follow-up controls.

## Release security gate

The same candidate commit must pass typecheck, tests, build, `npm run
scan:production-bundle`, Google acceptance evidence, and independent
security review before `v0.1.0`. A failed or unknown gate blocks release.
