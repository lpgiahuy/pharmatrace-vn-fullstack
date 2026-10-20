import { Controller, Post, Body, Get, Patch, UseGuards, HttpCode, HttpStatus } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from "@nestjs/swagger";
import { AuthUserService } from "./auth-user.service";
import { UserLoginDto } from "./dto/user-login.dto";
import { UserRegisterDto } from "./dto/user-register.dto";
import { UserUpdateProfileDto } from "./dto/user-update-profile.dto";
import { UserChangePasswordDto } from "./dto/user-change-password.dto";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { CurrentUser, CurrentUserPayload } from "../../../common/decorators/current-user.decorator";

@ApiTags("Auth")
@Controller("auth")
export class AuthUserController {
  constructor(private readonly authUserService: AuthUserService) {}

  @Post("register")
  @ApiOperation({
    summary: "Register a new customer account",
    description:
      "Registers a new retail customer account in the system database with Bronze tier.",
  })
  @ApiResponse({
    status: 201,
    description: "Customer account successfully created",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid input data or missing required fields",
  })
  @ApiResponse({
    status: 409,
    description: "Phone number or email address is already registered",
  })
  async register(@Body() dto: UserRegisterDto) {
    const data = await this.authUserService.registerCustomer(dto);
    return {
      success: true,
      message: "Registration successful",
      data,
    };
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Customer login",
    description:
      "Authenticates a retail customer using phone number or email address with password.",
  })
  @ApiResponse({
    status: 200,
    description: "Authenticated successfully with JWT access token",
  })
  @ApiResponse({
    status: 401,
    description: "Invalid credentials or inactive account",
  })
  async login(@Body() dto: UserLoginDto) {
    const data = await this.authUserService.loginCustomer(dto);
    return {
      success: true,
      message: "Login successful",
      data,
    };
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("bearerAuth")
  @ApiOperation({
    summary: "Get current logged-in profile (Customer & Staff Shared)",
    description:
      "Retrieves current authenticated profile details. Automatically resolves Customer profile (loyalty points, membership tier) or Staff/Employee profile (role, assigned facility).",
  })
  @ApiResponse({
    status: 200,
    description: "User profile retrieved successfully",
  })
  @ApiResponse({ status: 401, description: "Unauthorized access token" })
  async getMe(@CurrentUser() user: CurrentUserPayload) {
    const profile = await this.authUserService.getProfile(user.id);
    return {
      success: true,
      data: profile,
    };
  }

  @Get("loyalty-progress")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("bearerAuth")
  @ApiOperation({
    summary: "Get customer loyalty tier progress (Customer Specific)",
    description:
      "Returns current loyalty tier, next tier, reward points, and points missing to upgrade.",
  })
  @ApiResponse({
    status: 200,
    description: "Loyalty progress retrieved successfully",
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async getLoyaltyProgress(@CurrentUser() user: CurrentUserPayload) {
    const progress = await this.authUserService.getLoyaltyProgress(user.id);
    return {
      success: true,
      data: progress,
    };
  }

  @Patch("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("bearerAuth")
  @ApiOperation({
    summary: "Update profile information (Customer & Staff Shared)",
    description:
      "Updates current authenticated user profile details (full name, email address, or primary shipping address).",
  })
  @ApiResponse({ status: 200, description: "Profile updated successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async updateMe(@CurrentUser() user: CurrentUserPayload, @Body() dto: UserUpdateProfileDto) {
    const updated = await this.authUserService.updateProfile(user.id, dto);
    return {
      success: true,
      message: "Profile updated successfully",
      data: updated,
    };
  }

  @Patch("me/change-password")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("bearerAuth")
  @ApiOperation({
    summary: "Change account password (Customer & Staff Shared)",
    description:
      "Changes password for current authenticated user (Customer or Internal Staff) after verifying current active password.",
  })
  @ApiResponse({ status: 200, description: "Password changed successfully" })
  @ApiResponse({ status: 400, description: "Invalid password or mismatch" })
  @ApiResponse({ status: 401, description: "Current password is incorrect" })
  async changeMyPassword(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UserChangePasswordDto,
  ) {
    return this.authUserService.changePassword(user.id, dto);
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "User logout (Customer & Staff Shared)",
    description:
      "Logs out the user (Customer or Internal Staff) and invalidates current JWT session token.",
  })
  @ApiResponse({ status: 200, description: "Logged out successfully" })
  logout() {
    return {
      success: true,
      message: "Logged out successfully",
    };
  }
}
