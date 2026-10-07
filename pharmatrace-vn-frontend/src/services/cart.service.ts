import { apiClient } from './api.client';

export interface ServerCartPackagingOption {
  id: number;
  unitName: string;
  price: number;
  originalPrice?: number | null;
  discountPercent?: number;
  isBaseUnit?: boolean;
}

export interface ServerCartItem {
  id: string; // `${productId}-${variantId}`
  cartItemId: number;
  productId: number;
  slug: string;
  medicineName: string;
  imageUrl?: string | null;
  variantId: number;
  unitName: string;
  price: number;
  originalPrice?: number | null;
  discountPercent?: number;
  quantity: number;
  isPrescription: boolean;
  status: string;
  totalStock?: number;
  packagingOptions?: ServerCartPackagingOption[];
}

export interface ServerCartData {
  items: ServerCartItem[];
  totalItems: number;
  subtotal: number;
}

export interface CartResponse {
  success: boolean;
  message?: string;
  data: ServerCartData;
}

export const cartService = {
  getCart: async (): Promise<CartResponse> => {
    return apiClient.get('/customer/cart');
  },

  addToCart: async (variantId: number, quantity: number = 1): Promise<CartResponse> => {
    return apiClient.post('/customer/cart', { variantId, quantity });
  },

  updateQuantity: async (variantId: number, quantity: number): Promise<CartResponse> => {
    return apiClient.patch(`/customer/cart/${variantId}`, { quantity });
  },

  switchVariant: async (oldVariantId: number, newVariantId: number): Promise<CartResponse> => {
    return apiClient.patch('/customer/cart/switch-variant', { oldVariantId, newVariantId });
  },

  removeItem: async (variantId: number): Promise<CartResponse> => {
    return apiClient.delete(`/customer/cart/${variantId}`);
  },

  clearCart: async (): Promise<CartResponse> => {
    return apiClient.delete('/customer/cart');
  },

  syncCart: async (items: { variantId: number; quantity: number }[]): Promise<CartResponse> => {
    return apiClient.post('/customer/cart/sync', { items });
  },
};
