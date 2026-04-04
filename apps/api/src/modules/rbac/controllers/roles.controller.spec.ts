import { RolesController } from './roles.controller';

describe('RolesController', () => {
  let controller: RolesController;
  let rolesService: {
    getHierarchyTree: jest.Mock;
    getHierarchyEdges: jest.Mock;
    listConstraints: jest.Mock;
    listRoleDefinitions: jest.Mock;
    getRoleDefinitionById: jest.Mock;
    createCustomRole: jest.Mock;
    updateCustomRole: jest.Mock;
    deleteCustomRole: jest.Mock;
  };

  const mockUser = { sub: 'user-1', organizationId: 'org-1', memberId: 'mem-1' };

  beforeEach(() => {
    rolesService = {
      getHierarchyTree: jest.fn(),
      getHierarchyEdges: jest.fn(),
      listConstraints: jest.fn(),
      listRoleDefinitions: jest.fn(),
      getRoleDefinitionById: jest.fn(),
      createCustomRole: jest.fn(),
      updateCustomRole: jest.fn(),
      deleteCustomRole: jest.fn(),
    };
    controller = new RolesController(rolesService as never);
  });

  describe('getHierarchy', () => {
    it('should return tree and edges', async () => {
      const tree = [{ id: 'r-1', roleName: 'Owner', children: [] }];
      const edges = [{ parentRoleId: 'r-1', childRoleId: 'r-2' }];
      rolesService.getHierarchyTree.mockResolvedValue(tree);
      rolesService.getHierarchyEdges.mockResolvedValue(edges);

      const result = await controller.getHierarchy();

      expect(result).toEqual({ success: true, data: { tree, edges } });
    });
  });

  describe('listConstraints', () => {
    it('should return constraints', async () => {
      const constraints = [{ id: 'c-1', constraintType: 'mutually_exclusive' }];
      rolesService.listConstraints.mockResolvedValue(constraints);

      const result = await controller.listConstraints();

      expect(result).toEqual({ success: true, data: constraints });
    });
  });

  describe('listRoles', () => {
    it('should pass organizationId when systemOnly is not set', async () => {
      rolesService.listRoleDefinitions.mockResolvedValue([]);

      await controller.listRoles(mockUser as never, {} as never);

      expect(rolesService.listRoleDefinitions).toHaveBeenCalledWith('org-1');
    });

    it('should pass undefined when systemOnly is true', async () => {
      rolesService.listRoleDefinitions.mockResolvedValue([]);

      await controller.listRoles(mockUser as never, { systemOnly: true } as never);

      expect(rolesService.listRoleDefinitions).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getRoleById', () => {
    it('should return role by ID', async () => {
      const role = { id: 'rd-1', name: 'Admin' };
      rolesService.getRoleDefinitionById.mockResolvedValue(role);

      const result = await controller.getRoleById('rd-1');

      expect(result).toEqual({ success: true, data: role });
    });
  });

  describe('createRole', () => {
    it('should create a custom role with user context', async () => {
      const dto = { name: 'Custom', slug: 'custom', permissionIds: ['p-1'] };
      const created = { id: 'new-1', name: 'Custom' };
      rolesService.createCustomRole.mockResolvedValue(created);

      const result = await controller.createRole(mockUser as never, dto as never);

      expect(result).toEqual({ success: true, data: created });
      expect(rolesService.createCustomRole).toHaveBeenCalledWith('org-1', dto, 'user-1');
    });
  });

  describe('updateRole', () => {
    it('should update a role with user context', async () => {
      const dto = { name: 'Updated' };
      const updated = { id: 'rd-1', name: 'Updated' };
      rolesService.updateCustomRole.mockResolvedValue(updated);

      const result = await controller.updateRole('rd-1', mockUser as never, dto as never);

      expect(result).toEqual({ success: true, data: updated });
      expect(rolesService.updateCustomRole).toHaveBeenCalledWith('rd-1', dto, 'user-1');
    });
  });

  describe('deleteRole', () => {
    it('should delete a role', async () => {
      rolesService.deleteCustomRole.mockResolvedValue(undefined);

      const result = await controller.deleteRole('rd-1', mockUser as never);

      expect(result).toEqual({ success: true });
      expect(rolesService.deleteCustomRole).toHaveBeenCalledWith('rd-1', 'user-1');
    });
  });
});
