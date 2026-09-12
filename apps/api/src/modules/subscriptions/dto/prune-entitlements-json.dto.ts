import {
  IsDefined,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateBy,
  ValidationOptions,
  buildMessage,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * The value a stored entitlement must equal to be pruned.
 *
 * Deliberately NOT optional and NOT nullable-by-omission: a prune with no value
 * would mean "clear this key from every subscription", which would wipe
 * complimentary grants along with the junk. The value is what separates the
 * two, so it is required.
 */
function IsPrunableValue(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isPrunableValue',
      validator: {
        validate: (value: unknown): boolean =>
          (typeof value === 'number' && Number.isInteger(value)) ||
          typeof value === 'boolean' ||
          typeof value === 'string',
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}valueEquals must be an integer, boolean, or string`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}

export class PruneEntitlementsJsonDto {
  @ApiProperty({
    description:
      'Entitlement key to clear from entitlements_json wherever its stored value matches.',
    example: 'aiAnswers',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  key!: string;

  @ApiProperty({
    description:
      'Only subscriptions whose stored value for `key` is strictly equal to this are cleared. ' +
      'A row storing a different value (a deliberate complimentary grant) is left alone.',
    example: 0,
    oneOf: [{ type: 'integer' }, { type: 'boolean' }, { type: 'string' }],
  })
  @IsDefined()
  @IsPrunableValue()
  valueEquals!: number | boolean | string;
}
