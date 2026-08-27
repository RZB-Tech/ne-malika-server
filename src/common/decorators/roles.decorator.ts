import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { UserRole } from '../types/auth.types';
import { RolesGuard } from '../guards/roles.guard';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const AnyRole = () =>
  applyDecorators(UseGuards(RolesGuard), Roles('user', 'seller', 'admin'));

export const SellerOnly = () =>
  applyDecorators(UseGuards(RolesGuard), Roles('seller'));

export const SellerOrAdmin = () =>
  applyDecorators(UseGuards(RolesGuard), Roles('seller', 'admin'));

export const AdminOnly = () =>
  applyDecorators(UseGuards(RolesGuard), Roles('admin'));
