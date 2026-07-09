import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));

if (!args.input) {
  printUsage();
  process.exit(1);
}

const inputPath = path.resolve(args.input);
const outputPath = path.resolve(args.out || "data/preloaded-state.json");
const defaultLocation = args.defaultLocation || "Troy, MI";
const existingState = readJsonIfExists(outputPath);
const rows = parseCsv(fs.readFileSync(inputPath, "utf8"));

if (!rows.length) {
  throw new Error(`No rows found in ${inputPath}`);
}

const [headers, ...records] = rows;
const normalizedHeaders = headers.map(normalizeHeader);
const listings = records
  .map((record) => rowToListing(recordToObject(normalizedHeaders, record), defaultLocation))
  .filter(Boolean);

const state = {
  radiusMinutes: Number(args.radius || existingState?.radiusMinutes || 30),
  workplaces: {
    a: {
      label: args.workALabel || existingState?.workplaces?.a?.label || "Your workplace",
      address: args.workA || existingState?.workplaces?.a?.address || "",
      place: null,
    },
    b: {
      label: args.workBLabel || existingState?.workplaces?.b?.label || "Their workplace",
      address: args.workB || existingState?.workplaces?.b?.address || "",
      place: null,
    },
  },
  listings,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(state, null, 2)}\n`);
console.log(`Wrote ${listings.length} listings to ${outputPath}`);

function rowToListing(row, defaultLocation) {
  const name = firstValue(row, ["name of residence", "name", "residence", "property", "apartment"]);
  if (!name) {
    return null;
  }

  const address = firstValue(row, ["address", "location"]) || `${name}, ${defaultLocation}`;
  const rent = firstValue(row, ["monthly rent", "rent", "price"]);
  const beds = firstValue(row, ["bedrooms", "beds"]);
  const baths = firstValue(row, ["bathrooms", "baths"]);
  const sqft = firstValue(row, ["sq ft", "sqft", "square feet"]);
  const washerDryer = firstValue(row, ["washer/dryer", "washer dryer", "laundry"]);
  const floors = firstValue(row, ["floors", "flooring"]);
  const poolGym = firstValue(row, ["pool + gym", "pool gym", "amenities"]);
  const walkInCloset = firstValue(row, ["walk in closet", "walk-in closet"]);
  const reviewScores = firstValue(row, ["review scores", "review score", "rating"]);
  const fitNotes = firstValue(row, ["fit notes", "notes"]);

  const notes = [
    baths && `${baths} bath`,
    sqft && `${sqft} sq ft`,
    washerDryer && `washer/dryer: ${washerDryer}`,
    floors && `floors: ${floors}`,
    poolGym && `pool/gym: ${poolGym}`,
    walkInCloset && `walk-in closet: ${walkInCloset}`,
    reviewScores && `review score: ${reviewScores}`,
    fitNotes,
  ]
    .filter(isUsefulValue)
    .join("; ");

  return {
    id: slugify(name),
    name,
    address,
    rent,
    beds,
    notes,
    place: null,
    commutes: {},
  };
}

function recordToObject(headers, record) {
  const row = {};
  headers.forEach((header, index) => {
    row[header] = cleanValue(record[index] || "");
  });
  return row;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(value);
      if (row.some((cell) => cell.trim())) {
        rows.push(row);
      }
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  row.push(value);
  if (row.some((cell) => cell.trim())) {
    rows.push(row);
  }
  return rows;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--") && !parsed.input) {
      parsed.input = arg;
      continue;
    }

    const key = arg.replace(/^--/, "");
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return {
    ...parsed,
    defaultLocation: parsed["default-location"],
    workALabel: parsed["work-a-label"],
    workBLabel: parsed["work-b-label"],
    workA: parsed["work-a"],
    workB: parsed["work-b"],
  };
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (isUsefulValue(row[key])) {
      return row[key];
    }
  }
  return "";
}

function cleanValue(value) {
  return String(value || "")
    .replaceAll("â€“", "-")
    .replaceAll("–", "-")
    .replaceAll("—", "-")
    .trim();
}

function normalizeHeader(value) {
  return cleanValue(value)
    .toLowerCase()
    .replace(/:/g, "")
    .replace(/\s+/g, " ");
}

function isUsefulValue(value) {
  const cleaned = cleanValue(value).toLowerCase();
  return Boolean(cleaned && cleaned !== "n/a" && cleaned !== "not listed" && cleaned !== "unknown");
}

function slugify(value) {
  return String(value || "listing")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function printUsage() {
  console.log(`Usage:
  pnpm csv:preload -- "data/K+B homes - Sheet1 (1).csv" --out data/preloaded-state.json --default-location "Troy, MI"

Options:
  --out <path>                 Output JSON path. Defaults to data/preloaded-state.json.
  --default-location <place>   Appended when a CSV row has no address column.
  --radius <minutes>           Drive-time radius. Defaults to existing JSON radius or 30.
  --work-a <address>           Workplace A address.
  --work-b <address>           Workplace B address.
  --work-a-label <label>       Workplace A label.
  --work-b-label <label>       Workplace B label.
`);
}
