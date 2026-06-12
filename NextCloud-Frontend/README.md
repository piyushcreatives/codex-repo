# CloudSpace

This branch uses the adapter login flow at `POST /api/auth/login` as its single active auth strategy.
On successful login the adapter tries to exchange a real password for a Nextcloud app password,
then persists only the delegated app password in server-side session storage.

A modern React frontend for self-hosted Nextcloud. CloudSpace replaces Nextcloud's default web interface with a fast, polished single-page application built with React 19, Tailwind CSS, and shadcn/ui. The Express backend acts as an API adapter — translating CloudSpace's clean REST API into Nextcloud's mix of OCS, WebDAV, CalDAV, CardDAV, and REST endpoints. The frontend code is completely decoupled from Nextcloud internals.

---

## Screenshots

> Add screenshots here

---

## Features

- **Dashboard** — Storage ring, recent files, upcoming events, messages, and activity widgets
- **Files** — File browser with breadcrumbs, grid/list view, folder creation, rename, delete
- **Talk** — 3-panel chat with conversation list, message thread, info panel, voice/video call UI, group creation
- **Calendar** — Month/week/day/agenda views with event CRUD, navigation, and color coding
- **Notes** — Split-pane markdown editor with auto-save, pin/unpin, delete, and search
- **Contacts** — Grid/list view, search, detail panel, contact CRUD with vCard sync
- **Deck** — Kanban board with drag-and-drop cards, stack management, card detail modals
- **Mail** — 3-panel email client with inbox/sent/drafts, compose dialog, star, search
- **Activity** — Filterable activity feed with stats, date grouping, and mark-all-read
- **Media** — Photo gallery with lightbox, albums, multi-select, keyboard navigation
- **Settings** — Profile, security (2FA), notifications, appearance (dark mode), storage, connected apps
- **Command Palette** — Cmd+K search across navigation, files, contacts, and quick actions

---

## Architecture

```
┌──────────┐      ┌──────────────────┐      ┌─────────────────┐
│  Browser  │──────│  Vite Dev Server │──────│  Nextcloud 28   │
│  React    │ :5173│  /api proxy      │ :5000│  Docker         │ :8080
│  SPA      │      │  Express Adapter │      │  PostgreSQL     │
└──────────┘      └──────────────────┘      └─────────────────┘
```

The Express adapter (`server/index.ts`) receives standard REST calls from the React frontend and translates them into Nextcloud API calls:

- **Files** → WebDAV (PROPFIND, MKCOL, PUT, DELETE, MOVE)
- **Calendar** → CalDAV (REPORT with iCal parsing via ical.js)
- **Contacts** → CardDAV (REPORT with vCard parsing via ical.js)
- **Talk** → OCS Spreed API v4 (JSON via `?format=json`)
- **Notes** → Nextcloud Notes REST API v1
- **Deck** → Nextcloud Deck REST API v1.0
- **Mail** → Nextcloud Mail REST API
- **Activity** → OCS Activity API v2

The frontend (`client/src/`) is completely unchanged — it calls `/api/*` endpoints and receives `{ data: ... }` responses, unaware of Nextcloud behind the adapter.

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 18+ | Tested with 20.x and 22.x |
| npm | 9+ | Comes with Node.js |
| Docker Desktop | Latest | WSL2 backend required on Windows |
| Git Bash | Latest | Windows only — required for seed script |
| Free ports | 8080, 5000, 5173 | NC, API adapter, Vite respectively |

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/DExPioson/NextCloud-Frontend.git
cd NextCloud-Frontend
npm install

# 2. Set up Nextcloud backend (see "Detailed Setup" below)
cd ../cloudspace-backend
docker compose up -d
sleep 60

# 3. Install required NC apps and seed data
docker exec -u www-data cloudspace-backend-nextcloud-1 php occ app:install deck
docker exec -u www-data cloudspace-backend-nextcloud-1 php occ app:install spreed
docker exec -u www-data cloudspace-backend-nextcloud-1 php occ app:install notes
docker exec -u www-data cloudspace-backend-nextcloud-1 php occ app:disable password_policy
NC_BASE_URL="http://localhost:8080" bash seed/seed.sh

