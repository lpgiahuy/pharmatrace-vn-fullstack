export const FREE_SHIPPING_THRESHOLD = 500000;
export const DEFAULT_SHIPPING_FEE = 30000;

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


