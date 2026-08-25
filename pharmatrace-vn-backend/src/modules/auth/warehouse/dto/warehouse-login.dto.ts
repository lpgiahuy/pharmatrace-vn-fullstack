import { IsEmail, IsNotEmpty, IsString, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class WarehouseLoginDto {
  @ApiProperty({
    example: "warehouse@pharmatrace.vn",
    description: "Warehouse staff email address",
  })
  @IsNotEmpty()
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: "password123",
    description: "Warehouse account password",
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password!: string;
}
