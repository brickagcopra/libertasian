import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateCustomRoleDto } from './create-custom-role.dto';

describe('CreateCustomRoleDto permissionIds validation', () => {
  async function validatePermissionIds(permissionIds: string[]) {
    const dto = plainToInstance(CreateCustomRoleDto, {
      name: 'Senior Paralegal',
      slug: 'senior-paralegal',
      permissionIds,
    });
    const errors = await validate(dto);
    return errors.find((e) => e.property === 'permissionIds');
  }

  it('accepts a version-0 (foundational seed) UUID', async () => {
    // Seeded RBAC permission IDs use RFC version nibble 0 (e.g. documents:read).
    const error = await validatePermissionIds(['a0000000-0000-0000-0000-000000000001']);
    expect(error).toBeUndefined();
  });

  it('rejects a non-UUID string', async () => {
    const error = await validatePermissionIds(['not-a-uuid']);
    expect(error).toBeDefined();
  });
});
