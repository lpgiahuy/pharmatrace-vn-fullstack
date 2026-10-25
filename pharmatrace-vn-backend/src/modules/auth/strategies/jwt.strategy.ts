import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthActor, normalizeRole } from '../../../common/auth-identity';

export interface JwtPayload {
  id?: number;
  sub?: number;
  role?: string;
  facilityId?: number;
  type?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService, private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>("JWT_SECRET"),
    });
  }

  async validate(payload: JwtPayload) {
    const userId = payload.id ?? payload.sub;
    const role = normalizeRole(payload.role);
    if (!userId || !Number.isInteger(userId) || userId <= 0
      || (payload.id !== undefined && payload.sub !== undefined && payload.id !== payload.sub)
      || !role || (payload.type !== 'customer' && payload.type !== 'employee')
      || (payload.type === 'customer' ? role !== 'CUSTOMER' : role === 'CUSTOMER')) {
      throw new UnauthorizedException("Invalid or expired authorization token");
    }

    const actor: AuthActor = { id: userId, type: payload.type, role, facilityId: payload.facilityId ?? null };
    return this.prisma.withAuth(async (tx) => {
      if (actor.type === 'customer') {
        const customer = await tx.customers.findUnique({ where: { id: actor.id } });
        if (!customer || customer.status !== 'ACTIVE' || actor.facilityId !== null) {
          throw new UnauthorizedException('Account is inactive or token identity changed');
        }
        return { ...actor, fullName: customer.full_name };
      }
      const employee = await tx.employees.findUnique({ where: { id: actor.id } });
      if (!employee || employee.status !== 'ACTIVE' || normalizeRole(employee.role || '') !== role
        || (employee.facility_id ?? null) !== actor.facilityId) {
        throw new UnauthorizedException('Account permissions changed; sign in again');
      }
      return { ...actor, fullName: employee.full_name };
    }, { actor });
  }
}
