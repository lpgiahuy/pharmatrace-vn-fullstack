import { apiClient } from './api.client';
import {
  Facility,
  FacilityQuery,
  FacilityStats,
  PaginatedFacilityResponse,
} from '../types/facility.types';

export const facilityService = {
  async getFacilities(params?: FacilityQuery): Promise<PaginatedFacilityResponse> {
    const res = await apiClient.get('/facilities', { params });
    return res as unknown as PaginatedFacilityResponse;
  },

  async getDropdownList(): Promise<{ success: boolean; data: Facility[] }> {
    const res = await apiClient.get('/facilities/dropdown');
    return res as unknown as { success: boolean; data: Facility[] };
  },

  async getStats(): Promise<{ success: boolean; data: FacilityStats }> {
    const res = await apiClient.get('/facilities/stats');
    return res as unknown as { success: boolean; data: FacilityStats };
  },

  async getFacilityById(id: number): Promise<{ success: boolean; data: Facility }> {
    const res = await apiClient.get(`/facilities/${id}`);
    return res as unknown as { success: boolean; data: Facility };
  },

  async createFacility(data: Partial<Facility>): Promise<{ success: boolean; data: Facility }> {
    const res = await apiClient.post('/facilities', data);
    return res as unknown as { success: boolean; data: Facility };
  },

  async updateFacility(id: number, data: Partial<Facility>): Promise<{ success: boolean; data: Facility }> {
    const res = await apiClient.patch(`/facilities/${id}`, data);
    return res as unknown as { success: boolean; data: Facility };
  },

  async deleteFacility(id: number): Promise<{ success: boolean; message: string }> {
    const res = await apiClient.delete(`/facilities/${id}`);
    return res as unknown as { success: boolean; message: string };
  },
};