# 4. Start the frontend (two terminals)
cd ../NextCloud-Frontend
npm run dev                     # Terminal 1 — Vite on :5173
npx tsx server/index.ts         # Terminal 2 — API adapter on :5000

# 5. Open http://localhost:5173
# Login: piyush@cloudspace.home / cloudspace123
```

---

## Detailed Setup

### 1. Clone & Install

```bash
git clone https://github.com/DExPioson/NextCloud-Frontend.git
cd NextCloud-Frontend
npm install
npx playwright install    # optional — only needed if running E2E tests
```

### 2. Environment Configuration

The `.env` file in the project root configures the API adapter and Vite proxy targets:

```env
NC_BASE_URL=http://localhost:8090
SESSION_SECRET=cloudspace-dev-secret-change-in-prod
SESSION_DB_PATH=./sessions.db
SESSION_COOKIE_SECURE=false
ALLOW_MOCK_SERVICES=false
PORT=5000
VITE_PORT=5173
VITE_HOST=0.0.0.0
VITE_HTTPS=false
VITE_API_PROXY_TARGET=http://localhost:5000
VITE_NEXTCLOUD_PROXY_TARGET=http://localhost:8090
```

| Variable | Value | Purpose |
|----------|-------|---------|
| `NC_BASE_URL` | `http://localhost:8090` | Nextcloud gateway URL used by the adapter. |
| `SESSION_SECRET` | Any string | Secret used to encrypt stored session payloads. Change in production. |
| `SESSION_DB_PATH` | `./sessions.db` | Persistent SQLite session store path. |
| `SESSION_COOKIE_SECURE` | `false` locally / `true` in prod | Enables `Secure` on the auth cookie. |
| `SESSION_TTL_SECONDS` | `43200` | Adapter session lifetime in seconds. |
| `ALLOW_MOCK_SERVICES` | `false` | Disables mock-backed endpoints unless explicitly re-enabled. |
| `NEXTCLOUD_BOOTSTRAP_STRATEGY` | `exchange-or-direct` | Tries to exchange a login password for an app password, or accepts a direct app password. |
| `NEXTCLOUD_APP_PASSWORD_LABEL` | `CloudSpace Adapter` | Label/User-Agent used when requesting a delegated Nextcloud app password. |
| `PORT` | `5000` | Express adapter port. Vite proxies `/api` to this port. |
| `VITE_PORT` | `5173` | Frontend dev server port. |
| `VITE_HOST` | `0.0.0.0` | Host binding for LAN/local testing. |
| `VITE_HTTPS` | `false` locally / `true` for secure LAN media tests | Enables Vite HTTPS using a local self-signed dev certificate. |
| `VITE_API_PROXY_TARGET` | `http://localhost:5000` | API proxy target for `/api`. |
| `VITE_NEXTCLOUD_PROXY_TARGET` | `http://localhost:8090` | Proxy target for `/ocs` and `/remote.php`. |

For WebRTC camera, microphone, and screen sharing from another device, set `VITE_HTTPS=true` and open the Vite server over `https://...`. Browsers allow media capture on `localhost` or secure origins only.

### 3. Nextcloud Backend Setup

The Nextcloud Docker setup lives in a **separate folder** alongside this repo:

```
Desktop/
├── NextCloud-Frontend/    ← this repo
└── cloudspace-backend/    ← Nextcloud Docker (not in this repo)
    ├── docker-compose.yml
    └── seed/
        └── seed.sh
```

#### a) Create the backend folder

```bash
mkdir -p ../cloudspace-backend
cd ../cloudspace-backend
```

#### b) Create docker-compose.yml

Create `docker-compose.yml` with this exact content:

