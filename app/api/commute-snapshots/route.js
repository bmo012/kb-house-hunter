import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../lib/supabaseServer";

const SNAPSHOT_INTERVAL_MS = 30 * 60 * 1000;
const TABLE_NAME = "commute_snapshots";

const schedulerState = globalThis.__houseHunterCommuteScheduler || {
  interval: null,
  lastState: null,
  running: false,
  lastRunAt: null,
  lastError: null,
};

globalThis.__houseHunterCommuteScheduler = schedulerState;

export async function GET(request) {
  ensureScheduler();

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ snapshots: [], scheduler: summarizeScheduler(), configured: false });
  }

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 600, 2000);
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .order("captured_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message, snapshots: [], scheduler: summarizeScheduler(), configured: true }, { status: 500 });
  }

  return NextResponse.json({
    snapshots: data.reverse(),
    scheduler: summarizeScheduler(),
    configured: true,
  });
}

export async function POST(request) {
  ensureScheduler();

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (body.state) {
    schedulerState.lastState = normalizeState(body.state);
  }

  if (!body.captureNow) {
    return NextResponse.json({ snapshots: [], scheduler: summarizeScheduler(), configured: Boolean(getSupabaseServerClient()) });
  }

  const result = await captureSnapshots(schedulerState.lastState);
  return NextResponse.json({ ...result, scheduler: summarizeScheduler() }, { status: result.error ? 500 : 200 });
}

function ensureScheduler() {
  if (schedulerState.interval) {
    return;
  }

  schedulerState.interval = setInterval(async () => {
    if (!schedulerState.lastState || schedulerState.running) {
      return;
    }
    await captureSnapshots(schedulerState.lastState);
  }, SNAPSHOT_INTERVAL_MS);
}

async function captureSnapshots(state) {
  const supabase = getSupabaseServerClient();
  const googleKey = process.env.GOOGLE_MAPS_SERVER_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!supabase) {
    return failCapture("Supabase is not configured.", false);
  }
  if (!googleKey) {
    return failCapture("GOOGLE_MAPS_SERVER_API_KEY or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is required.");
  }
  if (!state?.listings?.length) {
    return { snapshots: [], configured: true };
  }

  schedulerState.running = true;
  schedulerState.lastError = null;
  const capturedAt = new Date().toISOString();
  const rows = [];

  try {
    for (const listing of state.listings) {
      if (!listing.place) {
        continue;
      }

      for (const [workplaceKey, workplace] of Object.entries(state.workplaces || {})) {
        if (!workplace?.place) {
          continue;
        }

        rows.push(await buildSnapshotRow({ capturedAt, listing, workplaceKey, workplace, direction: "to_facility", googleKey }));
        rows.push(await buildSnapshotRow({ capturedAt, listing, workplaceKey, workplace, direction: "from_facility", googleKey }));
      }
    }

    if (!rows.length) {
      return { snapshots: [], configured: true };
    }

    const { data, error } = await supabase.from(TABLE_NAME).insert(rows).select("*");
    if (error) {
      throw error;
    }

    schedulerState.lastRunAt = capturedAt;
    return { snapshots: data || [], configured: true };
  } catch (error) {
    return failCapture(error.message || "Snapshot capture failed.", true, error);
  } finally {
    schedulerState.running = false;
  }
}

function failCapture(message, configured = true, error = null) {
  schedulerState.lastError = message;
  console.error("[house-hunter:commute-snapshots]", message, error || "");
  return { error: message, snapshots: [], configured };
}

async function buildSnapshotRow({ capturedAt, listing, workplaceKey, workplace, direction, googleKey }) {
  const origin = direction === "to_facility" ? listing.place : workplace.place;
  const destination = direction === "to_facility" ? workplace.place : listing.place;
  const result = await fetchDirections(origin, destination, googleKey);

  return {
    captured_at: capturedAt,
    listing_id: listing.id,
    listing_name: listing.name || listing.address || "Unnamed place",
    workplace_key: workplaceKey,
    workplace_label: workplace.label || workplaceKey,
    direction,
    origin_address: direction === "to_facility" ? listing.place?.address || listing.address : workplace.place?.address || workplace.address,
    destination_address: direction === "to_facility" ? workplace.place?.address || workplace.address : listing.place?.address || listing.address,
    duration_seconds: result.durationSeconds,
    distance_meters: result.distanceMeters,
    duration_text: result.durationText,
    distance_text: result.distanceText,
    overview_polyline: result.overviewPolyline,
    status: result.status,
    error: result.error,
  };
}

async function fetchDirections(origin, destination, googleKey) {
  const params = new URLSearchParams({
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    mode: "driving",
    departure_time: "now",
    traffic_model: "best_guess",
    key: googleKey,
  });

  const response = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`, {
    cache: "no-store",
  });
  const data = await response.json();

  if (!response.ok || data.status !== "OK") {
    return {
      durationSeconds: null,
      distanceMeters: null,
      durationText: "Unavailable",
      distanceText: "",
      overviewPolyline: null,
      status: data.status || String(response.status),
      error: data.error_message || data.status || "Directions request failed.",
    };
  }

  const route = data.routes[0];
  const leg = route.legs[0];
  const duration = leg.duration_in_traffic || leg.duration;

  return {
    durationSeconds: duration?.value ?? null,
    distanceMeters: leg.distance?.value ?? null,
    durationText: duration?.text || "Unavailable",
    distanceText: leg.distance?.text || "",
    overviewPolyline: route.overview_polyline?.points || null,
    status: data.status,
    error: null,
  };
}

function normalizeState(state) {
  return {
    workplaces: state.workplaces || {},
    listings: (state.listings || []).filter((listing) => listing?.id && listing.place),
  };
}

function summarizeScheduler() {
  return {
    active: Boolean(schedulerState.interval),
    hasState: Boolean(schedulerState.lastState),
    running: schedulerState.running,
    lastRunAt: schedulerState.lastRunAt,
    lastError: schedulerState.lastError,
    intervalMinutes: SNAPSHOT_INTERVAL_MS / 60000,
  };
}
