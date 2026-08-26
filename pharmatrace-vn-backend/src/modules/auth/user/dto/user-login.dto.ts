import { IsNotEmpty, IsString, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class UserLoginDto {
  @ApiProperty({
    example: "customer@pharmatrace.vn",
    description:
      "Retail customer phone number (e.g. 0123456789) or email address",
  })
  @IsNotEmpty()
  @IsString()
  identifier!: string;

  @ApiProperty({
    example: "0123456789",
    description: "Customer account password",
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password!: string;
}
