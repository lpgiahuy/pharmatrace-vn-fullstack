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

export interface Shipment {
  id: number;
  order_id: number;
  tracking_number: string;
  courier_name: string;
  carrier_confirmed_at?: string | null;
  shipping_status: ShippingStatus;
  picked_up_at?: string | null;
  estimated_delivery_at?: string | null;
  actual_delivery_at?: string | null;
  cod_amount: number | string;
  cod_settlement_status: CodSettlementStatus;
  cod_settled_at?: string | null;
  proof_type?: string | null;
  proof_reference?: string | null;
  delivered_to_name?: string | null;
  delivery_notes?: string | null;
  return_category?: string | null;
  return_reason?: string | null;
  return_qa_status?: string | null;
  return_qa_notes?: string | null;
  return_disposition?: string | null;
  return_received_at?: string | null;
  return_disposed_at?: string | null;
  note?: string | null;
  created_at: string;
  updated_at: string;
  orders?: {
    id: number;
    order_code: string;
    recipient_name?: string;
    recipient_phone?: string;
    shipping_address?: string;
    total_amount?: number;
    order_status?: string;
    payment_status?: string;
    order_items?: Array<{ variant_id: number; medicine_name?: string; quantity: number; assigned_uids: string[] }>;
  };
  history?: LogisticsEvent[];
  returnItems?: Array<{ variant_id: number; quantity: number; box_uids: string[] }>;
  authorizedItems?: Array<{ variant_id: number; quantity: number; reason: string; approved_by: number; approved_at: string }>;
  refundDecision?: { goods_value: string | number; customer_fee: string | number; refund_amount: string | number; payment_method: string; payment_reference: string | null; approved_by: number; approved_at: string; status: 'APPROVED' | 'RECORDED'; executed_by: number | null; executed_at: string | null } | null;
  statementReviews?: Array<{
    id: number; gross: string | number; fee: string | number; adjustment: string | number; net: string | number;
    statement_reference: string; status: 'PENDING' | 'APPROVED' | 'DISCREPANCY_PENDING';
    recorded_by: number; approved_by: number | null; recorded_at: string;
  }>;
  settlements?: Array<{
    cashbook_id: number | null;
    amount: number;
    courier_fee?: number;
    adjustment_amount?: number;
    net_amount?: number;
    statement_reference?: string;
    discrepancy_amount?: number;
    discrepancy_status?: string;
    collected_by: string | number;
    collected_at: string;
  }>;
}

export interface ShipmentQuery {
  page?: number;
  limit?: number;
  status?: string;
  courier?: string;
  from?: string;
  to?: string;
}

