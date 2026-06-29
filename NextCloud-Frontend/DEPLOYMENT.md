# Deployment

## Production topology (icingtree.com)

Three hosts, **reverse-proxy model** — the browser only ever talks to the frontend origin:

```
Browser ──> https://cloud.icingtree.com            React SPA + nginx
              ├─ /api/*  ─┐
              └─ /ws      ├─ proxied ─> https://cloudapi.icingtree.com   Express adapter
                          │                          └─ server-side ──> https://nc.icingtree.com   Nextcloud
```

The SPA calls **relative `/api` paths** and the frontend nginx proxies them, so requests are
**same-origin** → no CORS, and the cookie stays `SameSite=Lax; Secure`.

- **Frontend (`cloud.icingtree.com`)**: `npm run build` → serve `dist/` with
  `nextcloud-backend/nginx.frontend.prod.conf` (serves the SPA, proxies `/api` + `/ws` to the adapter).
- **Adapter (`cloudapi.icingtree.com`)**: run `server/index.ts` with `.env.headless.production.example`
  (`NODE_ENV=production`, `NC_BASE_URL=https://nc.icingtree.com`, `FRONTEND_URL=https://cloud.icingtree.com`,
  a strong `SESSION_SECRET`, `SESSION_COOKIE_SECURE=true`). Persist `sessions.db`.
- **Nextcloud (`nc.icingtree.com`)**: `trusted_domains` + `overwritehost`/`overwriteprotocol`/`overwrite.cli.url`
  set to `nc.icingtree.com`/`https`; reverse proxy `nextcloud-backend/nginx.prod.conf` (CORS allows
  `https://cloud.icingtree.com`); for notify_push set `base_endpoint=https://nc.icingtree.com/push` (see `NOTIFY_PUSH.md`).

Smoke test: `curl https://cloud.icingtree.com/api/auth/session` (401 unauthenticated = adapter reachable
through the proxy) and `curl https://nc.icingtree.com/status.php` (Nextcloud up), then sign in at the frontend.

---

## Required environment variables

Use [`\.env.example`](C:\Users\admin\Desktop\Codex New Implementation\NextCloud-Frontend\.env.example) as the baseline.

Required server variables:

- `NC_BASE_URL`
- `SESSION_SECRET`
- `SESSION_DB_PATH`
- `SESSION_COOKIE_SECURE`
- `SESSION_TTL_SECONDS`
- `NEXTCLOUD_BOOTSTRAP_STRATEGY`
- `NEXTCLOUD_APP_PASSWORD_LABEL`
- `PORT`

Required frontend/proxy variables:

- `VITE_PORT`
- `VITE_API_PROXY_TARGET`
- `VITE_NEXTCLOUD_PROXY_TARGET`

Operational safety variable:

- `ALLOW_MOCK_SERVICES=false`

## Staging vs production

### Staging

- `SESSION_COOKIE_SECURE=false` is acceptable only when testing over plain HTTP.
- `NEXTCLOUD_BOOTSTRAP_STRATEGY=exchange-or-direct` keeps the current staging UX simple.
- `NC_BASE_URL` can point at the local or staging Nextcloud gateway.

### Production

- Set `SESSION_COOKIE_SECURE=true`.
- Use HTTPS end to end.
- Use a long random `SESSION_SECRET`.
- Keep `ALLOW_MOCK_SERVICES=false`.
- Prefer `exchange-or-direct` unless your security policy requires users to input app passwords directly, in which case use `require-direct-app-password`.

## Reverse proxy requirements

- Forward `Set-Cookie` headers unchanged.
- Preserve HTTPS at the edge and pass the correct forwarded proto headers if your stack depends on them.
- Route `/api` to the Express adapter.
- Route `/ocs` and `/remote.php` to Nextcloud when you are using the Vite-style proxy model in front of the app.

## Nextcloud prerequisites

- The target Nextcloud instance must support the official app-password conversion endpoint:
  `/ocs/v2.php/core/getapppassword`
- Users must be allowed to create app passwords in the instance policy.
- If users have two-factor authentication enabled, they may need to log in with an app password directly depending on server policy.

## Session storage notes

- `SESSION_DB_PATH` should point to persistent storage, not ephemeral container scratch space.
- The adapter encrypts session payloads, but the delegated app password is still sensitive secret material and must be protected accordingly.
