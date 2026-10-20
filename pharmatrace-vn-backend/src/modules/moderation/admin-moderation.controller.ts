import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ContentModerationService } from './content-moderation.service';
import {
  AdminModerationQueryDto,
  ResolveReportDto,
  AdminAuditQueryDto,
} from './dto/admin-moderation-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Admin - Content Moderation & Reports')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'SuperAdmin', 'ADMIN', 'Admin')
@Controller('admin/moderation')
export class AdminModerationController {
  constructor(private readonly moderationService: ContentModerationService) {}

  @Get('reports')
  @ApiOperation({
    summary: 'Get all flagged review reports (SuperAdmin)',
    description: 'Retrieves user/shop reported reviews with status and reason filtering.',
  })
  @ApiResponse({ status: 200, description: 'Reports retrieved successfully' })
  async getReports(@Query() query: AdminModerationQueryDto) {
    const result = await this.moderationService.getReportsForAdmin(query);
    return {
      success: true,
      data: result.items,
      pagination: result.pagination,
    };
  }

  @Patch('reports/:id/resolve')
  @ApiOperation({
    summary: 'Resolve review report (SuperAdmin)',
    description: 'Marks report as resolved and optionally updates the target review status.',
  })
  @ApiResponse({ status: 200, description: 'Report resolved successfully' })
  async resolveReport(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ResolveReportDto,
  ) {
    const adminRole = user.role || 'SUPER_ADMIN';
    return this.moderationService.resolveReport(
      id,
      user.id,
      adminRole,
      dto.note,
      dto.actionOnReview,
    );
  }

  @Patch('reports/:id/dismiss')
  @ApiOperation({
    summary: 'Dismiss review report (SuperAdmin)',
    description: 'Dismisses report as invalid with a moderator note.',
  })
  @ApiResponse({ status: 200, description: 'Report dismissed successfully' })
  async dismissReport(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ResolveReportDto,
  ) {
    const adminRole = user.role || 'SUPER_ADMIN';
    return this.moderationService.dismissReport(id, user.id, adminRole, dto.note);
  }

  @Get('audit-logs')
  @ApiOperation({
    summary: 'Get moderation audit trail (SuperAdmin)',
    description: 'Retrieves all automated and human moderation audit entries.',
  })
  @ApiResponse({ status: 200, description: 'Audit logs retrieved successfully' })
  async getAuditLogs(@Query() query: AdminAuditQueryDto) {
    const result = await this.moderationService.getAuditLogs(query);
    return {
      success: true,
      data: result.items,
      pagination: result.pagination,
    };
  }
}
