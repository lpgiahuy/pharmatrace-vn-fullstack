import { IsEmail, IsInt, IsNotEmpty, IsString, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class AdminSetupDto {
  @ApiProperty({
    example: "Super Admin",
    description: "Full name of the initial SuperAdmin",
  })
  @IsNotEmpty()
  @IsString()
  fullName!: string;

  @ApiProperty({
    example: "admin@pharmatrace.vn",
    description: "SuperAdmin login email address",
  })
  @IsNotEmpty()
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: "password123",
    description: "SuperAdmin account password (minimum 6 characters)",
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiProperty({
    example: 1,
    description: "Assigned facility or head office ID (Required)",
  })
  @IsNotEmpty()
  @IsInt()
  facilityId!: number;
}
