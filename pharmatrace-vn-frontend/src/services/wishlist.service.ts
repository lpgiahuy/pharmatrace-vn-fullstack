import { apiClient } from './api.client';

export interface WishlistItemPackagingOption {
  id: number;
  unitName: string;
  price: number;
  originalPrice?: number | null;
  discountPercent?: number;
  isBaseUnit?: boolean;
}

export interface WishlistItem {
  id: number;
  medicineName: string;
  slug: string;
  imageUrl?: string;
  manufacturer?: string;
  price: number;
  originalPrice?: number | null;
  unitName: string;
  unitQuantity?: number;
  variantId?: number | null;
  packagingOptions?: WishlistItemPackagingOption[];
  isPrescription: boolean;
  status: string;
  totalStock?: number;
  addedAt: string;
}

export interface WishlistPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface WishlistResponse {
  success: boolean;
  message?: string;
  data: WishlistItem[];
  pagination: WishlistPagination;
}

export interface WishlistQueryParams {
  page?: number;
  limit?: number;
  sort?: 'newest' | 'oldest' | 'price_asc' | 'price_desc';
  search?: string;
}

export const wishlistService = {
  getWishlist: async (params?: WishlistQueryParams): Promise<WishlistResponse> => {
    return apiClient.get('/customer/wishlist', { params });
  },

  checkIsWishlisted: async (
    productId: number,
  ): Promise<{ success: boolean; data: { productId: number; isWishlisted: boolean } }> => {
    return apiClient.get(`/customer/wishlist/check/${productId}`);
  },

  checkBatchWishlist: async (
    productIds: number[],
  ): Promise<{ success: boolean; data: { wishlistedProductIds: number[] } }> => {
    return apiClient.post('/customer/wishlist/check-batch', { productIds });
  },

  addToWishlist: async (
    productId: number,
  ): Promise<{ success: boolean; message: string; data: any }> => {
    return apiClient.post(`/customer/wishlist/${productId}`);
  },

  removeFromWishlist: async (
    productId: number,
  ): Promise<{ success: boolean; message: string; data: any }> => {
    return apiClient.delete(`/customer/wishlist/${productId}`);
  },
};
