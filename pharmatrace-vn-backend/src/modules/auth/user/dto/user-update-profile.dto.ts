import { IsEmail, IsOptional, IsString } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class UserUpdateProfileDto {
  @ApiPropertyOptional({
    example: "Nguyen Van A",
    description: "Updated full name",
  })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({
    example: "customer@pharmatrace.vn",
    description: "Updated email address",
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: "123 Nguyen Hue, Q1",
    description: "Updated primary shipping address",
  })
  @IsOptional()
  @IsString()
  defaultAddress?: string;
}
