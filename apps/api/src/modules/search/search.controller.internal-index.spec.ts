import { SearchController } from './search.controller';
import type { SearchService } from './search.service';

/**
 * The internal index route has two paths and they are not interchangeable.
 *
 * The default is what every existing caller uses — the auto-publish trigger,
 * the #322 reindex backfill, `reindex_failed_publishes` — for documents whose
 * sections have not changed. Deleting first there would take a live document
 * out of both indexes for the duration of the re-index and buy nothing, so
 * these tests pin that the default still does exactly one thing.
 *
 * `?replace=true` is for a caller that replaced the document's sections.
 * `indexLegalDocument` upserts the sections a document has NOW; the rows for
 * the sections it used to have are already gone from PostgreSQL, so nothing
 * in the index path can find them to remove. Prod has the 2015 criminal bar
 * paper indexed under its instruction text for exactly that reason.
 */
describe('SearchController.internalIndexDocument', () => {
  const DOC_ID = 'doc-1';

  function build() {
    const searchService = {
      indexLegalDocument: jest.fn().mockResolvedValue(undefined),
      removeFromIndex: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new SearchController(
      searchService as unknown as SearchService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { controller, searchService };
  }

  describe('default path (no flag)', () => {
    it('indexes without removing anything first', async () => {
      const { controller, searchService } = build();

      const result = await controller.internalIndexDocument(DOC_ID);

      expect(searchService.indexLegalDocument).toHaveBeenCalledWith(DOC_ID);
      expect(searchService.removeFromIndex).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        data: { message: `Document ${DOC_ID} indexed` },
      });
    });

    it.each([undefined, '', 'false', '0', 'yes', 'TRUE', 'replace'])(
      'treats %p as no replace — only an explicit opt-in deletes',
      async (value) => {
        const { controller, searchService } = build();

        const result = await controller.internalIndexDocument(
          DOC_ID,
          value as string | undefined,
        );

        expect(searchService.removeFromIndex).not.toHaveBeenCalled();
        expect(searchService.indexLegalDocument).toHaveBeenCalledWith(DOC_ID);
        expect(result.data.message).toBe(`Document ${DOC_ID} indexed`);
      },
    );
  });

  describe('?replace=true', () => {
    it('removes the document from both indexes before re-indexing it', async () => {
      const { controller, searchService } = build();
      const order: string[] = [];
      searchService.removeFromIndex.mockImplementation(async () => {
        order.push('remove');
      });
      searchService.indexLegalDocument.mockImplementation(async () => {
        order.push('index');
      });

      const result = await controller.internalIndexDocument(DOC_ID, 'true');

      expect(searchService.removeFromIndex).toHaveBeenCalledWith(DOC_ID);
      expect(searchService.indexLegalDocument).toHaveBeenCalledWith(DOC_ID);
      // Order is the whole point: indexing first and deleting after would
      // delete what it had just written.
      expect(order).toEqual(['remove', 'index']);
      expect(result).toEqual({
        success: true,
        data: { message: `Document ${DOC_ID} re-indexed` },
      });
    });

    it('accepts replace=1 as well', async () => {
      const { controller, searchService } = build();

      await controller.internalIndexDocument(DOC_ID, '1');

      expect(searchService.removeFromIndex).toHaveBeenCalledWith(DOC_ID);
    });

    it('does not index when the removal fails', async () => {
      // A failed delete means the stale entries are still there; indexing on
      // top of them would report success while leaving the exact state this
      // flag exists to fix.
      const { controller, searchService } = build();
      searchService.removeFromIndex.mockRejectedValue(new Error('opensearch down'));

      await expect(
        controller.internalIndexDocument(DOC_ID, 'true'),
      ).rejects.toThrow('opensearch down');
      expect(searchService.indexLegalDocument).not.toHaveBeenCalled();
    });
  });
});
