import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { UserRole } from '../types/auth.types';
import { RolesGuard } from '../guards/roles.guard';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Доступ любому вошедшему, включая покупателя без магазина. Нужен там, где
 * продавцом ещё не стали, но действие ведёт именно к этому — создание магазина.
 */
export const AnyRole = () =>
  applyDecorators(UseGuards(RolesGuard), Roles('user', 'seller', 'admin'));

/** Эквивалент SellerGuard из ТЗ: доступ только продавцу. */
export const SellerOnly = () =>
  applyDecorators(UseGuards(RolesGuard), Roles('seller'));

/** Доступ и продавцу, и администратору — например, загрузка фото товара. */
export const SellerOrAdmin = () =>
  applyDecorators(UseGuards(RolesGuard), Roles('seller', 'admin'));

/** Эквивалент AdminGuard из ТЗ: доступ только администратору. */
export const AdminOnly = () =>
  applyDecorators(UseGuards(RolesGuard), Roles('admin'));
