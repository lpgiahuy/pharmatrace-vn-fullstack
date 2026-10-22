"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import type * as L from "leaflet";
import {
  MapPin,
  Search,
  Crosshair,
  X,
  Check,
  Loader2,
  Navigation,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import "leaflet/dist/leaflet.css";
import {
  formatTwoTierVietnameseAddress,
  resolveFallbackAddressSelection,
} from "@/utils/map-address-selection";

export interface SelectedLocationResult {
  latitude: number;
  longitude: number;
  mapAddress: string;
  specificDetail: string;
  note?: string;
  fullAddress: string;
  placeId?: string;
}

interface MapAddressPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (result: SelectedLocationResult) => void;
  initialAddress?: string;
  initialNote?: string;
  initialCoords?: { latitude: number; longitude: number };
}

interface SearchResultItem {
  placeId?: string;
  primary: string;
  secondary: string;
  fullAddress: string;
  coordinates: [number, number]; // [lng, lat]
  houseNumber?: string;
}

interface PhotonFeature {
  geometry: {
    coordinates: [number, number];
  };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    locality?: string;
    district?: string;
    city?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    type?: string;
    osm_key?: string;
  };
}

const DEFAULT_LAT = 10.7769; // TP.HCM center (Quận 1)
const DEFAULT_LNG = 106.7009;

// Formatter for Photon properties
function formatPhotonItem(f: PhotonFeature): SearchResultItem {
  const p = f.properties || {};
  const [lon, lat] = f.geometry.coordinates;

  let primary = p.name || "";
  if (!primary && p.street) {
    primary = p.housenumber ? `${p.housenumber} ${p.street}` : p.street;
  } else if (
    p.housenumber &&
    p.street &&
    (primary === p.street || primary === "")
  ) {
    primary = `${p.housenumber} ${p.street}`;
  }
  if (!primary) {
    primary = p.locality || p.district || p.city || "Selected Location";
  }

  const rawParts: string[] = [primary];
  if (p.locality && p.locality !== primary) rawParts.push(p.locality);
  if (p.district && p.district !== primary) rawParts.push(p.district);
  if (p.city && p.city !== primary) rawParts.push(p.city);
  else if (p.state && p.state !== primary && p.state !== p.city)
    rawParts.push(p.state);

  const rawAddress = rawParts.filter(Boolean).join(", ");
  const fullAddress = formatTwoTierVietnameseAddress(rawAddress, primary);

  const secondary = fullAddress.startsWith(primary)
    ? fullAddress.slice(primary.length).replace(/^,\s*/, "")
    : fullAddress;

  return {
    primary,
    secondary,
    fullAddress,
    coordinates: [lon, lat],
    houseNumber: p.housenumber,
  };
}

function normalizeAddressForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi-VN")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractAddressNumber(address: string): string | null {
  const firstPart = address.split(",", 1)[0]?.trim() ?? "";
  return (
    firstPart.match(
      /^(?:(?:số|hẻm|ngõ|ngách|kiệt)\s*)?(\d+[\p{L}\d./-]*)/iu,
    )?.[1] ?? null
  );
}

function extractRequestedPlace(address: string): string | null {
  const firstPart = address.split(",", 1)[0]?.trim() ?? "";
  const withoutNumber = firstPart.replace(
    /^(?:(?:số|hẻm|ngõ|ngách|kiệt)\s*)?\d+[\p{L}\d./-]*\s+/iu,
    "",
  );
  const place = withoutNumber.replace(/^đường\s+/iu, "").trim();
  return place ? normalizeAddressForSearch(place) : null;
}

function photonFeatureMatchesQuery(
  query: string,
  feature: PhotonFeature,
): boolean {
  const requestedPlace = extractRequestedPlace(query);
  if (!requestedPlace) return true;

  const properties = feature.properties || {};
  const resultText = [
    properties.name,
    properties.street,
    properties.locality,
    properties.district,
    properties.city,
  ]
    .filter(Boolean)
    .join(" ");

  return normalizeAddressForSearch(resultText).includes(requestedPlace);
}

