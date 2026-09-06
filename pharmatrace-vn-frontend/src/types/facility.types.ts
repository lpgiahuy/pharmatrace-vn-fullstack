export type FacilityType = 'MANUFACTURER' | 'CENTRAL_WAREHOUSE' | 'BRANCH_WAREHOUSE' | 'PHARMACY';

export interface Facility {
  id: number;
  name: string;
  type: FacilityType | string;
  rawType?: string;
  address?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  createdAt?: string;
  totalEmployees?: number;
  totalInventories?: number;
}

export interface FacilityStats {
  total: number;
  manufacturers: number;
  warehouses: number;
  pharmacies: number;
}

export interface FacilityQuery {
  page?: number;
  limit?: number;
  search?: string;
  type?: string;
}

export interface PaginatedFacilityResponse {
  success: boolean;
  message?: string;
  data: Facility[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
