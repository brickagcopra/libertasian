// ==========================================================================
// LIBERTASIAN — k6 Smoke Test Profile
// Purpose: Sanity check — verify all scripts work, endpoints respond
// VUs: 2, Duration: 30s
// ==========================================================================

import { sleep } from 'k6';
import { mergeThresholds } from '../lib/config.js';
import { suggestions, citationLookup } from '../scenarios/public-endpoints.js';
import { readDocument, listSections, readSection } from '../scenarios/documents.js';
import { randomDocumentId, randomIntBetween } from '../lib/data-generators.js';

export const options = {
  scenarios: {
    public_endpoints: {
      executor: 'constant-vus',
      vus: 1,
      duration: '30s',
      exec: 'publicEndpoints',
    },
    document_reader: {
      executor: 'constant-vus',
      vus: 1,
      duration: '30s',
      exec: 'documentReader',
    },
  },
  thresholds: mergeThresholds('publicEndpoints', 'documentRead'),
};

export function publicEndpoints() {
  suggestions();
  sleep(1);
  citationLookup();
  sleep(1);
}

export function documentReader() {
  const docId = readDocument();
  sleep(0.5);
  listSections(docId);
  sleep(0.5);
  readSection(docId);
  sleep(randomIntBetween(1, 2));
}
