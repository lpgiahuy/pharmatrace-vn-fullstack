import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { requireCustomer } from '../auth-identity';

@Injectable()
export class CustomerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    requireCustomer(context.switchToHttp().getRequest().user);
    return true;
  }
}
