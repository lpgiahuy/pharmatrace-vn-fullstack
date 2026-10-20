import { apiClient } from './api.client';

export interface OrderItem {
  id: number;
  orderId: number;
  medicineId?: number;
  variantId?: number;
  medicineName: string;
  unitName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  assignedUids?: string[];
  assigned_uids?: string[];
  sourceFacilityId?: number;
  sourceFacilityName?: string;
  batchNumber?: string;
  expiryDate?: string;
  medicine?: {
    id: number;
    name: string;
    isPrescription?: boolean;
    registrationNumber?: string;
    images?: string[];
    thumbnail?: string;
    imageUrl?: string;
    slug?: string;
  };
  variant?: {
    id: number;
    price: number;
    packagingUnit?: {
      id: number;
      name: string;
    };
    medicine?: {
      id: number;
      name: string;
      registrationNumber?: string;
      images?: string[];
      thumbnail?: string;
    };
  };
}

export interface OrderShipment {
  id: number;
  orderId: number;
  trackingNumber: string;
  carrierName?: string;
  courierName?: string;
  shippingStatus: string;
  shippingFee: number;
  estimatedDelivery?: string;
  shippedAt?: string;
  deliveredAt?: string;
}

export type OrderStatus =
  | 'PENDING'
  | 'WAITING_INTERNAL_TRANSFER'
  | 'PROCESSING'
  | 'SHIPPING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'RETURNED'
  | 'PARTIALLY_RETURNED';

export type PaymentMethod = 'COD' | 'BANK_TRANSFER' | 'E_WALLET';
export type PaymentStatus = 'UNPAID' | 'PAID' | 'REFUNDED';

export function formatOrderStatus(status?: string): OrderStatus {
  if (!status) return 'PENDING';
  const s = status.trim().toUpperCase();
  if (['PENDING'].includes(s)) return 'PENDING';
  if (['WAITING_INTERNAL_TRANSFER', 'WAITING_TRANSFER'].includes(s)) {
    return 'WAITING_INTERNAL_TRANSFER';
  }
  if (['PROCESSING'].includes(s)) return 'PROCESSING';
  if (['SHIPPING', 'IN_TRANSIT'].includes(s)) return 'SHIPPING';
  if (['COMPLETED', 'DELIVERED'].includes(s)) return 'COMPLETED';
  if (['CANCELLED', 'CANCELED'].includes(s)) return 'CANCELLED';
  if (['RETURNED', 'PARTIALLY_RETURNED'].includes(s)) return 'RETURNED';
  return 'PENDING';
}

export function formatOrderStatusLabel(status?: string): string {
  const normalized = formatOrderStatus(status);
  switch (normalized) {
    case 'PENDING':
      return 'Pending';
    case 'WAITING_INTERNAL_TRANSFER':
      return 'Waiting Internal Transfer (Consolidating)';
    case 'PROCESSING':
      return 'Processing';
    case 'SHIPPING':
      return 'In Transit';
    case 'COMPLETED':
      return 'Completed';
    case 'CANCELLED':
      return 'Cancelled';
    case 'RETURNED':
    case 'PARTIALLY_RETURNED':
      return 'Returned';
    default:
      return normalized;
  }
}

export function formatPaymentStatus(status?: string): PaymentStatus {
  if (!status) return 'UNPAID';
  const s = status.trim().toUpperCase();
  if (['PAID'].includes(s)) return 'PAID';
  if (['UNPAID'].includes(s)) return 'UNPAID';
  if (['REFUNDED'].includes(s)) return 'REFUNDED';
  return 'UNPAID';
}

export function formatPaymentMethod(method?: string): string {
  if (!method) return 'COD';
  const s = method.trim().toUpperCase();
  if (['TIEN_MAT', 'TIENMAT', 'COD', 'CASH'].includes(s)) return 'COD';
  if (['CHUYEN_KHOAN', 'CHUYENKHOAN', 'BANK_TRANSFER', 'VIETQR', 'BANK'].includes(s)) return 'Bank Transfer';
  if (['VI_DIEN_TU', 'E_WALLET', 'VNPAY', 'MOMO', 'ZALOPAY'].includes(s)) return 'E-Wallet';
  return method;
}

export interface InternalTransfer {
  id: number;
  transferCode: string;
  fromFacilityId: number;
  fromFacilityName?: string;
  toFacilityId: number;
  toFacilityName?: string;
  status: 'REQUESTED' | 'CONFIRMED' | 'DISPATCHED' | 'RECEIVED' | 'CANCELLED' | 'REPLACED' | 'REJECTED_UNFULFILLED';
  items: Array<{
    variantId: number;
    medicineId: number;
    medicineName: string;
    unitName: string;
    quantity: number;
  }>;
  trackingCode?: string;
  distanceKm: number;
  estimatedHours: number;
  notes?: string;
  dispatchedAt?: string;
  receivedAt?: string;
  createdAt: string;
}

export interface Order {
  id: number;
  orderCode: string;
  customerId: number;
  prescriptionId?: number | null;
  exportFacilityId?: number | null;
  exportFacility?: {
    id: number;
    facilityName: string;
    address?: string;
  };
  subtotalAmount: number;
  shippingFee: number;
  discountAmount: number;
  voucherDiscount?: number;
  pointsDiscount?: number;
  usedPoints: number;
  totalAmount: number;
  orderStatus: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  shippingAddress: string;
  recipientName: string;
  recipientPhone: string;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: {
    id: number;
    fullName: string;
    email: string;
    phone: string;
  };
  items?: OrderItem[];
  orderItems?: OrderItem[];
  shipments?: OrderShipment[];
  shipment?: OrderShipment;
  internalTransfers?: InternalTransfer[];
  prescription?: any;
}

