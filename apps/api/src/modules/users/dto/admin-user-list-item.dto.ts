import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One row in the GET /admin/users response.
 *
 * Aggregates per-user signals across organizations (LTV, current plan,
 * primary org name) so the list view is usable without expanding each row.
 */
export class AdminUserListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty({ description: 'User status: active | suspended | deactivated' })
  status!: string;

  @ApiPropertyOptional({ description: 'Onboarding-selected role (lawyer, student, etc.)' })
  userRole!: string | null;

  @ApiProperty()
  emailVerified!: boolean;

  @ApiProperty()
  mfaEnabled!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional({ description: 'Name of the first/primary organization the user is a member of' })
  primaryOrgName!: string | null;

  @ApiPropertyOptional({ description: 'Plan code of the user\'s current best subscription' })
  currentPlanCode!: string | null;

  @ApiPropertyOptional({ description: 'Status of the user\'s current best subscription' })
  subscriptionStatus!: string | null;

  @ApiPropertyOptional({ description: 'Start date of the user\'s current best subscription' })
  subscriptionStartedAt!: Date | null;

  @ApiProperty({ description: 'Sum of all succeeded Payment.amount across user\'s orgs (centavos)' })
  lifetimeValueCentavos!: number;
}

export class AdminUserListResponseDto {
  @ApiProperty()
  success!: boolean;

  @ApiProperty({ type: [AdminUserListItemDto] })
  data!: AdminUserListItemDto[];

  @ApiPropertyOptional()
  nextCursor!: string | null;

  @ApiProperty()
  hasNext!: boolean;
}
