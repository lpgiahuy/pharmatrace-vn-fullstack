import { apiClient } from './api.client';

export interface CustomerOrderStats {
  totalOrders: number;
  totalSpent: number;
  completedOrders: number;
  cancelledOrders: number;
}

export interface Customer {
  id: number;
  fullName: string;
  email: string;
  phoneNumber: string;
  membershipTier: 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'DIAMOND' | string;
  rewardPoints: number;
  defaultAddress?: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'BANNED' | string;
  createdAt: string;
  totalOrders?: number;
  orderStats?: CustomerOrderStats;
}

export interface CustomerQuery {
  page?: number;
  limit?: number;
  search?: string;
  membershipTier?: string;
  status?: string;
}

export interface PaginatedCustomerResponse {
  success: boolean;
  message?: string;
  data: Customer[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface CustomerOrderItem {
  id: number;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  medicine?: {
    id: number;
    medicineName: string;
    activeIngredients?: string | null;
    dosage?: string | null;
    imageUrl?: string | null;
  } | null;
  packaging?: {
    id: number;
    unitName: string;
  } | null;
}

export interface CustomerOrderDetail {
  id: number;
  orderCode: string;
  subtotalAmount: number;
  shippingFee: number;
  discountAmount: number;
  usedPoints: number;
  totalAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  orderStatus: string;
  shippingAddress?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  note?: string | null;
  createdAt: string;
  facility?: {
    id: number;
    name: string;
    type: string;
  } | null;
  shipment?: {
    id: number;
    trackingNumber: string;
    courierName: string;
    shippingStatus: string;
    pickedUpAt?: string | null;
    estimatedDeliveryAt?: string | null;
    actualDeliveryAt?: string | null;
  } | null;
  orderItems: CustomerOrderItem[];
}

export interface CustomerOrderQuery {
  page?: number;
  limit?: number;
  orderStatus?: string;
  paymentStatus?: string;
}

export interface PaginatedCustomerOrdersResponse {
  success: boolean;
  message?: string;
  data: CustomerOrderDetail[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export const customerService = {
  async getCustomers(params?: CustomerQuery): Promise<PaginatedCustomerResponse> {
    const res = await apiClient.get('/admin/customers', { params });
    return res as unknown as PaginatedCustomerResponse;
  },

  async getCustomerById(id: number): Promise<{ success: boolean; data: Customer }> {
    const res = await apiClient.get(`/admin/customers/${id}`);
    return res as unknown as { success: boolean; data: Customer };
  },

  async updateCustomerStatus(id: number, payload: { status: string } | string) {
    const body = typeof payload === 'string' ? { status: payload } : payload;
    const res = await apiClient.patch(`/admin/customers/${id}/status`, body);
    return res;
  },

  async getCustomerOrders(
    id: number,
    params?: CustomerOrderQuery
  ): Promise<PaginatedCustomerOrdersResponse> {
    const res = await apiClient.get(`/admin/customers/${id}/orders`, { params });
    return res as unknown as PaginatedCustomerOrdersResponse;
  },
};
