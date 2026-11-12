import { apiClient } from './api.client';

export type ReturnStatus =
  | 'REQUESTED' | 'NEEDS_INFO' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  | 'RECEIVED' | 'INSPECTED' | 'REFUND_APPROVED' | 'REFUNDED' | 'CLOSED';
export type ReturnResolution = 'REFUND' | 'EXCHANGE';
export type ReturnMethod = 'CARRIER_PICKUP' | 'STORE_DROP_OFF';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'DEBIT_CARD' | 'E_WALLET';

export interface ReturnRequest {
  id: number;
  code: string;
  order_id: number;
  status: ReturnStatus;
  channel: 'ONLINE' | 'COUNTER' | 'PHONE';
  resolution: ReturnResolution;
  return_method: ReturnMethod;
  description: string | null;
  customer_fee: string;
  staff_note: string | null;
  replacement_order_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ReturnLine {
  order_item_id: number;
  quantity: number;
  reason_code: string;
  reason_note: string | null;
  restricted: boolean;
  exchange_variant_id: number | null;
  approved_quantity: number | null;
  received_quantity: number | null;
  pass_quantity: number | null;
  fail_quantity: number | null;
  /** Units found not to be the product sold; never credited. */
  mismatch_quantity: number | null;
  /** Boxes on this line carry UIDs, so receipt scans them against the order. */
  tracked?: boolean;
  box_uids: string[];
  medicine_name?: string;
  unit_name?: string;
  unit_price?: string;
}

export interface ReturnEvent {
  id: number;
  action: string;
  from_status: string | null;
  to_status: ReturnStatus;
  actor_type: string | null;
  actor_role: string | null;
  actor_name: string | null;
  note: string | null;
  created_at: string;
}

export interface ReturnRefund {
  goods_value?: string;
  customer_fee?: string;
  refund_amount: string;
  payment_method: PaymentMethod;
  payment_reference?: string | null;
  approved_by?: number;
  executed_by?: number | null;
  executed_at: string | null;
}

export interface ReturnDetail extends ReturnRequest {
  order_code?: string;
  handover: {
    method: ReturnMethod;
    code: string;
    facility: { id: number; facility_name: string; address?: string | null; phone_number?: string | null } | null;
    pickupAddress: string | null;
    courierName: string | null;
    trackingNumber: string | null;
  };
  lines: ReturnLine[];
  attachments: { id: number; uploaded_by_type: string; created_at: string }[];
  events: ReturnEvent[];
  refund: ReturnRefund | null;
}

export interface EligibleItem {
  orderItemId: number;
  variantId: number;
  medicineName: string;
  unitName: string;
  unitPrice: string;
  /** Unit value after the order's voucher/points are spread over its lines; this is what a return credits. */
  paidUnitPrice: string;
  purchasedQuantity: number;
  returnableQuantity: number;
  restricted: boolean;
  allowedReasons: string[];
  exchangeOptions: { variantId: number; unitName: string; unitPrice: string }[];
}

export interface ReturnEligibility {
  orderId: number;
  orderCode: string;
  deadline: string | null;
  blocker?: 'RMA_ORDER_NOT_DELIVERED' | 'RMA_RETURN_WINDOW_EXPIRED' | 'RMA_OPEN_REQUEST_EXISTS';
  openRequest?: { id: number; code: string } | null;
  items: EligibleItem[];
}

export interface CreateReturnPayload {
  orderId: number;
  resolution: ReturnResolution;
  returnMethod: ReturnMethod;
  pickupAddress?: string;
  description?: string;
  channel?: 'COUNTER' | 'PHONE';
  lines: { orderItemId: number; quantity: number; reasonCode: string; reasonNote?: string; exchangeVariantId?: number }[];
}

export interface ReturnListQuery {
  page?: number;
  limit?: number;
  status?: ReturnStatus;
  q?: string;
}

interface Envelope<T> { success: boolean; data: T }
interface Page<T> { success: boolean; data: T[]; pagination: { page: number; limit: number; total: number } }

const scopes = {
  customer: '/customer/returns',
  admin: '/admin/returns',
} as const;
export type ReturnScope = keyof typeof scopes;

export const returnService = {
  eligibility: (orderId: number) => apiClient.get<unknown, Envelope<ReturnEligibility>>(`/customer/orders/${orderId}/return-eligibility`),
  lookup: (orderCode: string) => apiClient.get<unknown, Envelope<ReturnEligibility>>('/admin/returns/lookup', { params: { orderCode } }),
  list: (scope: ReturnScope, params: ReturnListQuery) => apiClient.get<unknown, Page<ReturnRequest>>(scopes[scope], { params }),
  detail: (scope: ReturnScope, id: number) => apiClient.get<unknown, Envelope<ReturnDetail>>(`${scopes[scope]}/${id}`),
  create: (scope: ReturnScope, payload: CreateReturnPayload) => apiClient.post<unknown, Envelope<ReturnDetail>>(scopes[scope], payload),
  upload: (scope: ReturnScope, id: number, file: File) => {
    const data = new FormData();
    data.append('file', file);
    return apiClient.post<unknown, Envelope<{ id: number }>>(`${scopes[scope]}/${id}/attachments`, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  photo: (scope: ReturnScope, id: number, attachmentId: number) =>
    apiClient.get<unknown, Blob>(`${scopes[scope]}/${id}/attachments/${attachmentId}`, { responseType: 'blob' }),
  act: <T = ReturnDetail>(scope: ReturnScope, id: number, action: string, body?: unknown) =>
    apiClient.post<unknown, Envelope<T>>(`${scopes[scope]}/${id}/${action}`, body),
  changeMethod: (id: number, body: { returnMethod: ReturnMethod; pickupAddress?: string }) =>
    apiClient.put<unknown, Envelope<ReturnDetail>>(`${scopes.customer}/${id}/return-method`, body),
};
