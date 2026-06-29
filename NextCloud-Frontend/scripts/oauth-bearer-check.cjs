// Verify which Nextcloud APIs accept an OAuth2 access token as a Bearer credential.
// Credential-free: you paste a real access token (no admin password needed), so this
// is safe to run against PRODUCTION (nc.icingtree.com, v33).
//
// How to get an access token from production (one-time, in a browser):
//   1. Open: https://nc.icingtree.com/index.php/apps/oauth2/authorize?response_type=code&client_id=<CLOUDSPACE_CLIENT_ID>&redirect_uri=<REGISTERED_REDIRECT>&state=test
//      (logs you in via Keycloak, then redirects to <REGISTERED_REDIRECT>?code=XXXX)
//   2. Exchange the code (server-side, with the client secret):
//        curl -u "<client_id>:<client_secret>" -d grant_type=authorization_code \
//             -d code=XXXX -d redirect_uri=<REGISTERED_REDIRECT> \
//             https://nc.icingtree.com/index.php/apps/oauth2/api/v1/token
//   3. Run this with the access_token:
//        NC_URL=https://nc.icingtree.com ACCESS_TOKEN=<access_token> node scripts/oauth-bearer-check.cjs
//
// PASS (200/207) = Bearer accepted. 401 = rejected (needs a workaround). 412 (Mail) = no
// account configured, which is auth-accepted, not a rejection.

const NC = (process.env.NC_URL || "http://localhost:8080").replace(/\/+$/, "");
const TOKEN = process.env.ACCESS_TOKEN || "";
const USER = process.env.NC_USER || "admin"; // used in the DAV paths

if (!TOKEN) { console.error("Set ACCESS_TOKEN=<oauth2 access token>"); process.exit(1); }

const B = { Authorization: `Bearer ${TOKEN}`, "OCS-APIRequest": "true", Accept: "application/json" };
const probes = [
  ["OCS user",          "GET",      "/ocs/v2.php/cloud/user?format=json"],
  ["OCS capabilities",  "GET",      "/ocs/v2.php/cloud/capabilities?format=json"],
  ["Files (WebDAV)",    "PROPFIND", `/remote.php/dav/files/${USER}/`],
  ["Calendar (CalDAV)", "PROPFIND", `/remote.php/dav/calendars/${USER}/`],
  ["Contacts (CardDAV)","PROPFIND", `/remote.php/dav/addressbooks/users/${USER}/`],
  ["Talk (rooms)",      "GET",      "/ocs/v2.php/apps/spreed/api/v4/room?format=json"],
  ["Deck (boards)",     "GET",      "/index.php/apps/deck/api/v1.0/boards"],
  ["Mail (accounts)",   "GET",      "/index.php/apps/mail/api/accounts"],
  ["Notifications",     "GET",      "/ocs/v2.php/apps/notifications/api/v2/notifications?format=json"],
];

(async () => {
  console.log(`Bearer-auth coverage against ${NC}\n`);
  for (const [label, method, path] of probes) {
    try {
      const res = await fetch(`${NC}${path}`, { method, headers: method === "PROPFIND" ? { ...B, Depth: "0" } : B });
      const ok = res.status === 200 || res.status === 207;
      const note = res.status === 412 ? " (no account configured — auth OK)" : res.status === 401 ? " (REJECTED)" : "";
      console.log(`  ${ok ? "PASS" : "----"}  ${label.padEnd(20)} ${res.status}${note}`);
    } catch (e) { console.log(`  ERR   ${label.padEnd(20)} ${e.message}`); }
  }
})();
