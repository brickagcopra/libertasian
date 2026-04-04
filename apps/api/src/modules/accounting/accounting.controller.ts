import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AccountingService } from './accounting.service';
import {
  CreateJournalEntryDto,
  GeneralLedgerQueryDto,
  JournalEntryQueryDto,
  PeriodQueryDto,
  VoidJournalEntryDto,
} from './dto';

@ApiTags('Admin Accounting')
@Controller('admin/accounting')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
@ApiBearerAuth()
export class AccountingController {
  constructor(private readonly accountingService: AccountingService) {}

  // ---- Chart of Accounts ----

  @Get('chart-of-accounts')
  @ApiOperation({ summary: 'List all accounts with current balances' })
  async getChartOfAccounts() {
    const data = await this.accountingService.getChartOfAccounts();
    return { success: true, data };
  }

  // ---- Accounting Periods ----

  @Get('periods')
  @ApiOperation({ summary: 'List all accounting periods' })
  async listPeriods() {
    const data = await this.accountingService.listPeriods();
    return { success: true, data };
  }

  @Post('periods/:id/close')
  @Roles('owner')
  @ApiOperation({ summary: 'Close an accounting period (owner only)' })
  async closePeriod(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.accountingService.closePeriod(id, userId);
    return { success: true, data };
  }

  // ---- Journal Entries ----

  @Get('journal-entries')
  @ApiOperation({ summary: 'List journal entries with filters and pagination' })
  async listJournalEntries(@Query() query: JournalEntryQueryDto) {
    const data = await this.accountingService.listJournalEntries({
      periodId: query.period,
      status: query.status,
      cursor: query.cursor,
      limit: query.limit,
    });
    return { success: true, ...data };
  }

  @Post('journal-entries')
  @ApiOperation({ summary: 'Create a new journal entry (draft)' })
  async createJournalEntry(
    @Body() dto: CreateJournalEntryDto,
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.accountingService.createJournalEntry(dto, userId);
    return { success: true, data };
  }

  @Get('journal-entries/:id')
  @ApiOperation({ summary: 'Get a journal entry by ID' })
  async getJournalEntry(@Param('id') id: string) {
    const data = await this.accountingService.getJournalEntry(id);
    return { success: true, data };
  }

  @Post('journal-entries/:id/post')
  @Roles('owner')
  @ApiOperation({ summary: 'Post a draft journal entry (owner only)' })
  async postJournalEntry(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.accountingService.postJournalEntry(id, userId);
    return { success: true, data };
  }

  @Post('journal-entries/:id/void')
  @Roles('owner')
  @ApiOperation({ summary: 'Void a posted journal entry (owner only)' })
  async voidJournalEntry(
    @Param('id') id: string,
    @Body() dto: VoidJournalEntryDto,
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.accountingService.voidJournalEntry(id, userId, dto);
    return { success: true, data };
  }

  // ---- Trial Balance & Ledger ----

  @Get('trial-balance')
  @ApiOperation({ summary: 'Generate trial balance for a period' })
  async getTrialBalance(@Query() query: PeriodQueryDto) {
    const data = await this.accountingService.getTrialBalance(query.period);
    return { success: true, data };
  }

  @Get('general-ledger')
  @ApiOperation({ summary: 'Get general ledger for an account' })
  async getGeneralLedger(@Query() query: GeneralLedgerQueryDto) {
    const data = await this.accountingService.getGeneralLedger({
      accountId: query.account,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      cursor: query.cursor,
      limit: query.limit,
    });
    return { success: true, data };
  }
}
