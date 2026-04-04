import { PermissionsController } from './permissions.controller';

describe('PermissionsController', () => {
  let controller: PermissionsController;
  let permissionsService: {
    getAllPermissions: jest.Mock;
    getPermissionByCode: jest.Mock;
  };

  beforeEach(() => {
    permissionsService = {
      getAllPermissions: jest.fn(),
      getPermissionByCode: jest.fn(),
    };
    controller = new PermissionsController(permissionsService as never);
  });

  describe('listPermissions', () => {
    it('should return all permissions without filters', async () => {
      const mockPerms = [
        { id: '1', code: 'documents:read', resource: 'documents', action: 'read', category: 'content' },
      ];
      permissionsService.getAllPermissions.mockResolvedValue(mockPerms);

      const result = await controller.listPermissions({} as never);

      expect(result).toEqual({ success: true, data: mockPerms });
      expect(permissionsService.getAllPermissions).toHaveBeenCalledWith({
        category: undefined,
        resource: undefined,
      });
    });

    it('should pass category and resource filters', async () => {
      permissionsService.getAllPermissions.mockResolvedValue([]);

      await controller.listPermissions({ category: 'admin', resource: 'dashboard' } as never);

      expect(permissionsService.getAllPermissions).toHaveBeenCalledWith({
        category: 'admin',
        resource: 'dashboard',
      });
    });
  });

  describe('getPermissionByCode', () => {
    it('should return a permission by code', async () => {
      const perm = { id: '1', code: 'documents:read', resource: 'documents' };
      permissionsService.getPermissionByCode.mockResolvedValue(perm);

      const result = await controller.getPermissionByCode('documents:read');

      expect(result).toEqual({ success: true, data: perm });
      expect(permissionsService.getPermissionByCode).toHaveBeenCalledWith('documents:read');
    });
  });
});
