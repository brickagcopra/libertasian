import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { computeAccountBalance } from './utils/financial-math';
import type { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import type { VoidJournalEntryDto } from './dto/void-journal-entry.dto';

/**
 * Core double-entry accounting service.
 *
 * Invariants enforced:
 *   1. Every journal entry must balance: SUM(debits) === SUM(credits)
 *   2. Entries can only be posted to open periods
 *   3. Posted entries are immutable — voiding creates a reversal
 *   4. Each line must reference an active account
 */
@Injectable()
export class AccountingService {
  private readonly logger = new Logger(AccountingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // Journal Entry CRUD
  // ------------------------------------------------------------------

  /**
   * Create a journal entry with lines inside a transaction.
   * Validates: accounts exist & active, debits === credits, period is open.
   */
  async createJournalEntry(dto: CreateJournalEntryDto, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Resolve or create the accounting period
      const period = await this.getOrCreatePeriodTx(tx, new Date(dto.entryDate));

      if (period.status === 'CLOSED') {
        throw new BadRequestException(
          `Accounting period ${period.periodName} is closed`,
        );
      }

      // 2. Validate all account codes exist and are active
      const accountIds = dto.lines.map((l) => l.accountId);
      const accounts = await tx.chartOfAccount.findMany({
        where: { id: { in: accountIds } },
      });

      const accountMap = new Map(accounts.map((a) => [a.id, a]));
      for (const line of dto.lines) {
        const account = accountMap.get(line.accountId);
        if (!account) {
          throw new NotFoundException(`Account not found: ${line.accountId}`);
        }
        if (!account.isActive) {
          throw new BadRequestException(
            `Account ${account.code} (${account.name}) is inactive`,
          );
        }
      }

      // 3. Validate debits === credits (integer comparison, no rounding)
      const totalDebits = dto.lines.reduce((sum, l) => sum + l.debitAmount, 0);
      const totalCredits = dto.lines.reduce((sum, l) => sum + l.creditAmount, 0);

      if (totalDebits !== totalCredits) {
        throw new BadRequestException(
          `Journal entry does not balance: debits=${totalDebits}, credits=${totalCredits}`,
        );
      }

      if (totalDebits === 0) {
        throw new BadRequestException('Journal entry must have non-zero amounts');
      }

      // 4. Validate each line has either debit or credit, not both
      for (const line of dto.lines) {
        if (line.debitAmount > 0 && line.creditAmount > 0) {
          throw new BadRequestException(
            'A journal entry line cannot have both debit and credit amounts',
          );
        }
        if (line.debitAmount < 0 || line.creditAmount < 0) {
          throw new BadRequestException(
            'Journal entry line amounts must be non-negative',
          );
        }
      }

      // 5. Create the journal entry header + lines
      const entry = await tx.journalEntry.create({
        data: {
          periodId: period.id,
          entryDate: new Date(dto.entryDate),
          description: dto.description,
          sourceType: dto.sourceType ?? 'MANUAL',
          sourceRefId: dto.sourceRefId,
          status: 'DRAFT',
          notes: dto.notes,
          isAuto: dto.isAuto ?? false,
          lines: {
            create: dto.lines.map((line) => ({
              accountId: line.accountId,
              debitAmount: line.debitAmount,
              creditAmount: line.creditAmount,
              description: line.description,
              organizationId: line.organizationId,
              subscriptionId: line.subscriptionId,
            })),
          },
        },
        include: {
          lines: { include: { account: true } },
          period: true,
        },
      });

      return entry;
    });
  }

  /**
   * Post a draft journal entry — makes it immutable and affects account balances.
   */
  async postJournalEntry(id: string, userId: string) {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: { period: true },
    });

    if (!entry) {
      throw new NotFoundException(`Journal entry not found: ${id}`);
    }
    if (entry.status !== 'DRAFT') {
      throw new ConflictException(
        `Journal entry ${entry.entryNumber} is ${entry.status}, only DRAFT entries can be posted`,
      );
    }
    if (entry.period.status === 'CLOSED') {
      throw new BadRequestException(
        `Cannot post to closed period ${entry.period.periodName}`,
      );
    }

    const updated = await this.prisma.journalEntry.update({
      where: { id },
      data: {
        status: 'POSTED',
        postedById: userId,
        postedAt: new Date(),
      },
      include: {
        lines: { include: { account: true } },
        period: true,
      },
    });

    await this.auditService.log({
      actorUserId: userId,
      actorType: 'admin',
      action: 'accounting.journal_entry_posted',
      entityType: 'journal_entry',
      entityId: id,
      metadata: { entryNumber: updated.entryNumber },
    });

    return updated;
  }

  /**
   * Void a posted journal entry.
   * Creates a reversal entry with swapped debits/credits and auto-posts it.
   */
  async voidJournalEntry(id: string, userId: string, dto: VoidJournalEntryDto) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findUnique({
        where: { id },
        include: { lines: true, period: true },
      });

      if (!entry) {
        throw new NotFoundException(`Journal entry not found: ${id}`);
      }
      if (entry.status !== 'POSTED') {
        throw new ConflictException(
          `Only POSTED entries can be voided. Current status: ${entry.status}`,
        );
      }
      if (entry.period.status === 'CLOSED') {
        throw new BadRequestException(
          `Cannot void entries in closed period ${entry.period.periodName}`,
        );
      }

      // 1. Mark original as VOID
      await tx.journalEntry.update({
        where: { id },
        data: {
          status: 'VOID',
          voidedById: userId,
          voidedAt: new Date(),
          voidReason: dto.reason,
        },
      });

      // 2. Create reversal entry with swapped debits/credits
      const reversal = await tx.journalEntry.create({
        data: {
          periodId: entry.periodId,
          entryDate: new Date(),
          description: `REVERSAL of JE #${entry.entryNumber}: ${dto.reason}`,
          sourceType: entry.sourceType,
          sourceRefId: entry.sourceRefId,
          status: 'POSTED',
          postedById: userId,
          postedAt: new Date(),
          notes: `Reversal of voided entry #${entry.entryNumber}`,
          isAuto: true,
          lines: {
            create: entry.lines.map((line) => ({
              accountId: line.accountId,
              debitAmount: line.creditAmount, // swap
              creditAmount: line.debitAmount, // swap
              description: `Reversal: ${line.description ?? ''}`,
              organizationId: line.organizationId,
              subscriptionId: line.subscriptionId,
            })),
          },
        },
        include: {
          lines: { include: { account: true } },
          period: true,
        },
      });

      await this.auditService.log({
        actorUserId: userId,
        actorType: 'admin',
        action: 'accounting.journal_entry_voided',
        entityType: 'journal_entry',
        entityId: id,
        metadata: {
          entryNumber: entry.entryNumber,
          reversalEntryId: reversal.id,
          reversalEntryNumber: reversal.entryNumber,
          reason: dto.reason,
        },
      });

      return { voidedEntry: entry, reversalEntry: reversal };
    });
  }

  /**
   * Get a single journal entry with its lines and relations.
   */
  async getJournalEntry(id: string) {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: {
        lines: { include: { account: true, organization: { select: { id: true, name: true } } } },
        period: true,
        postedBy: { select: { id: true, fullName: true } },
        voidedBy: { select: { id: true, fullName: true } },
      },
    });

    if (!entry) {
      throw new NotFoundException(`Journal entry not found: ${id}`);
    }

    return entry;
  }

  /**
   * List journal entries with cursor-based pagination and filters.
   */
  async listJournalEntries(filters: {
    periodId?: string;
    status?: string;
    cursor?: string;
    limit?: number;
  }) {
    const limit = filters.limit ?? 20;

    const where: Prisma.JournalEntryWhereInput = {};
    if (filters.periodId) where.periodId = filters.periodId;
    if (filters.status) where.status = filters.status as 'DRAFT' | 'POSTED' | 'VOID';

    const entries = await this.prisma.journalEntry.findMany({
      where,
      take: limit + 1,
      ...(filters.cursor && { skip: 1, cursor: { id: filters.cursor } }),
      orderBy: { createdAt: 'desc' },
      include: {
        lines: { include: { account: { select: { id: true, code: true, name: true } } } },
        period: { select: { id: true, periodName: true } },
        postedBy: { select: { id: true, fullName: true } },
      },
    });

    const hasNext = entries.length > limit;
    const items = hasNext ? entries.slice(0, limit) : entries;
    const lastItem = items[items.length - 1];

    return {
      items,
      meta: {
        hasNext,
        nextCursor: hasNext && lastItem ? lastItem.id : undefined,
      },
    };
  }

  // ------------------------------------------------------------------
  // Trial Balance & General Ledger
  // ------------------------------------------------------------------

  /**
   * Generate trial balance for a period.
   * Aggregates all POSTED journal entry lines by account.
   */
  async getTrialBalance(periodId?: string) {
    const where: Prisma.JournalEntryLineWhereInput = {
      journalEntry: { status: 'POSTED' },
    };

    if (periodId) {
      where.journalEntry = { ...where.journalEntry, periodId } as Prisma.JournalEntryWhereInput;
    }

    const aggregations = await this.prisma.journalEntryLine.groupBy({
      by: ['accountId'],
      where,
      _sum: {
        debitAmount: true,
        creditAmount: true,
      },
    });

    // Fetch account details
    const accountIds = aggregations.map((a) => a.accountId);
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { id: { in: accountIds } },
      orderBy: { displayOrder: 'asc' },
    });

    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    const rows = aggregations
      .map((agg) => {
        const account = accountMap.get(agg.accountId);
        if (!account) return null;

        const debits = agg._sum.debitAmount ?? 0;
        const credits = agg._sum.creditAmount ?? 0;
        const balance = computeAccountBalance(debits, credits, account.normalBalance);

        return {
          accountId: account.id,
          accountCode: account.code,
          accountName: account.name,
          accountType: account.accountType,
          normalBalance: account.normalBalance,
          totalDebits: debits,
          totalCredits: credits,
          balance,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const acctA = accountMap.get(a!.accountId);
        const acctB = accountMap.get(b!.accountId);
        return (acctA?.displayOrder ?? 0) - (acctB?.displayOrder ?? 0);
      });

    const totalDebits = rows.reduce((sum, r) => sum + (r?.totalDebits ?? 0), 0);
    const totalCredits = rows.reduce((sum, r) => sum + (r?.totalCredits ?? 0), 0);

    return {
      rows,
      totals: {
        totalDebits,
        totalCredits,
        balanced: totalDebits === totalCredits,
      },
      periodId: periodId ?? null,
    };
  }

  /**
   * Get the balance for a specific account as of a date.
   * Sums all POSTED journal entry lines up to and including the date.
   */
  async getAccountBalance(accountId: string, asOfDate?: Date) {
    const account = await this.prisma.chartOfAccount.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new NotFoundException(`Account not found: ${accountId}`);
    }

    const where: Prisma.JournalEntryLineWhereInput = {
      accountId,
      journalEntry: {
        status: 'POSTED',
        ...(asOfDate && { entryDate: { lte: asOfDate } }),
      },
    };

    const result = await this.prisma.journalEntryLine.aggregate({
      where,
      _sum: {
        debitAmount: true,
        creditAmount: true,
      },
    });

    const totalDebits = result._sum.debitAmount ?? 0;
    const totalCredits = result._sum.creditAmount ?? 0;
    const balance = computeAccountBalance(totalDebits, totalCredits, account.normalBalance);

    return {
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      accountType: account.accountType,
      normalBalance: account.normalBalance,
      totalDebits,
      totalCredits,
      balance,
      asOfDate: asOfDate ?? new Date(),
    };
  }

  /**
   * Get general ledger for an account — paginated transaction list with running balance.
   */
  async getGeneralLedger(params: {
    accountId: string;
    from?: Date;
    to?: Date;
    cursor?: string;
    limit?: number;
  }) {
    const limit = params.limit ?? 20;

    const account = await this.prisma.chartOfAccount.findUnique({
      where: { id: params.accountId },
    });

    if (!account) {
      throw new NotFoundException(`Account not found: ${params.accountId}`);
    }

    // Build filter for date range
    const entryDateFilter: Prisma.DateTimeFilter = {};
    if (params.from) entryDateFilter.gte = params.from;
    if (params.to) entryDateFilter.lte = params.to;

    const where: Prisma.JournalEntryLineWhereInput = {
      accountId: params.accountId,
      journalEntry: {
        status: 'POSTED',
        ...(Object.keys(entryDateFilter).length > 0 && { entryDate: entryDateFilter }),
      },
    };

    const lines = await this.prisma.journalEntryLine.findMany({
      where,
      take: limit + 1,
      ...(params.cursor && { skip: 1, cursor: { id: params.cursor } }),
      orderBy: { journalEntry: { entryDate: 'asc' } },
      include: {
        journalEntry: {
          select: {
            id: true,
            entryNumber: true,
            entryDate: true,
            description: true,
            sourceType: true,
          },
        },
      },
    });

    const hasNext = lines.length > limit;
    const items = hasNext ? lines.slice(0, limit) : lines;
    const lastItem = items[items.length - 1];

    // Compute running balance: get the balance BEFORE the first item in this page
    let openingBalance = 0;
    if (items.length > 0) {
      const firstEntryDate = items[0]!.journalEntry.entryDate;
      const priorResult = await this.prisma.journalEntryLine.aggregate({
        where: {
          accountId: params.accountId,
          journalEntry: {
            status: 'POSTED',
            entryDate: { lt: firstEntryDate },
          },
        },
        _sum: { debitAmount: true, creditAmount: true },
      });

      openingBalance = computeAccountBalance(
        priorResult._sum.debitAmount ?? 0,
        priorResult._sum.creditAmount ?? 0,
        account.normalBalance,
      );
    }

    let runningBalance = openingBalance;
    const ledgerLines = items.map((line) => {
      const lineEffect = computeAccountBalance(
        line.debitAmount,
        line.creditAmount,
        account.normalBalance,
      );
      runningBalance += lineEffect;

      return {
        id: line.id,
        entryNumber: line.journalEntry.entryNumber,
        entryDate: line.journalEntry.entryDate,
        description: line.description ?? line.journalEntry.description,
        sourceType: line.journalEntry.sourceType,
        debitAmount: line.debitAmount,
        creditAmount: line.creditAmount,
        runningBalance,
        journalEntryId: line.journalEntry.id,
      };
    });

    return {
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        accountType: account.accountType,
        normalBalance: account.normalBalance,
      },
      openingBalance,
      items: ledgerLines,
      meta: {
        hasNext,
        nextCursor: hasNext && lastItem ? lastItem.id : undefined,
      },
    };
  }

  // ------------------------------------------------------------------
  // Chart of Accounts
  // ------------------------------------------------------------------

  /**
   * Get all chart of accounts with current balances.
   */
  async getChartOfAccounts() {
    const accounts = await this.prisma.chartOfAccount.findMany({
      orderBy: { displayOrder: 'asc' },
    });

    // Get balances for all accounts
    const aggregations = await this.prisma.journalEntryLine.groupBy({
      by: ['accountId'],
      where: { journalEntry: { status: 'POSTED' } },
      _sum: { debitAmount: true, creditAmount: true },
    });

    const balanceMap = new Map(
      aggregations.map((a) => [
        a.accountId,
        { debits: a._sum.debitAmount ?? 0, credits: a._sum.creditAmount ?? 0 },
      ]),
    );

    return accounts.map((account) => {
      const bal = balanceMap.get(account.id) ?? { debits: 0, credits: 0 };
      const balance = computeAccountBalance(bal.debits, bal.credits, account.normalBalance);

      return {
        ...account,
        balance,
        totalDebits: bal.debits,
        totalCredits: bal.credits,
      };
    });
  }

  /**
   * Find an account by its code.
   */
  async findAccountByCode(code: string) {
    const account = await this.prisma.chartOfAccount.findUnique({
      where: { code },
    });

    if (!account) {
      throw new NotFoundException(`Account not found with code: ${code}`);
    }

    return account;
  }

  // ------------------------------------------------------------------
  // Accounting Periods
  // ------------------------------------------------------------------

  /**
   * Get or create an accounting period for a given date.
   * Period boundaries are the first and last day of the month.
   */
  async getOrCreatePeriod(date: Date) {
    return this.getOrCreatePeriodTx(this.prisma, date);
  }

  /**
   * Transaction-safe version of getOrCreatePeriod.
   */
  private async getOrCreatePeriodTx(
    tx: Prisma.TransactionClient | PrismaService,
    date: Date,
  ) {
    const year = date.getFullYear();
    const month = date.getMonth(); // 0-indexed
    const periodName = `${year}-${String(month + 1).padStart(2, '0')}`;

    const existing = await tx.accountingPeriod.findUnique({
      where: { periodName },
    });

    if (existing) return existing;

    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0); // last day of month

    return tx.accountingPeriod.create({
      data: {
        periodName,
        startDate,
        endDate,
        status: 'OPEN',
      },
    });
  }

  /**
   * List all accounting periods.
   */
  async listPeriods() {
    return this.prisma.accountingPeriod.findMany({
      orderBy: { startDate: 'desc' },
      include: {
        _count: { select: { journalEntries: true } },
      },
    });
  }

  /**
   * Close an accounting period. No more entries can be posted to it.
   */
  async closePeriod(periodId: string, userId: string) {
    const period = await this.prisma.accountingPeriod.findUnique({
      where: { id: periodId },
    });

    if (!period) {
      throw new NotFoundException(`Accounting period not found: ${periodId}`);
    }

    if (period.status === 'CLOSED') {
      throw new ConflictException(
        `Period ${period.periodName} is already closed`,
      );
    }

    // Check for any remaining DRAFT entries
    const draftCount = await this.prisma.journalEntry.count({
      where: { periodId, status: 'DRAFT' },
    });

    if (draftCount > 0) {
      throw new BadRequestException(
        `Cannot close period ${period.periodName}: ${draftCount} draft journal entries exist. Post or delete them first.`,
      );
    }

    const updated = await this.prisma.accountingPeriod.update({
      where: { id: periodId },
      data: {
        status: 'CLOSED',
        closedById: userId,
        closedAt: new Date(),
      },
    });

    await this.auditService.log({
      actorUserId: userId,
      actorType: 'admin',
      action: 'accounting.period_closed',
      entityType: 'accounting_period',
      entityId: periodId,
      metadata: { periodName: period.periodName },
    });

    return updated;
  }
}
