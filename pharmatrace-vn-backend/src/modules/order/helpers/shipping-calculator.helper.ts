export const FREE_SHIPPING_THRESHOLD = 500000;
export const DEFAULT_SHIPPING_FEE = 30000;
export const MAX_SERVICEABLE_DISTANCE_KM = 2500;

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

export interface RoutingResult {
  facilityId: number;
  facilityName: string;
  distanceKm: number;
  shippingFee: number;
  isFreeShipping: boolean;
}

export interface DeliveryEstimate {
  estimatedHours: number;
  label: string;
  isServiceable: boolean;
}

export function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (
    lat1 === undefined || lon1 === undefined ||
    lat2 === undefined || lon2 === undefined ||
    isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)
  ) {
    throw new Error('Invalid coordinates provided for Haversine distance calculation.');
  }

  const R = 6371.0;
  const toRad = (degree: number) => (degree * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return Math.round(distance * 10) / 10;
}

export function calculateShippingFeeByDistance(distanceKm: number, subtotal: number): number {
  if (subtotal >= FREE_SHIPPING_THRESHOLD) {
    return 0;
  }

  if (distanceKm <= 5) {
    return 15000;
  } else if (distanceKm <= 15) {
    return 25000;
  } else if (distanceKm <= 30) {
    return 35000;
  } else {
    const extraKm = Math.ceil(distanceKm - 30);
    return 35000 + extraKm * 1000;
  }
}

export function calculateEstimatedDelivery(distanceKm: number | null, isConsolidated: boolean): DeliveryEstimate {
  if (distanceKm !== null && distanceKm > MAX_SERVICEABLE_DISTANCE_KM) {
    return {
      estimatedHours: 0,
      label: 'Address is outside delivery coverage area',
      isServiceable: false,
    };
  }

  let baseHours = 24;
  if (distanceKm !== null && distanceKm <= 15) {
    baseHours = 4;
  } else if (distanceKm !== null && distanceKm <= 60) {
    baseHours = 24;
  } else {
    baseHours = 48;
  }

  const totalHours = isConsolidated ? baseHours + 24 : baseHours;
  let label = '';
  if (isConsolidated) {
    label = baseHours === 4
      ? 'Estimated 26-28 hours (includes 24 hours for consolidation)'
      : baseHours === 24
        ? 'Estimated 2 days (includes 24 hours for consolidation)'
        : 'Estimated 3-4 days (includes 24 hours for consolidation)';
  } else if (baseHours <= 4) {
    label = 'Estimated same-day delivery (2-4 hours)';
  } else if (baseHours <= 24) {
    label = 'Estimated 1 day';
  } else {
    label = 'Estimated 2-3 days';
  }

  return {
    estimatedHours: totalHours,
    label,
    isServiceable: true,
  };
}
