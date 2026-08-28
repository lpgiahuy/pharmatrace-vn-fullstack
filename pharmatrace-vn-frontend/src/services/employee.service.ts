import { apiClient } from './api.client';

export interface Facility {
  id: number;
  name: string;
  type: string;
  address?: string;
}

export interface Employee {
  id: number;
  fullName: string;
  email: string;
  role: string;
  status: 'ACTIVE' | 'INACTIVE';
  facilityId: number;
  facility?: Facility | null;
  createdAt?: string;
}

export interface EmployeeQuery {
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
  facilityId?: number;
  status?: string;
}

export interface PaginatedEmployeeResponse {
  success: boolean;
  message?: string;
  data: Employee[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export const employeeService = {
  async getEmployees(params?: EmployeeQuery): Promise<PaginatedEmployeeResponse> {
    const res = await apiClient.get('/admin/employees', { params });
    return res as unknown as PaginatedEmployeeResponse;
  },

  async createEmployee(data: {
    fullName: string;
    email: string;
    password?: string;
    role: string;
    facilityId: number;
  }) {
    const res = await apiClient.post('/admin/employees', data);
    return res;
  },

  async updateEmployee(
    id: number,
    data: {
      fullName?: string;
      email?: string;
      password?: string;
      role?: string;
      facilityId?: number;
      status?: string;
    }
  ) {
    const res = await apiClient.patch(`/admin/employees/${id}`, data);
    return res;
  },

  async updateEmployeeStatus(id: number, status: 'ACTIVE' | 'INACTIVE') {
    const res = await apiClient.patch(`/admin/employees/${id}/status`, { status });
    return res;
  },

  async deleteEmployee(id: number) {
    const res = await apiClient.delete(`/admin/employees/${id}`);
    return res;
  },
};
