# Headless Nextcloud Integration

This branch no longer runs two auth models in parallel.

## Active strategy

- Login: `POST /api/auth/login`
- Session storage: encrypted SQLite payloads in `sessions.db`
- Frontend dev origin: `http://localhost:5173`
- Express adapter: `http://localhost:5000`
- Nextcloud gateway: `http://localhost:8090`

## Environment setup

Copy `.env.example` to `.env` and keep these values aligned:

```env
PORT=5000
NC_BASE_URL=http://localhost:8090
SESSION_SECRET=change-me
SESSION_DB_PATH=./sessions.db
SESSION_COOKIE_SECURE=false
ALLOW_MOCK_SERVICES=false
VITE_PORT=5173
VITE_API_PROXY_TARGET=http://localhost:5000
VITE_NEXTCLOUD_PROXY_TARGET=http://localhost:8090
```

## Notes

- Browser-side OAuth/PKCE helpers were removed from this repo to avoid split auth behavior.
- Mock-backed endpoints are disabled by default. Enable them only with `ALLOW_MOCK_SERVICES=true`.
- OAuth/Keycloak migration is designed in `OAUTH_MIGRATION.md`; the callback is `…/api/auth/callback` (local dev: `http://localhost:5173/api/auth/callback`).
