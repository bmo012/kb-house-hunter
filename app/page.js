"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import preloadedState from "../data/preloaded-state.json";

const STORAGE_KEY = "houseHunterState.v2";
const DEFAULT_CENTER = { lat: 38.9072, lng: -77.0369 };
const ENV_GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
const DEBUG_MAPS = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DEBUG_MAPS === "true";
const APP_DIAGNOSTIC_VERSION = "diagnostics-2026-07-09-1";

const emptyState = {
  workplaces: {
    a: { label: "Your workplace", address: "", place: null },
    b: { label: "Their workplace", address: "", place: null },
  },
  listings: [],
  radiusMinutes: 30,
};

const defaultState = mergeState(preloadedState);

export default function Home() {
  const [saved, setSaved] = useState(defaultState);
  const [apiKey, setApiKey] = useState(ENV_GOOGLE_MAPS_KEY);
  const [status, setStatus] = useState({
    text: ENV_GOOGLE_MAPS_KEY
      ? "Loading Google Maps..."
      : "Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env.local, or paste a temporary key.",
    error: !ENV_GOOGLE_MAPS_KEY,
  });
  const [mapReady, setMapReady] = useState(false);
  const [draftPlace, setDraftPlace] = useState({ name: "", address: "", rent: "", beds: "", notes: "" });
  const [shareCopied, setShareCopied] = useState(false);
  const [startupDiagnostics, setStartupDiagnostics] = useState(null);

  const loadedInitialStateRef = useRef(false);
  const mapNodeRef = useRef(null);
  const mapRef = useRef(null);
  const geocoderRef = useRef(null);
  const directionsRef = useRef(null);
  const infoWindowRef = useRef(null);
  const workplaceMarkersRef = useRef({});
  const listingMarkersRef = useRef(new Map());
  const radiusPolygonRef = useRef(null);
  const workplaceAreaPolygonsRef = useRef([]);
  const hydratedMissingPlacesRef = useRef(false);
  const drewInitialWorkplaceAreasRef = useRef(false);
  const workplaceAInputRef = useRef(null);
  const workplaceBInputRef = useRef(null);
  const listingAddressInputRef = useRef(null);

  useEffect(() => {
    setStartupDiagnostics(getStartupDiagnostics());
    logStartupDiagnostics();
    logMaps("env", {
      hasKey: Boolean(ENV_GOOGLE_MAPS_KEY),
      keyPrefix: ENV_GOOGLE_MAPS_KEY ? `${ENV_GOOGLE_MAPS_KEY.slice(0, 6)}...` : "",
      debug: DEBUG_MAPS,
    });

    const sharedState = readSharedStateFromUrl();
    if (sharedState) {
      logMaps("state:shared-url", {
        listings: sharedState.listings.length,
        workplaces: summarizeWorkplaces(sharedState.workplaces),
      });
      setSaved(sharedState);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sharedState));
      window.history.replaceState({}, "", window.location.pathname);
      loadedInitialStateRef.current = true;
      return;
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      logMaps("state:preloaded", {
        listings: defaultState.listings.length,
        workplaces: summarizeWorkplaces(defaultState.workplaces),
      });
      loadedInitialStateRef.current = true;
      return;
    }
    try {
      const localState = mergeState(JSON.parse(raw), defaultState);
      logMaps("state:local-storage", {
        listings: localState.listings.length,
        workplaces: summarizeWorkplaces(localState.workplaces),
      });
      setSaved(localState);
    } catch {
      logMaps("state:local-storage-invalid");
      localStorage.removeItem(STORAGE_KEY);
    }
    loadedInitialStateRef.current = true;
  }, []);

  useEffect(() => {
    if (!loadedInitialStateRef.current) {
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }, [saved]);

  useEffect(() => {
    if (!apiKey) {
      logMaps("script:skip-no-api-key");
      return;
    }

    logMaps("script:load-start", {
      keyPrefix: `${apiKey.slice(0, 6)}...`,
      libraries: ["places", "geometry"],
    });
    loadGoogleMaps(apiKey)
      .then(() => {
        logMaps("script:load-success", {
          hasGoogle: Boolean(window.google),
          hasMaps: Boolean(window.google?.maps),
          mapsVersion: window.google?.maps?.version,
        });
        if (!mapNodeRef.current || mapRef.current) {
          logMaps("map:init-skipped", {
            hasNode: Boolean(mapNodeRef.current),
            alreadyInitialized: Boolean(mapRef.current),
          });
          return;
        }

        logMaps("map:init-start", { center: DEFAULT_CENTER });
        mapRef.current = new window.google.maps.Map(mapNodeRef.current, {
          center: DEFAULT_CENTER,
          clickableIcons: true,
          mapTypeControl: false,
          streetViewControl: false,
          zoom: 11,
        });
        geocoderRef.current = new window.google.maps.Geocoder();
        directionsRef.current = new window.google.maps.DirectionsService();
        infoWindowRef.current = new window.google.maps.InfoWindow();
        attachPlaceAutocomplete([workplaceAInputRef.current, workplaceBInputRef.current, listingAddressInputRef.current]);
        setMapReady(true);
        logMaps("map:init-success");
        setStatus({ text: "Map ready. Add workplaces and places to compare drive times.", error: false });
      })
      .catch((error) => {
        logMaps("script:load-error", error);
        setStatus({ text: "Could not load Google Maps. Check the API key and enabled APIs.", error: true });
      });
  }, [apiKey]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !geocoderRef.current || !directionsRef.current || hydratedMissingPlacesRef.current) {
      logMaps("hydrate:skip", {
        mapReady,
        hasMap: Boolean(mapRef.current),
        hasGeocoder: Boolean(geocoderRef.current),
        hasDirections: Boolean(directionsRef.current),
        alreadyHydrated: hydratedMissingPlacesRef.current,
      });
      return;
    }

    hydratedMissingPlacesRef.current = true;
    logMaps("hydrate:start", {
      listings: saved.listings.length,
      missingListingPlaces: saved.listings.filter((listing) => listing.address && !listing.place).length,
      workplaces: summarizeWorkplaces(saved.workplaces),
    });
    hydrateMissingPlaces(saved)
      .then((next) => {
        logMaps("hydrate:success", {
          listings: next.listings.length,
          listingPlaces: next.listings.filter((listing) => listing.place).length,
          workplaces: summarizeWorkplaces(next.workplaces),
        });
        setSaved(next);
        setStatus({ text: "Loaded preloaded places and commute data.", error: false });
      })
      .catch((error) => {
        logMaps("hydrate:error", error);
        setStatus({ text: error.message || "Could not load preloaded places.", error: true });
      });
  }, [mapReady, saved]);

  const saveWorkplaces = useCallback(
    async (event) => {
      event.preventDefault();
      requireMap(mapRef.current);

      const next = {
        ...saved,
        radiusMinutes: Number(event.currentTarget.radiusMinutes.value) || 30,
        workplaces: {
          a: { ...saved.workplaces.a, address: event.currentTarget.workplaceA.value.trim() },
          b: { ...saved.workplaces.b, address: event.currentTarget.workplaceB.value.trim() },
        },
      };

      for (const key of ["a", "b"]) {
        if (!next.workplaces[key].address) {
          next.workplaces[key].place = null;
          clearMarker(workplaceMarkersRef.current[key]);
          delete workplaceMarkersRef.current[key];
          continue;
        }
        logMaps("geocode:workplace-start", { key, address: next.workplaces[key].address });
        next.workplaces[key].place = await geocodeAddress(geocoderRef.current, next.workplaces[key].address);
        logMaps("geocode:workplace-success", { key, place: next.workplaces[key].place });
      }

      next.listings = await refreshListingCommutes(next.listings, next.workplaces, directionsRef.current);
      setSaved(next);
      drewInitialWorkplaceAreasRef.current = false;
      setStatus({ text: "Workplaces saved. Click a workplace marker to draw its drive-time area.", error: false });
    },
    [saved],
  );

  const addListing = useCallback(
    async (event) => {
      event.preventDefault();
      requireMap(mapRef.current);

      const listing = {
        id: createId(),
        name: draftPlace.name.trim(),
        address: draftPlace.address.trim(),
        rent: draftPlace.rent.trim(),
        beds: draftPlace.beds.trim(),
        notes: draftPlace.notes.trim(),
        place: await geocodeAddress(geocoderRef.current, draftPlace.address.trim()),
        commutes: {},
      };
      logMaps("geocode:listing-success", { name: listing.name, place: listing.place });

      const [withCommutes] = await refreshListingCommutes([listing], saved.workplaces, directionsRef.current);
      const next = { ...saved, listings: [...saved.listings, withCommutes] };
      setSaved(next);
      setDraftPlace({ name: "", address: "", rent: "", beds: "", notes: "" });
      setStatus({ text: "Place added.", error: false });
    },
    [draftPlace, saved],
  );

  const drawDriveTimeArea = useCallback(async (workplace, radiusMinutes) => {
    if (!workplace.place) {
      logMaps("polygon:click-skip-no-place", { workplace: workplace.label });
      return;
    }

    const minutes = Number(radiusMinutes) || 30;
    logMaps("polygon:click-start", { workplace: workplace.label, minutes });
    setStatus({ text: `Calculating an approximate ${minutes}-minute drive-time area.`, error: false });
    clearMarker(radiusPolygonRef.current);

    const center = workplace.place;
    const bearings = Array.from({ length: 16 }, (_, index) => index * 22.5);
    const points = [];
    for (const bearing of bearings) {
      points.push(await findReachablePoint(center, bearing, minutes, directionsRef.current));
    }

    radiusPolygonRef.current = new window.google.maps.Polygon({
      map: mapRef.current,
      paths: points,
      strokeColor: "#1769e0",
      strokeOpacity: 0.85,
      strokeWeight: 2,
      fillColor: "#1769e0",
      fillOpacity: 0.16,
    });
    fitMapToPoints(points.concat([center]));
    logMaps("polygon:click-success", { workplace: workplace.label, points: points.length });
    setStatus({ text: `Showing approximate ${minutes}-minute driving area from ${workplace.label}.`, error: false });
  }, []);

  const drawSavedWorkplaceAreas = useCallback(async (next) => {
    if (!mapRef.current || !directionsRef.current) {
      return;
    }

    workplaceAreaPolygonsRef.current.forEach(clearMarker);
    workplaceAreaPolygonsRef.current = [];

    const workplaces = Object.values(next.workplaces).filter((workplace) => workplace.place);
    if (!workplaces.length) {
      logMaps("polygon:auto-skip-no-workplaces");
      return;
    }

    logMaps("polygon:auto-start", { workplaces: workplaces.map((workplace) => workplace.label), minutes: next.radiusMinutes });
    setStatus({ text: `Drawing saved ${next.radiusMinutes}-minute drive areas around the workplaces.`, error: false });
    const colors = ["#1769e0", "#168a5a"];
    for (let index = 0; index < workplaces.length; index += 1) {
      const workplace = workplaces[index];
      logMaps("polygon:auto-workplace-start", { workplace: workplace.label });
      const points = await buildDriveTimePolygon(workplace.place, next.radiusMinutes, directionsRef.current, 12);
      const polygon = new window.google.maps.Polygon({
        map: mapRef.current,
        paths: points,
        strokeColor: colors[index] || "#1769e0",
        strokeOpacity: 0.75,
        strokeWeight: 2,
        fillColor: colors[index] || "#1769e0",
        fillOpacity: 0.1,
      });
      workplaceAreaPolygonsRef.current.push(polygon);
      logMaps("polygon:auto-workplace-success", { workplace: workplace.label, points: points.length });
    }
    setStatus({ text: "Showing saved drive-time areas around both workplaces.", error: false });
  }, []);

  const renderMap = useCallback(
    (next) => {
      if (!mapRef.current || !window.google?.maps) {
        logMaps("render:skip-map-not-ready", {
          hasMap: Boolean(mapRef.current),
          hasGoogleMaps: Boolean(window.google?.maps),
        });
        return;
      }

      logMaps("render:start", {
        listings: next.listings.length,
        listingPlaces: next.listings.filter((listing) => listing.place).length,
        workplaces: summarizeWorkplaces(next.workplaces),
      });
      for (const key of ["a", "b"]) {
        const workplace = next.workplaces[key];
        clearMarker(workplaceMarkersRef.current[key]);
        if (!workplace.place) {
          delete workplaceMarkersRef.current[key];
          continue;
        }
        const marker = new window.google.maps.Marker({
          map: mapRef.current,
          position: workplace.place,
          label: key === "a" ? "A" : "B",
          title: workplace.label,
        });
        marker.addListener("click", () => drawDriveTimeArea(workplace, next.radiusMinutes));
        workplaceMarkersRef.current[key] = marker;
        logMaps("render:workplace-marker", { key, label: workplace.label, place: workplace.place });
      }

      listingMarkersRef.current.forEach(clearMarker);
      listingMarkersRef.current.clear();
      next.listings.forEach((listing) => {
        if (!listing.place) {
          return;
        }
        const marker = new window.google.maps.Marker({
          map: mapRef.current,
          position: listing.place,
          title: listing.name,
        });
        marker.addListener("click", () => {
          infoWindowRef.current.setContent(renderInfoWindow(listing));
          infoWindowRef.current.open({ anchor: marker, map: mapRef.current });
        });
        listingMarkersRef.current.set(listing.id, marker);
        logMaps("render:listing-marker", { id: listing.id, name: listing.name, place: listing.place });
      });

      fitMapToPoints([
        ...Object.values(next.workplaces).map((workplace) => workplace.place),
        ...next.listings.map((listing) => listing.place),
      ]);

      if (!drewInitialWorkplaceAreasRef.current && Object.values(next.workplaces).some((workplace) => workplace.place)) {
        drewInitialWorkplaceAreasRef.current = true;
        drawSavedWorkplaceAreas(next);
      }
      logMaps("render:success");
    },
    [drawDriveTimeArea, drawSavedWorkplaceAreas],
  );

  useEffect(() => {
    if (!mapReady) {
      logMaps("render-effect:skip-map-not-ready");
      return;
    }
    logMaps("render-effect:start");
    renderMap(saved);
  }, [mapReady, renderMap, saved]);

  const deleteListing = useCallback(
    (id) => {
      const next = { ...saved, listings: saved.listings.filter((listing) => listing.id !== id) };
      setSaved(next);
    },
    [saved],
  );

  const clearListings = useCallback(() => {
    const next = { ...saved, listings: [] };
    setSaved(next);
    setStatus({ text: "Cleared saved places.", error: false });
  }, [saved]);

  const copyShareLink = useCallback(async () => {
    const encoded = encodeShareState(saved);
    const url = `${window.location.origin}${window.location.pathname}?s=${encoded}`;
    await navigator.clipboard.writeText(url);
    setShareCopied(true);
    window.setTimeout(() => setShareCopied(false), 1800);
  }, [saved]);

  const listingCards = useMemo(
    () =>
      saved.listings.map((listing) => ({
        ...listing,
        meta: [listing.rent, listing.beds ? `${listing.beds} beds` : ""].filter(Boolean).join(" - "),
      })),
    [saved.listings],
  );

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Apartment controls">
        <section className="panel">
          <h1>House Hunter</h1>
          <p className="muted">
            Save places locally, compare drive times to both workplaces, and copy a share link your girlfriend can open.
          </p>
          {!ENV_GOOGLE_MAPS_KEY && (
            <>
              <label className="field">
                <span>Temporary Google Maps API key</span>
                <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="AIza..." />
              </label>
              <button type="button" onClick={() => setApiKey(apiKey.trim())}>
                Load map
              </button>
            </>
          )}
          <button type="button" className="secondary" onClick={copyShareLink} disabled={!saved.listings.length && !saved.workplaces.a.address && !saved.workplaces.b.address}>
            {shareCopied ? "Copied" : "Copy share link"}
          </button>
        </section>

        <section className="panel diagnostics-panel">
          <h2>Diagnostics</h2>
          <dl className="diagnostics-list">
            <dt>Build</dt>
            <dd>{APP_DIAGNOSTIC_VERSION}</dd>
            <dt>Google key</dt>
            <dd>{startupDiagnostics?.hasGoogleMapsKey ? `present (${startupDiagnostics.googleMapsKeyPrefix})` : "missing"}</dd>
            <dt>Debug env</dt>
            <dd>{startupDiagnostics?.debugMapsValue || "not set"}</dd>
            <dt>Debug on</dt>
            <dd>{String(startupDiagnostics?.debugMapsEnabled ?? DEBUG_MAPS)}</dd>
            <dt>Origin</dt>
            <dd>{startupDiagnostics?.origin || "loading"}</dd>
          </dl>
        </section>

        <section className="panel">
          <h2>Workplaces</h2>
          <form
            key={`${saved.workplaces.a.address}|${saved.workplaces.b.address}|${saved.radiusMinutes}`}
            className="stack"
            onSubmit={handleAsync(saveWorkplaces, setStatus)}
          >
            <label className="field">
              <span>Your workplace</span>
              <input name="workplaceA" ref={workplaceAInputRef} defaultValue={saved.workplaces.a.address} placeholder="Address or place name" />
            </label>
            <label className="field">
              <span>Their workplace</span>
              <input name="workplaceB" ref={workplaceBInputRef} defaultValue={saved.workplaces.b.address} placeholder="Address or place name" />
            </label>
            <div className="inline">
              <label className="field compact">
                <span>Radius minutes</span>
                <input name="radiusMinutes" type="number" min="5" max="90" step="5" defaultValue={saved.radiusMinutes} />
              </label>
              <button type="submit">Save workplaces</button>
            </div>
          </form>
        </section>

        <section className="panel">
          <h2>Add a place</h2>
          <form className="stack" onSubmit={handleAsync(addListing, setStatus)}>
            <label className="field">
              <span>Name</span>
              <input value={draftPlace.name} onChange={(event) => setDraftPlace({ ...draftPlace, name: event.target.value })} placeholder="Apartment name or address" required />
            </label>
            <label className="field">
              <span>Address</span>
              <input ref={listingAddressInputRef} value={draftPlace.address} onChange={(event) => setDraftPlace({ ...draftPlace, address: event.target.value })} placeholder="Address" required />
            </label>
            <div className="inline">
              <label className="field compact">
                <span>Rent</span>
                <input value={draftPlace.rent} onChange={(event) => setDraftPlace({ ...draftPlace, rent: event.target.value })} placeholder="$2,400" />
              </label>
              <label className="field compact">
                <span>Beds</span>
                <input value={draftPlace.beds} onChange={(event) => setDraftPlace({ ...draftPlace, beds: event.target.value })} placeholder="2" />
              </label>
            </div>
            <label className="field">
              <span>Notes</span>
              <textarea value={draftPlace.notes} onChange={(event) => setDraftPlace({ ...draftPlace, notes: event.target.value })} rows="3" placeholder="Parking, pet policy, tour notes" />
            </label>
            <button type="submit">Add to map</button>
          </form>
        </section>

        <section className="panel listings-panel">
          <div className="section-heading">
            <h2>Places</h2>
            <button className="ghost" type="button" onClick={clearListings}>
              Clear
            </button>
          </div>
          <div className="listing-list" aria-live="polite">
            {!listingCards.length && <p className="muted">No places yet.</p>}
            {listingCards.map((listing) => (
              <article className="listing-card" key={listing.id}>
                <header>
                  <div>
                    <h3>{listing.name}</h3>
                    <p className="muted">{listing.meta || listing.address}</p>
                  </div>
                  <button className="ghost" type="button" onClick={() => deleteListing(listing.id)}>
                    Delete
                  </button>
                </header>
                <dl>
                  <dt>Address</dt>
                  <dd>{listing.place?.address || listing.address}</dd>
                  <dt>Your drive</dt>
                  <dd>{listing.commutes?.a?.label || "Set workplace"}</dd>
                  <dt>Their drive</dt>
                  <dd>{listing.commutes?.b?.label || "Set workplace"}</dd>
                  {listing.notes && (
                    <>
                      <dt>Notes</dt>
                      <dd>{listing.notes}</dd>
                    </>
                  )}
                </dl>
              </article>
            ))}
          </div>
        </section>
      </aside>

      <section className="map-shell">
        <div ref={mapNodeRef} className="map" role="application" aria-label="Google map" />
        <div className={`status ${status.error ? "error" : ""}`}>{status.text}</div>
      </section>
    </main>
  );

  function fitMapToPoints(points) {
    const usable = points.filter(Boolean);
    if (!usable.length || !mapRef.current) {
      return;
    }
    const bounds = new window.google.maps.LatLngBounds();
    usable.forEach((point) => bounds.extend(point));
    mapRef.current.fitBounds(bounds);
  }
}

