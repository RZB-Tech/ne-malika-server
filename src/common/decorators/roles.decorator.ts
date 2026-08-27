import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../types/auth.types';

// RolesGuard зарегистрирован глобально через APP_GUARD и читает ROLES_KEY —
// повторный UseGuards здесь заставлял бы guard срабатывать дважды.
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const AnyRole = () => Roles('user', 'seller', 'admin');

export const SellerOnly = () => Roles('seller');

export const SellerOrAdmin = () => Roles('seller', 'admin');

export const AdminOnly = () => Roles('admin');
