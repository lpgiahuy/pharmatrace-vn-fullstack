import { Controller, Post, Body, HttpCode, HttpStatus } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { AuthAdminService } from "./auth-admin.service";
import { AdminLoginDto } from "./dto/admin-login.dto";
import { AdminSetupDto } from "./dto/admin-setup.dto";

@ApiTags("Admin - Auth")
@Controller("admin/auth")
export class AuthAdminController {
  constructor(private readonly authAdminService: AuthAdminService) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Login to the admin management system (Admin/Staff)",
    description:
      "Authenticates internal management staff (SuperAdmin, Store Manager, Pharmacist) with email and password.",
  })
  @ApiResponse({
    status: 200,
    description: "Login successful, returns user information and JWT token",
  })
  @ApiResponse({ status: 401, description: "Invalid email or password" })
  async login(@Body() dto: AdminLoginDto) {
    const data = await this.authAdminService.loginStaff(dto);
    return {
      success: true,
      message: "Admin login successful!",
      data,
    };
  }

  @Post("setup")
  @ApiOperation({
    summary: "Public administrator setup is disabled",
    description:
      "Provision the initial administrator through the database administration process.",
  })
  @ApiResponse({
    status: 410,
    description: "Public setup is no longer available",
  })
  async setupAdmin(@Body() dto: AdminSetupDto) {
    const data = await this.authAdminService.setupInitialAdmin(dto);
    return {
      success: true,
      message: "SuperAdmin account initialized successfully!",
      data,
    };
  }
}