```yaml
services:
  db:
    image: postgres:15
    restart: unless-stopped
    environment:
      POSTGRES_DB: nextcloud
      POSTGRES_USER: nextcloud
      POSTGRES_PASSWORD: nextcloud_db_pass
    volumes:
      - db_data:/var/lib/postgresql/data

  nextcloud:
    image: nextcloud:28
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      POSTGRES_HOST: db
      POSTGRES_DB: nextcloud
      POSTGRES_USER: nextcloud
      POSTGRES_PASSWORD: nextcloud_db_pass
      NEXTCLOUD_ADMIN_USER: admin
      NEXTCLOUD_ADMIN_PASSWORD: CloudSpace2026!
      NEXTCLOUD_TRUSTED_DOMAINS: localhost
      OVERWRITEPROTOCOL: http
    volumes:
      - nc_data:/var/www/html
    depends_on:
      - db

volumes:
  db_data:
  nc_data:
```

#### c) Start the containers

```bash
docker compose up -d
```

#### d) Wait for Nextcloud to initialize

```bash
# Wait ~60 seconds for first boot, then verify:
curl -s http://localhost:8080/status.php | head -1
# Should return JSON with "installed":true
```

#### e) Install required apps

The Nextcloud 28 base image does NOT include Deck, Talk, or Notes. Install them:

```bash
docker exec -u www-data cloudspace-backend-nextcloud-1 php occ app:install deck
docker exec -u www-data cloudspace-backend-nextcloud-1 php occ app:install spreed
docker exec -u www-data cloudspace-backend-nextcloud-1 php occ app:install notes
```

#### f) Create test users

Disable the password policy first (it blocks simple test passwords), create users, then re-enable:

```bash
# Disable password policy
docker exec -u www-data cloudspace-backend-nextcloud-1 php occ app:disable password_policy

# Create primary test user
docker exec -u www-data cloudspace-backend-nextcloud-1 php occ user:add piyush --password-from-env --display-name="Piyush Sharma" <<< ""
docker exec -u www-data cloudspace-backend-nextcloud-1 bash -c 'export OC_PASS=cloudspace123 && php occ user:resetpassword --password-from-env piyush'

# Create team members
for user in gaurav rohan priya arjun neha vikram anjali rahul kavita; do
  docker exec -u www-data cloudspace-backend-nextcloud-1 bash -c "export OC_PASS=test123 && php occ user:add $user --password-from-env --display-name=\"$(echo $user | sed 's/./\U&/')\"" 2>/dev/null || true
done

# Re-enable password policy
docker exec -u www-data cloudspace-backend-nextcloud-1 php occ app:enable password_policy
```

> **Note**: If you use the seed script (step g), it handles user creation automatically. The commands above are for manual setup without the seed script.

#### g) Run the seed script

The seed script populates Nextcloud with realistic test data. It must be run from **Git Bash** (not PowerShell, not WSL):

```bash
# From cloudspace-backend/ directory, in Git Bash:
NC_BASE_URL="http://localhost:8080" bash seed/seed.sh 2>&1 | tee seed/seed.log
```

> **Important**: The `NC_BASE_URL` override is required. The script defaults to `https://localhost` which fails in Git Bash on Windows due to TLS issues with curl.

### 4. Seed Data

The seed script creates:

| Resource | Count | Nextcloud App |
|----------|-------|---------------|
| Users | 10 (piyush + 9 team members) | Core |
| Folders | 50 | Files (WebDAV) |
| Files | 100 | Files (WebDAV) |
| Calendar Events | ~80 | Calendar (CalDAV) |
| Contacts | 100 | Contacts (CardDAV) |
| Notes | 50 | Notes |
| Deck Boards | 20 | Deck |
| Deck Cards | 800 | Deck |
| Talk Rooms | 10 | Talk/Spreed |
| Talk Messages | 200 | Talk/Spreed |
| File Shares | 20+ | Sharing API |

### 5. Running the Frontend

Open two terminals:

```
Terminal 1 (Vite dev server):
$ cd NextCloud-Frontend
$ npm run dev
→ http://localhost:5173

Terminal 2 (API adapter):
$ cd NextCloud-Frontend
$ npx tsx server/index.ts
→ http://localhost:5000
→ Proxying to Nextcloud at http://localhost:8080
```

