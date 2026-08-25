import { IsNotEmpty, IsString, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class UserChangePasswordDto {
  @ApiProperty({
    example: "0123456789",
    description: "Current active password",
  })
  @IsNotEmpty()
  @IsString()
  currentPassword: string;

  @ApiProperty({
    example: "newpassword123",
    description: "New password (minimum 6 characters)",
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  newPassword: string;
}
