# Talk Handoff Context

## Purpose

This file summarizes what has already been implemented in the `CloudSpace` custom frontend and, specifically, what has been done for the `Talk` module so another engineer can continue without losing context.

Workspace root:

- `C:\Users\admin\Desktop\Codex New Implementation`

Main frontend repo:

- `C:\Users\admin\Desktop\Codex New Implementation\NextCloud-Frontend`

Backend repo:

- `C:\Users\admin\Desktop\Codex New Implementation\nextcloud-backend`

## Current local stack

Verified local endpoints:

- Frontend: `https://192.168.10.108:5173/#/login`
- Frontend (same machine): `https://localhost:5173/#/login`
- Adapter API: `http://localhost:5000`
- Nextcloud gateway: `http://localhost:8090`
- Direct Nextcloud: `http://localhost:8080`

Notes:

- HTTPS is enabled for Vite dev serving so browser media permissions work on LAN devices.
- The browser will usually show a local certificate warning once per device.

## Overall architecture now

### Auth strategy

The project is currently using a single adapter-based login flow.

- Active login endpoint: `/api/auth/login`
- No active frontend OAuth/PKCE login flow
- Adapter stores encrypted server-side session state
- Session storage is persisted in SQLite rather than in-memory `Map`

Important implementation points:

- The adapter can bootstrap a Nextcloud app password from a normal password where supported.
- The adapter also creates a parallel Nextcloud web session cookie jar for native Talk call endpoints.

Primary files:

- `NextCloud-Frontend/server/index.ts`
- `NextCloud-Frontend/server/credential-provider.ts`
- `NextCloud-Frontend/server/session-store.ts`
- `NextCloud-Frontend/server/nextcloud-web-session.ts`

### Data flow

The browser does not connect to MariaDB directly.

Actual flow:

`Browser -> Vite frontend -> Adapter API -> Nextcloud APIs -> Nextcloud app layer -> MariaDB`

Databases in use:

- MariaDB for Nextcloud core data
- SQLite for adapter session storage

## Nextcloud integration status

Real integrations already wired:

- Auth: OCS + app-password bootstrap
- Files: WebDAV
- Dashboard: real Nextcloud-backed
- Conversations / Talk: Nextcloud Talk APIs + custom frontend call layer
- Calendar: CalDAV
- Contacts: CardDAV
- Deck / cards: Deck API
- Notes: WebDAV-backed compatibility layer
- Media: real files from Nextcloud

Capability detection added:

- `GET /api/capabilities`
- Startup uses shared capability credentials from frontend `.env`
- Used to enable or disable Talk / Deck / Calendar / Contacts / Notes in the UI

Primary files:

- `NextCloud-Frontend/server/capability-store.ts`
- `NextCloud-Frontend/server/groupware-client.ts`
- `NextCloud-Frontend/server/nextcloud-client.ts`
- `NextCloud-Frontend/server/index.ts`

## Talk module: what has been done

### Real data and chat behavior

The Talk page is no longer using fake seeded users for the main flows.

Implemented:

- Real DM user discovery via Nextcloud users
- Real group conversations
- Real message send and fetch
- Real attachment upload + message share flow
- Real participant fetching
- Real shared file listing
- Real group member add flow

Talk-specific frontend file:

- `NextCloud-Frontend/client/src/pages/Talk.tsx`

Relevant backend files:

- `NextCloud-Frontend/server/index.ts`
- `NextCloud-Frontend/server/groupware-client.ts`
- `NextCloud-Frontend/server/nextcloud-client.ts`

### Native Talk migration progress

This project is not using the old pure custom call bootstrap anymore.

Implemented so far:

- Native Nextcloud web-session bootstrap during login
- Native Talk call start / accept / end semantics where available
- Native Talk signaling settings fetch
- ICE/STUN values now come from Nextcloud signaling settings instead of only hardcoded Google STUN

Important limitation:

- Local Nextcloud currently reports internal signaling mode.
- Because of that, the browser is still using the existing adapter signaling fallback for SDP/ICE exchange.
- This is a hybrid state:
  - native call session semantics: yes
  - native signaling config: yes
  - full standalone native signaling in browser: not yet

### Talk UI / UX fixes already completed

Implemented:

- Conversation search
- In-conversation message search
- Attachment upload from chat
- Better incoming call state handling
- Correct incoming call type:
  - voice call shows as voice
  - video call shows as video
  - screen-share call shows as screen-share
- Active conversation restore after reload
- Call overlays for voice and video/screen
- Participant handling in active call UI
- Remote audio rendering added explicitly
- Incoming call ringtone added on receiver side

### WebRTC / call fixes already completed

Implemented:

- Multi-peer connection map by remote username
- Offer / answer / ICE routing through adapter
- Remote stream binding on `ontrack`
- Explicit remote audio renderers for joined participants
- Screen-share toggle and stream replacement flow
- Remote audio replay hardening when tracks are added or unmuted later

Specific fixes made recently:

1. Blank screen when clicking call buttons

- Cause: call overlay props were used but not destructured in component parameters
- Fix: corrected prop destructuring in `VoiceCallOverlay` and `VideoCallOverlay`

2. Receiver saw video call even when caller started voice call

- Cause: incoming call state only stored caller name, and banner text was hardcoded as video
- Fix: incoming call state now carries real call type and the banner renders accordingly

3. Remote audio missing in voice call

- Cause: the voice-call overlay did not mount any remote media element, so remote audio had nowhere to play
- Fix: added `RemoteAudioRenderer` and mounted it for joined remote participants

4. One-way audio hardening

