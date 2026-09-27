import { readerHref } from './navigation';

describe('readerHref', () => {
  it('carries the document, section and trimmed quote', () => {
    expect(readerHref('doc-1', 'sec-9', '  the quoted passage ')).toEqual({
      pathname: '/reader/[id]',
      params: { id: 'doc-1', section: 'sec-9', highlight: 'the quoted passage' },
    });
  });

  it('leaves out an absent section or blank quote', () => {
    expect(readerHref('doc-2', null, 'q text')).toEqual({
      pathname: '/reader/[id]',
      params: { id: 'doc-2', highlight: 'q text' },
    });
    expect(readerHref('doc-3', 'sec-1', '   ')).toEqual({
      pathname: '/reader/[id]',
      params: { id: 'doc-3', section: 'sec-1' },
    });
    expect(readerHref('doc-4')).toEqual({ pathname: '/reader/[id]', params: { id: 'doc-4' } });
  });
});
