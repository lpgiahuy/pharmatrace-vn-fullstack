import {
  calculateHaversineDistance,
  calculateShippingFeeByDistance,
  calculateEstimatedDelivery,
  FREE_SHIPPING_THRESHOLD,
  DEFAULT_SHIPPING_FEE,
} from './shipping-calculator.helper';

describe('Shipping Calculator Helper', () => {
  describe('calculateEstimatedDelivery', () => {
    it.each([
      [15, false, 4, 'Estimated same-day delivery (2-4 hours)'],
      [15, true, 28, 'Estimated 26-28 hours (includes 24 hours for consolidation)'],
      [30, false, 24, 'Estimated 1 day'],
      [100, false, 48, 'Estimated 2-3 days'],
      [60, true, 48, 'Estimated 2 days (includes 24 hours for consolidation)'],
      [61, true, 72, 'Estimated 3-4 days (includes 24 hours for consolidation)'],
    ])('estimates %s km with consolidation %s', (distance, consolidated, hours, label) => {
      expect(calculateEstimatedDelivery(distance, consolidated)).toEqual({ estimatedHours: hours, label, isServiceable: true });
    });

    it('rejects distances beyond coverage', () => {
      expect(calculateEstimatedDelivery(2501, false).isServiceable).toBe(false);
    });
  });
  describe('calculateHaversineDistance', () => {
    it('should return 0 when two points are identical', () => {
      const lat = 10.7769;
      const lon = 106.7009;
      const distance = calculateHaversineDistance(lat, lon, lat, lon);
      expect(distance).toBe(0);
    });

    it('should accurately calculate distance between District 1 and Thu Duc (~11.2 km)', () => {
      const d1Lat = 10.7769;
      const d1Lon = 106.7009;
      const thuDucLat = 10.8494;
      const thuDucLon = 106.7725;

      const distance = calculateHaversineDistance(d1Lat, d1Lon, thuDucLat, thuDucLon);
      expect(distance).toBeGreaterThan(10);
      expect(distance).toBeLessThan(13);
      expect(distance).toBe(11.2);
    });

    it('should throw an error when coordinates are missing or NaN', () => {
      expect(() => calculateHaversineDistance(NaN, 106.7, 10.8, 106.8)).toThrow(
        'Invalid coordinates provided for Haversine distance calculation.',
      );
      expect(() => calculateHaversineDistance(10.7, undefined as any, 10.8, 106.8)).toThrow(
        'Invalid coordinates provided for Haversine distance calculation.',
      );
      expect(() => calculateHaversineDistance(10.7, 106.7, NaN, 106.8)).toThrow(
        'Invalid coordinates provided for Haversine distance calculation.',
      );
      expect(() => calculateHaversineDistance(10.7, 106.7, 10.8, undefined as any)).toThrow(
        'Invalid coordinates provided for Haversine distance calculation.',
      );
    });
  });

  describe('calculateShippingFeeByDistance', () => {
    it('should return 0 fee if subtotal meets or exceeds FREE_SHIPPING_THRESHOLD (500,000 VND)', () => {
      expect(calculateShippingFeeByDistance(2, FREE_SHIPPING_THRESHOLD)).toBe(0);
      expect(calculateShippingFeeByDistance(50, FREE_SHIPPING_THRESHOLD + 100000)).toBe(0);
    });

    it('should charge 15,000 VND for distances <= 5 km', () => {
      expect(calculateShippingFeeByDistance(1, 200000)).toBe(15000);
      expect(calculateShippingFeeByDistance(5, 200000)).toBe(15000);
    });

    it('should charge 25,000 VND for distances between 5.1 and 15 km', () => {
      expect(calculateShippingFeeByDistance(5.1, 200000)).toBe(25000);
      expect(calculateShippingFeeByDistance(15, 200000)).toBe(25000);
    });

    it('should charge 35,000 VND for distances between 15.1 and 30 km', () => {
      expect(calculateShippingFeeByDistance(15.1, 200000)).toBe(35000);
      expect(calculateShippingFeeByDistance(30, 200000)).toBe(35000);
    });

    it('should charge 35,000 VND + 1,000 VND per extra km for distances > 30 km', () => {
      // 35 km -> 35 - 30 = 5 extra km -> 35,000 + 5,000 = 40,000 VND
      expect(calculateShippingFeeByDistance(35, 200000)).toBe(40000);
      // 30.2 km -> Math.ceil(0.2) = 1 extra km -> 35,000 + 1,000 = 36,000 VND
      expect(calculateShippingFeeByDistance(30.2, 200000)).toBe(36000);
    });
  });
});
