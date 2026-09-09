import { apiClient } from './api.client';
import {
  Product,
  ProductQuery,
  PackagingSpecification,
  PaginatedProductsResponse,
  ProductPayload,
} from '@/types/product.types';

export const productService = {
  // Public
  async getProducts(query?: ProductQuery): Promise<PaginatedProductsResponse> {
    return apiClient.get('/products', { params: query });
  },

  async getPackagings(): Promise<{ success: boolean; data: PackagingSpecification[] }> {
    return apiClient.get('/products/packagings');
  },

  async getBrands(): Promise<{ success: boolean; data: string[] }> {
    return apiClient.get('/products/brands');
  },

  async getProductById(idOrSlug: number | string): Promise<{ success: boolean; data: Product }> {
    return apiClient.get(`/products/${idOrSlug}`);
  },

  // Admin
  async createProduct(payload: ProductPayload): Promise<{ success: boolean; data: Product }> {
    return apiClient.post('/admin/products', payload);
  },

  async updateProduct(id: number, payload: Partial<ProductPayload>): Promise<{ success: boolean; data: Product }> {
    return apiClient.put(`/admin/products/${id}`, payload);
  },

  async deleteProduct(id: number): Promise<{ success: boolean; message: string; data: any }> {
    return apiClient.delete(`/admin/products/${id}`);
  },

  async uploadProductImage(id: number, file: File): Promise<{ success: boolean; message: string; data: { imageUrl: string } }> {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post(`/admin/products/${id}/images`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },

  async uploadImageDirect(file: File): Promise<{ success: boolean; message: string; data: { imageUrl: string; publicId?: string } }> {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post('/admin/products/upload-image', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
};
