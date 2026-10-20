// Geocoding helper backed by OpenStreetMap providers.
// Photon is the primary provider; Nominatim is a rate-limited fallback.
import { Logger } from "@nestjs/common";
import { GeoCoordinates } from "./shipping-calculator.helper";

const logger = new Logger("GeocodingHelper");

const PHOTON_BASE_URL = "https://photon.komoot.io/api";
const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "PharmaTrace-VN/1.0";

const REQUEST_TIMEOUT_MS = 2_000;
const TOTAL_TIMEOUT_MS = 5_000;
const NOMINATIM_INTERVAL_MS = 1_000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const CACHE_MAX_ENTRIES = 500;

interface CacheEntry {
  result: GeocodeResult;
  expiresAt: number;
}

export type GeocodePrecision = "house" | "alley" | "street" | "ward" | "district" | "unknown";

export interface GeocodeResult extends GeoCoordinates {
  matchedAddress: string;
  precision: GeocodePrecision;
  provider: "photon" | "nominatim";
}

const geocodeCache = new Map<string, CacheEntry>();
const pendingGeocodes = new Map<string, Promise<GeocodeResult | null>>();

let nominatimQueue: Promise<void> = Promise.resolve();
let nextNominatimRequestAt = 0;

function normalizeAddress(address: string): string {
  return address
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("vi-VN");
}

function appendCountry(address: string): string {
  return /(?:^|[,\s])(việt nam|vietnam)(?:$|[,\s])/i.test(address)
    ? address
    : `${address}, Việt Nam`;
}

function normalizeForComparison(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi-VN")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractRequestedPlace(address: string): string | null {
  const firstPart = address.split(",", 1)[0]?.trim() ?? "";
  const withoutNumber = firstPart.replace(
    /^(?:(?:số|hẻm|ngõ|ngách|kiệt)\s*)?\d+[\p{L}\d./-]*\s+/iu,
    "",
  );
  const place = withoutNumber.replace(/^đường\s+/iu, "").trim();
  return place ? normalizeForComparison(place) : null;
}

function matchesRequestedStreet(address: string, resultText: string): boolean {
  const requestedPlace = extractRequestedPlace(address);
  return (
    !requestedPlace ||
    normalizeForComparison(resultText).includes(requestedPlace)
  );
}

export function isValidCoordinates(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function inferPrecision(name: string, type?: string, hasHouseNumber = false): GeocodePrecision {
  if (hasHouseNumber || type === "house" || type === "building") {
    return "house";
  }
  if (/^(hẻm|ngõ|ngách|kiệt)\b/iu.test(name)) {
    return "alley";
  }
  if (["street", "road", "residential"].includes(type ?? "")) {
    return "street";
  }
  if (["suburb", "quarter", "neighbourhood", "ward"].includes(type ?? "")) {
    return "ward";
  }
  if (["district", "city_district", "county"].includes(type ?? "")) {
    return "district";
  }
  return "unknown";
}

function getCached(key: string): GeocodeResult | null {
  const entry = geocodeCache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    geocodeCache.delete(key);
    return null;
  }

  // Reinsertion makes the Map insertion order act as a small LRU cache.
  geocodeCache.delete(key);
  geocodeCache.set(key, entry);
  return entry.result;
}

function setCached(key: string, result: GeocodeResult): void {
  geocodeCache.delete(key);
  geocodeCache.set(key, {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  if (geocodeCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = geocodeCache.keys().next().value as string | undefined;
    if (oldestKey) {
      geocodeCache.delete(oldestKey);
    }
  }
}

async function geocodeWithPhoton(address: string, timeoutMs: number): Promise<GeocodeResult | null> {
  const url = new URL(PHOTON_BASE_URL);
  url.searchParams.set("q", address);
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycode", "VN");

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    logger.warn(`Photon returned HTTP ${response.status}`);
    return null;
  }

  const data = await response.json();
  if (!Array.isArray(data?.features)) {
    return null;
  }

  for (const feature of data.features) {
    const properties = feature?.properties ?? {};
    const resultText = [
      properties.name,
      properties.street,
      properties.locality,
      properties.district,
      properties.city,
    ]
      .filter(Boolean)
      .join(" ");
    if (!matchesRequestedStreet(address, resultText)) {
      continue;
    }

    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      continue;
    }

    const [longitude, latitude] = coordinates;
    if (
      typeof latitude === "number" &&
      typeof longitude === "number" &&
      isValidCoordinates(latitude, longitude)
    ) {
      const matchedAddress = [
        properties.name,
        properties.district,
        properties.city,
      ]
        .filter(Boolean)
        .join(", ");
      return {
        latitude,
        longitude,
        matchedAddress,
        precision: inferPrecision(
          properties.name ?? "",
          properties.type ?? properties.osm_value,
          Boolean(properties.housenumber),
        ),
        provider: "photon",
      };
    }
  }

  return null;
}

