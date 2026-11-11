import { apiClient } from './api.client';

export type ShippingStatus =
  | 'PENDING_PICKUP'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'RETURN_REQUESTED'
  | 'RETURN_IN_TRANSIT'
  | 'RETURNED_TO_WAREHOUSE';

export type CodSettlementStatus = 'UNSETTLED' | 'DISCREPANCY_PENDING' | 'SETTLED';

export interface LogisticsEvent {
  old_status: string | null;
  new_status: string;
  reason?: string | null;
  actor_id?: number | null;
  actor_type?: string | null;
  actor_name?: string | null;
  actor_role?: string | null;
  actor_inferred?: boolean;
  created_at: string;
  occurred_at?: string | null;
}

export function formatStaffRole(role?: string | null): string {
  if (!role) return '';
  const normalized = role.toUpperCase().replace(/\s+/g, '_');
  const roleMap: Record<string, string> = {
    SUPER_ADMIN: 'Super Admin',
    STORE_MANAGER: 'Store Manager',
    PHARMACIST: 'Pharmacist',
    WAREHOUSE_STAFF: 'Warehouse Staff',
    CUSTOMER: 'Customer',
  };
  if (roleMap[normalized]) return roleMap[normalized];
  return role
    .split(/[\s_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function logisticsActorLabel(event: LogisticsEvent): string {
  if (event.actor_name) {
    const role = event.actor_role ? ` (${formatStaffRole(event.actor_role)})` : '';
    const idTag = event.actor_id ? ` • ${event.actor_type === 'customer' ? 'Customer' : 'Staff'} #${event.actor_id}` : '';
    return `${event.actor_name}${role}${idTag}`;
  }
  if (event.actor_type === 'customer') {
    return event.actor_id ? `Customer #${event.actor_id}` : 'Customer';
  }
  if (event.actor_id) {
    const role = event.actor_role ? ` (${formatStaffRole(event.actor_role)})` : '';
    return `Staff #${event.actor_id}${role}`;
  }
  return 'System';
}

export interface InternalTransferItem {
  variantId: number;
  medicineId: number;
  medicineName: string;
  unitName: string;
  quantity: number;
}

export interface InternalTransferFacility {
  id: number;
  facility_name: string;
  facility_code?: string;
  address?: string;
}

export interface InternalTransfer {
  custody?: Array<{ variant_id: number; quantity: number; outstanding: number; handed_over_at: string; received_at: string | null }>;
  resolution?: { action: string; reason: string; customer_agreement: string | null; resolved_by: number; replacement_transfer_id: number | null } | null;
  id: number;
  transfer_code: string;
  order_id: number;
  from_facility_id: number;
  to_facility_id: number;
  status:
    | 'REQUESTED'
    | 'DISPATCHED'
    | 'RECEIVED'
    | 'PARTIALLY_RECEIVED'
    | 'RECEIVED_WITH_DISCREPANCY'
    | 'RETURN_REQUESTED'
    | 'RETURNED_TO_SOURCE'
    | 'CANCELLED'
    | 'REPLACED'
    | 'REJECTED_UNFULFILLED';
  items: InternalTransferItem[];
  manifest?: { lines: Array<{ variantId: number; quantity: number; boxUids: string[] }>; prepared_by: number; prepared_at: string } | null;
  tracking_code?: string | null;
  transport_mode?: 'INTERNAL' | 'THIRD_PARTY' | null;
  transport_employee_id?: number | null;
  transport_employee_name?: string | null;
  courier_name?: string | null;
  distance_km?: number | null;
  estimated_hours?: number | null;
  notes?: string | null;
  variance_details?: Record<string, unknown> | null;
  return_reason?: string | null;
  returned_at?: string | null;
  discrepancy_status?: string;
  dispatched_at?: string | null;
  received_at?: string | null;
  created_at: string;
  updated_at?: string;
  from_facility?: InternalTransferFacility;
  to_facility?: InternalTransferFacility;
  history?: LogisticsEvent[];
}

export interface ReceiveTransferLinePayload {
  variantId: number;
  receivedQuantity: number;
  goodUids?: string[];
  damagedUids?: string[];
  damagedQuantity?: number;
  missingQuantity?: number;
  notes?: string;
}

export interface ReceiveTransferPayload {
  lines?: ReceiveTransferLinePayload[];
  notes?: string;
}

export interface HaltTransferPayload {
  reason: string;
}

export interface ReceiveTransferReturnLinePayload {
  variantId: number;
  goodQuantity: number;
  goodUids?: string[];
  damagedUids?: string[];
  damagedQuantity?: number;
}

export interface ReceiveTransferReturnPayload {
  lines?: ReceiveTransferReturnLinePayload[];
  notes?: string;
}

export interface DispatchTransferPayload {
  transportMode: 'INTERNAL' | 'THIRD_PARTY';
  transportEmployeeId?: number;
  courierName?: string;
  trackingCode?: string;
  manifest: Array<{ variantId: number; quantity: number; boxUids: string[] }>;
}

export const CARRIER_OPTIONS = ['GHN', 'GHTK', 'J&T', 'VIETTEL_POST', 'VNPOST', 'BEST', 'SPX', 'NINJA_VAN', 'FLASH'].map(value => ({ value, label: value }));

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

export interface SingleResponse<T> {
  success: boolean;
  data: T;
}

export const logisticsService = {
  resolveDiscrepancy: (id: number, payload: { action: 'RESUPPLY' | 'ACCEPT_SHORTAGE'; sourceFacilityId?: number; reason: string; customerAgreement?: string }) =>
    apiClient.patch(`/admin/logistics/transfers/${id}/resolve-discrepancy`, payload),
  getTransfers: async (
    orderId?: number,
    status?: string
  ): Promise<SingleResponse<InternalTransfer[]>> => {
    const params = new URLSearchParams();
    if (orderId) params.append('orderId', String(orderId));
    if (status) params.append('status', status);
    const qs = params.toString();
    return apiClient.get(`/admin/logistics/transfers${qs ? `?${qs}` : ''}`);
  },

  getTransfer: async (id: number): Promise<SingleResponse<InternalTransfer>> => {
    return apiClient.get(`/admin/logistics/transfers/${id}`);
  },


  dispatchTransfer: async (
    transferId: number,
    payload: DispatchTransferPayload
  ): Promise<SingleResponse<InternalTransfer>> => {
    return apiClient.patch(`/admin/logistics/transfers/${transferId}/dispatch`, {
      ...payload,
    });
  },

  getTransportStaff: (id: number): Promise<SingleResponse<Array<{ id: number; full_name: string }>>> =>
    apiClient.get(`/admin/logistics/transfers/${id}/transport-staff`),

  haltTransfer: async (
    transferId: number,
    payload: HaltTransferPayload
  ): Promise<SingleResponse<InternalTransfer>> => {
    return apiClient.patch(`/admin/logistics/transfers/${transferId}/halt`, payload);
  },


  receiveTransfer: async (
    transferId: number,
    payload?: ReceiveTransferPayload
  ): Promise<SingleResponse<InternalTransfer>> => {
    return apiClient.patch(`/admin/logistics/transfers/${transferId}/receive`, payload || {});
  },

  receiveTransferReturn: async (
    transferId: number,
    payload?: ReceiveTransferReturnPayload
  ): Promise<SingleResponse<InternalTransfer>> => {
    return apiClient.patch(`/admin/logistics/transfers/${transferId}/receive-return`, payload || {});
  },


  getAllInternalTransfers: async (orderId?: number) => {
    const url = orderId ? `/admin/logistics/transfers?orderId=${orderId}` : '/admin/logistics/transfers';
    return apiClient.get(url);
  },
  dispatchInternalTransfer: async (transferId: number, payload: DispatchTransferPayload) => {
    return apiClient.patch(`/admin/logistics/transfers/${transferId}/dispatch`, payload);
  },
  receiveInternalTransfer: async (transferId: number) => {
    return apiClient.patch(`/admin/logistics/transfers/${transferId}/receive`);
  },
};
