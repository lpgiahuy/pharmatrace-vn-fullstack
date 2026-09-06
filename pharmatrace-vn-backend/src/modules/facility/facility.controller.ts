import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { FacilityService } from './facility.service';
import { CreateFacilityDto } from './dto/create-facility.dto';
import { UpdateFacilityDto } from './dto/update-facility.dto';
import { FacilityQueryDto } from './dto/facility-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Facilities')
@Controller('facilities')
export class FacilityController {
  constructor(private readonly facilityService: FacilityService) {}

  @Get()
  @ApiOperation({
    summary: 'Get paginated facilities list',
    description: 'Retrieves facilities with search by name/address, type filtering, and pagination.',
  })
  @ApiResponse({ status: 200, description: 'Facilities retrieved successfully' })
  async findAll(@Query() query: FacilityQueryDto) {
    const result = await this.facilityService.findAll(query);
    return {
      success: true,
      message: 'Facilities retrieved successfully',
      data: result.items,
      pagination: result.pagination,
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get facility statistics (total count by type)' })
  @ApiResponse({ status: 200, description: 'Facility stats retrieved successfully' })
  async getStats() {
    const data = await this.facilityService.getStats();
    return {
      success: true,
      message: 'Facility statistics retrieved successfully',
      data,
    };
  }

  @Get('dropdown')
  @ApiOperation({ summary: 'Get lightweight facility list for selection dropdowns' })
  @ApiResponse({ status: 200, description: 'Dropdown list retrieved successfully' })
  async getDropdownList() {
    const data = await this.facilityService.getDropdownList();
    return {
      success: true,
      message: 'Facilities retrieved successfully',
      data,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get facility details by ID' })
  @ApiResponse({ status: 200, description: 'Facility details retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Facility not found' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.facilityService.findOne(id);
    return {
      success: true,
      message: 'Facility retrieved successfully',
      data,
    };
  }

  @Post()
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'SuperAdmin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new facility (Admin only)' })
  @ApiResponse({ status: 201, description: 'Facility created successfully' })
  async create(@Body() dto: CreateFacilityDto) {
    const data = await this.facilityService.create(dto);
    return {
      success: true,
      message: 'Facility created successfully',
      data,
    };
  }

  @Patch(':id')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'SuperAdmin')
  @ApiOperation({ summary: 'Update facility by ID (Admin only)' })
  @ApiResponse({ status: 200, description: 'Facility updated successfully' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFacilityDto,
  ) {
    const data = await this.facilityService.update(id, dto);
    return {
      success: true,
      message: 'Facility updated successfully',
      data,
    };
  }

  @Delete(':id')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'SuperAdmin')
  @ApiOperation({ summary: 'Delete facility by ID (Admin only)' })
  @ApiResponse({ status: 200, description: 'Facility deleted successfully' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.facilityService.remove(id);
  }
}
