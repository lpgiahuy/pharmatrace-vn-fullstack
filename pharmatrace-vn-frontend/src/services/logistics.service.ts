import { apiClient } from './api.client';

export const logisticsService = {
  getAllInternalTransfers: async (orderId?: number) => {
    const url = orderId ? `/admin/logistics/transfers?orderId=${orderId}` : '/admin/logistics/transfers';
    return apiClient.get(url);
  },

  dispatchInternalTransfer: async (transferId: number, trackingCode?: string) => {
    return apiClient.patch(`/admin/logistics/transfers/${transferId}/dispatch`, { trackingCode });
  },

  receiveInternalTransfer: async (transferId: number) => {
    return apiClient.patch(`/admin/logistics/transfers/${transferId}/receive`);
  },

  rejectDamagedInternalTransfer: async (transferId: number) => {
    return apiClient.patch(`/admin/logistics/transfers/${transferId}/reject-damaged`);
  },
};
