export interface AdCreative {
  id: string;
  displayType: 'modal' | 'slide_in' | 'floating_bar' | 'inline_banner' | 'sticky_footer';
  position: string | null;
  headline: string | null;
  bodyText: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  ctaText: string | null;
  ctaUrl: string | null;
  ctaStyle: string | null;
  secondaryCtaText: string | null;
  bgColor: string | null;
  textColor: string | null;
  accentColor: string | null;
  borderRadius: number | null;
  animation: string | null;
  sortOrder: number;
}

export interface AdCampaign {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  priority: number;
  targetPages: string[];
  targetUserType: string | null;
  maxImpressions: number | null;
  maxImpressionsPerUser: number | null;
  impressionCount: number;
  clickCount: number;
  dismissCount: number;
  showAfterSeconds: number;
  showOncePerSession: boolean;
  creatives: AdCreative[];
}

export interface RecordAdEventInput {
  campaignId: string;
  creativeId?: string;
  eventType: 'impression' | 'click' | 'dismiss' | 'cta_click';
  sessionId: string;
  page: string;
}