### 6. Login

Open `http://localhost:5173` in your browser.

| Field | Value |
|-------|-------|
| Email | `piyush@cloudspace.home` |
| Password | `cloudspace123` |

All 10 seeded users can log in. The primary test user is `piyush`.

| User | Password | Role |
|------|----------|------|
| admin | CloudSpace2026! | Nextcloud admin |
| piyush | cloudspace123 | Primary test user |
| gaurav, rohan, priya, arjun, neha, vikram, anjali, rahul, kavita | test123 | Team members |

---

## Running Tests

Both the Vite dev server and Express adapter must be running, and Nextcloud must be up.

```bash
# Install browsers (first time only)
npx playwright install

# Run all 81 tests (headless)
npx playwright test

# Interactive UI mode
npx playwright test --ui

# With browser visible
npx playwright test --headed

# Single test file
npx playwright test e2e/07-notes.spec.ts

# Verbose output
npx playwright test --reporter=list
```

The test suite covers all 12 screens plus auth and theme persistence. All assertions are structural (no hardcoded data values) so they work against any seeded Nextcloud instance.

---

## Daily Startup

For returning developers — the sequence each day after the initial setup:

```
1. Start Docker Desktop            → wait for "Engine running"
2. cd cloudspace-backend && docker compose up -d
3. Wait ~60 seconds                → NC needs time to initialize
4. Terminal 1: cd NextCloud-Frontend && npm run dev
5. Terminal 2: npx tsx server/index.ts
6. Open http://localhost:5173
```

---

## Resetting to Clean State

To start completely fresh (destroys all data):

```bash
cd cloudspace-backend
docker compose down -v        # Remove containers and volumes
docker compose up -d          # Recreate fresh
sleep 60                      # Wait for NC init

# Reinstall apps
docker exec -u www-data cloudspace-backend-nextcloud-1 php occ app:install deck
docker exec -u www-data cloudspace-backend-nextcloud-1 php occ app:install spreed
docker exec -u www-data cloudspace-backend-nextcloud-1 php occ app:install notes
docker exec -u www-data cloudspace-backend-nextcloud-1 php occ app:disable password_policy

# Re-seed
NC_BASE_URL="http://localhost:8080" bash seed/seed.sh
```

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| UI Framework | React | 19.2.4 |
| Build Tool | Vite | 8.0.4 |
| CSS | Tailwind CSS | 3.4.19 |
| Components | shadcn/ui (Radix primitives) | Latest |
| Routing | wouter (hash-based) | 3.9.0 |
| Data Fetching | TanStack Query | 5.96.2 |
| Server | Express | 5.2.1 |
| Session | Encrypted SQLite-backed custom store | built-in |
| XML Parsing | xml2js | 0.6.2 |
| iCal/vCard | ical.js | 2.2.1 |
| Drag & Drop | @hello-pangea/dnd | 18.0.1 |
| Icons | lucide-react | 1.7.0 |
| Dates | date-fns | 4.1.0 |
| E2E Testing | Playwright | 1.59.1 |
| TypeScript | 6.0.2 | |

---

## Project Structure

