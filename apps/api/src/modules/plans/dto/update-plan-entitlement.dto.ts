import { PartialType } from '@nestjs/swagger';
import { CreatePlanEntitlementDto } from './create-plan-entitlement.dto';

export class UpdatePlanEntitlementDto extends PartialType(CreatePlanEntitlementDto) {}
