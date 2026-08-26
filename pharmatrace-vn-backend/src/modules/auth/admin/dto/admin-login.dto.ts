import { IsEmail, IsNotEmpty, IsString, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class AdminLoginDto {
  @ApiProperty({
    example: "admin@pharmatrace.vn",
    description: "Internal staff or admin email address",
  })
  @IsNotEmpty()
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: "password123",
    description: "Staff account password",
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password!: string;
}
