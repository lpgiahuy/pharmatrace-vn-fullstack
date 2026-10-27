import { IsEmail, IsNotEmpty, IsString, MinLength, IsInt, IsOptional, IsIn } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { EMPLOYEE_ROLES, normalizeRole } from '../../../common/auth-identity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'john.doe@pharmatrace.vn', description: 'Employee email address' })
  @IsEmail({}, { message: 'Must be a valid email address' })
  @IsNotEmpty({ message: 'Email address is required' })
  email!: string;

  @ApiProperty({ example: 'SecurePass123!', description: 'Account password (minimum 6 characters)' })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password!: string;

  @ApiProperty({ example: 'John Doe', description: 'Full name of the employee' })
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  fullName!: string;

  @ApiProperty({
    example: 'STORE_MANAGER',
    description: 'System role (e.g. SUPER_ADMIN, STORE_MANAGER, WAREHOUSE_MANAGER, PHARMACIST)',
  })
  @IsString()
  @IsNotEmpty({ message: 'Role is required' })
  @Transform(({ value }) => normalizeRole(value) ?? value)
  @IsIn(EMPLOYEE_ROLES, { message: 'Role must be a supported employee role' })
  role!: string;

  @ApiProperty({ example: 1, description: 'Assigned facility ID' })
  @Type(() => Number)
  @IsInt({ message: 'Facility ID must be an integer' })
  @IsNotEmpty({ message: 'Facility ID is required' })
  facilityId!: number;
}
