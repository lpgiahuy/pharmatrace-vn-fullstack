import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export class CurrentUserPayload {
  id: number;
  role?: string;
  facilityId?: number;
  type?: string;
  [key: string]: unknown;
}

export const CurrentUser = createParamDecorator(
  (
    data: keyof CurrentUserPayload | undefined,
    ctx: ExecutionContext,
  ): unknown => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: CurrentUserPayload }>();
    const user = request.user;
    return data && user ? user[data] : user;
  },
);