function addressNumberMatchScore(query: string, resultName: string): number {
  const queryNumber = extractAddressNumber(query);
  const resultNumber = extractAddressNumber(resultName);

  if (!queryNumber || !resultNumber) return 0;

  const queryParts = queryNumber.toLocaleLowerCase("vi-VN").split(/[./-]/);
  const resultParts = resultNumber.toLocaleLowerCase("vi-VN").split(/[./-]/);
  let commonParts = 0;
  while (
    commonParts < queryParts.length &&
    commonParts < resultParts.length &&
    queryParts[commonParts] === resultParts[commonParts]
  ) {
    commonParts += 1;
  }

  return commonParts * 100 + (queryNumber === resultNumber ? 1_000 : 0);
}

// Keep the exact query first and relax only to street level. Never fabricate a
// house result from an unrelated Photon suggestion.
function generateSearchCandidates(rawQuery: string): string[] {
  const raw = rawQuery.trim().replace(/\s+/g, " ");
  const streetLevel = raw.replace(
    /^(?:(?:số|hẻm|ngõ|ngách|kiệt)\s*)?\d+[\p{L}\d./-]*\s+/iu,
    "",
  );

  return [...new Set([raw, streetLevel].filter(Boolean))];
}

// Blue location pin icon for Leaflet map (Sharp Google Maps teardrop shape with blue palette)
function createBluePinIcon(leaflet: typeof L) {
  return leaflet.divIcon({
    className: "custom-map-pin",
    html: `
      <div style="position:relative;width:38px;height:48px;display:flex;flex-direction:column;align-items:center;cursor:grab;">
        <div style="width:34px;height:34px;background:#004996;border:2.5px solid #ffffff;border-radius:50% 50% 50% 0;
                    transform:rotate(-45deg);box-shadow:0 3px 10px rgba(0,73,150,0.45),0 1px 4px rgba(0,0,0,0.25);
                    display:flex;align-items:center;justify-content:center;">
          <div style="width:11px;height:11px;background:#ffffff;border-radius:50%;transform:rotate(45deg);box-shadow:inset 0 1px 2px rgba(0,0,0,0.2);"></div>
        </div>
        <div style="width:2px;height:12px;background:#004996;margin-top:-2px;border-radius:1px;opacity:0.85;"></div>
        <div style="position:absolute;bottom:0;width:12px;height:4px;background:rgba(0,0,0,0.2);border-radius:50%;filter:blur(1px);"></div>
      </div>
    `,
    iconSize: [38, 48],
    iconAnchor: [19, 48],
  });
}

// Helper to load Google Maps JavaScript API with Places library
let googleMapsScriptPromise: Promise<boolean> | null = null;

