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
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { EmployeeService } from './employee.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeeQueryDto } from './dto/employee-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Admin - Employee Management')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'SuperAdmin')
@Controller('admin/employees')
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) { }

  @Get()
  @ApiOperation({
    summary: 'Get paginated employee list',
    description: 'Retrieves employees with pagination, role filter, facility filter, and search by name/email/title.',
  })
  @ApiResponse({ status: 200, description: 'Employees retrieved successfully' })
  async findAll(@Query() query: EmployeeQueryDto) {
    const result = await this.employeeService.findAll(query);
    return {
      success: true,
      message: 'Employees retrieved successfully',
      data: result.items,
      pagination: result.pagination,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get employee details by ID' })
  @ApiResponse({ status: 200, description: 'Employee retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.employeeService.findOne(id);
    return {
      success: true,
      message: 'Employee retrieved successfully',
      data,
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new employee' })
  @ApiResponse({ status: 201, description: 'Employee created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid payload or non-existent facility' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async create(@Body() dto: CreateEmployeeDto) {
    const data = await this.employeeService.create(dto);
    return {
      success: true,
      message: 'Employee created successfully',
      data,
    };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update employee details' })
  @ApiResponse({ status: 200, description: 'Employee updated successfully' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() currentUser: any,
  ) {
    const currentUserId = currentUser?.id || currentUser?.sub;
    if (currentUserId === id && dto.status === 'INACTIVE') {
      throw new BadRequestException('You cannot disable your own account');
    }
    const data = await this.employeeService.update(id, dto);
    return {
      success: true,
      message: 'Employee updated successfully',
      data,
    };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Activate or deactivate an employee account' })
  @ApiResponse({ status: 200, description: 'Employee status updated successfully' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: string,
    @CurrentUser() currentUser?: any,
  ) {
    const resolvedStatus = status ? status.toUpperCase() : 'ACTIVE';

    const currentUserId = currentUser?.id || currentUser?.sub;
    if (currentUserId === id && resolvedStatus === 'INACTIVE') {
      throw new BadRequestException('You cannot disable your own account');
    }

    const data = await this.employeeService.updateStatus(id, resolvedStatus);
    return {
      success: true,
      message: 'Employee status updated successfully',
      data,
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an employee account' })
  @ApiResponse({ status: 200, description: 'Employee deleted successfully' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser?: any,
  ) {
    const currentUserId = currentUser?.id || currentUser?.sub;
    if (currentUserId === id) {
      throw new BadRequestException('You cannot delete your own account');
    }
    const data = await this.employeeService.remove(id);
    return data;
  }
}
