import { Injectable, ConflictException, UnauthorizedException, NotFoundException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserLoginDto } from './dto/user-login.dto';
import { UserRegisterDto } from './dto/user-register.dto';
import { UserUpdateProfileDto } from './dto/user-update-profile.dto';
import { UserChangePasswordDto } from './dto/user-change-password.dto';
import * as bcrypt from 'bcryptjs';

function sanitizeCustomer(customer: any) {
  return {
    id: customer.id,
    fullName: customer.full_name,
    email: customer.email,
    phone: customer.phone_number,
    role: 'CUSTOMER',
    membershipTier: customer.membership_tier,
    rewardPoints: customer.reward_points,
    defaultAddress: customer.default_address,
    status: customer.status,
    createdAt: customer.created_at,
  };
}

@Injectable()
export class AuthUserService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async registerCustomer(dto: UserRegisterDto) {
    const phone = dto.phone.trim();
    const email = dto.email ? dto.email.trim().toLowerCase() : null;

    const existing = await this.prisma.customers.findFirst({
      where: { OR: [{ phone_number: phone }, ...(email ? [{ email }] : [])] },
    });
    if (existing) throw new ConflictException('Phone number or email is already registered');

    const password_hash = await bcrypt.hash(dto.password, 10);

    const newCustomer = await this.prisma.customers.create({
      data: {
        full_name: dto.name.trim(),
        phone_number: phone,
        email,
        password_hash,
        membership_tier: 'BRONZE',
        reward_points: 0,
        default_address: dto.address?.trim() ?? null,
        status: 'ACTIVE',
      },
    });

    const token = this.jwtService.sign({ sub: newCustomer.id, id: newCustomer.id, role: 'CUSTOMER', type: 'customer' });
    return { user: sanitizeCustomer(newCustomer), accessToken: token };
  }

  async loginCustomer(dto: UserLoginDto) {
    const identifier = dto.identifier.trim().toLowerCase();

    const customer = await this.prisma.customers.findFirst({
      where: {
        OR: [
          { phone_number: identifier },
          { email: identifier },
        ],
      },
    });

    if (!customer || !customer.password_hash) {
      throw new UnauthorizedException('Invalid phone/email or password');
    }
    if (customer.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is deactivated or locked');
    }

    const ok = await bcrypt.compare(dto.password, customer.password_hash);
    if (!ok) throw new UnauthorizedException('Invalid phone/email or password');

    const token = this.jwtService.sign({
      sub: customer.id,
      id: customer.id,
      role: 'CUSTOMER',
      type: 'customer',
    });

    return { user: sanitizeCustomer(customer), accessToken: token };
  }

  async getProfile(customerId: number) {
    const customer = await this.prisma.customers.findUnique({
      where: { id: customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return sanitizeCustomer(customer);
  }

  async getLoyaltyProgress(customerId: number) {
    const customer = await this.prisma.customers.findUnique({
      where: { id: customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const points = customer.reward_points ?? 0;
    const tiers = [
      { tier: 'SILVER', min: 1000 },
      { tier: 'GOLD', min: 2500 },
      { tier: 'PLATINUM', min: 5000 },
      { tier: 'DIAMOND', min: 10000 },
    ];
    const next = tiers.find((t) => points < t.min) ?? { tier: 'MAX', min: points };

    return {
      currentTier: customer.membership_tier ?? 'BRONZE',
      nextTier: next.tier,
      rewardPoints: points,
      pointsNeeded: Math.max(0, next.min - points),
    };
  }

  async updateProfile(customerId: number, dto: UserUpdateProfileDto) {
    if (!customerId) throw new BadRequestException('Customer ID required');

    const updated = await this.prisma.customers.update({
      where: { id: customerId },
      data: {
        ...(dto.fullName && { full_name: dto.fullName.trim() }),
        ...(dto.email && { email: dto.email.trim().toLowerCase() }),
        ...(dto.defaultAddress && { default_address: dto.defaultAddress }),
      },
    });

    return sanitizeCustomer(updated);
  }

  async changePassword(customerId: number, dto: UserChangePasswordDto) {
    const customer = await this.prisma.customers.findUnique({ where: { id: customerId } });
    if (!customer || !customer.password_hash) throw new NotFoundException('Customer not found');

    const ok = await bcrypt.compare(dto.currentPassword, customer.password_hash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const hash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.customers.update({ where: { id: customerId }, data: { password_hash: hash } });

    return { success: true, message: 'Password changed successfully' };
  }
}
