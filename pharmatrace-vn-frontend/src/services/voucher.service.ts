import { apiClient } from './api.client';

export interface VoucherItem {
  id: number;
  voucherCode: string;
  discountType: string;
  discountValue: number;
  minOrderValue: number;
  maxDiscountAmount: number | null;
  totalQuantity: number;
  usedQuantity: number;
  startDate: string | null;
  endDate: string | null;
  status: string;
}

export interface ValidateVoucherResponse {
  valid: boolean;
  voucherId: number;
  voucherCode: string;
  discountType: string;
  discountValue: number;
  discountAmount: number;
  finalTotal: number;
  minOrderValue: number;
  maxDiscountAmount: number | null;
  message: string;
}

export const voucherService = {
  // Public/Customer: Validate voucher
  validateVoucher: async (
    voucherCode: string,
    orderSubtotal: number,
  ): Promise<{ success: boolean; data: ValidateVoucherResponse; message: string }> => {
    return apiClient.post('/vouchers/validate', { voucherCode, orderSubtotal });
  },

  // Public/Customer: Apply voucher and record usage
  applyVoucher: async (
    voucherCode: string,
    orderSubtotal: number,
  ): Promise<{ success: boolean; data: ValidateVoucherResponse; message: string }> => {
    return apiClient.post('/vouchers/apply', { voucherCode, orderSubtotal });
  },

  // Admin: Get all vouchers
  adminGetVouchers: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    discountType?: string;
    sort?: string;
  }): Promise<{ success: boolean; data: VoucherItem[]; pagination: any }> => {
    return apiClient.get('/admin/vouchers', { params });
  },

  // Admin: Get single voucher
  adminGetVoucher: async (
    id: number,
  ): Promise<{ success: boolean; data: VoucherItem }> => {
    return apiClient.get(`/admin/vouchers/${id}`);
  },

  // Admin: Create voucher
  adminCreateVoucher: async (
    data: Partial<VoucherItem>,
  ): Promise<{ success: boolean; data: VoucherItem; message: string }> => {
    return apiClient.post('/admin/vouchers', data);
  },

  // Admin: Update voucher
  adminUpdateVoucher: async (
    id: number,
    data: Partial<VoucherItem>,
  ): Promise<{ success: boolean; data: VoucherItem; message: string }> => {
    return apiClient.patch(`/admin/vouchers/${id}`, data);
  },

  // Admin: Delete voucher
  adminDeleteVoucher: async (
    id: number,
  ): Promise<{ success: boolean; message: string }> => {
    return apiClient.delete(`/admin/vouchers/${id}`);
  },
};
