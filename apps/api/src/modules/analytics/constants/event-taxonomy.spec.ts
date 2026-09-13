import {
  EVENT_TAXONOMY,
  EVENT_CATEGORIES,
  VALID_EVENT_NAMES_SET,
  getEventCategory,
  validateEventProperties,
} from './event-taxonomy';

/**
 * `AnalyticsService.track` rejects any event name absent from this taxonomy
 * with a 400, so an uninstrumented surface stays uninstrumented until its name
 * is listed here. These are the names the web and mobile surface instrumentation
 * sends; the list is asserted rather than assumed because the failure mode is a
 * silent one — the client fire-and-forgets and the event simply never arrives.
 */
const SURFACE_EVENTS = [
  'page_viewed',
  'bar_exam_opened',
  'bar_exam_question_viewed',
  'library_opened',
  'feed_viewed',
  'workspace_opened',
  'digest_viewed',
  'codal_opened',
  'codal_section_viewed',
  'scan_started',
  'search_executed',
] as const;

describe('event taxonomy — surface events', () => {
  it.each(SURFACE_EVENTS)('accepts %s', (name) => {
    expect(VALID_EVENT_NAMES_SET.has(name)).toBe(true);
  });

  it.each(SURFACE_EVENTS)('%s has a declared category', (name) => {
    const category = getEventCategory(name);
    expect(category).toBeDefined();
    expect(EVENT_CATEGORIES).toContain(category);
  });

  it('rejects a name that is not in the taxonomy', () => {
    expect(VALID_EVENT_NAMES_SET.has('bar_exam_opened_typo')).toBe(false);
  });
});

describe('page_viewed contract', () => {
  it('requires path and surface — the two fields the aggregate reads', () => {
    expect(EVENT_TAXONOMY['page_viewed']!.requiredProperties).toEqual(['path', 'surface']);
  });

  it('accepts the properties the shared route map produces', () => {
    expect(
      validateEventProperties('page_viewed', { path: '/digest/[id]', surface: 'digests' }),
    ).toEqual([]);
  });

  it('flags a page view that arrives without a surface', () => {
    expect(validateEventProperties('page_viewed', { path: '/digests' })).toEqual(['surface']);
  });
});

describe('surface events carry no identifiers', () => {
  /**
   * Privacy contract for this product: a route with a case id in it is a record
   * of what someone researched. The five surface-level events therefore require
   * only `surface` — no document, case, question, note or section id may become
   * a required property, because a required property is one the client is told
   * to send.
   */
  const NEW_SURFACE_EVENTS = [
    'bar_exam_opened',
    'bar_exam_question_viewed',
    'library_opened',
    'feed_viewed',
    'workspace_opened',
  ] as const;

  it.each(NEW_SURFACE_EVENTS)('%s requires only surface', (name) => {
    expect(EVENT_TAXONOMY[name]!.requiredProperties).toEqual(['surface']);
  });

  it.each(NEW_SURFACE_EVENTS)('%s requires no id-shaped property', (name) => {
    const banned = /_id$|^query|text|content/;
    for (const prop of EVENT_TAXONOMY[name]!.requiredProperties) {
      expect(prop).not.toMatch(banned);
    }
  });
});
