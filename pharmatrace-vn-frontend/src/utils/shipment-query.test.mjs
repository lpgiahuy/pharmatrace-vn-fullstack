import assert from 'node:assert/strict';
import test from 'node:test';
import dayjs from 'dayjs';
import { shipmentQuery, emptyShipmentFilters } from './shipment-query.ts';

test('omits empty filters and trims the carrier for shipment and COD lists', () => {
  assert.deepEqual(shipmentQuery(2, emptyShipmentFilters), { page: 2, limit: 20 });
  assert.deepEqual(shipmentQuery(1, { status: 'SETTLED', courier: ' GHN ', dateRange: null }), { page: 1, limit: 20, status: 'SETTLED', courier: 'GHN' });
});
test('uses full local calendar days and omits an incomplete date range', () => {
  const start = dayjs('2026-11-09'), end = dayjs('2026-11-10');
  const query = shipmentQuery(1, { ...emptyShipmentFilters, dateRange: [start, end] });
  assert.equal(query.from, start.startOf('day').toISOString()); assert.equal(query.to, end.endOf('day').toISOString());
  assert.deepEqual(shipmentQuery(1, { ...emptyShipmentFilters, dateRange: [start, null] }), { page: 1, limit: 20 });
});
