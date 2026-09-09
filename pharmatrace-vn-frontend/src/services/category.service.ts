import { apiClient } from './api.client';
import {
  Category,
  CategoryTreeItem,
  CategoryPayload,
  CategoryResponse,
} from '@/types/category.types';

export const categoryService = {
  // Public
  async getCategories(): Promise<CategoryResponse<Category[]>> {
    return apiClient.get('/categories');
  },

  async getCategoryTree(): Promise<CategoryResponse<CategoryTreeItem[]>> {
    return apiClient.get('/categories/tree');
  },

  async getCategoryById(id: number): Promise<CategoryResponse<Category>> {
    return apiClient.get(`/categories/${id}`);
  },

  // Admin
  async createCategory(payload: CategoryPayload): Promise<CategoryResponse<Category>> {
    return apiClient.post('/admin/categories', payload);
  },

  async updateCategory(id: number, payload: Partial<CategoryPayload>): Promise<CategoryResponse<Category>> {
    return apiClient.put(`/admin/categories/${id}`, payload);
  },

  async deleteCategory(id: number): Promise<CategoryResponse<{ message: string; deletedId: number }>> {
    return apiClient.delete(`/admin/categories/${id}`);
  },
};
