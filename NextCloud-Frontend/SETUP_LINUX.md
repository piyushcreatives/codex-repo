# CloudSpace Frontend — Linux / Mac Setup Guide

## Prerequisites

- **Node.js** v20+ — `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs`
- **Docker** — `sudo apt install docker.io` (Linux) or https://www.docker.com/products/docker-desktop (Mac)
- **Git** — `sudo apt install git`
- **OpenSSL** — pre-installed on most Linux/Mac

---

## Step 1 — Clone & Install

```bash
git clone <your-repo-url> NextCloud-Frontend
cd NextCloud-Frontend
npm install
```

---

## Step 2 — Start Nextcloud (Docker)

```bash
docker run -d \
  --name nextcloud \
  -p 8080:80 \
  -v nextcloud_data:/var/www/html \
  nextcloud:latest
```

Wait ~30 seconds, open **http://localhost:8080** in browser, create an admin account.

Then enable these apps at **http://localhost:8080/settings/apps**:
- Files, Talk, Calendar, Contacts, Deck, Mail, Activity

Create 2+ test users at **http://localhost:8080/settings/users** for testing calls.

---

## Step 3 — Generate SSL Certificates

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -days 365 \
  -subj "/CN=localhost"
```

---

## Step 4 — Configure Environment

```bash
cp .env.example .env
nano .env
```

Set these values:

```env
PORT=5000
NC_BASE_URL=http://localhost:8080
SESSION_SECRET=any-random-string-here
SESSION_DB_PATH=./sessions.db
SESSION_COOKIE_SECURE=true
SESSION_TTL_SECONDS=43200
ALLOW_MOCK_SERVICES=false
NEXTCLOUD_BOOTSTRAP_STRATEGY=exchange-or-direct
NEXTCLOUD_APP_PASSWORD_LABEL=CloudSpace Adapter
NC_CAPABILITY_USERNAME=admin
NC_CAPABILITY_PASSWORD=your-nextcloud-admin-password
VITE_PORT=5173
VITE_HOST=0.0.0.0
VITE_HTTPS=true
VITE_API_PROXY_TARGET=https://localhost:5000
VITE_NEXTCLOUD_PROXY_TARGET=http://localhost:8080
```

**Change these:**
- `NC_CAPABILITY_PASSWORD` — your Nextcloud admin password
- `SESSION_SECRET` — any random string

---

## Step 5 — Start Backend (Terminal 1)

```bash
npx tsx server/index.ts
```

You should see:
```
CloudSpace API server running on https://0.0.0.0:5000
```

---

## Step 6 — Start Frontend (Terminal 2)

Open a **new terminal**, same folder:

```bash
npm run dev
```

You should see:
```
VITE v8.x.x ready
  Local: https://localhost:5173/
```

---

## Step 7 — Open in Browser

1. Open **https://localhost:5000** — accept the self-signed certificate warning
2. Open **https://localhost:5173** — accept the self-signed certificate warning
3. Log in with your Nextcloud credentials

> You must accept the SSL certificate on BOTH ports for calls to work.

---

## Testing Calls (2 Users)

1. Open **https://localhost:5173** in Browser 1 — log in as User A
2. Open **https://localhost:5173** in a different browser or incognito — log in as User B
3. Start a conversation, click the phone icon to call

---

## LAN Access (Other Devices)

```bash
# Find your local IP
hostname -I     # Linux
ifconfig        # Mac

# Add your IP to Nextcloud trusted domains
docker exec -u www-data nextcloud php occ config:system:set trusted_domains 2 --value="YOUR_LOCAL_IP"
```

Open `https://YOUR_LOCAL_IP:5173` on the other device, accept SSL warnings on both `:5173` and `:5000`.

---

## All Commands Summary

```bash
# Install
npm install

# Start Nextcloud (Docker must be running)
docker run -d --name nextcloud -p 8080:80 -v nextcloud_data:/var/www/html nextcloud:latest

# Generate SSL certs (one-time)
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/key.pem -out certs/cert.pem -days 365 -subj "/CN=localhost"

# Configure env
cp .env.example .env
# Edit .env — set NC_CAPABILITY_PASSWORD

# Start backend (Terminal 1)
npx tsx server/index.ts

# Start frontend (Terminal 2)
npm run dev

# Open https://localhost:5173
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Cannot connect to Nextcloud | Make sure Docker is running. Run `docker ps` to check. |
| Camera/mic not working | Must use HTTPS. Accept certs on both `:5173` and `:5000`. |
| Port 8080 in use | Change port in docker command (`-p 9090:80`) and update `.env`. |
| Login fails | Check `NC_CAPABILITY_USERNAME` and `NC_CAPABILITY_PASSWORD` in `.env`. |
| `npm install` fails | Delete `node_modules` and `package-lock.json`, then run `npm install` again. |
| Permission denied on Docker | Use `sudo` or add your user to docker group: `sudo usermod -aG docker $USER` |
| Node version too old | Use nvm: `nvm install 20 && nvm use 20` |
