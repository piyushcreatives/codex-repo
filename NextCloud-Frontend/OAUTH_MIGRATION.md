# CloudSpace ↔ Keycloak/OAuth2 migration — design + de-risking

## The problem
Nextcloud login is delegated to **Keycloak** (oidc_login). CloudSpace's adapter currently
authenticates to Nextcloud with a **username/password → app-password** exchange, which SSO
users can't do (they have no Nextcloud password to type). We need users to log in on the
frontend (`cloud.icingtree.com`) via Keycloak, with no per-domain client sprawl.

## The design (1 client, not 3)
A Keycloak/OAuth *client* = one application, not one per subdomain. CloudSpace becomes a
single **OAuth2 client of Nextcloud** (which is already Keycloak's client). Keycloak never
sees `cloud`/`cloudapi` — only Nextcloud.

```
Keycloak ──(existing client: Nextcloud)──► nc.icingtree.com
                                                  ▲ (1 OAuth2 client: CloudSpace, redirect_uri = https://cloud.icingtree.com/api/auth/callback)
cloud.icingtree.com ──/api──► cloudapi.icingtree.com ─┘
```

Login flow (one login, on the frontend):
1. "Sign in" → browser to `nc/index.php/apps/oauth2/authorize?response_type=code&client_id=…&redirect_uri=https://cloud.icingtree.com/api/auth/callback&state=…`
2. Nextcloud (logged out) → auto-redirects to **Keycloak**; user authenticates once.
3. Keycloak → Nextcloud → Nextcloud issues an **authorization code** to the redirect_uri.
4. `cloud.icingtree.com/api/auth/callback` (proxied to the adapter) → adapter exchanges the code
   at `nc/apps/oauth2/api/v1/token` for **access_token + refresh_token**, creates the session
   cookie (same-origin on `cloud.icingtree.com`), redirects to `/`.
5. Adapter calls Nextcloud APIs with `Authorization: Bearer <access_token>` (refresh on expiry).

## De-risking result (the reason we probed first)
Minted a **real Nextcloud OAuth2 access token** (local NC v28) and tested Bearer across every
CloudSpace API. `scripts/oauth-bearer-check.cjs` reproduces this against any NC (incl. prod v33).

| API | Bearer | Note |
|-----|--------|------|
| OCS (user, capabilities, notifications) | ✅ 200 | |
| Files (WebDAV `remote.php/dav`) | ✅ 207 | |
| Calendar (CalDAV) | ✅ 207 | |
| Contacts (CardDAV) | ✅ 207 | |
| Talk (spreed) | ✅ 200 | |
| Mail | ✅ (412 = no account, **auth accepted**) | |
| **Deck** | ❌ **401** | Deck's `/index.php/apps/deck/api` does **not** honor OAuth Bearer |

**Conclusion:** a clean Bearer swap works for everything **except Deck**. That's the one
caveat — and it's narrow.

## Deck — the one gap, options
1. **Re-test on v33 first** (`scripts/oauth-bearer-check.cjs` with a prod token) — newer Deck
   may have added OAuth support. If it passes on v33, there is no gap.
2. If Deck still 401s on v33:
   - Keep an **app-password fallback just for Deck** users who set one (degraded; not ideal for pure-SSO).
   - Proxy Deck via a path Deck accepts (it honors session cookies / Basic — neither available to a pure-OAuth session).
   - Treat Deck as read-limited for SSO users until upstream adds Bearer support, and surface that honestly in the UI.

## Callback path & client registration
The callback lives under **`/api/auth/callback`** so it's already covered by the existing
`/api` reverse proxy (prod) and Vite proxy (dev) — the adapter handles it server-side, the
`code` never touches browser JS, and no extra nginx location is needed. Nextcloud allows one
redirect URI per client, so register **two** clients (Settings → Security → OAuth 2.0):

| Env | Client name | Redirection URI |
|-----|-------------|-----------------|
| Production | `CloudSpace` | `https://cloud.icingtree.com/api/auth/callback` |
| Dev (local) | `CloudSpace (dev)` | `http://localhost:5173/api/auth/callback` |

Env vars (the **secret stays server-side**; only the client *id* may be public/`VITE_`):
```
# adapter (cloudapi) — server-side
OAUTH_CLIENT_ID=<Client Identifier from Nextcloud>
OAUTH_CLIENT_SECRET=<Secret from Nextcloud>     # never in the frontend / git
OAUTH_REDIRECT_URI=https://cloud.icingtree.com/api/auth/callback
# frontend (public id only)
VITE_OAUTH_CLIENT_ID=<same Client Identifier>
VITE_OAUTH_REDIRECT_URI=https://cloud.icingtree.com/api/auth/callback
```
NC endpoints (from `NC_BASE_URL`): authorize `…/index.php/apps/oauth2/authorize`,
token `…/index.php/apps/oauth2/api/v1/token`. The redirect URI must be **byte-identical** in
the registration, the authorize request, and the token exchange.

Keycloak needs **no changes** — the existing `nextcloud_new_UI` client (realm `paas`,
redirect `https://nc.icingtree.com/*`) is all that's required; CloudSpace authenticates through
Nextcloud, and Keycloak only ever redirects back to `nc.icingtree.com`.

## Implementation checklist (after Deck decision)
- [ ] Register the two Nextcloud OAuth2 clients above; put id/secret in env.
- [ ] Adapter: `GET /api/auth/oauth/start` + `GET /api/auth/callback` (code↔token exchange), store `{accessToken, refreshToken, expiresAt}` in the encrypted session.
- [ ] Adapter: swap `toBasicAuth` → `Bearer <accessToken>` with refresh-on-401 (`nextcloud-client.ts`, `groupware-client.ts`, `credential-provider.ts`); update `realtime.ts` notify_push auth.
- [ ] Frontend: "Sign in with Keycloak" button → `/api/auth/oauth/start` (keep username/password as a fallback for local/admin).
- [ ] Handle Deck per the decision above.
