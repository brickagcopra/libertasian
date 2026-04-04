import { SetMetadata } from '@nestjs/common';
import { API_KEY_PERMISSIONS_KEY } from '../guards/api-key-auth.guard';

/**
 * Decorator to specify required API key permissions for an endpoint.
 * Usage: @RequiredApiKeyPermissions('search', 'documents:read')
 */
export const RequiredApiKeyPermissions = (...permissions: string[]) =>
  SetMetadata(API_KEY_PERMISSIONS_KEY, permissions);