- Cause: likely late-arriving/unmuted remote tracks on one side
- Fix: remote audio renderer now retries playback when tracks are added or unmuted

5. Incoming ringtone

- Added a receiver-side ringtone using browser `AudioContext`
- No extra asset file was introduced

## Talk testing done so far

### Automated Talk test coverage

Talk-focused Playwright coverage was added and stabilized.

Files:

- `NextCloud-Frontend/e2e/05-talk.spec.ts`
- `NextCloud-Frontend/e2e/05-talk-api.spec.ts`
- `NextCloud-Frontend/e2e/helpers.ts`
- `NextCloud-Frontend/playwright.config.ts`
- `NextCloud-Frontend/playwright/global-setup.ts`

Verified passing suite at the time of the latest full Talk run:

- Conversation list loads
- Open a conversation and load messages
- Send a message in a writable conversation
- Search within a conversation filters visible messages
- Attach a file and send it into the current conversation
- Group conversations tab opens a real group chat
- DM message send persists for Talk
- Group message send persists for Talk
- Native DM call starts, accepts, and ends cleanly
- Non-callable Talk conversation is rejected cleanly

Latest confirmed automated Talk result:

- `10/10 Talk test cases passed`

Command used:

```powershell
cd "C:\Users\admin\Desktop\Codex New Implementation\NextCloud-Frontend"
npm run check
$env:E2E_EMAIL='Test01'
$env:E2E_PASSWORD='CloudSpace!Test01!2026'
npx playwright test e2e/05-talk.spec.ts e2e/05-talk-api.spec.ts --project=chromium --reporter=line --workers=1
```

### Manual Talk testing already performed

Verified manually or through targeted debugging:

- Non-admin users can see Talk when capabilities are configured
- `Test01` and `Test02` can discover each other in Talk
- DM creation works
- Incoming calls can appear on the other user
- Voice call type is now reflected correctly in receiver UI
- Receiver-side ringtone was added

## Current known Talk issues / items still needing verification

These are the most important remaining items to validate manually after the latest patches:

1. Full two-way audio consistency

- A recent bug was observed where `Test02` could hear `Test01`, but `Test01` could not hear `Test02`
- A hardening patch was added to remote audio replay logic
- This still needs fresh end-to-end manual verification after the patch

2. Cross-device browser behavior

- Media behavior depends on browser permissions
- Both devices must use the HTTPS LAN URL
- Both devices may need the local cert accepted once

3. Native signaling architecture

- Still hybrid because local Nextcloud uses internal signaling mode
- Native session semantics are used, but browser SDP/ICE exchange still relies on adapter fallback

## Important environment/config notes

Frontend `.env` is the live runtime config for the adapter-side capability behavior.

Important variables used:

- `NC_BASE_URL`
- `NC_CAPABILITY_USERNAME`
- `NC_CAPABILITY_PASSWORD`
- `SESSION_SECRET`
- `ALLOW_MOCK_SERVICES=false`
- `VITE_HOST=0.0.0.0`
- `VITE_HTTPS=true`
- `VITE_API_PROXY_TARGET`
- `VITE_NEXTCLOUD_PROXY_TARGET`

Do not rely on stale OAuth variables in `.env.development` for the current branch.

## Suggested next steps for the next engineer

1. Re-verify Talk manually on two real devices:

- `Test01` calls `Test02`
- `Test02` calls `Test01`
- verify two-way audio both directions
- verify incoming ringtone on receiver
- verify video call
- verify screen share

2. If one-way audio still persists:

- inspect whether caller-side remote audio track appears in `ontrack`
- inspect whether the remote audio stream contains audio tracks but remains muted/inactive
- inspect browser permissions and device-selected input/output on both devices

3. If production-grade calling is the real target:

- move further toward native Nextcloud Talk signaling or a stronger signaling architecture
- add TURN support for real-world network conditions

## Files most relevant for continuation

Talk frontend:

- `C:\Users\admin\Desktop\Codex New Implementation\NextCloud-Frontend\client\src\pages\Talk.tsx`

Talk adapter/backend glue:

- `C:\Users\admin\Desktop\Codex New Implementation\NextCloud-Frontend\server\index.ts`
- `C:\Users\admin\Desktop\Codex New Implementation\NextCloud-Frontend\server\groupware-client.ts`
- `C:\Users\admin\Desktop\Codex New Implementation\NextCloud-Frontend\server\nextcloud-client.ts`
- `C:\Users\admin\Desktop\Codex New Implementation\NextCloud-Frontend\server\nextcloud-web-session.ts`

Talk tests:

- `C:\Users\admin\Desktop\Codex New Implementation\NextCloud-Frontend\e2e\05-talk.spec.ts`
- `C:\Users\admin\Desktop\Codex New Implementation\NextCloud-Frontend\e2e\05-talk-api.spec.ts`
- `C:\Users\admin\Desktop\Codex New Implementation\NextCloud-Frontend\e2e\helpers.ts`
- `C:\Users\admin\Desktop\Codex New Implementation\NextCloud-Frontend\playwright.config.ts`
- `C:\Users\admin\Desktop\Codex New Implementation\NextCloud-Frontend\playwright\global-setup.ts`

## Short status summary

The custom Nextcloud frontend is already well beyond a mock Talk UI.

Current state:

- Real messages: working
- Real DM/group conversations: working
- Real attachments in Talk: working
- Incoming call type UI: fixed
- Blank call overlay render crash: fixed
- Receiver ringtone: added
- Remote audio rendering: implemented and hardened

Still needing fresh confirmation after the latest fixes:

- stable two-way audio on real devices
