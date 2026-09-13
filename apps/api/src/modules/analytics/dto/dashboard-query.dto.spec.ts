import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { DashboardQueryDto } from './dashboard-query.dto';

/**
 * `?refresh=true` arrives as a query STRING. The global ValidationPipe runs
 * with `enableImplicitConversion: false`, so without the explicit @Transform on
 * the DTO the value stays `'true'` and `@IsBoolean()` rejects the request — the
 * Refresh button would 400 instead of refreshing.
 */
function parse(query: Record<string, unknown>): DashboardQueryDto {
  return plainToInstance(DashboardQueryDto, query, { enableImplicitConversion: false });
}

describe('DashboardQueryDto.refresh', () => {
  it('coerces the string "true" to boolean true', () => {
    const dto = parse({ refresh: 'true' });
    expect(dto.refresh).toBe(true);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts "1" as well', () => {
    expect(parse({ refresh: '1' }).refresh).toBe(true);
  });

  it('treats "false" as false rather than as a truthy string', () => {
    // `Boolean('false')` is true, which would make ?refresh=false bypass the
    // cache — the opposite of what the caller asked for.
    expect(parse({ refresh: 'false' }).refresh).toBe(false);
  });

  it('stays undefined when the param is absent, and validates', () => {
    // class-transformer does not run @Transform for a key that is not present,
    // so the field is absent rather than false. `getCachedOrFetch` defaults its
    // `refresh` parameter to false, so absent and false behave identically.
    const dto = parse({});
    expect(dto.refresh).toBeUndefined();
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ignores an arbitrary string', () => {
    expect(parse({ refresh: 'yes-please' }).refresh).toBe(false);
  });

  it('leaves the other query fields alone', () => {
    const dto = parse({ from: '2026-09-01', to: '2026-09-12', refresh: 'true' });
    expect(dto.from).toBe('2026-09-01');
    expect(dto.to).toBe('2026-09-12');
    expect(validateSync(dto)).toHaveLength(0);
  });
});
