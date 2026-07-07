import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { UserRole } from '../types/auth.types';
import { RolesGuard } from '../guards/roles.guard';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Эквивалент SellerGuard из ТЗ: доступ только продавцу. */
export const SellerOnly = () =>
  applyDecorators(UseGuards(RolesGuard), Roles('seller'));

/** Эквивалент AdminGuard из ТЗ: доступ только администратору. */
export const AdminOnly = () =>
  applyDecorators(UseGuards(RolesGuard), Roles('admin'));
