# Preloader User Guide

The preloader turns a CSV spreadsheet of apartments/houses into `data/preloaded-state.json`, which the app uses as the shared default map data.

## What It Does

The script reads a CSV file and creates:

- Fixed workplace settings
- A drive-time radius
- One listing per CSV row
- Notes assembled from useful CSV columns
- Empty `place` and `commutes` fields that the app fills in through Google Maps

The app loads `data/preloaded-state.json` when it starts. If a listing does not already have coordinates, the app geocodes its address in the browser.

## Basic Command

From the project root:

```powershell
pnpm csv:preload -- "data/K+B homes - Sheet1 (1).csv" --out data/preloaded-state.json --default-location "Troy, MI"
```

This reads the CSV and overwrites `data/preloaded-state.json`.

## Recommended Command

Use this when you want to include the fixed workplaces and radius:

```powershell
pnpm csv:preload -- "data/K+B homes - Sheet1 (1).csv" --out data/preloaded-state.json --default-location "Troy, MI" --work-a "280 Mill Street, Rochester, MI, USA" --work-b "28050 Grand River Avenue, Farmington Hills, MI, USA" --work-a-label "Elm workplace" --work-b-label "Corewell workplace" --radius 30
```

## CSV Columns

The script understands these columns when present:

- `Name of Residence`, `Name`, `Residence`, `Property`, or `Apartment`
- `Address` or `Location`
- `Monthly rent`, `Rent`, or `Price`
- `Bedrooms` or `Beds`
- `Bathrooms` or `Baths`
- `Sq ft`, `Sqft`, or `Square feet`
- `Washer/dryer`, `Washer dryer`, or `Laundry`
- `Floors` or `Flooring`
- `Pool + gym`, `Pool gym`, or `Amenities`
- `Walk in closet` or `Walk-in closet`
- `Review scores`, `Review score`, or `Rating`
- `Fit notes` or `Notes`

Only the name column is required.

## Address Behavior

Best case: your CSV has an `Address` column with exact street addresses.

If there is no address column, the script creates an address like:

```text
District Royal Oak Apartments, Troy, MI
```

That is good enough for some apartment complexes, but it can geocode incorrectly. After running the script, open `data/preloaded-state.json` and replace guessed addresses with exact street addresses when possible.

## Output Shape

The generated file looks like this:

```json
{
  "radiusMinutes": 30,
  "workplaces": {
    "a": {
      "label": "Elm workplace",
      "address": "280 Mill Street, Rochester, MI, USA",
      "place": null
    },
    "b": {
      "label": "Corewell workplace",
      "address": "28050 Grand River Avenue, Farmington Hills, MI, USA",
      "place": null
    }
  },
  "listings": [
    {
      "id": "district-royal-oak-apartments",
      "name": "District Royal Oak Apartments",
      "address": "District Royal Oak Apartments, Troy, MI",
      "rent": "$1,590-$1,635",
      "beds": "2",
      "notes": "1.5 bath; 1,100 sq ft",
      "place": null,
      "commutes": {}
    }
  ]
}
```

Do not manually fill `place` or `commutes` unless you know exactly what you are doing. The app can calculate those.

## Options

```text
--out <path>
```

Output JSON path. Defaults to `data/preloaded-state.json`.

```text
--default-location <place>
```

Location appended to listing names when the CSV has no address column.

```text
--radius <minutes>
```

Drive-time radius used for workplace polygons.

```text
--work-a <address>
--work-b <address>
```

Fixed workplace addresses.

```text
--work-a-label <label>
--work-b-label <label>
```

Names shown for the workplace markers.

## Workflow

1. Export the spreadsheet as CSV.
2. Put the CSV in the `data/` folder.
3. Run `pnpm csv:preload`.
4. Open `data/preloaded-state.json`.
5. Fix guessed addresses.
6. Run `pnpm lint` and `pnpm build`.
7. Commit and push the updated JSON.
8. Redeploy the app.

## Local Browser Cache

The app also saves state in browser `localStorage`. If you update `data/preloaded-state.json` but do not see changes locally, clear the app’s saved browser state or open the site in a private window.

The deployed app will show the new preloaded data to first-time visitors. Existing visitors may still have local edits layered on top.

## Common Problems

If a marker is missing, check that the listing has an address and that Google can geocode it.

If the marker appears in the wrong city, replace the generated address with an exact street address.

If commute times show as unavailable, verify the Google Maps key has Directions API enabled.

If the script overwrote workplaces, rerun it with `--work-a`, `--work-b`, `--work-a-label`, and `--work-b-label`.
