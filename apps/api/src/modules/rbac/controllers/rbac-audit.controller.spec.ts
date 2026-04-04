import { RbacAuditController } from './rbac-audit.controller';

describe('RbacAuditController', () => {
  let controller: RbacAuditController;
  let prisma: {
    auditLog: { findMany: jest.Mock };
  };

  const mockUser = { sub: 'user-1', organizationId: 'org-1' };

  beforeEach(() => {
    prisma = {
      auditLog: { findMany: jest.fn() },
    };
    controller = new RbacAuditController(prisma as never);
  });

  describe('listAuditLogs', () => {
    it('should return paginated audit logs scoped to organization', async () => {
      const logs = [
        {
          id: 'log-1',
          action: 'role.assigned',
          entityType: 'member_role',
          entityId: 'mr-1',
          actorUserId: 'user-1',
          metadataJson: { roleSlug: 'editor' },
          createdAt: new Date('2026-01-15'),
          actor: { fullName: 'Admin User', email: 'admin@example.com' },
        },
      ];
      prisma.auditLog.findMany.mockResolvedValue(logs);

      const result = await controller.listAuditLogs(mockUser as never, {} as never);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: 'log-1',
        action: 'role.assigned',
        entityType: 'member_role',
        actorName: 'Admin User',
      });
      expect(result.meta.hasNext).toBe(false);
    });

    it('should apply action filter', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);

      await controller.listAuditLogs(mockUser as never, {
        action: ['role.assigned', 'role.removed'],
      } as never);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            action: { in: ['role.assigned', 'role.removed'] },
          }),
        }),
      );
    });

    it('should apply actorUserId filter', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);

      await controller.listAuditLogs(mockUser as never, {
        actorUserId: 'actor-1',
      } as never);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            actorUserId: 'actor-1',
          }),
        }),
      );
    });

    it('should apply date range filter', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);

      await controller.listAuditLogs(mockUser as never, {
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      } as never);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: new Date('2026-01-01'),
              lte: new Date('2026-01-31'),
            },
          }),
        }),
      );
    });

    it('should handle cursor pagination', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);

      await controller.listAuditLogs(mockUser as never, {
        cursor: 'cur-1',
        limit: 10,
      } as never);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 11,
          skip: 1,
          cursor: { id: 'cur-1' },
        }),
      );
    });

    it('should return hasNext = true when more items exist', async () => {
      // Return limit+1 items
      const logs = Array.from({ length: 3 }, (_, i) => ({
        id: `log-${i}`,
        action: 'role.assigned',
        entityType: 'member_role',
        entityId: `mr-${i}`,
        actorUserId: 'user-1',
        metadataJson: {},
        createdAt: new Date('2026-01-01'),
        actor: { fullName: 'User', email: 'u@test.com' },
      }));
      prisma.auditLog.findMany.mockResolvedValue(logs);

      const result = await controller.listAuditLogs(mockUser as never, { limit: 2 } as never);

      expect(result.data).toHaveLength(2);
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.nextCursor).toBe('log-1');
    });

    it('should default limit to 20', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);

      await controller.listAuditLogs(mockUser as never, {} as never);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 21 }),
      );
    });

    it('should always scope to org and RBAC entity types', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);

      await controller.listAuditLogs(mockUser as never, {} as never);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
            entityType: { in: ['member_role', 'role_definition'] },
          }),
        }),
      );
    });

    it('should handle null actor gracefully', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          action: 'role.assigned',
          entityType: 'member_role',
          entityId: 'mr-1',
          actorUserId: null,
          metadataJson: {},
          createdAt: new Date('2026-01-01'),
          actor: null,
        },
      ]);

      const result = await controller.listAuditLogs(mockUser as never, {} as never);

      expect(result.data[0].actorName).toBeNull();
    });
  });
});
