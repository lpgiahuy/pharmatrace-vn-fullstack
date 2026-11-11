import type { Dayjs } from 'dayjs';
import type { ShipmentQuery } from '@/services/logistics.service';

export interface ShipmentFiltersValue {
  status: string;
  courier: string;
  dateRange: [Dayjs | null, Dayjs | null] | null;
}

export const emptyShipmentFilters: ShipmentFiltersValue = { status: '', courier: '', dateRange: null };

export function shipmentQuery(page: number, { status, courier, dateRange }: ShipmentFiltersValue): ShipmentQuery {
  return {
    page, limit: 20,
    ...(status ? { status } : {}),
    ...(courier.trim() ? { courier: courier.trim() } : {}),
    ...(dateRange?.[0] && dateRange[1] ? {
      from: dateRange[0].startOf('day').toISOString(), to: dateRange[1].endOf('day').toISOString(),
    } : {}),
  };
}
