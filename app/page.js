"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import preloadedState from "../data/preloaded-state.json";

const STORAGE_KEY = "houseHunterState.v2";
const DEFAULT_CENTER = { lat: 38.9072, lng: -77.0369 };
const ENV_GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
const DEBUG_MAPS = process.env.NEXT_PUBLIC_DEBUG_MAPS === "true";
const WORKPLACE_COLORS = {
  a: "#1769e0",
  b: "#168a5a",
};
const LISTING_COLORS = ["#7c3aed", "#d97706", "#0891b2", "#be123c", "#4f46e5", "#15803d"];
const TREND_TOLERANCE = 0.1;

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
  const [routeSnapshots, setRouteSnapshots] = useState([]);
  const [selectedListingId, setSelectedListingId] = useState(null);
  const [snapshotStatus, setSnapshotStatus] = useState("Route history not loaded yet.");
  const [editingListingId, setEditingListingId] = useState(null);
  const [editingPlace, setEditingPlace] = useState(null);
  const [captureSummary, setCaptureSummary] = useState({ lastCompletedAt: null, count: 0, configured: false });

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
  const routePolylinesRef = useRef([]);
  const hydratedMissingPlacesRef = useRef(false);
  const drewInitialWorkplaceAreasRef = useRef(false);
  const workplaceAInputRef = useRef(null);
  const workplaceBInputRef = useRef(null);
  const listingAddressInputRef = useRef(null);

  useEffect(() => {
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

  const loadRouteSnapshots = useCallback(async () => {
    try {
      const response = await fetch("/api/commute-snapshots?limit=1000", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Could not load route history.");
      }
      setRouteSnapshots(data.snapshots || []);
      setCaptureSummary({
        lastCompletedAt: data.scheduler?.lastRunAt || getLatestCaptureTime(data.snapshots || []),
        count: data.snapshots?.length || 0,
        configured: Boolean(data.configured),
      });
      setSnapshotStatus(
        data.configured
          ? data.scheduler?.lastRunAt
            ? `Last automatic capture: ${formatTimestamp(data.scheduler.lastRunAt)}.`
            : "Route history is ready. Capture current routes to seed the chart."
          : "Add Supabase environment variables to save route history.",
      );
    } catch (error) {
      setSnapshotStatus(error.message || "Could not load route history.");
    }
  }, []);

  const selectListing = useCallback((listing) => {
    setSelectedListingId(listing.id);
    if (listing.place && mapRef.current) {
      mapRef.current.panTo(listing.place);
      mapRef.current.setZoom(Math.max(mapRef.current.getZoom() || 12, 13));
    }
    const marker = listingMarkersRef.current.get(listing.id);
    if (marker && infoWindowRef.current) {
      infoWindowRef.current.setContent(renderInfoWindow(listing));
      infoWindowRef.current.open({ anchor: marker, map: mapRef.current });
    }
  }, []);

  useEffect(() => {
    if (!loadedInitialStateRef.current) {
      return;
    }

    fetch("/api/commute-snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: saved, captureNow: false }),
    })
      .then(() => loadRouteSnapshots())
      .catch((error) => setSnapshotStatus(error.message || "Could not start route history capture."));
  }, [loadRouteSnapshots, saved]);

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
      strokeColor: workplace.color || "#1769e0",
      strokeOpacity: 0.85,
      strokeWeight: 2,
      fillColor: workplace.color || "#1769e0",
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

    const workplaces = Object.entries(next.workplaces)
      .map(([key, workplace]) => ({ ...workplace, color: WORKPLACE_COLORS[key] || "#1769e0" }))
      .filter((workplace) => workplace.place);
    if (!workplaces.length) {
      logMaps("polygon:auto-skip-no-workplaces");
      return;
    }

    logMaps("polygon:auto-start", { workplaces: workplaces.map((workplace) => workplace.label), minutes: next.radiusMinutes });
    setStatus({ text: `Drawing saved ${next.radiusMinutes}-minute drive areas around the workplaces.`, error: false });
    for (let index = 0; index < workplaces.length; index += 1) {
      const workplace = workplaces[index];
      logMaps("polygon:auto-workplace-start", { workplace: workplace.label });
      const points = await buildDriveTimePolygon(workplace.place, next.radiusMinutes, directionsRef.current, 12);
      const polygon = new window.google.maps.Polygon({
        map: mapRef.current,
        paths: points,
        strokeColor: workplace.color,
        strokeOpacity: 0.75,
        strokeWeight: 2,
        fillColor: workplace.color,
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
        const color = WORKPLACE_COLORS[key] || "#1769e0";
        const marker = new window.google.maps.Marker({
          map: mapRef.current,
          position: workplace.place,
          icon: createWorkplaceMarkerIcon(color),
          label: key === "a" ? "A" : "B",
          title: workplace.label,
        });
        marker.addListener("click", () => drawDriveTimeArea({ ...workplace, color }, next.radiusMinutes));
        workplaceMarkersRef.current[key] = marker;
        logMaps("render:workplace-marker", { key, label: workplace.label, place: workplace.place });
      }

      listingMarkersRef.current.forEach(clearMarker);
      listingMarkersRef.current.clear();
      next.listings.forEach((listing, index) => {
        if (!listing.place) {
          return;
        }
        const isSelected = listing.id === selectedListingId;
        const color = getListingColor(index);
        const marker = new window.google.maps.Marker({
          map: mapRef.current,
          position: listing.place,
          icon: createListingMarkerIcon(color, isSelected),
          title: listing.name,
          zIndex: isSelected ? 5 : 2,
        });
        marker.addListener("click", () => {
          setSelectedListingId(listing.id);
          infoWindowRef.current.setContent(renderInfoWindow(listing));
          infoWindowRef.current.open({ anchor: marker, map: mapRef.current });
        });
        listingMarkersRef.current.set(listing.id, marker);
        logMaps("render:listing-marker", { id: listing.id, name: listing.name, place: listing.place });
      });

      routePolylinesRef.current.forEach(clearMarker);
      routePolylinesRef.current = drawLatestRouteLines(routeSnapshots, selectedListingId, mapRef.current);

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
    [drawDriveTimeArea, drawSavedWorkplaceAreas, routeSnapshots, selectedListingId],
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
      if (selectedListingId === id) {
        setSelectedListingId(null);
      }
    },
    [saved, selectedListingId],
  );

  const startEditingListing = useCallback((listing) => {
    setEditingListingId(listing.id);
    setEditingPlace({
      name: listing.name || "",
      address: listing.address || "",
      rent: listing.rent || "",
      beds: listing.beds || "",
      notes: listing.notes || "",
    });
  }, []);

  const cancelEditingListing = useCallback(() => {
    setEditingListingId(null);
    setEditingPlace(null);
  }, []);

  const saveListingEdit = useCallback(
    async (event, listing) => {
      event.preventDefault();
      requireMap(mapRef.current);

      const form = event.currentTarget;
      const nextListing = {
        ...listing,
        name: form.name.value.trim(),
        address: form.address.value.trim(),
        rent: form.rent.value.trim(),
        beds: form.beds.value.trim(),
        notes: form.notes.value.trim(),
      };

      if (nextListing.address !== listing.address || !nextListing.place) {
        nextListing.place = await geocodeAddress(geocoderRef.current, nextListing.address);
      }

      const [withCommutes] = await refreshListingCommutes([nextListing], saved.workplaces, directionsRef.current);
      setSaved({
        ...saved,
        listings: saved.listings.map((item) => (item.id === listing.id ? withCommutes : item)),
      });
      setEditingListingId(null);
      setEditingPlace(null);
      setSelectedListingId(listing.id);
      setStatus({ text: "Place updated.", error: false });
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

  const captureCurrentRoutes = useCallback(async () => {
    setSnapshotStatus("Capturing current route times...");
    const response = await fetch("/api/commute-snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: saved, captureNow: true }),
    });
    const data = await response.json();
    if (!response.ok) {
      setSnapshotStatus(data.error || "Could not capture current routes.");
      return;
    }
    await loadRouteSnapshots();
    const completedAt = data.scheduler?.lastRunAt || new Date().toISOString();
    setCaptureSummary({ lastCompletedAt: completedAt, count: data.snapshots?.length || 0, configured: true });
    setSnapshotStatus(`Captured ${data.snapshots?.length || 0} route snapshots at ${formatTimestamp(completedAt)}.`);
  }, [loadRouteSnapshots, saved]);

  const listingCards = useMemo(
    () =>
      saved.listings.map((listing, index) => {
        const latestSnapshots = getLatestListingSnapshots(routeSnapshots, listing.id);
        return {
          ...listing,
          color: getListingColor(index),
          meta: [listing.rent, listing.beds ? `${listing.beds} beds` : ""].filter(Boolean).join(" - "),
          latestSnapshots,
          history: getListingHistory(routeSnapshots, listing.id),
          trends: {
            a: getRouteTrend(latestSnapshots.a, routeSnapshots),
            b: getRouteTrend(latestSnapshots.b, routeSnapshots),
          },
        };
      }),
    [routeSnapshots, saved.listings],
  );

  const selectedListing = listingCards.find((listing) => listing.id === selectedListingId) || listingCards[0] || null;
  const allDayRoutes = useMemo(() => buildAllDayRoutes(routeSnapshots), [routeSnapshots]);

  useEffect(() => {
    if (!selectedListingId && listingCards[0]) {
      setSelectedListingId(listingCards[0].id);
    }
  }, [listingCards, selectedListingId]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>House Hunter</h1>
          <p className="muted">Compare places by live commute, history, and rush-hour shape.</p>
        </div>
        <div className="topbar-actions">
          {!ENV_GOOGLE_MAPS_KEY && (
            <div className="api-key-field">
              <label htmlFor="temporaryGoogleMapsKey">Temporary Google Maps API key</label>
              <input id="temporaryGoogleMapsKey" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="AIza..." />
              <button type="button" onClick={() => setApiKey(apiKey.trim())}>
                Load map
              </button>
            </div>
          )}
          <button type="button" className="secondary" onClick={copyShareLink} disabled={!saved.listings.length && !saved.workplaces.a.address && !saved.workplaces.b.address}>
            {shareCopied ? "Copied" : "Copy share link"}
          </button>
        </div>
      </header>

      <aside className="sidebar" aria-label="Apartment controls">

        <section className="panel">
          <div className="section-heading">
            <h2>Workplaces</h2>
            <span className="small-pill">{saved.radiusMinutes} min radius</span>
          </div>
          <div className="workplace-summary">
            {["a", "b"].map((key) => (
              <div className="workplace-card" key={key} style={{ "--work-color": WORKPLACE_COLORS[key] }}>
                <span className="color-dot" />
                <div>
                  <strong>{saved.workplaces[key].label}</strong>
                  <p className="muted">{saved.workplaces[key].place?.address || saved.workplaces[key].address || "Not configured"}</p>
                </div>
              </div>
            ))}
          </div>
          <form
            key={`${saved.workplaces.a.address}|${saved.workplaces.b.address}|${saved.radiusMinutes}`}
            className="stack"
            onSubmit={handleAsync(saveWorkplaces, setStatus)}
          >
            <div className="inline">
              <label className="field">
                <span>Your workplace</span>
                <input name="workplaceA" ref={workplaceAInputRef} defaultValue={saved.workplaces.a.address} placeholder="Address or place name" />
              </label>
              <label className="field">
                <span>Their workplace</span>
                <input name="workplaceB" ref={workplaceBInputRef} defaultValue={saved.workplaces.b.address} placeholder="Address or place name" />
              </label>
            </div>
            <div className="radius-row">
              <label className="field slider-field">
                <span>Drive-time area radius</span>
                <input name="radiusMinutes" type="range" min="5" max="90" step="5" defaultValue={saved.radiusMinutes} />
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
            <div className="button-row">
              <button className="secondary" type="button" onClick={captureCurrentRoutes} disabled={!saved.listings.length}>
                Capture latest drive times
              </button>
              <button className="ghost" type="button" onClick={clearListings}>
                Clear
              </button>
            </div>
          </div>
          <div className="capture-status">
            <strong>Latest capture</strong>
            <span>{captureSummary.lastCompletedAt ? formatTimestamp(captureSummary.lastCompletedAt) : "Not completed yet"}</span>
            <p className="muted">{snapshotStatus}</p>
          </div>
          <div className="listing-list" aria-live="polite">
            {!listingCards.length && <p className="muted">No places yet.</p>}
            {listingCards.map((listing) => (
              <article className={`listing-card ${selectedListing?.id === listing.id ? "selected" : ""}`} key={listing.id}>
                {editingListingId === listing.id ? (
                  <form className="stack" onSubmit={handleAsync((event) => saveListingEdit(event, listing), setStatus)}>
                    <div className="inline">
                      <label className="field">
                        <span>Name</span>
                        <input name="name" value={editingPlace.name} onChange={(event) => setEditingPlace({ ...editingPlace, name: event.target.value })} required />
                      </label>
                      <label className="field">
                        <span>Address</span>
                        <input name="address" value={editingPlace.address} onChange={(event) => setEditingPlace({ ...editingPlace, address: event.target.value })} required />
                      </label>
                    </div>
                    <div className="inline">
                      <label className="field">
                        <span>Rent</span>
                        <input name="rent" value={editingPlace.rent} onChange={(event) => setEditingPlace({ ...editingPlace, rent: event.target.value })} />
                      </label>
                      <label className="field">
                        <span>Beds</span>
                        <input name="beds" value={editingPlace.beds} onChange={(event) => setEditingPlace({ ...editingPlace, beds: event.target.value })} />
                      </label>
                    </div>
                    <label className="field">
                      <span>Notes</span>
                      <textarea name="notes" value={editingPlace.notes} onChange={(event) => setEditingPlace({ ...editingPlace, notes: event.target.value })} rows="3" />
                    </label>
                    <div className="button-row">
                      <button type="submit">Save place</button>
                      <button className="ghost" type="button" onClick={cancelEditingListing}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <header>
                      <button className="listing-title-button" type="button" onClick={() => selectListing(listing)}>
                        <span className="color-dot" style={{ "--work-color": listing.color }} />
                        <span>
                          <h3>{listing.name}</h3>
                          <p className="muted">{listing.meta || listing.address}</p>
                        </span>
                      </button>
                      <div className="button-row">
                        <button className="ghost" type="button" onClick={() => startEditingListing(listing)}>
                          Edit
                        </button>
                        <button className="delete-button" type="button" onClick={() => deleteListing(listing.id)} aria-label={`Delete ${listing.name}`}>
                          x
                        </button>
                      </div>
                    </header>
                    <p className="address-line">{listing.place?.address || listing.address}</p>
                    <div className="drive-chip-row">
                      {["a", "b"].map((key) => (
                        <DriveChip
                          key={key}
                          label={saved.workplaces[key].label}
                          color={WORKPLACE_COLORS[key]}
                          value={listing.latestSnapshots[key]?.duration_text || listing.commutes?.[key]?.label || "Set workplace"}
                          trend={listing.trends[key]}
                        />
                      ))}
                    </div>
                    <ListingMiniHistory listing={listing} />
                    {listing.notes && <p className="notes-line">{listing.notes}</p>}
                  </>
                )}
              </article>
            ))}
          </div>
        </section>

        {selectedListing && (
          <section className="panel">
            <div className="section-heading">
              <h2>{selectedListing.name} route history</h2>
              <span className="small-pill">{Object.values(selectedListing.history).flat().length} captures</span>
            </div>
            <RouteHistory listing={selectedListing} />
          </section>
        )}

        <section className="panel">
          <h2>All drives by time of day</h2>
          <AllDayDriveView routes={allDayRoutes} />
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

function DriveChip({ label, color, value, trend }) {
  return (
    <div className="drive-chip" style={{ "--work-color": color, "--trend-color": trend.color }}>
      <span className="drive-icon" aria-hidden="true">
        DR
      </span>
      <span>
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
      <em>{trend.label}</em>
    </div>
  );
}

function ListingMiniHistory({ listing }) {
  const workplaceKeys = Object.keys(listing.history);
  if (!workplaceKeys.length) {
    return null;
  }

  return (
    <div className="mini-history">
      {workplaceKeys.map((key) => {
        const points = listing.history[key].slice(-24);
        const maxSeconds = Math.max(...points.map((point) => point.duration_seconds || 0), 1);
        return (
          <div className="mini-history-row" key={key}>
            <span style={{ "--work-color": WORKPLACE_COLORS[key] || "#1769e0" }}>{key.toUpperCase()}</span>
            <div>
              {points.map((point) => (
                <i
                  key={point.id || `${point.captured_at}-${point.workplace_key}`}
                  title={`${formatTimestamp(point.captured_at)}: ${formatDuration(point.duration_seconds)}`}
                  style={{
                    height: `${Math.max(18, ((point.duration_seconds || 0) / maxSeconds) * 100)}%`,
                    backgroundColor: getRouteColor(point.duration_seconds),
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RouteHistory({ listing }) {
  const workplaceKeys = Object.keys(listing.history);

  if (!workplaceKeys.length) {
    return <p className="muted">No route captures yet. Use Capture latest to start the time series.</p>;
  }

  return (
    <div className="history-stack">
      {workplaceKeys.map((key) => {
        const points = listing.history[key];
        const latest = points.at(-1);
        const maxSeconds = Math.max(...points.map((point) => point.duration_seconds || 0), 1);
        const trend = getRouteTrend(latest, points);

        return (
          <section className="history-group" key={key}>
            <div className="section-heading">
              <h3>{latest.workplace_label}</h3>
              <span className="route-pill" style={{ backgroundColor: trend.color }}>
                {formatDuration(latest.duration_seconds)} {trend.label}
              </span>
            </div>
            <div className="spark-bars" aria-label={`${latest.workplace_label} commute time history`}>
              {points.map((point) => (
                <span
                  key={point.id || `${point.captured_at}-${point.workplace_key}`}
                  title={`${formatTimestamp(point.captured_at)}: ${formatDuration(point.duration_seconds)}`}
                  style={{
                    height: `${Math.max(12, ((point.duration_seconds || 0) / maxSeconds) * 100)}%`,
                    backgroundColor: getRouteColor(point.duration_seconds),
                  }}
                />
              ))}
            </div>
            <p className="muted">
              {points.length} captures. Latest at {formatTimestamp(latest.captured_at)}.
            </p>
          </section>
        );
      })}
    </div>
  );
}

function AllDayDriveView({ routes }) {
  if (!routes.length) {
    return <p className="muted">No captured drives yet. Capture latest drive times now and let the history run to see rush-hour patterns.</p>;
  }

  const maxSeconds = Math.max(...routes.map((route) => route.averageSeconds || 0), 1);

  return (
    <div className="all-day-chart">
      {routes.map((route) => (
        <div className="time-row" key={`${route.hour}-${route.workplaceKey}`}>
          <span>{route.hourLabel}</span>
          <div className="time-bar-track">
            <span
              style={{
                width: `${Math.max(5, (route.averageSeconds / maxSeconds) * 100)}%`,
                backgroundColor: WORKPLACE_COLORS[route.workplaceKey] || getRouteColor(route.averageSeconds),
              }}
            />
          </div>
          <strong>{formatDuration(route.averageSeconds)}</strong>
        </div>
      ))}
    </div>
  );
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

function drawLatestRouteLines(snapshots, selectedListingId, map) {
  if (!map || !window.google?.maps) {
    return [];
  }

  const latest = new Map();
  snapshots
    .filter((snapshot) => snapshot.direction === "from_facility" && snapshot.overview_polyline)
    .forEach((snapshot) => {
      const key = `${snapshot.listing_id}:${snapshot.workplace_key}`;
      const current = latest.get(key);
      if (!current || new Date(snapshot.captured_at) > new Date(current.captured_at)) {
        latest.set(key, snapshot);
      }
    });

  return Array.from(latest.values()).map((snapshot) => {
    const isSelected = snapshot.listing_id === selectedListingId;
    const trend = getRouteTrend(snapshot, snapshots);
    return new window.google.maps.Polyline({
      map,
      path: decodePolyline(snapshot.overview_polyline),
      strokeColor: trend.color,
      strokeOpacity: isSelected ? 0.95 : 0.45,
      strokeWeight: isSelected ? 6 : 3,
      zIndex: isSelected ? 3 : 1,
    });
  });
}

function createWorkplaceMarkerIcon(color) {
  if (!window.google?.maps) {
    return undefined;
  }
  return {
    path: window.google.maps.SymbolPath.CIRCLE,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 3,
    scale: 14,
  };
}

function createListingMarkerIcon(color, selected) {
  if (!window.google?.maps) {
    return undefined;
  }
  return {
    path: window.google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: selected ? "#111827" : "#ffffff",
    strokeWeight: selected ? 4 : 2,
    scale: selected ? 7 : 5,
  };
}

function getLatestListingSnapshots(snapshots, listingId) {
  const latest = {};
  snapshots
    .filter((snapshot) => snapshot.listing_id === listingId && snapshot.direction === "from_facility")
    .forEach((snapshot) => {
      const current = latest[snapshot.workplace_key];
      if (!current || new Date(snapshot.captured_at) > new Date(current.captured_at)) {
        latest[snapshot.workplace_key] = snapshot;
      }
    });
  return latest;
}

function getListingHistory(snapshots, listingId) {
  const history = {};
  snapshots
    .filter((snapshot) => snapshot.listing_id === listingId && snapshot.direction === "from_facility")
    .sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at))
    .forEach((snapshot) => {
      if (!history[snapshot.workplace_key]) {
        history[snapshot.workplace_key] = [];
      }
      history[snapshot.workplace_key].push(snapshot);
    });
  return history;
}

function getListingColor(index) {
  return LISTING_COLORS[index % LISTING_COLORS.length];
}

function getRouteTrend(snapshot, snapshots) {
  if (!snapshot?.duration_seconds) {
    return { label: "no data", color: "#6b7280", normalSeconds: null };
  }

  const peerDurations = snapshots
    .filter(
      (item) =>
        item !== snapshot &&
        item.listing_id === snapshot.listing_id &&
        item.workplace_key === snapshot.workplace_key &&
        item.direction === snapshot.direction &&
        item.duration_seconds &&
        (!item.id || !snapshot.id || item.id !== snapshot.id),
    )
    .map((item) => item.duration_seconds);

  if (!peerDurations.length) {
    return { label: "new", color: getRouteColor(snapshot.duration_seconds), normalSeconds: snapshot.duration_seconds };
  }

  const normalSeconds = peerDurations.reduce((sum, seconds) => sum + seconds, 0) / peerDurations.length;
  const delta = (snapshot.duration_seconds - normalSeconds) / normalSeconds;
  if (delta > TREND_TOLERANCE) {
    return { label: "up", color: "#b42318", normalSeconds };
  }
  if (delta < -TREND_TOLERANCE) {
    return { label: "down", color: "#168a5a", normalSeconds };
  }
  return { label: "normal", color: "#1769e0", normalSeconds };
}

function getLatestCaptureTime(snapshots) {
  return snapshots.reduce((latest, snapshot) => {
    if (!snapshot.captured_at) {
      return latest;
    }
    if (!latest || new Date(snapshot.captured_at) > new Date(latest)) {
      return snapshot.captured_at;
    }
    return latest;
  }, null);
}

function buildAllDayRoutes(snapshots) {
  const groups = new Map();
  snapshots
    .filter((snapshot) => snapshot.direction === "from_facility" && snapshot.duration_seconds && snapshot.captured_at)
    .forEach((snapshot) => {
      const date = new Date(snapshot.captured_at);
      const hour = date.getHours();
      const key = `${hour}:${snapshot.workplace_key}`;
      const current = groups.get(key) || {
        hour,
        hourLabel: formatHour(hour),
        workplaceKey: snapshot.workplace_key,
        totalSeconds: 0,
        count: 0,
      };
      current.totalSeconds += snapshot.duration_seconds;
      current.count += 1;
      groups.set(key, current);
    });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      averageSeconds: group.totalSeconds / group.count,
    }))
    .sort((a, b) => a.hour - b.hour || a.workplaceKey.localeCompare(b.workplaceKey));
}

function getRouteColor(seconds) {
  if (!seconds) {
    return "#6b7280";
  }
  const minutes = seconds / 60;
  if (minutes <= 20) {
    return "#168a5a";
  }
  if (minutes <= 30) {
    return "#1769e0";
  }
  if (minutes <= 45) {
    return "#d97706";
  }
  return "#b42318";
}

function formatDuration(seconds) {
  if (!seconds) {
    return "Unavailable";
  }
  return `${Math.round(seconds / 60)} min`;
}

function formatHour(hour) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(date);
}

function formatTimestamp(value) {
  if (!value) {
    return "never";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function decodePolyline(encoded) {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const path = [];

  while (index < encoded.length) {
    const latResult = decodePolylineChunk(encoded, index);
    index = latResult.index;
    lat += latResult.value;

    const lngResult = decodePolylineChunk(encoded, index);
    index = lngResult.index;
    lng += lngResult.value;

    path.push({ lat: lat / 100000, lng: lng / 100000 });
  }

  return path;
}

function decodePolylineChunk(encoded, startIndex) {
  let result = 0;
  let shift = 0;
  let index = startIndex;
  let byte = null;

  do {
    byte = encoded.charCodeAt(index) - 63;
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);

  return {
    index,
    value: result & 1 ? ~(result >> 1) : result >> 1,
  };
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
