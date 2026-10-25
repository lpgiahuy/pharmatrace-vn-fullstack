import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigService } from "@nestjs/config";

import { AuthUserController } from "./user/auth-user.controller";
import { AuthUserService } from "./user/auth-user.service";

import { AuthAdminController } from "./admin/auth-admin.controller";
import { AuthAdminService } from "./admin/auth-admin.service";

import { AuthWarehouseController } from "./warehouse/auth-warehouse.controller";
import { AuthWarehouseService } from "./warehouse/auth-warehouse.service";

import { JwtStrategy } from "./strategies/jwt.strategy";
import { RolesGuard } from "../../common/guards/roles.guard";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>("JWT_SECRET"),
        signOptions: {
          expiresIn: (configService.get<string>("JWT_EXPIRES_IN") ||
            "7d") as any,
        },
      }),
    }),
  ],
  controllers: [
    AuthUserController,
    AuthAdminController,
    AuthWarehouseController,
  ],
  providers: [
    AuthUserService,
    AuthAdminService,
    AuthWarehouseService,
    JwtStrategy,
    RolesGuard,
  ],
  exports: [
    AuthUserService,
    AuthAdminService,
    AuthWarehouseService,
    JwtStrategy,
    PassportModule,
  ],
})
export class AuthModule {}
