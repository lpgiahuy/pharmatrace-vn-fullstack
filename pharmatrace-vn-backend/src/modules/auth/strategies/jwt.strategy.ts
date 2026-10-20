import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";

export interface JwtPayload {
  id?: number;
  sub?: number;
  role?: string;
  facilityId?: number;
  type?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>("JWT_SECRET") ||
        "pharmatrace-vn-jwt-secret-key-2026",
    });
  }

  validate(payload: JwtPayload) {
    const userId = payload.id || payload.sub;
    const role = payload.role || "CUSTOMER";

    if (!userId) {
      throw new UnauthorizedException("Invalid or expired authorization token");
    }

    return {
      id: userId,
      role,
      facilityId: payload.facilityId || null,
      type: payload.type || "customer",
    };
  }
}