function loadGoogleMaps(apiKey) {
  if (typeof window.google?.maps?.Map === "function") {
    logMaps("script:already-loaded");
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-google-maps]");
    if (existing) {
      logMaps("script:existing-tag-found");
      if (typeof window.google?.maps?.Map === "function") {
        resolve();
        return;
      }
      window.initHouseHunterGoogleMaps = () => {
        logMaps("script:callback-existing");
        resolve();
      };
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    window.initHouseHunterGoogleMaps = () => {
      logMaps("script:callback");
      resolve();
    };

    const script = document.createElement("script");
    script.dataset.googleMaps = "true";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places,geometry&loading=async&callback=initHouseHunterGoogleMaps`;
    script.async = true;
    script.defer = true;
    script.onerror = reject;
    document.head.append(script);
  });
}

function attachPlaceAutocomplete(inputs) {
  if (!window.google.maps.places?.Autocomplete) {
    logMaps("autocomplete:skip-unavailable");
    return;
  }
  logMaps("autocomplete:attach", { inputs: inputs.filter(Boolean).length });
  inputs.filter(Boolean).forEach((input) => {
    new window.google.maps.places.Autocomplete(input, {
      fields: ["formatted_address", "geometry", "name"],
    });
  });
}

async function geocodeAddress(geocoder, address) {
  if (!geocoder) {
    throw new Error("Google geocoder is not initialized.");
  }
  logMaps("geocode:start", { address });
  const response = await geocoder.geocode({ address });
  if (!response.results.length) {
    logMaps("geocode:no-results", { address, response });
    throw new Error(`No result found for "${address}".`);
  }
  const result = response.results[0];
  const place = {
    address: result.formatted_address,
    lat: result.geometry.location.lat(),
    lng: result.geometry.location.lng(),
  };
  logMaps("geocode:success", { address, place });
  return place;
}

async function refreshListingCommutes(listings, workplaces, directionsService) {
  const next = [];
  for (const listing of listings) {
    const commutes = { ...(listing.commutes || {}) };
    for (const key of ["a", "b"]) {
      const workplace = workplaces[key];
      if (!workplace.place || !listing.place) {
        delete commutes[key];
        continue;
      }
      logMaps("directions:listing-start", {
        listing: listing.name,
        workplace: workplace.label,
        origin: listing.place,
        destination: workplace.place,
      });
      commutes[key] = await getDriveTime(directionsService, listing.place, workplace.place);
      logMaps("directions:listing-success", {
        listing: listing.name,
        workplace: workplace.label,
        commute: commutes[key],
      });
    }
    next.push({ ...listing, commutes });
  }
  return next;
}

function getDriveTime(directionsService, origin, destination) {
  return new Promise((resolve) => {
    if (!directionsService) {
      logMaps("directions:error-no-service");
      resolve({ label: "Unavailable", seconds: null });
      return;
    }
    logMaps("directions:start", { origin, destination });
    directionsService.route(
      {
        origin,
        destination,
        travelMode: window.google.maps.TravelMode.DRIVING,
        drivingOptions: { departureTime: new Date() },
      },
      (result, status) => {
        if (status !== "OK") {
          logMaps("directions:error-status", { status, origin, destination, result });
          resolve({ label: "Unavailable", seconds: null });
          return;
        }
        const leg = result.routes[0].legs[0];
        const duration = leg.duration_in_traffic || leg.duration;
        const commute = { label: duration.text, seconds: duration.value };
        logMaps("directions:success", commute);
        resolve(commute);
      },
    );
  });
}

async function findReachablePoint(center, bearing, targetMinutes, directionsService) {
  logMaps("polygon:sample-start", { bearing, targetMinutes });
  const targetSeconds = targetMinutes * 60;
  let lowMiles = 1;
  let highMiles = Math.max(8, targetMinutes * 1.2);
  let best = destinationPoint(center, bearing, lowMiles);

  for (let i = 0; i < 4; i += 1) {
    const test = destinationPoint(center, bearing, highMiles);
    const duration = await getDriveTime(directionsService, center, test);
    if (duration.seconds && duration.seconds > targetSeconds) {
      break;
    }
    best = test;
    highMiles *= 1.6;
  }

  for (let i = 0; i < 4; i += 1) {
    const midMiles = (lowMiles + highMiles) / 2;
    const test = destinationPoint(center, bearing, midMiles);
    const duration = await getDriveTime(directionsService, center, test);
    if (duration.seconds && duration.seconds <= targetSeconds) {
      best = test;
      lowMiles = midMiles;
    } else {
      highMiles = midMiles;
    }
  }

  logMaps("polygon:sample-success", { bearing, point: best });
  return best;
}

async function buildDriveTimePolygon(center, targetMinutes, directionsService, sampleCount = 16) {
  const bearings = Array.from({ length: sampleCount }, (_, index) => index * (360 / sampleCount));
  const points = [];
  for (const bearing of bearings) {
    points.push(await findReachablePoint(center, bearing, targetMinutes, directionsService));
  }
  return points;
}

function destinationPoint(origin, bearingDegrees, miles) {
  const meters = miles * 1609.344;
  const point = window.google.maps.geometry.spherical.computeOffset(
    new window.google.maps.LatLng(origin.lat, origin.lng),
    meters,
    bearingDegrees,
  );
  return { lat: point.lat(), lng: point.lng() };
}

function renderInfoWindow(listing) {
  return `
    <strong>${escapeHtml(listing.name)}</strong><br>
    ${escapeHtml(listing.place?.address || listing.address)}<br>
    ${listing.rent ? `Rent: ${escapeHtml(listing.rent)}<br>` : ""}
    ${listing.beds ? `Beds: ${escapeHtml(listing.beds)}<br>` : ""}
    Your drive: ${escapeHtml(listing.commutes?.a?.label || "Set workplace")}<br>
    Their drive: ${escapeHtml(listing.commutes?.b?.label || "Set workplace")}
    ${listing.notes ? `<br>Notes: ${escapeHtml(listing.notes)}` : ""}
  `;
}

function handleAsync(fn, setStatus) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (error) {
      setStatus({ text: error.message || "Something went wrong.", error: true });
    }
  };
}

function requireMap(map) {
  if (!map) {
    throw new Error("Load Google Maps first.");
  }
}

function clearMarker(marker) {
  if (marker) {
    marker.setMap(null);
  }
}

function createId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function encodeShareState(state) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(state))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function readSharedStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get("s");
  if (!encoded) {
    return null;
  }
  try {
    const padded = encoded.padEnd(encoded.length + ((4 - (encoded.length % 4)) % 4), "=");
    const json = decodeURIComponent(escape(atob(padded.replaceAll("-", "+").replaceAll("_", "/"))));
    return mergeState(JSON.parse(json), defaultState);
  } catch {
    return null;
  }
}

async function hydrateMissingPlaces(state) {
  const next = mergeState(state, defaultState);

  for (const key of ["a", "b"]) {
    const workplace = next.workplaces[key];
    if (workplace.address && !workplace.place) {
      workplace.place = await geocodeAddress(window.google.maps.Geocoder ? new window.google.maps.Geocoder() : null, workplace.address);
    }
  }

  for (const listing of next.listings) {
    if (listing.address && !listing.place) {
      try {
        listing.place = await geocodeAddress(new window.google.maps.Geocoder(), listing.address);
      } catch {
        listing.place = null;
      }
    }
  }

  next.listings = await refreshListingCommutes(next.listings, next.workplaces, new window.google.maps.DirectionsService());
  return next;
}

function mergeState(value, base = emptyState) {
  const incoming = value || {};
  const listings = new Map();
  for (const listing of base.listings || []) {
    listings.set(listing.id || slugify(listing.name || listing.address), listing);
  }
  for (const listing of incoming.listings || []) {
    listings.set(listing.id || slugify(listing.name || listing.address), listing);
  }

  return {
    ...base,
    ...incoming,
    workplaces: {
      a: { ...base.workplaces.a, ...(incoming.workplaces?.a || {}) },
      b: { ...base.workplaces.b, ...(incoming.workplaces?.b || {}) },
    },
    listings: Array.from(listings.values()),
  };
}

function slugify(value) {
  return String(value || "listing")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function summarizeWorkplaces(workplaces) {
  return Object.fromEntries(
    Object.entries(workplaces || {}).map(([key, workplace]) => [
      key,
      {
        label: workplace.label,
        hasAddress: Boolean(workplace.address),
        address: workplace.address || "",
        hasPlace: Boolean(workplace.place),
        place: workplace.place || null,
      },
    ]),
  );
}

function logMaps(event, details) {
  if (!DEBUG_MAPS || typeof console === "undefined") {
    return;
  }

  const prefix = `[house-hunter:maps] ${event}`;
  if (details instanceof Error) {
    console.error(prefix, {
      message: details.message,
      stack: details.stack,
    });
    return;
  }

  if (details === undefined) {
    console.log(prefix);
    return;
  }

  console.log(prefix, details);
}

function logStartupDiagnostics() {
  if (typeof console === "undefined") {
    return;
  }

  console.error("[house-hunter:startup]", getStartupDiagnostics());
}

function getStartupDiagnostics() {
  return {
    appDiagnosticVersion: APP_DIAGNOSTIC_VERSION,
    nodeEnv: process.env.NODE_ENV,
    hasGoogleMapsKey: Boolean(ENV_GOOGLE_MAPS_KEY),
    googleMapsKeyPrefix: ENV_GOOGLE_MAPS_KEY ? `${ENV_GOOGLE_MAPS_KEY.slice(0, 6)}...` : "",
    debugMapsValue: process.env.NEXT_PUBLIC_DEBUG_MAPS || "",
    debugMapsEnabled: DEBUG_MAPS,
    origin: typeof window !== "undefined" ? window.location.origin : "",
    href: typeof window !== "undefined" ? window.location.href : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
