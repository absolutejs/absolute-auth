# Verifiable Credentials (G6) — multi-cycle plan

`0.40.0-beta.0` ships a TIGHT minimal subset so the package can issue SD-JWT VCs to a wallet via OpenID4VCI's pre-authorized_code flow. That alone is enough for the "ID card you can store in your wallet" use case that's the most-requested first-step.

The full G6 scope is deliberately spread across several betas because each piece is a distinct spec family. This file captures what's shipped, what's deferred, and the order to add the rest.

## What `0.40.0-beta.0` ships (this cycle)

- **SD-JWT VC primitives** (`src/vc/sdJwt.ts`) — draft-ietf-oauth-sd-jwt-vc + draft-ietf-oauth-selective-disclosure-jwt
  - `issueSdJwtVc({base, selective, signingKey, holderJwk?})` — encodes selective claims as salted hashes (`_sd`), emits the `<jwt>~<disclosure1>~<disclosure2>~` form with optional `cnf` holder binding
  - `parseSdJwtVc(token)` — splits the `~` form, decodes the JWT payload + disclosures
  - `presentSdJwtVc(parsed, claimNames)` — drops disclosures the holder doesn't want to reveal
  - `verifySdJwtVc({token, issuerPublicJwk})` — verifies issuer signature, rehashes disclosures against `_sd`, returns `{protectedClaims, disclosedClaims, cnf?}`
- **OpenID4VCI issuer-side routes** (`src/oidc/vci.ts`)
  - `GET /.well-known/openid-credential-issuer` — issuer metadata + `credential_configurations_supported`
  - `POST /vci/credential` — issues an SD-JWT VC for an authorized access token; cnf-binds via the wallet's `proof.jwt` if supplied
  - `POST /vci/nonce` — issues a fresh c_nonce for wallet proof-of-possession
  - `urn:ietf:params:oauth:grant-type:pre-authorized_code` on `/oauth2/token`
- **Stores** — in-memory + Postgres for `CredentialOffer` + `CredentialNonce`
- **Discovery** — issuer metadata advertises `credential_configurations_supported` + pre-authorized_code grant
- **Tests** — SD-JWT round-trips, OID4VCI happy path, c_nonce binding, tamper detection

## Deferred to `0.40.0-beta.1` (next slice)

- **OpenID for Verifiable Presentations (OID4VP)** — verifier side
  - `POST /vp/authorize` — initiate a presentation request with DIF Presentation Definition
  - `POST /vp/response` — accept `vp_token` + `presentation_submission`, verify, surface to consumer hook `onVerifiedPresentation({verifiedClaims, holderJwk})`
  - Same-device (cross-domain redirect) + cross-device (QR / deeplink) modes
  - SIOPv2 `id_token` mode (legacy compatibility)
- **Status mechanism** — Bitstring Status List (draft-ietf-oauth-status-list)
  - `/vc/status/:listId` endpoint serving the status list as a signed JWT
  - `revokeVcCredential(jti)` operation that flips the bit
  - `verifySdJwtVc` honors `status` claim when present

## Deferred to `0.40.0-beta.2+` (later slices)

- **Additional credential formats**
  - JWT-VC (W3C VC Data Model 2.0 JSON-LD form via JWT envelope)
  - mdoc / ISO 18013-5 (mobile driver's license format) — needs CBOR + COSE primitives
- **Authorization Code flow** for VCI (in addition to pre-authorized_code) — for in-band consent UX where the wallet drives login
- **Key attestation** — `attestation_jwt` proof type so the wallet proves its key lives in a secure enclave
- **Trust frameworks** — EUDIW trust list lookup, OID Federation 1.0 (= G10) for cross-issuer trust
- **Postgres status store** + multi-tenant status list partitioning
- **DPoP-bound credential delivery** — the credential is bound to the wallet's DPoP key in addition to the cnf JWK

## Skipped (deliberate non-goals)

- Wallet implementation — out of scope; the package issues + verifies, the wallet is the user's app
- Real ARF (EU Architecture Reference Framework) trust list integration — punt until an EU consumer asks
- LD-Proof JSON-LD VCs — superseded by SD-JWT VC + mdoc in practice; the W3C VC DM 2.0 secure-by-default formats are what wallets implement

## Spec references

- SD-JWT VC: `draft-ietf-oauth-sd-jwt-vc-09` (2025-06)
- SD-JWT: `draft-ietf-oauth-selective-disclosure-jwt-13` (2025-05)
- OpenID4VCI: `openid-4-verifiable-credential-issuance-1_0-ID2` (final 2025-09)
- OpenID4VP: `openid-4-verifiable-presentations-1_0-ID3` (final 2025-09)
- Bitstring Status List: `draft-ietf-oauth-status-list-12` (2025-04)
- W3C VC Data Model 2.0: `vc-data-model-2.0` (W3C Rec 2025-05)
- EUDI ARF: `eu-digital-identity-wallet/eudi-doc-architecture-and-reference-framework`

## Why this order

Issuer-first because (a) most "first VC use case" inquiries are "I want to issue a credential the user can hold in their wallet," (b) it's the simpler half (the issuer always knows the schema; the verifier has to handle arbitrary presentations), and (c) it composes cleanly on top of the existing OIDC provider — pre-authorized_code is just another grant type, the credential endpoint is just another protected route.

OID4VP (verifier) follows because the consumer can rehearse the protocol against their own issuer in beta.0, then accept presentations in beta.1. Status mechanism rides with verifier because "I issued it and can revoke it" is the same operation pair.
