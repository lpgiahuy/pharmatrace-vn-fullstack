import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class UserRegisterDto {
  @ApiProperty({
    example: "Customer",
    description: "Customer full legal name",
  })
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiProperty({
    example: "0909123456",
    description: "Customer contact phone number",
  })
  @IsNotEmpty()
  @IsString()
  phone!: string;

  @ApiProperty({
    example: "customer@example.com",
    description: "Customer email address (required)",
  })
  @IsNotEmpty({ message: "Email address is required" })
  @IsEmail({}, { message: "Invalid email format" })
  email!: string;

  @ApiProperty({
    example: "password123",
    description: "Customer account password (minimum 6 characters)",
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiPropertyOptional({
    example: "123 Nguyen Hue, Ward 1, District 1, HCMC",
    description: "Primary shipping address (optional)",
  })
  @IsOptional()
  @IsString()
  address?: string;
}