async function waitForNominatimSlot(deadline: number): Promise<boolean> {
  let releaseQueue!: () => void;
  const previous = nominatimQueue;
  nominatimQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previous;
  const waitMs = Math.max(0, nextNominatimRequestAt - Date.now());
  if (Date.now() + waitMs >= deadline) {
    releaseQueue();
    return false;
  }

  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  nextNominatimRequestAt = Date.now() + NOMINATIM_INTERVAL_MS;
  releaseQueue();
  return true;
}

async function geocodeWithNominatim(address: string, timeoutMs: number, deadline: number): Promise<GeocodeResult | null> {
  if (!(await waitForNominatimSlot(deadline))) {
    return null;
  }

  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    return null;
  }

  const url = new URL(NOMINATIM_BASE_URL);
  url.searchParams.set("q", address);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "vn");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, remainingMs))),
  });

  if (!response.ok) {
    logger.warn(`Nominatim returned HTTP ${response.status}`);
    return null;
  }

  const results = await response.json();
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  for (const result of results) {
    if (!matchesRequestedStreet(address, result?.display_name ?? "")) {
      continue;
    }

    const rawLatitude = result?.lat;
    const rawLongitude = result?.lon;
    const latitude =
      typeof rawLatitude === "string" && rawLatitude.trim() !== ""
        ? Number(rawLatitude)
        : Number.NaN;
    const longitude =
      typeof rawLongitude === "string" && rawLongitude.trim() !== ""
        ? Number(rawLongitude)
        : Number.NaN;
    if (isValidCoordinates(latitude, longitude)) {
      const matchedAddress = result?.display_name ?? "";
      return {
        latitude,
        longitude,
        matchedAddress,
        precision: inferPrecision(
          matchedAddress.split(",", 1)[0] ?? "",
          result?.addresstype ?? result?.type,
          Boolean(result?.address?.house_number),
        ),
        provider: "nominatim",
      };
    }
  }

  return null;
}

// Generates only the two useful accuracy levels for shipping calculations:
// the full address, then the street and administrative context without the
// house/alley number. Broader ward/district centroids are deliberately omitted.
export function generateAddressSearchCandidates(raw: string): string[] {
  const fullAddress = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!fullAddress) {
    return [];
  }

  const streetAddress = fullAddress.replace(
    /^(?:(?:số|hẻm|ngõ|ngách|kiệt)\s*)?\d+[\p{L}\d./-]*\s+/iu,
    "",
  );

  return [...new Set([fullAddress, streetAddress])]
    .filter(Boolean)
    .map(appendCountry);
}

async function resolveAddress(address: string): Promise<GeocodeResult | null> {
  const candidates = generateAddressSearchCandidates(address);
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;

  for (const query of candidates) {
    for (const provider of ["photon", "nominatim"] as const) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        logger.warn("Geocoding stopped after reaching its total time limit");
        return null;
      }

      try {
        const timeoutMs = Math.max(
          1,
          Math.min(REQUEST_TIMEOUT_MS, remainingMs),
        );
        const coordinates =
          provider === "photon"
            ? await geocodeWithPhoton(query, timeoutMs)
            : await geocodeWithNominatim(query, timeoutMs, deadline);

        if (coordinates) {
          logger.debug(`Geocoding succeeded via ${provider}`);
          return coordinates;
        }
      } catch (error) {
        logger.warn(
          `${provider} geocoding failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  logger.warn("Could not resolve coordinates for the supplied address");
  return null;
}

// Resolves a Vietnamese shipping address without throwing into checkout.
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  if (typeof address !== "string" || address.trim() === "") {
    return null;
  }

  const cacheKey = normalizeAddress(address);
  const cached = getCached(cacheKey);
  if (cached) {
    logger.debug("Geocoding cache hit");
    return cached;
  }

  const pending = pendingGeocodes.get(cacheKey);
  if (pending) {
    return pending;
  }

  const request = resolveAddress(address)
    .then((result) => {
      if (result) {
        setCached(cacheKey, result);
      }
      return result;
    })
    .finally(() => pendingGeocodes.delete(cacheKey));

  pendingGeocodes.set(cacheKey, request);
  return request;
}
