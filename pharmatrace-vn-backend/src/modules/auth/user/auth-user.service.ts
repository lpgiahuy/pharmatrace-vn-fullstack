import { Injectable, ConflictException, UnauthorizedException, NotFoundException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserLoginDto } from './dto/user-login.dto';
import { UserRegisterDto } from './dto/user-register.dto';
import { UserUpdateProfileDto } from './dto/user-update-profile.dto';
import { UserChangePasswordDto } from './dto/user-change-password.dto';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import type { customers } from '@prisma/client';
import { authActor, requireCustomer } from '../../../common/auth-identity';
import { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { staffProfile } from '../auth-profile';

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
    const email = (dto.email || '').trim().toLowerCase();
    if (!email) {
      throw new BadRequestException('Email address is required');
    }

    const password_hash = await bcrypt.hash(dto.password, 10);

    // Prisma materializes defaults into INSERT columns; use explicit columns so
    // the auth role cannot insert points, membership, status, or arbitrary IDs.
    const [newCustomer] = await this.prisma.withAuth((tx) => tx.$queryRaw<customers[]>`
      INSERT INTO public.customers (full_name, phone_number, email, password_hash, default_address)
      VALUES (${dto.name.trim()}, ${phone}, ${email}, ${password_hash}, ${dto.address?.trim() ?? null})
      RETURNING *
    `, { operation: 'register', identifier: phone }).catch((error) => {
      const isUnique = error?.code === '23505'
        || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        || error?.meta?.code === '23505'
        || (error?.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined)?.cause?.originalCode === '23505'
        || (error)?.originalCode === '23505'
        || (typeof error?.message === 'string' && error.message.includes('23505'));

      if (isUnique) {
        const errorMsg = String(error?.message || '');
        if (errorMsg.includes('customers_email_key') || errorMsg.includes('email')) {
          throw new ConflictException('Email is already registered');
        }
        if (errorMsg.includes('customers_phone_number_key') || errorMsg.includes('phone')) {
          throw new ConflictException('Phone number is already registered');
        }
        throw new ConflictException('Phone number or email is already registered');
      }
      throw error;
    });

    const token = this.jwtService.sign({ sub: newCustomer.id, id: newCustomer.id, role: 'CUSTOMER', type: 'customer' });
    return { user: sanitizeCustomer(newCustomer), accessToken: token };
  }

  async loginCustomer(dto: UserLoginDto) {
    const identifier = dto.identifier.trim().toLowerCase();

    const customer = await this.prisma.withAuth((tx) => tx.customers.findFirst({
      where: {
        OR: [
          { phone_number: identifier },
          { email: identifier },
        ],
      },
    }), { operation: 'customer_login', identifier });

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

  async getProfile(user: CurrentUserPayload) {
    const actor = authActor(user);
    return this.prisma.withAuth(async (tx) => {
      if (actor.type === 'employee') {
        const employee = await tx.employees.findUnique({ where: { id: actor.id }, include: { facilities: true } });
        if (!employee) throw new NotFoundException('Employee not found');
        return staffProfile(employee);
      }
      const customer = await tx.customers.findUnique({ where: { id: actor.id } });
      if (!customer) throw new NotFoundException('Customer not found');
      return sanitizeCustomer(customer);
    }, { actor });
  }

  async getLoyaltyProgress(user: CurrentUserPayload) {
    const customerId = requireCustomer(user);
    const customer = await this.prisma.withAuth((tx) => tx.customers.findUnique({
      where: { id: customerId },
    }), { actor: authActor(user) });
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

  async updateProfile(user: CurrentUserPayload, dto: UserUpdateProfileDto) {
    const actor = authActor(user);
    if (actor.type === 'employee') {
      if (dto.defaultAddress !== undefined) throw new BadRequestException('Employee profiles do not have a shipping address');
      const employee = await this.prisma.withAuth((tx) => tx.employees.update({
        where: { id: actor.id },
        data: {
          ...(dto.fullName !== undefined && { full_name: dto.fullName.trim() }),
          ...(dto.email !== undefined && { email: dto.email.trim().toLowerCase() }),
        },
        include: { facilities: true },
      }), { actor });
      return staffProfile(employee);
    }

    const updated = await this.prisma.withAuth((tx) => tx.customers.update({
      where: { id: actor.id },
      data: {
        ...(dto.fullName && { full_name: dto.fullName.trim() }),
        ...(dto.email && { email: dto.email.trim().toLowerCase() }),
        ...(dto.defaultAddress !== undefined && { default_address: dto.defaultAddress.trim() || null }),
      },
    }), { actor });

    return sanitizeCustomer(updated);
  }

  async changePassword(user: CurrentUserPayload, dto: UserChangePasswordDto) {
    const actor = authActor(user);
    const account = await this.prisma.withAuth(async (tx) => actor.type === 'customer'
      ? tx.customers.findUnique({ where: { id: actor.id } })
      : tx.employees.findUnique({ where: { id: actor.id } }), { actor });
    if (!account || !account.password_hash) throw new NotFoundException('Account not found');

    const ok = await bcrypt.compare(dto.currentPassword, account.password_hash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const hash = await bcrypt.hash(dto.newPassword, 10);
    const result = await this.prisma.withAuth((tx) => actor.type === 'customer'
      ? tx.customers.updateMany({ where: { id: actor.id, password_hash: account.password_hash }, data: { password_hash: hash } })
      : tx.employees.updateMany({ where: { id: actor.id, password_hash: account.password_hash }, data: { password_hash: hash } }), { actor });
    if (result.count !== 1) throw new ConflictException('Password changed concurrently; sign in again');

    return { success: true, message: 'Password changed successfully' };
  }
}
