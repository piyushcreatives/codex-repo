# Production Keycloak SSO — Deployment Guide

Goal: **`cloud.icingtree.com` → "Sign in with SSO" → Keycloak login → dashboard**, with **no intermediate Nextcloud consent screens**. Proven end-to-end on the local stack; this is the production rollout.

> **Secret handling:** the Keycloak client secret is referenced below as `<KEYCLOAK_CLIENT_SECRET>`. It is provided by the Keycloak team (Shobhit). **Do not commit it** — set it as an env var / occ argument at deploy time only.

---

## Architecture

The adapter is a **direct OIDC client of Keycloak** (it does *not* go through Nextcloud's OAuth2). Nextcloud accepts the Keycloak **access token as a Bearer** and validates + provisions the user via the `user_oidc` app.

```
https://cloud.icingtree.com              (frontend)
   → https://cloudapi.icingtree.com/api/auth/oauth/start   (adapter)
   → https://keycloak.spacepe.in/realms/paas/.../auth       (Keycloak login)
   → back to https://cloud.icingtree.com/api/auth/callback  (adapter → session)
        ↳ adapter calls https://nc.icingtree.com with Bearer <keycloak_access_token>
          which user_oidc validates + auto-provisions the user
```

## Environment reference

| Piece | URL |
|---|---|
| Frontend | `https://cloud.icingtree.com` |
| Adapter (API) | `https://cloudapi.icingtree.com` |
| Nextcloud (v33) | `https://nc.icingtree.com` |
| Keycloak | `https://keycloak.spacepe.in` · realm `paas` · client `nextcloud_new_UI` |

---

## Part A — Nextcloud (`nc.icingtree.com`) · install + configure `user_oidc`

Run on the production NC server (`occ`). No SSRF flag needed (public Keycloak).

```bash
occ app:install user_oidc     # or: occ app:enable user_oidc

occ user_oidc:provider keycloak \
  --clientid="nextcloud_new_UI" \
  --clientsecret="<KEYCLOAK_CLIENT_SECRET>" \
  --discoveryuri="https://keycloak.spacepe.in/realms/paas/.well-known/openid-configuration" \
  --scope="openid email profile" \
  --unique-uid=0 \
  --check-bearer=1 \
  --bearer-provisioning=1 \
  --mapping-uid="preferred_username" \
  --mapping-display-name="name" \
  --mapping-email="email"
```

- `--check-bearer=1` → NC validates incoming Keycloak Bearer tokens for API/WebDAV.
- `--bearer-provisioning=1` → auto-creates the NC user on first Bearer call.
- `--unique-uid=0` + `--mapping-uid=preferred_username` → NC username = Keycloak `preferred_username` (stable, human-readable).

**Web-panel alternative:** Settings → Administration → OpenID Connect → *Register provider* with the same discovery URL / client id / secret / mappings, and enable the bearer-validation + provisioning options in the provider's advanced settings.

> `oidc_login` is **not** required for this architecture. If it's installed from an earlier attempt, it's harmless but redundant.

---

## Part B — Keycloak (`keycloak.spacepe.in`, realm `paas`, client `nextcloud_new_UI`) · 2 changes

**Requires Keycloak admin — send this to the Keycloak team:**

1. **Add an Audience mapper** (this is the make-or-break step — without it NC rejects the token because `aud` is `"account"`):
   - Client `nextcloud_new_UI` → *Client scopes* → `nextcloud_new_UI-dedicated` → *Add mapper* → *By configuration* → **Audience**
   - **Included Client Audience** = `nextcloud_new_UI`
   - **Add to access token** = ON
2. **Add to Valid redirect URIs:** `https://cloud.icingtree.com/api/auth/callback`
   - **Web origins:** `https://cloud.icingtree.com`
3. *(Recommended)* Ensure the client's **default client scopes** include **`profile`** and **`email`** (currently `openid` only) so NC receives the user's name + email.

---

## Part C — Adapter (`cloudapi.icingtree.com`) · deploy + env

Deploy the `staging` build, then set:

```dotenv
OAUTH_CLIENT_ID=nextcloud_new_UI
OAUTH_CLIENT_SECRET=<KEYCLOAK_CLIENT_SECRET>
OAUTH_REDIRECT_URI=https://cloud.icingtree.com/api/auth/callback
OAUTH_AUTHORIZE_URL=https://keycloak.spacepe.in/realms/paas/protocol/openid-connect/auth
OAUTH_TOKEN_URL=https://keycloak.spacepe.in/realms/paas/protocol/openid-connect/token
OAUTH_SCOPE=openid profile email
FRONTEND_URL=https://cloud.icingtree.com
NC_BASE_URL=https://nc.icingtree.com
```

## Part D — Frontend (`cloud.icingtree.com`) · deploy

Deploy the build. The "Sign in with SSO" button auto-activates when the adapter reports `oauth:true` (no frontend code change).

---

## What is NOT needed in production (simpler than local)

- ❌ `allow_local_remote_servers` — only needed locally because the local Keycloak was a private IP. `keycloak.spacepe.in` is public.
- ❌ `host.docker.internal` — production uses one fixed public domain, so the OIDC **issuer is automatically consistent**.
- ✅ Prod NC is **v33** → **Deck also works** over Bearer (on local v28 it 401s).

---

## Verification checklist (run in order)

```bash
# 1. Adapter deployed + OAuth on
curl -s https://cloud.icingtree.com/api/auth/methods
#    expect: {"data":{"password":true,"oauth":true}}

# 2. Adapter redirects straight to Keycloak (no Nextcloud host in the URL)
curl -sI "https://cloud.icingtree.com/api/auth/oauth/start" | grep -i location
#    expect: Location: https://keycloak.spacepe.in/realms/paas/.../auth?...client_id=nextcloud_new_UI...

# 3. Keycloak token has the right audience (get a token for a test user, decode)
#    aud MUST contain "nextcloud_new_UI"  (Part B.1). If it's only "account", the mapper is missing.

# 4. Bearer works against Nextcloud (replace <TOKEN> with a real Keycloak access token)
curl -s -H "Authorization: Bearer <TOKEN>" -H "OCS-APIRequest: true" \
  "https://nc.icingtree.com/ocs/v2.php/cloud/user?format=json"
#    expect: status "ok" with the user id (NOT 997 "not logged in")
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer <TOKEN>" -X PROPFIND \
  "https://nc.icingtree.com/remote.php/dav/files/<user>/"
#    expect: 207

# 5. Full browser test (Incognito): cloud.icingtree.com → Sign in with SSO
#    → Keycloak login → dashboard, with no "Connect to your account"/"Grant access" screens.
```

## Troubleshooting (symptom → cause → fix)

| Symptom | Cause | Fix |
|---|---|---|
| NC APIs return `997 / 401` with a valid token | `aud` missing the client | **Part B.1** audience mapper |
| `997`, log: *"token is issued by the wrong issuer"* | issuer ≠ discovery issuer | ensure adapter `OAUTH_TOKEN_URL` and `user_oidc` discovery use the **same** `keycloak.spacepe.in` host |
| log: *"Host violates local access rules"* | SSRF block on JWKS fetch | only if Keycloak is a private IP — N/A for public prod (do **not** enable in prod unless required) |
| user reaches Keycloak but no NC user created | provisioning off | `--bearer-provisioning=1` (Part A) |
| user has no display name/email in NC | client scopes | add `profile`+`email` scopes (Part B.3) |
| `/api/auth/methods` = `oauth:false` | env incomplete | all of `OAUTH_CLIENT_ID/SECRET/REDIRECT_URI/AUTHORIZE_URL/TOKEN_URL` must be set (Part C) |

## Rollback

The username/password login is untouched and always available. To disable SSO: unset the adapter `OAUTH_*` env (button hides). To remove NC-side: `occ user_oidc:provider:delete keycloak`.