export interface CodSummaryItem {
  cod_settlement_status: CodSettlementStatus;
  _count: { _all: number };
  _sum: { cod_amount: number | string | null };
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

export interface DeliveryProofPayload {
  proofType: 'CUSTOMER_SIGNATURE' | 'DELIVERY_PHOTO' | 'OTP' | 'DISPATCH_NOTE' | 'STAFF_CONFIRMATION';
  proofReference: string;
  deliveredToName: string;
  deliveryNotes?: string;
  occurredAt?: string;
}

export interface RequestPostDeliveryReturnPayload {
  reason: string;
  lines: Array<{ variantId: number; quantity: number }>;
}

export interface ReceiveReturnPayload {
  notes?: string;
  receivedLines: Array<{ variantId: number; quantity: number; boxUids: string[] }>;
}

export interface ReturnDispositionLinePayload {
  variantId: number;
  passQuantity: number;
  failQuantity: number;
  restockBoxUids?: string[];
  scrapBoxUids?: string[];
  notes?: string;
}

export interface ReturnDispositionPayload {
  decision: 'RESTOCK' | 'SCRAP' | 'PARTIAL_RESTOCK';
  qaNotes: string;
  lines: ReturnDispositionLinePayload[];
}

export interface ReturnRefundPayload {
  goodsValue: number;
  customerFee: number;
  paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'DEBIT_CARD' | 'E_WALLET';
  reason: string;
}

export interface ReconcileCodPayload {
  grossAmount: number;
  courierFee: number;
  adjustmentAmount?: number;
  netAmount: number;
  statementReference: string;
  discrepancyNote?: string;
}

export interface ReconcileCodResponse {
  shipmentId: number;
  cashbookId?: number | null;
  status: string;
  collectedAmount?: number;
  netAmount?: number;
  courierFee?: number;
  adjustmentAmount?: number;
  discrepancyAmount?: number;
  discrepancyStatus?: string;
  discrepancy?: boolean;
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

export const canCollectShipmentCod = (shipment: Shipment) =>
  shipment.cod_settlement_status !== 'SETTLED' && Number(shipment.cod_amount) > 0 &&
  (shipment.shipping_status === 'DELIVERED' ||
    (!!shipment.actual_delivery_at && ['RETURN_REQUESTED', 'RETURN_IN_TRANSIT', 'RETURNED_TO_WAREHOUSE'].includes(shipment.shipping_status)));

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
  summary?: CodSummaryItem[];
}

export interface SingleResponse<T> {
  success: boolean;
  data: T;
}

export const logisticsService = {
  resolveDiscrepancy: (id: number, payload: { action: 'RESUPPLY' | 'ACCEPT_SHORTAGE'; sourceFacilityId?: number; reason: string; customerAgreement?: string }) =>
    apiClient.patch(`/admin/logistics/transfers/${id}/resolve-discrepancy`, payload),
  getShipments: async (query?: ShipmentQuery): Promise<PaginatedResponse<Shipment>> => {
    const params = new URLSearchParams();
    if (query?.page) params.append('page', String(query.page));
    if (query?.limit) params.append('limit', String(query.limit));
    if (query?.status) params.append('status', query.status);
    if (query?.courier) params.append('courier', query.courier);
    if (query?.from) params.append('from', query.from);
    if (query?.to) params.append('to', query.to);
    const qs = params.toString();
    return apiClient.get(`/admin/logistics/shipments${qs ? `?${qs}` : ''}`);
  },

  getShipment: async (id: number): Promise<SingleResponse<Shipment>> => {
    return apiClient.get(`/admin/logistics/shipments/${id}`);
  },

  updateCarrier: (id: number, courierName: string, trackingNumber: string): Promise<SingleResponse<Shipment>> =>
    apiClient.patch(`/admin/logistics/shipments/${id}/carrier`, { courierName, trackingNumber }),

  updateShipmentStatus: async (
    id: number,
    status: ShippingStatus,
    reason?: string,
    occurredAt?: string
  ): Promise<SingleResponse<Shipment>> => {
    return apiClient.patch(`/admin/logistics/shipments/${id}/status`, {
      status,
      reason: reason?.trim() || undefined,
      occurredAt,
    });
  },

  confirmDeliveryWithProof: async (
    id: number,
    payload: DeliveryProofPayload
  ): Promise<SingleResponse<Shipment>> => {
    return apiClient.post(`/admin/logistics/shipments/${id}/delivery-proof`, payload);
  },

  requestReturnShipment: async (
    id: number,
    reason: string
  ): Promise<SingleResponse<Shipment>> => {
    return apiClient.post(`/admin/logistics/shipments/${id}/return`, {
      reason: reason.trim(),
    });
  },

  requestPostDeliveryReturn: async (
    id: number,
    payload: RequestPostDeliveryReturnPayload
  ): Promise<SingleResponse<Shipment>> => {
    return apiClient.post(`/admin/logistics/shipments/${id}/post-delivery-return`, payload);
  },

  receiveReturn: async (
    id: number,
    payload: ReceiveReturnPayload
  ): Promise<SingleResponse<Shipment>> => {
    return apiClient.post(`/admin/logistics/shipments/${id}/receive-return`, payload);
  },

  dispositionReturn: async (
    id: number,
    payload: ReturnDispositionPayload
  ): Promise<SingleResponse<Shipment>> => {
    return apiClient.post(`/admin/logistics/shipments/${id}/disposition-return`, payload);
  },

  approveReturnRefund: async (id: number, payload: ReturnRefundPayload): Promise<SingleResponse<{ id: number; status: string; refundAmount: number }>> => {
    return apiClient.post(`/admin/logistics/shipments/${id}/refund`, payload);
  },

  recordRefundPayment: async (id: number, paymentReference: string): Promise<SingleResponse<{ id: number; cashbookId: number; refundAmount: number }>> => {
    return apiClient.post(`/admin/logistics/shipments/${id}/refund/payment`, { paymentReference });
  },

  getCodShipments: async (query?: ShipmentQuery): Promise<PaginatedResponse<Shipment>> => {
    const params = new URLSearchParams();
    if (query?.page) params.append('page', String(query.page));
    if (query?.limit) params.append('limit', String(query.limit));
    if (query?.status) params.append('status', query.status);
    if (query?.courier) params.append('courier', query.courier);
    if (query?.from) params.append('from', query.from);
    if (query?.to) params.append('to', query.to);
    const qs = params.toString();
    return apiClient.get(`/admin/logistics/cod${qs ? `?${qs}` : ''}`);
  },

  getCodShipment: async (id: number): Promise<SingleResponse<Shipment>> => {
    return apiClient.get(`/admin/logistics/cod/${id}`);
  },


  reconcileCod: async (
    id: number,
    payload: ReconcileCodPayload
  ): Promise<SingleResponse<ReconcileCodResponse>> => {
    return apiClient.post(`/admin/logistics/cod/${id}/reconcile`, payload);
  },

  approveCodStatement: async (id: number, statementId: number): Promise<SingleResponse<ReconcileCodResponse>> => {
    return apiClient.post(`/admin/logistics/cod/${id}/statements/${statementId}/approve`);
  },

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
