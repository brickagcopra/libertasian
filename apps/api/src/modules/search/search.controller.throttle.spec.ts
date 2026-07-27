import { InternalApiGuard } from '../../common/guards/internal-api.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SearchController } from './search.controller';

// @nestjs/throttler stores decorator config as reflect-metadata keyed by
// `<CONSTANT><throttler-name>` (the default throttler's name is 'default').
// Nest stores @UseGuards under '__guards__'. Both are part of the packages'
// stable metadata contracts — see auth.controller.spec.ts for the same trick.
const THROTTLER_SKIP_DEFAULT = 'THROTTLER:SKIPdefault';
const GUARDS_METADATA = '__guards__';

const guardsOn = (handler: unknown): unknown[] =>
  (Reflect.getMetadata(GUARDS_METADATA, handler as object) as unknown[]) ?? [];

describe('SearchController — internal index trigger', () => {
  it('skips the throttler: a bulk publish run exceeds the 300/min bucket and the worker drops 429s', () => {
    expect(
      Reflect.getMetadata(
        THROTTLER_SKIP_DEFAULT,
        SearchController.prototype.internalIndexDocument,
      ),
    ).toBe(true);
  });

  it('is still gated by InternalApiGuard (X-Internal-Api-Key), not left open', () => {
    expect(guardsOn(SearchController.prototype.internalIndexDocument)).toContain(
      InternalApiGuard,
    );
  });

  it('does not fall back to a JWT guard — the worker holds no JWT', () => {
    expect(
      guardsOn(SearchController.prototype.internalIndexDocument),
    ).not.toContain(JwtAuthGuard);
  });

  it('leaves every other route subject to its throttle', () => {
    // The skip is per-handler, never class-level: the public search surface
    // keeps its 30/min bucket and the admin index routes keep the general one.
    expect(
      Reflect.getMetadata(THROTTLER_SKIP_DEFAULT, SearchController),
    ).toBeUndefined();

    for (const handler of [
      SearchController.prototype.search,
      SearchController.prototype.searchByCitation,
      SearchController.prototype.getSuggestions,
      SearchController.prototype.indexDocument,
      SearchController.prototype.bulkIndex,
      SearchController.prototype.rebuildIndexes,
    ]) {
      expect(
        Reflect.getMetadata(THROTTLER_SKIP_DEFAULT, handler),
      ).toBeUndefined();
    }
  });
});
