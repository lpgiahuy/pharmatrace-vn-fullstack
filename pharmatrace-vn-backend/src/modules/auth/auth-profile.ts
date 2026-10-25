import { normalizeRole } from '../../common/auth-identity';

export function staffProfile(employee: any) {
  return {
    id: employee.id,
    fullName: employee.full_name,
    email: employee.email,
    role: normalizeRole(employee.role || ''),
    jobTitle: employee.job_title,
    status: employee.status,
    facilityId: employee.facility_id,
    facility: employee.facilities ? {
      id: employee.facilities.id, name: employee.facilities.facility_name,
      type: employee.facilities.facility_type, address: employee.facilities.address,
    } : null,
    createdAt: employee.created_at,
  };
}