function loadGoogleMapsScript(apiKey: string): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  const win = window as unknown as { google?: { maps?: { places?: unknown } } };

  if (win.google?.maps?.places) {
    return Promise.resolve(true);
  }

  if (googleMapsScriptPromise) {
    return googleMapsScriptPromise;
  }

  googleMapsScriptPromise = new Promise<boolean>((resolve) => {
    const existing = document.querySelector("script[data-google-maps]");
    if (existing) {
      existing.addEventListener("load", () => resolve(true));
      existing.addEventListener("error", () => resolve(false));
      return;
    }

    const script = document.createElement("script");
    script.setAttribute("data-google-maps", "true");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&libraries=places&language=vi&region=VN`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      googleMapsScriptPromise = null;
      resolve(false);
    };
    document.head.appendChild(script);
  });

  return googleMapsScriptPromise;
}

export default function MapAddressPickerModal({
  isOpen,
  onClose,
  onConfirm,
  initialAddress = "",
  initialNote = "",
  initialCoords,
}: MapAddressPickerModalProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerInstanceRef = useRef<L.Marker | null>(null);
  const leafletModuleRef = useRef<typeof L | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const reverseRequestIdRef = useRef(0);

  // Google Places Service Refs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const googleAutocompleteRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const googlePlacesServiceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const googleGeocoderRef = useRef<any>(null);

  // Location selection state: false if initialCoords was not explicitly provided
  const [hasSelectedLocation, setHasSelectedLocation] = useState(
    Boolean(initialCoords?.latitude && initialCoords?.longitude),
  );

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    initialCoords?.latitude && initialCoords?.longitude
      ? { lat: initialCoords.latitude, lng: initialCoords.longitude }
      : null,
  );

  const initialAddressMatch = initialAddress.match(/^\[(.*?)\]\s*(.*)$/);
  const parsedDetail = initialAddressMatch ? initialAddressMatch[1] : "";
  const parsedMapAddress = initialAddressMatch
    ? formatTwoTierVietnameseAddress(initialAddressMatch[2])
    : formatTwoTierVietnameseAddress(initialAddress);

  const [mapAddress, setMapAddress] = useState(
    initialCoords?.latitude && initialCoords?.longitude ? parsedMapAddress : "",
  );
  const [specificDetail, setSpecificDetail] = useState(parsedDetail);
  const [driverNote, setDriverNote] = useState(initialNote);
  const [lastPlaceId, setLastPlaceId] = useState<string | undefined>();

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Provider state: Derive hasGoogleApiKey directly
  const apiKey =
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    (typeof window !== "undefined"
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).VITE_GOOGLE_MAPS_API_KEY
      : "");

  const hasGoogleApiKey = Boolean(
    apiKey &&
    apiKey.trim().length > 10 &&
    !apiKey.includes("your_google_maps_api_key_here"),
  );

  const [isGoogleReady, setIsGoogleReady] = useState(false);

  // Geolocation & reverse geocoding state
  const [isLocating, setIsLocating] = useState(false);
  const [isReverseGeocoding, setIsReverseGeocoding] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mapCenterRef = useRef({
    lat: initialCoords?.latitude ?? DEFAULT_LAT,
    lng: initialCoords?.longitude ?? DEFAULT_LNG,
  });

  const updateSelectedLocationRef = useRef<
    (lat: number, lng: number, directAddress?: string, placeId?: string) => void
  >(() => {});

  // Initialize Google Maps Places API if key exists
  useEffect(() => {
    if (!isOpen || !hasGoogleApiKey) return;

    loadGoogleMapsScript(apiKey.trim()).then((loaded) => {
      if (loaded) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const win = window as any;
        if (win.google?.maps?.places) {
          googleAutocompleteRef.current =
            new win.google.maps.places.AutocompleteService();
          googlePlacesServiceRef.current =
            new win.google.maps.places.PlacesService(
              document.createElement("div"),
            );
          googleGeocoderRef.current = new win.google.maps.Geocoder();
          setIsGoogleReady(true);
        }
      }
    });
  }, [isOpen, hasGoogleApiKey, apiKey]);

  // Fallback reverse geocoding via Photon and BigDataCloud
  const fallbackReverseGeocode = useCallback(
    async (lat: number, lng: number, requestId: number) => {
      if (requestId !== reverseRequestIdRef.current) return;

      // 1. Primary: Photon Reverse Geocoding
      try {
        const photonUrl = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`;
        const res = await fetch(photonUrl, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.features && data.features.length > 0) {
            const formatted = formatPhotonItem(
              data.features[0] as PhotonFeature,
            );
            if (
              requestId === reverseRequestIdRef.current &&
              formatted.fullAddress
            ) {
              setMapAddress(formatted.fullAddress);
              return;
            }
          }
        }
      } catch {
        // Fallback to secondary provider below
      }

      if (requestId !== reverseRequestIdRef.current) return;

      // 2. Secondary fallback: BigDataCloud client-side reverse geocode
      try {
        const bdcUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=vi`;
        const resBdc = await fetch(bdcUrl, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(5000),
        });
        if (resBdc.ok) {
          const bdc = await resBdc.json();
          const parts: string[] = [];
          if (bdc.locality) parts.push(bdc.locality);
          if (bdc.city) parts.push(bdc.city);
          else if (bdc.principalSubdivision)
            parts.push(bdc.principalSubdivision);

          if (requestId === reverseRequestIdRef.current && parts.length > 0) {
            setMapAddress(formatTwoTierVietnameseAddress(parts.join(", ")));
            return;
          }
        }
      } catch {
        // Fallback to coordinates representation
      }

      if (requestId === reverseRequestIdRef.current) {
        setMapAddress(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
      }
    },
    [],
  );

  // Unified reverse geocoding (Google Geocoder with Photon fallback)
  const reverseGeocode = useCallback(
    async (lat: number, lng: number) => {
      const requestId = ++reverseRequestIdRef.current;
      setIsReverseGeocoding(true);
      try {
        if (googleGeocoderRef.current) {
          googleGeocoderRef.current.geocode(
            { location: { lat, lng } },
            (
              results: Array<{
                formatted_address?: string;
                place_id?: string;
              }> | null,
              status: string,
            ) => {
              if (
                requestId === reverseRequestIdRef.current &&
                status === "OK" &&
                results &&
                results[0]
              ) {
                const clean = formatTwoTierVietnameseAddress(
                  results[0].formatted_address || "",
                );
                setMapAddress(clean);
                if (results[0].place_id) {
                  setLastPlaceId(results[0].place_id);
                }
                setIsReverseGeocoding(false);
              } else if (requestId === reverseRequestIdRef.current) {
                fallbackReverseGeocode(lat, lng, requestId).finally(() => {
                  if (requestId === reverseRequestIdRef.current) {
                    setIsReverseGeocoding(false);
                  }
                });
              }
            },
          );
        } else {
          await fallbackReverseGeocode(lat, lng, requestId);
          if (requestId === reverseRequestIdRef.current) {
            setIsReverseGeocoding(false);
          }
        }
      } catch {
        await fallbackReverseGeocode(lat, lng, requestId);
        if (requestId === reverseRequestIdRef.current) {
          setIsReverseGeocoding(false);
        }
      }
    },
    [fallbackReverseGeocode],
  );

  // Helper to place or move the blue marker on the map
  const setOrUpdateMarker = useCallback((lat: number, lng: number) => {
    const leaflet = leafletModuleRef.current;
    const map = mapInstanceRef.current;
    if (!leaflet || !map) return;

    if (!markerInstanceRef.current) {
      const pinIcon = createBluePinIcon(leaflet);
      const marker = leaflet
        .marker([lat, lng], {
          draggable: true,
          icon: pinIcon,
          autoPan: true,
        })
        .addTo(map);

      marker.on("dragend", (e: L.LeafletEvent) => {
        const targetMarker = e.target as L.Marker;
        const p = targetMarker.getLatLng();
        updateSelectedLocationRef.current(p.lat, p.lng);
      });

      markerInstanceRef.current = marker;
    } else {
      markerInstanceRef.current.setLatLng([lat, lng]);
    }
  }, []);

  // Update selected location from any source (click, drag, search, gps)
  const updateSelectedLocation = useCallback(
    (lat: number, lng: number, directAddress?: string, placeId?: string) => {
      setCoords({ lat, lng });
      setHasSelectedLocation(true);
      mapCenterRef.current = { lat, lng };
      if (placeId) setLastPlaceId(placeId);

      setOrUpdateMarker(lat, lng);

      if (directAddress) {
        reverseRequestIdRef.current += 1;
        setIsReverseGeocoding(false);
        setMapAddress(formatTwoTierVietnameseAddress(directAddress));
      } else {
        reverseGeocode(lat, lng);
      }
    },
    [reverseGeocode, setOrUpdateMarker],
  );

  useEffect(() => {
    updateSelectedLocationRef.current = updateSelectedLocation;
  }, [updateSelectedLocation]);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!isOpen || !mapContainerRef.current) return;
    let alive = true;

    (async () => {
      const LeafletModule = await import("leaflet");
      const leaflet = LeafletModule.default;
      if (!alive || !mapContainerRef.current) return;

      leafletModuleRef.current = leaflet;

      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
        return;
      }

      // Create map: default center without selecting any location if initialCoords is omitted
      const initialCenterLat = initialCoords?.latitude ?? DEFAULT_LAT;
      const initialCenterLng = initialCoords?.longitude ?? DEFAULT_LNG;
      const initialZoom =
        initialCoords?.latitude && initialCoords?.longitude ? 16 : 13;

      const map = leaflet.map(mapContainerRef.current, {
        center: [initialCenterLat, initialCenterLng],
        zoom: initialZoom,
        zoomControl: false,
        attributionControl: true,
      });

      // Google Maps standard roadmap tiles (Clean, road network, Vietnamese labels, NO Carto watermark)
      leaflet
        .tileLayer("https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=vi", {
          subdomains: ["mt0", "mt1", "mt2", "mt3"],
          maxZoom: 20,
          attribution: "&copy; Google Maps",
        })
        .addTo(map);

      // Add zoom control to bottom right
      leaflet.control.zoom({ position: "bottomright" }).addTo(map);

      // Only create marker if initialCoords was explicitly provided
      if (initialCoords?.latitude && initialCoords?.longitude) {
        const pinIcon = createBluePinIcon(leaflet);
        const marker = leaflet
          .marker([initialCoords.latitude, initialCoords.longitude], {
            draggable: true,
            icon: pinIcon,
            autoPan: true,
          })
          .addTo(map);

        marker.on("dragend", (e: L.LeafletEvent) => {
          const targetMarker = e.target as L.Marker;
          const p = targetMarker.getLatLng();
          updateSelectedLocationRef.current(p.lat, p.lng);
        });

        markerInstanceRef.current = marker;

        if (!initialAddress) {
          reverseGeocode(initialCoords.latitude, initialCoords.longitude);
        }
      }

      // Map click event: click anywhere to place / move the pin
      map.on("click", (e: L.LeafletMouseEvent) => {
        updateSelectedLocationRef.current(e.latlng.lat, e.latlng.lng);
      });

      // Track viewport center for search bias
      map.on("moveend", () => {
        const center = map.getCenter();
        mapCenterRef.current = { lat: center.lat, lng: center.lng };
      });

      mapInstanceRef.current = map;

      // Invalidate size to guarantee perfect rendering
      setTimeout(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize();
        }
      }, 200);
    })();

    return () => {
      alive = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerInstanceRef.current = null;
        leafletModuleRef.current = null;
      }
    };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle outside click to close search dropdown
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  // Handle search input changes
  const handleQueryChange = (val: string) => {
    setSearchQuery(val);
    if (val.trim().length < 2) {
      setSearchResults([]);
      setHasSearched(false);
      setSearchError(null);
      setIsDropdownOpen(false);
    }
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setSearchResults([]);
    setHasSearched(false);
    setSearchError(null);
    setIsDropdownOpen(false);
    searchInputRef.current?.focus();
  };

  // Debounced search with Google Places Autocomplete (with fallback to Photon)
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      return;
    }

    // Cancel previous in-flight fallback search if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const timer = setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      setHasSearched(true);

      // ── Option A: Google Places Autocomplete ──
      if (
        isGoogleReady &&
        googleAutocompleteRef.current
      ) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const win = window as any;
          googleAutocompleteRef.current.getPlacePredictions(
            {
              input: q,
              componentRestrictions: { country: "vn" },
              locationBias: mapCenterRef.current
                ? new win.google.maps.Circle({
                    center: mapCenterRef.current,
                    radius: 25000,
                  })
                : undefined,
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (predictions: any[], status: string) => {
              if (
                status === win.google?.maps?.places?.PlacesServiceStatus?.OK &&
                predictions &&
                predictions.length > 0
              ) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const items: SearchResultItem[] = predictions.map((p: any) => ({
                  placeId: p.place_id,
                  primary: p.structured_formatting?.main_text || p.description,
                  secondary: p.structured_formatting?.secondary_text || "",
                  fullAddress: p.description,
                  coordinates: [0, 0],
                }));
                setSearchResults(items);
                setIsDropdownOpen(true);
              } else {
                setSearchResults([]);
              }
              setIsSearching(false);
            },
          );
          return;
        } catch {
          // Fallback to Photon below
        }
      }

      // ── Option B: Fallback Photon Search with Smart Vietnam Ranking ──
      try {
        const center = mapCenterRef.current;
        const candidates = generateSearchCandidates(q);
        const itemsMap = new Map<string, SearchResultItem>();
        const seenCoords = new Set<string>();
        const shouldUseLocationBias = !extractAddressNumber(q);

        for (const candidate of candidates) {
          if (controller.signal.aborted) break;

          try {
            const locationBias = shouldUseLocationBias
              ? `&lat=${center.lat}&lon=${center.lng}`
              : "";
            const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(
              candidate,
            )}&limit=7&countrycode=VN${locationBias}`;

            const res = await fetch(url, {
              headers: { Accept: "application/json" },
              signal: controller.signal,
            });

            if (!res.ok) continue;
            const data = await res.json();

            for (const f of (data.features as PhotonFeature[]) || []) {
              const cc = f.properties?.countrycode;
              if (cc && cc.toUpperCase() !== "VN") continue;
              if (!photonFeatureMatchesQuery(q, f)) continue;

              const [lon, lat] = f.geometry.coordinates;
              const coordKey = `${lon.toFixed(4)},${lat.toFixed(4)}`;
              if (seenCoords.has(coordKey)) continue;

              const item = formatPhotonItem(f);
              const primaryKey = item.primary.toLowerCase().trim();

              if (!itemsMap.has(primaryKey)) {
                itemsMap.set(primaryKey, item);
                seenCoords.add(coordKey);
              } else {
                // If existing doesn't have Phường but new does, replace with more detailed item
                const existing = itemsMap.get(primaryKey)!;
                if (
                  !existing.secondary.includes("Phường") &&
                  item.secondary.includes("Phường")
                ) {
                  itemsMap.set(primaryKey, item);
                  seenCoords.add(coordKey);
                }
              }
            }

            if (itemsMap.size >= 8) break;
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError")
              return;
          }
        }

        const list = Array.from(itemsMap.values());
        list.sort(
          (a, b) =>
            addressNumberMatchScore(q, b.primary) -
            addressNumberMatchScore(q, a.primary),
        );

        const finalResults = list.slice(0, 5);

        if (!controller.signal.aborted) {
          setSearchResults(finalResults);
          setIsDropdownOpen(true);
        }
      } catch (err: unknown) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setSearchError("Unable to search address. Please try again.");
          setIsDropdownOpen(true);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 320);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, isGoogleReady]);

  // Handle selecting an autocomplete result
  const handleSelectResult = (item: SearchResultItem) => {
    // ── If Google Places prediction ──
    if (item.placeId && googlePlacesServiceRef.current) {
      setIsSearching(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      googlePlacesServiceRef.current.getDetails(
        {
          placeId: item.placeId,
          fields: [
            "geometry",
            "formatted_address",
            "name",
            "address_components",
          ],
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (place: any, status: string) => {
          setIsSearching(false);
          if (
            status === win.google?.maps?.places?.PlacesServiceStatus?.OK &&
            place?.geometry?.location
          ) {
            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();
            const resolvedAddress = place.formatted_address || item.fullAddress;

            if (mapInstanceRef.current) {
              mapInstanceRef.current.flyTo([lat, lng], 17, {
                animate: true,
                duration: 0.8,
              });
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const streetNum = place.address_components?.find((c: any) =>
              c.types?.includes("street_number"),
            )?.long_name;
            const selection = resolveFallbackAddressSelection({
              searchQuery,
              resultAddress: resolvedAddress,
              resultHouseNumber: streetNum,
              currentSpecificDetail: specificDetail,
            });
            updateSelectedLocation(
              lat,
              lng,
              selection.mapAddress,
              item.placeId,
            );
            setSpecificDetail(selection.specificDetail);

            setIsDropdownOpen(false);
            setSearchQuery(item.primary);
            searchInputRef.current?.blur();
          }
        },
      );
      return;
    }

    // ── Fallback provider selection ──
    const [lon, lat] = item.coordinates;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([lat, lon], 17, {
        animate: true,
        duration: 0.8,
      });
    }

    const selection = resolveFallbackAddressSelection({
      searchQuery,
      resultAddress: item.fullAddress,
      resultHouseNumber: item.houseNumber,
      currentSpecificDetail: specificDetail,
    });
    updateSelectedLocation(lat, lon, selection.mapAddress);
    setSpecificDetail(selection.specificDetail);

    setIsDropdownOpen(false);
    setSearchQuery(item.primary);
    searchInputRef.current?.blur();
  };

  // Keyboard navigation inside search input
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setIsDropdownOpen(false);
      searchInputRef.current?.blur();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (searchResults.length > 0) {
        handleSelectResult(searchResults[0]);
      }
    }
  };

  // GPS / My Location button
  const handleGetGPS = () => {
    if (!navigator.geolocation) {
      setGeoError("Geolocation is not supported by your browser.");
      return;
    }

    setIsLocating(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      ({ coords: c }) => {
        setIsLocating(false);
        const { latitude: lat, longitude: lng } = c;

        if (mapInstanceRef.current) {
          mapInstanceRef.current.flyTo([lat, lng], 17, {
            animate: true,
            duration: 0.8,
          });
        }

        updateSelectedLocation(lat, lng);
      },
      () => {
        setIsLocating(false);
        setGeoError(
          "Unable to retrieve current location. Please allow location permissions or select on map.",
        );
        setTimeout(() => setGeoError(null), 5000);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  // Confirm button
  const handleConfirm = () => {
    if (!hasSelectedLocation || !coords) return;

    const detail = specificDetail.trim();
    const cleanAddress = formatTwoTierVietnameseAddress(mapAddress.trim());

    let fullAddress = "";
    if (detail && cleanAddress) {
      const cleanAddressWithoutDetail = cleanAddress.replace(/^\[.*?\]\s*/, "");
      const formattedDetail =
        detail.startsWith("[") && detail.endsWith("]") ? detail : `[${detail}]`;
      fullAddress = `${formattedDetail} ${cleanAddressWithoutDetail}`;
    } else if (detail) {
      fullAddress =
        detail.startsWith("[") && detail.endsWith("]") ? detail : `[${detail}]`;
    } else {
      fullAddress = cleanAddress;
    }

    onConfirm({
      latitude: coords.lat,
      longitude: coords.lng,
      mapAddress: cleanAddress,
      specificDetail: specificDetail.trim(),
      note: driverNote.trim(),
      fullAddress,
      placeId: lastPlaceId,
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px] p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full sm:max-w-2xl rounded-[6px] shadow-2xl flex flex-col overflow-hidden max-h-[96vh] sm:max-h-[90vh] border border-gray-200 animate-in fade-in zoom-in-95 duration-150">
        {/* ── Header ── */}
        <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[6px] bg-blue-50 flex items-center justify-center shrink-0">
              <MapPin className="w-5 h-5 text-[#004996]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-gray-900 text-sm leading-tight">
                  Select Address on Map
                </p>
                {isGoogleReady && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-[4px] border border-emerald-200">
                    <Sparkles className="w-2.5 h-2.5" /> Google Places
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-400 leading-tight mt-0.5">
                Drag pin or click on map to select location
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-[6px] flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* ── Map + Floating Search ── */}
        <div className="relative flex-1 min-h-[300px] sm:min-h-[360px] bg-slate-100 overflow-hidden">
          {/* Floating Search Bar */}
          <div
            ref={searchContainerRef}
            className="absolute top-3 left-3 right-16 z-[1000]"
          >
            <div
              className={`flex items-center bg-white rounded-[6px] shadow-lg border transition-all ${
                isDropdownOpen && searchResults.length > 0
                  ? "border-[#004996] ring-2 ring-[#004996]/20"
                  : "border-gray-200"
              }`}
            >
              <Search className="w-4 h-4 text-gray-400 shrink-0 ml-3.5" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onFocus={() => {
                  if (searchResults.length > 0 || hasSearched) {
                    setIsDropdownOpen(true);
                  }
                }}
                onChange={(e) => handleQueryChange(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search street, alley, or place in Vietnam..."
                className="flex-1 py-2.5 pl-2.5 pr-2 text-sm outline-none bg-transparent text-gray-800 placeholder-gray-400 min-w-0"
              />

              {isSearching ? (
                <Loader2 className="w-4 h-4 text-[#004996] animate-spin shrink-0 mr-3" />
              ) : searchQuery ? (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="mr-2.5 text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : null}
            </div>

            {/* Dropdown Suggestions */}
            {isDropdownOpen && (
              <div className="mt-1 bg-white rounded-[6px] shadow-2xl border border-gray-100 overflow-hidden max-h-64 overflow-y-auto divide-y divide-gray-50">
                {searchResults.length > 0 ? (
                  searchResults.map((item, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectResult(item)}
                      className="w-full px-3.5 py-2.5 text-left hover:bg-slate-50 flex items-start gap-3 transition-colors group cursor-pointer"
                    >
                      <div className="mt-0.5 w-7 h-7 rounded-[6px] bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center shrink-0 transition-colors">
                        <MapPin className="w-3.5 h-3.5 text-[#004996]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {item.primary}
                        </p>
                        {item.secondary && (
                          <p className="text-xs text-gray-400 truncate mt-0.5">
                            {item.secondary}
                          </p>
                        )}
                      </div>
                    </button>
                  ))
                ) : searchError ? (
                  <div className="px-4 py-3 text-sm text-rose-600 flex items-center gap-2 bg-rose-50/50">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{searchError}</span>
                  </div>
                ) : hasSearched && !isSearching ? (
                  <div className="px-4 py-3 text-sm text-gray-500 text-center">
                    No matching address found
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Floating GPS Button */}
          <button
            type="button"
            onClick={handleGetGPS}
            disabled={isLocating}
            title="Use current location"
            className="absolute top-3 right-3 z-[1000] w-10 h-10 rounded-[6px] bg-white shadow-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:text-[#004996] hover:border-[#004996] transition-all disabled:opacity-50 cursor-pointer"
          >
            {isLocating ? (
              <Loader2 className="w-5 h-5 animate-spin text-[#004996]" />
            ) : (
              <Crosshair className="w-5 h-5" />
            )}
          </button>

          {/* GPS error toast banner */}
          {geoError && (
            <div className="absolute bottom-3 left-3 right-3 z-[1000] bg-rose-50 border border-rose-200 text-rose-700 text-xs px-3 py-2 rounded-[6px] shadow-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{geoError}</span>
            </div>
          )}

          {/* Informational banner when Google API key is not yet configured */}
          {!hasGoogleApiKey && !isGoogleReady && (
            <div className="hidden sm:flex absolute bottom-3 left-3 z-[900] bg-white/90 backdrop-blur-xs border border-gray-200/80 text-gray-500 text-[11px] px-2.5 py-1.5 rounded-[6px] shadow-sm items-center gap-1.5 pointer-events-none">
              <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>
                Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to .env.local to enable
                Google Places
              </span>
            </div>
          )}

          {/* Leaflet map container */}
          <div ref={mapContainerRef} className="absolute inset-0 z-0" />
        </div>

        {/* ── Address Form Footer ── */}
        <div className="bg-white border-t border-gray-100 px-4 py-3.5 space-y-3">
          {/* Detected Address Display */}
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-[6px] bg-gray-50 border border-gray-200">
            <Navigation className="w-4 h-4 text-[#004996] shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">
                Location on Map
              </p>
              {!hasSelectedLocation || !coords ? (
                <p className="text-sm text-gray-500 leading-snug">
                  No location selected yet. Click on the map or search above to
                  choose your delivery address.
                </p>
              ) : isReverseGeocoding ? (
                <span className="text-sm text-gray-400 flex items-center gap-1.5 py-0.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Detecting
                  address...
                </span>
              ) : (
                <p className="text-sm font-medium text-gray-900 leading-snug break-words">
                  {mapAddress || "—"}
                </p>
              )}
              <p className="text-[11px] text-gray-400 font-mono mt-0.5">
                {hasSelectedLocation && coords
                  ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`
                  : "—, —"}
              </p>
            </div>
          </div>

          {/* Detail Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">
                House / Building / Alley details{" "}
                <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={specificDetail}
                onChange={(e) => setSpecificDetail(e.target.value)}
                placeholder="e.g. 38/14/14 or Apt 402, Building A"
                className="w-full px-3 py-2 text-sm rounded-[6px] border border-gray-200 focus:border-[#004996] focus:ring-2 focus:ring-[#004996]/20 outline-none transition-all placeholder-gray-300"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Alley depth, room number, floor level
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">
                Note for driver{" "}
                <span className="text-gray-400 font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                value={driverNote}
                onChange={(e) => setDriverNote(e.target.value)}
                placeholder="e.g. Call 10 mins before arrival, green gate on right"
                className="w-full px-3 py-2 text-sm rounded-[6px] border border-gray-200 focus:border-[#004996] focus:ring-2 focus:ring-[#004996]/20 outline-none transition-all placeholder-gray-300"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Helps courier find your address faster
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-0.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-[6px] hover:bg-gray-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!hasSelectedLocation || !coords}
              className="px-5 py-2 text-sm font-semibold text-white bg-[#004996] hover:bg-[#003772] disabled:opacity-40 disabled:cursor-not-allowed rounded-[6px] shadow-sm transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              Confirm Location
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
