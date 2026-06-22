# Enabling notify_push (Nextcloud "Client Push" / High Performance Backend)

This turns the ~15s notification/activity/files polling into **true server push**.
CloudSpace already auto-detects it — the moment Nextcloud advertises a notify_push
endpoint, `server/realtime.ts` connects to it and the polling fallback goes quiet.
**No CloudSpace code change is needed.**

> Your messages/typing/reactions are already instant (CloudSpace's own WebSocket
> layer). notify_push only upgrades the *notification / activity / file-change*
> signals, and mainly matters at larger user counts. For a small/dev setup the
> polling fallback is usually fine — this is the "go faster" path if you want it.

Prerequisite already satisfied: Nextcloud uses Redis (`\OC\Memcache\Redis`,
host `redis`), which notify_push requires.

---

## 1. Install the "Client Push" app

It's **not in an app bundle** — it's a separate app called **Client Push**
(app id `notify_push`). Install it either way:

- **Admin UI:** Apps → search **"Client Push"** → Download and enable, **or**
- **CLI:**
  ```sh
  docker exec -u www-data nextcloud-backend-nextcloud-1 php occ app:install notify_push
  ```

This places the Rust binary on the shared `nextcloud_data` volume at
`…/custom_apps/notify_push/bin/x86_64/notify_push` — which the sidecar runs.

## 2. Trust the proxy/sidecar IPs

The self-test only passes if Nextcloud trusts the forwarded headers from the
sidecar and nginx. Allow the Docker bridge subnet:

```sh
docker exec -u www-data nextcloud-backend-nextcloud-1 \
  php occ config:system:set trusted_proxies 0 --value="nginx"
docker exec -u www-data nextcloud-backend-nextcloud-1 \
  php occ config:system:set trusted_proxies 1 --value="notify_push"
docker exec -u www-data nextcloud-backend-nextcloud-1 \
  php occ config:system:set trusted_proxies 2 --value="172.16.0.0/12"
```

## 3. Start the sidecar

```sh
cd "C:\Users\admin\Desktop\Codex New Implementation\nextcloud-backend"
docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.notify-push.yml up -d
```

The sidecar waits for the binary to exist, then serves on `:7867`. nginx already
proxies `/push/` to it (see `nginx.dev.conf`), so reload nginx if it was already up:

```sh
docker exec nextcloud-backend-nginx-1 nginx -s reload
```

## 4. Point Nextcloud at the public push URL

The endpoint Nextcloud advertises must be the **origin the browser / CloudSpace
adapter uses to reach Nextcloud** — nginx on `:8090`.

`occ notify_push:setup http://localhost:8090/push` runs a self-test *from inside
the container*, where `localhost:8090` is the container's own loopback, not the
host's nginx — so it aborts before storing the URL. Set the endpoint directly
instead (this is all `setup` does on success):

```sh
docker exec -u www-data nextcloud-backend-nextcloud-1 \
  php occ config:app:set notify_push base_endpoint --value="http://localhost:8090/push"
```

Verify from the **host** (where the adapter actually runs):

```sh
curl http://localhost:8090/push/test/cookie      # -> a number, e.g. 72617940
```

> The `base_endpoint` value is exactly what gets advertised in capabilities and
> what the CloudSpace adapter connects to (`ws://localhost:8090/push/ws`). The
> in-container self-test failure is cosmetic — the binary's Redis/DB link (the
> part that matters) is already up, proven by the host curl returning a number.

## 5. Confirm CloudSpace picks it up

The capability is advertised to any authenticated session (use a real
account's app-password for `-u`; the `cloud/capabilities` endpoint rejects
unauthenticated requests with `997 Unauthorised`):

```sh
curl -s http://localhost:8090/ocs/v2.php/cloud/capabilities \
  -H "OCS-APIRequest: true" -H "Accept: application/json" \
  -u "<user>:<app-password>" | grep -o '"websocket":"[^"]*"'
# -> "websocket":"ws://localhost:8090/push/ws"
```

CloudSpace reads `capabilities.notify_push.endpoints.websocket` on the next WS
connect, then authenticates to the push server (username + app-password → the
server replies `authenticated`). The Express log then shows:

```
[realtime] notify_push connected for <username>
```

instead of falling back to polling. **Restart the Express adapter** (or just
reconnect a browser tab) so it re-reads capabilities — it caches them briefly.
Done.

---

## Turning it off

```sh
docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.notify-push.yml stop notify_push
docker exec -u www-data nextcloud-backend-nextcloud-1 php occ app:disable notify_push
```

CloudSpace automatically reverts to the polling watcher — nothing else to change.
