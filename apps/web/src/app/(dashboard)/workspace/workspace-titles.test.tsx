import { describe, it, expect } from 'vitest';

import { metadata as matters } from './matters/layout';
import { metadata as memos } from './memos/layout';
import { metadata as comparisons } from './comparisons/layout';
import { metadata as tasks } from './tasks/layout';
import { metadata as calendar } from './calendar/layout';
import { metadata as notes } from './notes/layout';
import { metadata as annotations } from './annotations/layout';
import { metadata as timelines } from './timelines/layout';
import { metadata as pleadings } from './pleadings/layout';
import { metadata as hearingPrep } from './hearing-prep/layout';
import { metadata as contradictions } from './contradictions/layout';
import { metadata as researchWorkspaces } from './research-workspaces/layout';
import { metadata as activity } from './activity/layout';

/**
 * Per-route page title tests for workspace sub-routes.
 *
 * Each workspace sub-route page is a 'use client' component and therefore
 * cannot export `metadata`. Without a per-segment server layout, every
 * sub-route inherited `title: 'Workspace'` from workspace/layout.tsx and
 * rendered "Workspace — LIBERTASIAN" in the browser tab. A server-component
 * layout.tsx per segment exports the correct title, which the root layout's
 * "%s — LIBERTASIAN" template then resolves.
 */

const cases: Array<{ segment: string; title: string; metadata: { title?: unknown } }> = [
  { segment: 'matters', title: 'Matters', metadata: matters },
  { segment: 'memos', title: 'Legal Memos', metadata: memos },
  { segment: 'comparisons', title: 'Case Comparisons', metadata: comparisons },
  { segment: 'tasks', title: 'Tasks', metadata: tasks },
  { segment: 'calendar', title: 'Calendar', metadata: calendar },
  { segment: 'notes', title: 'Notes', metadata: notes },
  { segment: 'annotations', title: 'Annotations', metadata: annotations },
  { segment: 'timelines', title: 'Timelines', metadata: timelines },
  { segment: 'pleadings', title: 'Pleadings', metadata: pleadings },
  { segment: 'hearing-prep', title: 'Hearing Prep', metadata: hearingPrep },
  { segment: 'contradictions', title: 'Contradictions', metadata: contradictions },
  { segment: 'research-workspaces', title: 'Research Workspaces', metadata: researchWorkspaces },
  { segment: 'activity', title: 'Activity', metadata: activity },
];

describe('workspace sub-route metadata titles', () => {
  it.each(cases)('$segment layout exports title "$title"', ({ title, metadata }) => {
    expect(metadata.title).toBe(title);
  });
});
