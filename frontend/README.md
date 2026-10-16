# LTS TimeTrack front end

React 19 + Vite + TypeScript. It contains the **kiosk scan screen** for volunteer scanner operators and the first
**admin screens** (sign-in routing, dashboard, people and printable badges). Sessions and corrections, devices, users,
rules, the audit log and reports are still to come. It talks to the FastAPI backend under `/api/v1` and nothing else.

## Run it

You need Node.js 20 or newer and the backend running on port 8000 (see the project README).

```powershell
cd frontend
npm install
npm run dev        # http://localhost:3000  (proxies /api to http://localhost:8000)
```

Other scripts: `npm test` (Vitest), `npm run lint`, `npm run build` (type-check + production build into `dist/`).

## Who sees what

Signing in sends an **admin** to `/admin` and a **volunteer** to `/kiosk`. Admins can open the kiosk from the admin
header and come back from the kiosk menu. Volunteers who type an admin address are sent back to the kiosk, and the
server refuses them anyway (403). The role is read from the access token only to choose screens; it is never trusted
for access.

| Address | Screen |
|---|---|
| `/login` | Sign in |
| `/kiosk` | Kiosk (device setup the first time) |
| `/admin` | Dashboard: who is on site now, sessions flagged for review, quick actions |
| `/admin/people` | Search and filter people (type, group, active), 25 per page |
| `/admin/people/new` | Add a person, then print or download their one-time QR badge |
| `/admin/people/:id` | Edit details, deactivate or reactivate, issue a new QR code, reprint a badge issued moments ago |
| `/admin/people/types` | List and add person types |

**Badges.** The badge card (name, type, ID number and QR, 86 x 54 mm) is what prints; the rest of the page is hidden in
print. The QR holds only a random token, so the printed text is what makes a badge recognisable. The code is shown once
(the backend never stores it), so print or save the badge when it appears; the detail page can reprint it for a short
time afterwards, and "Issue a new QR code" replaces a lost one (the old badge stops working at once).

## How the kiosk works

1. **Sign in** as a volunteer (or admin) at the kiosk.
2. **Device setup, once per kiosk:** an administrator registers the kiosk with `POST /devices` and gives you its
   `api_key`. Paste it in; it is checked against the server and stored on this device only.
3. **Scan.** The camera reads QR codes (a USB scanner or typing in the box works too). The screen shows
   **Checked in**, **Checked out** (with time on site), **Already scanned**, or an error, then returns to ready.
4. The **On site now** list refreshes after every scan and every 20 seconds.

Behaviour worth knowing:

- A badge held in front of the camera counts as **one** scan, however long it stays in view. It is accepted again
  only after it has left the frame for 2 seconds (and 5 seconds have passed), so a forgotten badge can never turn an
  entry into an exit.
- The access token (15 minutes) is renewed automatically with the refresh token (7 days), so a kiosk stays signed
  in all week. If the refresh token is rejected, the kiosk returns to the sign-in screen.
- A rejected device key stays on screen with a button to enter a new one.
- The camera needs HTTPS or `localhost`. Behind Nginx in production, serve the app over HTTPS.

## Layout

- `src/api/`: typed API client (`client.ts`) with token refresh, error mapping and the `X-Device-Key` header;
  `admin.ts` has the admin calls (people, person types, open sessions).
- `src/auth/`: session state (`session.tsx`, `context.ts`), the role hint (`jwt.ts`) and what is kept in
  `localStorage` (`storage.ts`): the refresh token, role and device key. The access token lives in memory only.
- `src/routes.tsx`: route guards (`RequireAuth`, `RequireAdmin`) and the role-based home redirect.
- `src/kiosk/useScanFlow.ts`: submits codes, ignores repeats, decides what the banner shows.
- `src/pages/`: `Login`, `DeviceSetup`, `Kiosk`. `src/admin/`: layout, dashboard and the people screens.
- `src/components/`: camera scanner, result banner, on-site list, clock, badge (`Badge.tsx`), key/value editor.
- `src/test/fakeApi.tsx`: test helper that stubs `fetch` by method and path and renders the app signed in.

## Production

`npm run build` writes static files to `dist/`. Nginx serves them and proxies `/api` to FastAPI on the same origin,
so no CORS configuration is needed (see the deployment table in the design document).