export function getOrderItems(order?: Order | null): OrderItem[] {
  if (!order) return [];
  if (Array.isArray(order.items) && order.items.length > 0) return order.items;
  if (Array.isArray(order.orderItems) && order.orderItems.length > 0) return order.orderItems;
  return [];
}

export function getOrderItemCount(order?: Order | null): number {
  const items = getOrderItems(order);
  if (items.length === 0) return 0;
  return items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
}

export function formatPaymentSummary(method?: string, status?: string): string {
  const m = formatPaymentMethod(method);
  const s = formatPaymentStatus(status);
  const statusLabel = s === 'PAID' ? 'Paid' : s === 'REFUNDED' ? 'Refunded' : 'Pending';
  return `${m} · ${statusLabel}`;
}

export interface CreateOrderItemDto {
  variantId: number;
  quantity: number;
}

export interface CreateOrderDto {
  shippingAddress: string;
  latitude?: number;
  longitude?: number;
  recipientName: string;
  recipientPhone: string;
  paymentMethod: PaymentMethod;
  voucherCode?: string;
  usedPoints?: number;
  prescriptionId?: number;
  note?: string;
  items: CreateOrderItemDto[];
}

export interface OrderQueryDto {
  page?: number;
  limit?: number;
  status?: string;
  sort?: string;
  search?: string;
}

export interface UpdateOrderStatusDto {
  orderStatus?: OrderStatus;
  paymentStatus?: PaymentStatus;
  note?: string;
}

export interface OrderListResponse {
  success: boolean;
  message?: string;
  data: Order[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SingleOrderResponse {
  success: boolean;
  message?: string;
  data: Order;
}

export interface AvailableBoxInfo {
  uid: string;
  status?: string;
  batchId?: number | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
  medicineId?: number | null;
  medicineName?: string | null;
  facilityId?: number | null;
}

export const orderService = {
  // Customer: Place an order
  createOrder: async (dto: CreateOrderDto): Promise<SingleOrderResponse> => {
    return apiClient.post('/orders', dto);
  },

  // Customer: Get my order list
  getMyOrders: async (params?: OrderQueryDto): Promise<OrderListResponse> => {
    return apiClient.get('/orders/me', { params });
  },

  // Customer: Get my order details
  getMyOrderById: async (id: number): Promise<SingleOrderResponse> => {
    return apiClient.get(`/orders/${id}`);
  },

  // Customer: Cancel pending order
  cancelMyOrder: async (id: number): Promise<SingleOrderResponse> => {
    return apiClient.patch(`/orders/${id}/cancel`);
  },

  // Admin: Get all orders
  adminGetOrders: async (params?: OrderQueryDto): Promise<OrderListResponse> => {
    return apiClient.get('/admin/orders', { params });
  },

  // Admin: Get single order details
  adminGetOrderById: async (id: number): Promise<SingleOrderResponse> => {
    return apiClient.get(`/admin/orders/${id}`);
  },

  // Admin: Update order status
  adminUpdateStatus: async (
    id: number,
    data: UpdateOrderStatusDto,
  ): Promise<SingleOrderResponse> => {
    return apiClient.patch(`/admin/orders/${id}/status`, data);
  },

  // Admin / Warehouse: Pack order and dispatch shipment
  adminPackOrder: async (
    id: number,
    data?: { boxUids?: string[]; courierName?: string; shippingNote?: string },
  ): Promise<SingleOrderResponse> => {
    return apiClient.post(`/admin/orders/${id}/pack`, data);
  },

  // Aliases matching old project API calls
  getAll: async (params?: any) => {
    return orderService.adminGetOrders(params);
  },

  getAdminById: async (id: number): Promise<Order> => {
    const res = await orderService.adminGetOrderById(id);
    return res.data || (res as any);
  },

  fulfillOrder: async (id: number, uids?: string[]) => {
    return orderService.adminPackOrder(id, { boxUids: uids });
  },

  shipOrder: async (id: number) => {
    return orderService.adminUpdateStatus(id, { orderStatus: 'SHIPPING' });
  },

  completeOrder: async (id: number) => {
    return orderService.adminUpdateStatus(id, {
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
    });
  },

  getAvailableUIDs: async (id: number): Promise<string[]> => {
    try {
      const res: any = await apiClient.get(`/admin/orders/${id}/available-boxes`);
      const list = res?.data || res || [];
      return Array.isArray(list) ? list.map((item: any) => item.uid).filter(Boolean) : [];
    } catch {
      return [];
    }
  },

  getAvailableBoxes: async (id: number): Promise<AvailableBoxInfo[]> => {
    try {
      const res: any = await apiClient.get(`/admin/orders/${id}/available-boxes`);
      const list = res?.data || res || [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  },

  // Inter-facility transfer management
  getAllInternalTransfers: async (orderId?: number) => {
    const url = orderId ? `/admin/orders/transfers/all?orderId=${orderId}` : '/admin/orders/transfers/all';
    return apiClient.get(url);
  },

  dispatchInternalTransfer: async (transferId: number, trackingCode?: string) => {
    return apiClient.patch(`/admin/orders/transfers/${transferId}/dispatch`, { trackingCode });
  },

  receiveInternalTransfer: async (transferId: number) => {
    return apiClient.patch(`/admin/orders/transfers/${transferId}/receive`);
  },

  rejectDamagedInternalTransfer: async (transferId: number) => {
    return apiClient.patch(`/admin/orders/transfers/${transferId}/reject-damaged`);
  },
};

