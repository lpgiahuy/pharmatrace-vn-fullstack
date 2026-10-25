import { apiClient } from './api.client';

export type ReviewStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

export interface PrescriptionReview {
  id: number;
  orderId: number;
  status: ReviewStatus;
  note: string | null;
  reviewedAt: string | null;
  orderStatus: string | null;
}

export interface Prescription {
  id: number;
  createdAt: string;
  reviews: PrescriptionReview[];
}

export interface PrescriptionQueueItem {
  id: number;
  orderId: number;
  orderCode: string;
  facilityId: number;
  status: ReviewStatus;
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
  medicines: { name: string | null; quantity: number }[];
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export const prescriptionService = {
  listMine: () => apiClient.get<unknown, ApiResponse<Prescription[]>>('/prescriptions'),
  upload: (file: File) => {
    const data = new FormData();
    data.append('file', file);
    return apiClient.post<unknown, ApiResponse<{ id: number }>>('/prescriptions', data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  customerImage: (id: number) => apiClient.get<unknown, Blob>(`/prescriptions/${id}/image`, { responseType: 'blob' }),
  queue: (status?: ReviewStatus, page?: number) => apiClient.get<unknown, ApiResponse<{
    items: PrescriptionQueueItem[];
    pagination: { page: number; total: number; limit: number };
  }>>('/admin/prescriptions', { params: { ...(status ? { status } : {}), ...(page ? { page } : {}) } }),
  adminImage: (id: number) => apiClient.get<unknown, Blob>(`/admin/prescriptions/${id}/image`, { responseType: 'blob' }),
  approve: (id: number, note?: string) => apiClient.patch(`/admin/prescriptions/${id}/approve`, { note }),
  reject: (id: number, note: string) => apiClient.patch(`/admin/prescriptions/${id}/reject`, { note }),
};
