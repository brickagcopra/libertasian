export interface Digest {
  id: string;
  legalDocumentId: string | null;
  organizationId: string | null;
  userId: string | null;
  sourceOrigin: string;
  title: string;
  digestType: string;
  summary: string | null;
  facts: string | null;
  petitionerArguments: string | null;
  respondentArguments: string | null;
  issues: string | null;
  ruling: string | null;
  doctrine: string | null;
  dispositive: string | null;
  confidenceScore: number | null;
  reviewStatus: string;
  visibility: string;
  createdAt: string;
  updatedAt: string;
  barSubjectCode: string | null;
  barSubjectSecondary: string | null;
}

export interface DigestsResponse {
  data: Digest[];
  cursor: string | null;
  hasNext: boolean;
}

export interface DigestFilters {
  cursor?: string;
  limit?: number;
  digestType?: string;
  reviewStatus?: string;
  legalDocumentId?: string;
  barSubjectCode?: string;
  sourceOrigin?: string;
  visibility?: string;
  orderBy?: 'createdAt' | 'confidenceScore';
  orderDirection?: 'asc' | 'desc';
}
