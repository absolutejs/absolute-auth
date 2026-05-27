# OpenID Conformance Suite — local runner

Runs the OpenID Foundation conformance suite
(<https://gitlab.com/openid/conformance-suite>) against a deployed
`@absolutejs/auth` OIDC provider. Nothing here is needed to use the package;
this directory is purely the certification preparation harness.

The conformance suite is a JVM application (Spring Boot + MongoDB + httpd)
distributed via Docker. Running it locally requires Docker + ~3 GB RAM. It
is **not bundled with the package** — the runner script clones it
on-demand into a sibling directory.

## Quick start

```bash
# 1. one-time prep: clone + build the suite (15-20 min, mostly Maven downloads)
./conformance/setup.sh

# 2. point at any URL that serves a `@absolutejs/auth` discovery document
TARGET_ISSUER=https://oidc-conformance.absolutejs.com ./conformance/run.sh

# 3. browse results: http://localhost:8443/
#    Default credentials: ssl/ca, see suite docs
```

For a fully local round-trip (suite + provider on the same machine), use
`ngrok` or `cloudflared` to expose the local provider over a real HTTPS URL
— the conformance suite refuses to talk to `http://localhost`.

## Profiles we target

The package targets the **minimum honest OIDC badge set** at
<https://openid.net/certification/op_servers/>:

| Profile | OpenID profile name | Status |
|---|---|---|
| Basic OP | `oidcc-basic-certification-test-plan` | ready (with this PR's `response_mode=form_post`) |
| Config OP | `oidcc-config-certification-test-plan` | ready |
| Dynamic OP | `oidcc-dynamic-certification-test-plan` | ready (DCR shipped in 0.29.0) |
| RP-Init Logout OP | `oidcc-rp-initiated-logout-certification-test-plan` | ready (0.29.0) |
| Back-Channel Logout OP | `oidcc-backchannel-rp-initiated-logout-certification-test-plan` | ready (0.29.0) |
| Form Post OP | `oidcc-formpost-basic-certification-test-plan` | ready (this PR) |

Aspirational (FAPI 2.0) profiles are documented in
`../OPENID-CONFORMANCE-CERTIFICATION.md`; running those needs CIBA + the
extra signing-alg policy work that ship in `@absolutejs/auth` 0.36.0+ +
some additional configuration the suite expects.

## Where the suite expects to land

The suite needs a **reachable HTTPS URL** with at least these endpoints
working against a published, registered test client:

- `GET /.well-known/openid-configuration`
- `GET /oauth2/jwks`
- `POST /oauth2/register` (Dynamic OP)
- `GET /oauth2/authorize` (with `response_mode=form_post` support for Form Post OP)
- `POST /oauth2/token`
- `GET /oauth2/userinfo`
- `GET /oauth2/end-session` (RP-Init Logout OP)
- `POST /oauth2/backchannel-logout` (Back-Channel Logout OP)

`examples/auth` in `~/abs/examples` runs every block enabled by default,
so it can serve as the reference instance.

## Once we're funded

See `../OPENID-CONFORMANCE-CERTIFICATION.md` for the OpenID Foundation
membership + per-profile fee schedule and the submission process. The
self-test results from this directory feed directly into the submission.
