# House Hunter

A small Next.js app for comparing apartments or houses against two workplaces on Google Maps.

## Local setup

```powershell
pnpm install
Copy-Item .env.local.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_browser_key
GOOGLE_MAPS_SERVER_API_KEY=your_google_maps_server_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your_supabase_secret_key
```

Then run:

```powershell
pnpm dev
```

Open `http://localhost:3000`.

## Google APIs

Use a browser Google Maps API key with these APIs enabled:

- Maps JavaScript API
- Geocoding API
- Directions API
- Places API

Restrict the key to your local and hosted domains in Google Cloud. Browser map keys are visible to users by design, so HTTP referrer restrictions matter.

## Preloaded Shared Data

The deployed app starts with the shared data in `data/preloaded-state.json`.

Edit that file to update fixed workplaces and listings for both of you:

```json
{
  "radiusMinutes": 30,
  "workplaces": {
    "a": {
      "label": "Elm workplace",
      "address": "Exact workplace address here",
      "place": null
    },
    "b": {
      "label": "Corewell workplace",
      "address": "Exact workplace address here",
      "place": null
    }
  }
}
```

Use exact street addresses when you have them. The current seed listings were copied from the CSV exports in `data/`, but several only have residence names, so Google geocoding may need manual address cleanup.

On load, the app geocodes missing coordinates, computes commute times, and draws the saved drive-time areas around the workplaces.

## Commute History

The app can save commute snapshots to Supabase and draw the latest saved routes as colored map lines. While the Next.js server is running, `/api/commute-snapshots` captures route times every 30 minutes after the site has loaded once. Use **Capture latest** to force an immediate capture.

See `docs/commute-snapshots.md` for the Supabase schema and environment setup.

### Convert a CSV to Preloaded State

Use the reusable converter script:

```powershell
pnpm csv:preload -- "data/K+B homes - Sheet1 (1).csv" --out data/preloaded-state.json --default-location "Troy, MI"
```

To set fixed workplaces at the same time:

```powershell
pnpm csv:preload -- "data/K+B homes - Sheet1 (1).csv" --out data/preloaded-state.json --default-location "Troy, MI" --work-a "280 Mill Street, Rochester, MI, USA" --work-b "28050 Grand River Avenue, Farmington Hills, MI, USA" --work-a-label "Elm workplace" --work-b-label "Corewell workplace" --radius 30
```

The script uses an `address` CSV column when present. If there is no address column, it uses `Name, default-location`, so review `data/preloaded-state.json` after converting and replace apartment-name guesses with exact street addresses where possible.

See `docs/preloader-guide.md` for the full preloader user guide.

## Sharing Without a Database

The app saves places in browser `localStorage`. Use **Copy share link** to create a URL containing the saved workplaces and listings so someone else can open the same view.

## Push to GitHub

This folder is already initialized as a local Git repo. Create an empty repo on GitHub, then run:

```powershell
git add .
git commit -m "Initial house hunter app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/house-hunter.git
git push -u origin main
```

If Git asks who you are:

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## Hosting on Vercel

1. Push this folder to a GitHub repo.
2. Import the repo in Vercel as a Next.js project.
3. Add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in Vercel project environment variables.
4. Deploy.
5. Add the Vercel domain to the Google Maps API key HTTP referrer restrictions.

For live shared editing between both of you, add a hosted database or KV store. The current version is intentionally database-free and uses share links.
