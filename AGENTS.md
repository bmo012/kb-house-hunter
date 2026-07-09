# Repository Guidelines

## Project Structure & Module Organization

- `app/` contains the App Router UI. `app/page.js` holds the main client-side map workflow, `app/layout.js` defines the shell, and `app/globals.css` contains global styling.
- `data/` contains CSV exports and `preloaded-state.json`, the seed data loaded by the app.
- `scripts/` contains utility scripts, including CSV conversion.
- `docs/` contains project-specific guides such as the preloader documentation.

Keep generated output such as `.next/` and dependencies such as `node_modules/` out of commits.

## Build, Test, and Development Commands

Use `pnpm` for dependency and script management.

- `pnpm install` installs dependencies from `pnpm-lock.yaml`.
- `pnpm dev` starts the local Next.js development server at `http://localhost:3000`.
- `pnpm build` creates a production build.
- `pnpm start` serves the production build after `pnpm build`.
- `pnpm lint` runs ESLint across the repository.
- `pnpm csv:preload -- "data/source.csv" --out data/preloaded-state.json --default-location "Troy, MI"` converts a CSV export into app seed data.

## Coding Style & Naming Conventions

Write JavaScript with ES modules, React function components, and hooks. Match the existing style: two-space indentation, double quotes, semicolons, and descriptive camelCase names. Use PascalCase for React components.

Prefer small helper functions near the code that uses them. Keep browser-only code inside client components marked with `"use client"`.

## Testing Guidelines

There is no test framework configured yet. For now, validate changes with `pnpm lint` and, for UI changes, run `pnpm dev` and exercise the map, workplace inputs, listing form, share links, and preloaded data manually.

If tests are added later, colocate them near the code under test or use a clear `__tests__/` directory, and add a `pnpm test` script.

## Preloaded Data Maintenance

Treat `data/preloaded-state.json` as the shared source of map items for deployed users. If any apartment CSV, workplace address, rent, notes, or listing details change, check whether the preload file must be regenerated or manually updated.

Use the reusable converter when CSV data changes:

```powershell
pnpm csv:preload -- "data/K+B homes - Sheet1.csv" --out data/preloaded-state.json --default-location "Troy, MI" --work-a "280 Mill Street, Rochester, MI, USA" --work-b "28050 Grand River Avenue, Farmington Hills, MI, USA" --work-a-label "Elm workplace" --work-b-label "Corewell workplace" --radius 30
```

After running the preloader, inspect `data/preloaded-state.json` before committing:

- Confirm every intended CSV row is present in `listings`.
- Replace guessed addresses such as `Name, Troy, MI` with exact street addresses when available.
- Keep workplace addresses and labels accurate.
- Leave `place: null` and `commutes: {}` unless there is a deliberate reason to commit cached values; the app can geocode and calculate commutes at runtime.
- Run `pnpm lint` and `pnpm build`.

See `docs/preloader-guide.md` for full preloader usage. If preload data changes and the deployed app still shows old data locally, clear browser localStorage or test in a private window.

## Commit & Pull Request Guidelines

The current Git history only contains `init`, so no strict convention is established. Use short, imperative commit messages such as `Add CSV preload validation` or `Fix shared link parsing`.

Pull requests should include a concise summary, testing performed, and screenshots or recordings for UI changes. Note environment or data changes, especially updates to `data/preloaded-state.json` or Google Maps API configuration.

## Security & Configuration Tips

Copy `.env.local.example` to `.env.local` and set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. Browser map keys are visible to users, so restrict the key by HTTP referrer in Google Cloud. Do not commit real secrets or private addresses unless they are intended shared seed data.
 