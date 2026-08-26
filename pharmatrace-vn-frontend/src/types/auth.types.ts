export interface CustomerProfile {
  id: number;
  fullName: string;
  email: string | null;
  phone?: string | null;
  role: 'CUSTOMER';
  membershipTier?: string;
  rewardPoints?: number;
  defaultAddress?: string | null;
  status?: string;
  createdAt?: string;
}

export interface EmployeeProfile {
  id: number;
  fullName: string;
  email: string;
  role: 'SUPER_ADMIN' | 'PHARMACIST' | 'WAREHOUSE_STAFF' | 'STORE_MANAGER';
  jobTitle?: string;
  facilityId?: number | null;
  facility?: {
    id: number;
    name: string;
    type: string;
    address: string | null;
  } | null;
  status?: string;
  createdAt?: string;
}

export interface AuthResponse {
  accessToken: string;
  user: CustomerProfile | EmployeeProfile;
}

export interface CustomerLoginDto {
  identifier: string;
  password: string;
}

export interface StaffLoginDto {
  email: string;
  password: string;
}

export interface CustomerRegisterDto {
  name: string;
  phone: string;
  email?: string;
  password: string;
  address?: string;
}