```
NextCloud-Frontend/
├── client/
│   ├── index.html
│   └── src/
│       ├── main.tsx                  # Entry point
│       ├── App.tsx                   # Router, theme, QueryClient
│       ├── index.css                 # Design tokens (HSL CSS vars)
│       ├── components/
│       │   ├── layout/              # Sidebar, TopBar, CommandPalette, Logo
│       │   └── ui/                  # 18 shadcn/ui components
│       ├── lib/                     # api.ts, dateUtils.ts, utils.ts
│       └── pages/                   # 12 page components (Login through Settings)
├── server/
│   ├── index.ts                     # Express API adapter (856 lines, all routes)
│   ├── nc-adapter.ts                # Nextcloud HTTP client (OCS, WebDAV, CalDAV, CardDAV)
│   ├── mappers.ts                   # NC response → CloudSpace type mappers
│   └── storage.ts                   # In-memory caches (tokens, hrefs, lookups)
├── shared/
│   └── schema.ts                    # TypeScript types (User, File, Contact, etc.)
├── e2e/                             # 14 Playwright spec files (81 tests)
│   ├── helpers.ts                   # login(), navigateTo(), expectToast()
│   ├── 01-auth.spec.ts              # through 14-theme-persistence.spec.ts
├── playwright/
│   ├── global-setup.ts              # Session login, saves to .auth/session.json
│   ├── .auth/                       # Session state (gitignored)
│   └── KNOWN_ISSUES.md
├── playwright.config.ts
├── .env                             # NC_BASE_URL, SESSION_SECRET, PORT
├── HANDOFF.md                       # Full LLM context document (729 lines)
├── package.json
├── vite.config.ts                   # Proxy /api → :5000
└── tailwind.config.ts
```

---

## API Overview

| Domain | CloudSpace Endpoints | Nextcloud API | Protocol |
|--------|---------------------|---------------|----------|
| Auth | `POST /api/auth/login`, `/logout` | OCS Cloud Users + App Passwords | OCS |
| User | `GET/PATCH /api/user` | OCS Cloud Users | OCS |
| Dashboard | `GET /api/dashboard` | WebDAV PROPFIND + OCS Users | WebDAV + OCS |
| Files | `GET/POST/PATCH/DELETE /api/files` | WebDAV PROPFIND/MKCOL/PUT/DELETE/MOVE | WebDAV |
| Talk | `GET/POST /api/conversations`, `/messages` | OCS Spreed API v4 | OCS |
| Calendar | `GET/POST/PATCH/DELETE /api/events` | CalDAV REPORT + PUT/DELETE | CalDAV |
| Notes | `GET/POST/PATCH/DELETE /api/notes` | Notes REST API v1 | REST |
| Contacts | `GET/POST/PATCH/DELETE /api/contacts` | CardDAV REPORT + PUT/DELETE | CardDAV |
| Deck | `GET/POST /api/boards`, `/stacks`, `/cards` | Deck REST API v1.0 | REST |
| Mail | `GET/POST/PATCH/DELETE /api/emails` | Mail REST API | REST |
| Activity | `GET /api/activity`, mark read | OCS Activity API v2 | OCS |

All endpoints return `{ data: ... }` responses. Missing NC apps return `{ data: [] }` with HTTP 200.

---

## Known Issues & Gotchas

| Issue | Cause | Fix |
|-------|-------|-----|
| Notes/Deck/Talk pages show empty | NC apps not installed in base image | Run `php occ app:install notes/deck/spreed` after first boot |
| Seed script fails silently | Default `NC_BASE_URL=https://localhost` causes TLS failure in Git Bash | Override: `NC_BASE_URL="http://localhost:8080" bash seed/seed.sh` |
| User creation fails | NC password policy blocks simple passwords | Disable with `php occ app:disable password_policy` before creating users |
| Talk API returns XML | OCS defaults to XML output | Adapter appends `?format=json` to all OCS requests |
| No `python3`/`jq` in Git Bash | Windows Git Bash has minimal tooling | Seed script uses `grep -o` and `node -e` for JSON parsing |
| Playwright tests fail with no data | Session cookie not established | Global setup logs in via API, saves storageState |
| Deck/Talk APIs return 404 for new users | Users must complete first browser login | Log in as each user at `http://localhost:8080` once |
| Card update/delete returns 404 | In-memory cache cleared on server restart | Navigate to the board listing first to repopulate cache |
| Activity read state resets on restart | Read/unread tracked in-memory only (NC has no read API) | Expected behavior — no fix needed |
| Mail counts always show 0 | Computing real counts from NC Mail API is expensive | Static return in `GET /api/emails/counts` |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes
4. Push to the branch (`git push origin feat/my-feature`)
5. Open a Pull Request

If using Claude Code for development, include the co-author line:
```
Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## License

MIT
