import { IsBoolean, IsObject, IsOptional } from 'class-validator';

export class UpdateDerivativeSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsObject()
  typesEnabled?: Record<string, boolean>;
}
