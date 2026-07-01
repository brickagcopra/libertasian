import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';

import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';

const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

describe('AccountingController', () => {
  let controller: AccountingController;
  let accountingService: {
    getChartOfAccounts: jest.Mock;
    listPeriods: jest.Mock;
    closePeriod: jest.Mock;
    listJournalEntries: jest.Mock;
    createJournalEntry: jest.Mock;
    getJournalEntry: jest.Mock;
    postJournalEntry: jest.Mock;
    voidJournalEntry: jest.Mock;
    getTrialBalance: jest.Mock;
    getGeneralLedger: jest.Mock;
  };

  const USER_ID = '00000000-0000-0000-0000-0000000000aa';
  const PERIOD_ID = '11111111-1111-1111-1111-111111111111';
  const ENTRY_ID = '22222222-2222-2222-2222-222222222222';

  beforeEach(async () => {
    accountingService = {
      getChartOfAccounts: jest.fn().mockResolvedValue([]),
      listPeriods: jest.fn().mockResolvedValue([]),
      closePeriod: jest.fn().mockResolvedValue({ id: PERIOD_ID, status: 'closed' }),
      listJournalEntries: jest.fn().mockResolvedValue({ data: [], nextCursor: undefined, hasNext: false }),
      createJournalEntry: jest.fn().mockResolvedValue({ id: ENTRY_ID, status: 'draft' }),
      getJournalEntry: jest.fn().mockResolvedValue({ id: ENTRY_ID }),
      postJournalEntry: jest.fn().mockResolvedValue({ id: ENTRY_ID, status: 'posted' }),
      voidJournalEntry: jest.fn().mockResolvedValue({ id: ENTRY_ID, status: 'voided' }),
      getTrialBalance: jest.fn().mockResolvedValue({ accounts: [], balanced: true }),
      getGeneralLedger: jest.fn().mockResolvedValue({ data: [], nextCursor: undefined, hasNext: false }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountingController],
      providers: [{ provide: AccountingService, useValue: accountingService }],
    })
      .overrideGuard(JwtAuthGuard).useValue(mockGuard)
      .overrideGuard(MfaGuard).useValue(mockGuard)
      .overrideGuard(TenantGuard).useValue(mockGuard)
      .overrideGuard(PermissionsGuard).useValue(mockGuard)
      .compile();

    controller = module.get<AccountingController>(AccountingController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('auth gate', () => {
    it('declares Jwt + Mfa + Tenant + Permissions guards via @UseGuards', () => {
      // Stripping any one of these would let org owners of free personal
      // orgs reach platform accounting endpoints, so the spec pins the
      // declaration here.
      const guards = (Reflect.getMetadata(GUARDS_METADATA, AccountingController) ?? []) as unknown[];
      expect(guards).toEqual([JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard]);
    });

    it('requires the admin:billing platform permission', () => {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, AccountingController)).toEqual({
        permissions: ['admin:billing'],
        mode: 'any',
      });
    });

    it('carries no org-role gate on the class or any handler', () => {
      // The old @Roles('owner', 'admin') gate passed for every
      // self-registered user (each is owner of their personal org).
      expect(Reflect.getMetadata(ROLES_KEY, AccountingController)).toBeUndefined();
      for (const handler of [
        AccountingController.prototype.closePeriod,
        AccountingController.prototype.postJournalEntry,
        AccountingController.prototype.voidJournalEntry,
      ]) {
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
      }
    });
  });

  describe('handlers', () => {
    it('closePeriod delegates to service with acting user', async () => {
      const result = await controller.closePeriod(PERIOD_ID, USER_ID);
      expect(result.success).toBe(true);
      expect(accountingService.closePeriod).toHaveBeenCalledWith(PERIOD_ID, USER_ID);
    });

    it('postJournalEntry delegates to service with acting user', async () => {
      const result = await controller.postJournalEntry(ENTRY_ID, USER_ID);
      expect(result.success).toBe(true);
      expect(accountingService.postJournalEntry).toHaveBeenCalledWith(ENTRY_ID, USER_ID);
    });

    it('voidJournalEntry delegates to service with acting user', async () => {
      const dto = { reason: 'duplicate entry' } as never;
      const result = await controller.voidJournalEntry(ENTRY_ID, dto, USER_ID);
      expect(result.success).toBe(true);
      expect(accountingService.voidJournalEntry).toHaveBeenCalledWith(ENTRY_ID, USER_ID, dto);
    });

    it('listJournalEntries maps query params to service filters', async () => {
      const result = await controller.listJournalEntries({
        period: PERIOD_ID,
        status: 'posted',
        limit: 20,
      } as never);
      expect(result.success).toBe(true);
      expect(accountingService.listJournalEntries).toHaveBeenCalledWith({
        periodId: PERIOD_ID,
        status: 'posted',
        cursor: undefined,
        limit: 20,
      });
    });
  });
});
