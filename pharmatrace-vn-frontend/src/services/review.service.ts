import { apiClient } from './api.client';

export interface ReviewItem {
  id: number;
  customerId?: number;
  ratingStars: number;
  comment: string;
  images: string[];
  isVerifiedPurchase?: boolean;
  helpfulCount?: number;
  adminReply?: string | null;
  repliedAt?: string | null;
  repliedByName?: string | null;
  createdAt: string;
  customerName: string;
  status?: string;
  productId?: number;
  productName?: string;
  productSlug?: string;
  productImage?: string;
  reports?: Array<{
    id: number;
    reason: string;
    status: string;
    description?: string;
    created_at: string;
  }>;
  customer?: {
    id: number;
    fullName: string;
    email: string;
    phone?: string;
  } | null;
  medicine?: {
    id: number;
    medicineName: string;
    slug?: string;
    imageUrl?: string;
  } | null;
}

export interface ModerationReport {
  id: number;
  review_id: number;
  reporter_customer_id?: number;
  reporter_employee_id?: number;
  reason: string;
  description?: string;
  status: string;
  resolved_by_employee_id?: number;
  resolver_note?: string;
  created_at: string;
  resolved_at?: string;
  reviews?: {
    id: number;
    comment: string;
    rating_stars: number;
    status: string;
    created_at: string;
    medicines?: { id: number; medicine_name: string; slug: string; image_url?: string };
    customers?: { id: number; full_name: string; email: string };
  };
  reporter_customer?: { id: number; full_name: string; email: string };
  reporter_employee?: { id: number; full_name: string; email: string; role: string };
  resolver_employee?: { id: number; full_name: string; role: string };
}

export interface ModerationAuditLog {
  id: number;
  review_id?: number;
  action: string;
  performed_by_employee_id?: number;
  performed_by_customer_id?: number;
  performed_by_role?: string;
  reason?: string;
  meta?: any;
  created_at: string;
  reviews?: {
    id: number;
    comment: string;
    rating_stars: number;
    status: string;
    medicines?: { id: number; medicine_name: string };
  };
  performed_by_employee?: { id: number; full_name: string; role: string; email: string };
  performed_by_customer?: { id: number; full_name: string; email: string };
}

export interface ReviewStats {
  totalReviews: number;
  averageRating: number;
  starCounts: Record<number, number>;
}

export interface ProductReviewsResponse {
  success: boolean;
  message: string;
  data: ReviewItem[];
  stats: ReviewStats;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface AdminReviewQueryParams {
  page?: number;
  limit?: number;
  status?: string;
  rating?: number;
  search?: string;
}

export const reviewService = {
  // Public
  getProductReviews: async (
    idOrSlug: string | number,
    params?: {
      page?: number;
      limit?: number;
      rating?: number;
      sort?: 'newest' | 'oldest' | 'highest_rating' | 'lowest_rating' | 'most_helpful';
    },
  ): Promise<ProductReviewsResponse> => {
    return apiClient.get(`/products/${idOrSlug}/reviews`, { params });
  },

  voteHelpful: async (
    reviewId: number,
    isUnvote?: boolean,
  ): Promise<{
    success: boolean;
    message: string;
    data: { reviewId: number; helpfulCount: number; isVoted?: boolean };
  }> => {
    return apiClient.post(`/reviews/${reviewId}/helpful`, { isUnvote });
  },

  // Customer
  checkCanReview: async (
    idOrSlug: string | number,
  ): Promise<{
    success: boolean;
    data: {
      productId: number;
      canReview: boolean;
      isPurchased: boolean;
      alreadyReviewed: boolean;
      existingReviewId: number | null;
      message: string;
    };
  }> => {
    return apiClient.get(`/products/${idOrSlug}/reviews/can-review`);
  },

  createProductReview: async (
    idOrSlug: string | number,
    data: { ratingStars: number; comment: string; images?: string[] },
  ): Promise<{ success: boolean; message: string; data: ReviewItem }> => {
    return apiClient.post(`/products/${idOrSlug}/reviews`, data);
  },

  uploadReviewImage: async (
    file: File,
  ): Promise<{ success: boolean; message: string; data: { imageUrl: string; publicId?: string } }> => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post('/reviews/upload-image', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },

  getCustomerMyReviews: async (params?: {
    page?: number;
    limit?: number;
  }): Promise<{
    success: boolean;
    data: ReviewItem[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> => {
    return apiClient.get('/customer/my-reviews', { params });
  },

  getCustomerPendingReviews: async (): Promise<{
    success: boolean;
    data: Array<{
      id: number;
      medicineName: string;
      slug: string;
      imageUrl?: string;
      unitPrice: number;
      orderDate?: string;
    }>;
  }> => {
    return apiClient.get('/customer/pending-reviews');
  },

  updateCustomerReview: async (
    id: number,
    data: { ratingStars?: number; comment?: string; images?: string[] },
  ): Promise<{ success: boolean; message: string; data: ReviewItem }> => {
    return apiClient.patch(`/customer/reviews/${id}`, data);
  },

  deleteCustomerReview: async (
    id: number,
  ): Promise<{ success: boolean; message: string }> => {
    return apiClient.delete(`/customer/reviews/${id}`);
  },

  reportReview: async (
    reviewId: number,
    data: { reason: string; description?: string },
  ): Promise<{ success: boolean; message: string; data?: any }> => {
    return apiClient.post(`/reviews/${reviewId}/report`, data);
  },

  // Admin
  getAllReviewsForAdmin: async (
    params?: AdminReviewQueryParams,
  ): Promise<{
    success: boolean;
    data: ReviewItem[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> => {
    return apiClient.get('/admin/reviews', { params });
  },

  updateReviewStatus: async (
    id: number,
    status: 'APPROVED' | 'PENDING' | 'HIDDEN' | 'SPAM',
    reason?: string,
  ): Promise<{ success: boolean; message: string; data: any }> => {
    return apiClient.patch(`/admin/reviews/${id}/status`, { status, reason });
  },

  replyToReview: async (
    id: number,
    reply: string,
    repliedByName?: string,
  ): Promise<{ success: boolean; message: string; data: any }> => {
    return apiClient.post(`/admin/reviews/${id}/reply`, { reply, repliedByName });
  },

  deleteReview: async (id: number): Promise<{ success: boolean; message: string }> => {
    return apiClient.delete(`/admin/reviews/${id}`);
  },

  // Admin - Moderation Reports & Audit
  getAdminReports: async (params?: {
    page?: number;
    limit?: number;
    status?: string;
    reason?: string;
  }): Promise<{
    success: boolean;
    data: ModerationReport[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> => {
    return apiClient.get('/admin/moderation/reports', { params });
  },

  resolveAdminReport: async (
    reportId: number,
    data: { note?: string; actionOnReview?: 'HIDE' | 'SPAM' | 'APPROVE' | 'KEEP' },
  ): Promise<{ success: boolean; message: string; data: any }> => {
    return apiClient.patch(`/admin/moderation/reports/${reportId}/resolve`, data);
  },

  dismissAdminReport: async (
    reportId: number,
    data?: { note?: string },
  ): Promise<{ success: boolean; message: string; data: any }> => {
    return apiClient.patch(`/admin/moderation/reports/${reportId}/dismiss`, data || {});
  },

  getAdminAuditLogs: async (params?: {
    page?: number;
    limit?: number;
    reviewId?: number;
    action?: string;
  }): Promise<{
    success: boolean;
    data: ModerationAuditLog[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> => {
    return apiClient.get('/admin/moderation/audit-logs', { params });
  },
};
