import {
  IsDefined,
  IsObject,
  ValidateBy,
  ValidationOptions,
  buildMessage,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Entitlement values are numbers (a quota, or -1 for unlimited) or booleans (a
 * feature flag). Nothing else may be written into `entitlements_json`: a string
 * '0' or a nested object would pass straight through the resolver's spread and
 * become a limit no comparison handles, which is how a quota silently stops
 * being enforced.
 */
function IsEntitlementValueMap(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isEntitlementValueMap',
      validator: {
        validate: (value: unknown): boolean => {
          if (
            value === null ||
            typeof value !== 'object' ||
            Array.isArray(value)
          ) {
            return false;
          }
          const entries = Object.entries(value as Record<string, unknown>);
          if (entries.length === 0) return false;
          return entries.every(
            ([, v]) =>
              (typeof v === 'number' && Number.isInteger(v)) ||
              typeof v === 'boolean',
          );
        },
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}values must be a non-empty map of entitlement keys to integers or booleans`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}

export class SetSubscriptionEntitlementsDto {
  @ApiProperty({
    description:
      'Entitlement keys to set on this subscription, e.g. { "aiAnswers": 15 }. ' +
      'Merged into entitlements_json; keys not listed are left untouched. ' +
      'Unknown keys are rejected against the canonical entitlement key list.',
    example: { aiAnswers: 15 },
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'integer' }, { type: 'boolean' }] },
  })
  @IsDefined()
  @IsObject()
  @IsEntitlementValueMap()
  values!: Record<string, number | boolean>;
}
