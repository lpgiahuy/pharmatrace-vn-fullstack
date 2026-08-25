import { Controller, Post, Body, HttpCode, HttpStatus } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { AuthWarehouseService } from "./auth-warehouse.service";
import { WarehouseLoginDto } from "./dto/warehouse-login.dto";

@ApiTags("Warehouse - Auth")
@Controller("warehouse/auth")
export class AuthWarehouseController {
  constructor(private readonly authWarehouseService: AuthWarehouseService) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Login to Warehouse WMS management system",
    description:
      "Authenticates warehouse logistics managers, inventory auditors, and factory warehouse staff.",
  })
  @ApiResponse({
    status: 200,
    description:
      "Warehouse WMS login successful, returns user information and JWT token",
  })
  @ApiResponse({
    status: 401,
    description: "Invalid email/password or unauthorized role",
  })
  async login(@Body() dto: WarehouseLoginDto) {
    const data = await this.authWarehouseService.loginWarehouseStaff(dto);
    return {
      success: true,
      message: "Warehouse WMS login successful!",
      data,
    };
  }
}
