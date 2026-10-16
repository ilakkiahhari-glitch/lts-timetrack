# LTS TimeTrack front end

React 19 + Vite + TypeScript. Today it contains the **kiosk scan screen** for volunteer scanner operators; the admin
screens come next. It talks to the FastAPI backend under `/api/v1` and nothing else.

## Run it

You need Node.js 20 or newer and the backend running on port 8000 (see the project README).

```powershell
cd frontend
npm install
npm run dev        # http://localhost:3000  (proxies /api to http://localhost:8000)
```

Other scripts: `npm test` (Vitest), `npm run lint`, `npm run build` (type-check + production build into `dist/`).

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

- `src/api/`: typed API client (`client.ts`) with token refresh, error mapping and the `X-Device-Key` header.
- `src/auth/`: session state (`session.tsx`, `context.ts`) and what is kept in `localStorage` (`storage.ts`): the
  refresh token and the device key. The access token lives in memory only.
- `src/kiosk/useScanFlow.ts`: submits codes, ignores repeats, decides what the banner shows.
- `src/pages/`: `Login`, `DeviceSetup`, `Kiosk`. `src/components/`: camera scanner, result banner, on-site list, clock.

## Production

`npm run build` writes static files to `dist/`. Nginx serves them and proxies `/api` to FastAPI on the same origin,
so no CORS configuration is needed (see the deployment table in the design document).
