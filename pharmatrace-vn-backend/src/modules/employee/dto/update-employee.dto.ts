import { IsEmail, IsString, MinLength, IsInt, IsOptional, IsIn } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { EMPLOYEE_ROLES, normalizeRole } from '../../../common/auth-identity';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateEmployeeDto {
  @ApiPropertyOptional({ example: 'john.doe@pharmatrace.vn', description: 'Employee email address' })
  @IsOptional()
  @IsEmail({}, { message: 'Must be a valid email address' })
  email?: string;

  @ApiPropertyOptional({ example: 'NewSecurePass123!', description: 'Optional new password (minimum 6 characters)' })
  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password?: string;

  @ApiPropertyOptional({ example: 'John Doe Updated', description: 'Full name of the employee' })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({ example: 'STORE_MANAGER', description: 'System role' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => normalizeRole(value) ?? value)
  @IsIn(EMPLOYEE_ROLES, { message: 'Role must be a supported employee role' })
  role?: string;

  @ApiPropertyOptional({ example: 2, description: 'Assigned facility ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Facility ID must be an integer' })
  facilityId?: number;

  @ApiPropertyOptional({ example: 'ACTIVE', description: 'Account status (ACTIVE or INACTIVE)' })
  @IsOptional()
  @IsString()
  @IsIn(['ACTIVE', 'INACTIVE'], { message: 'Status must be either ACTIVE or INACTIVE' })
  status?: string;
}
