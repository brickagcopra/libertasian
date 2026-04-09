export interface AdCreative {
  id: string;
  displayType: 'modal' | 'slide_in' | 'floating_bar' | 'inline_banner' | 'sticky_footer';
  position: string | null;
  headline: string;
  bodyText: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  ctaText: string | null;
  ctaUrl: string | null;
  ctaStyle: 'primary' | 'secondary' | 'outline' | null;
  secondaryCtaText: string | null;
  bgColor: string | null;
  textColor: string | null;
  accentColor: string | null;
  borderRadius: string | null;
  animation: string | null;
  sortOrder: number;
}

export interface AdCampaign {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'ended';
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
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  creatives: AdCreative[];
}

export interface CreateCampaignInput {
  name: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  priority?: number;
  targetPages: string[];
  targetUserType?: string;
  maxImpressions?: number;
  maxImpressionsPerUser?: number;
  showAfterSeconds?: number;
  showOncePerSession?: boolean;
}

export interface UpdateCampaignInput {
  name?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  priority?: number;
  targetPages?: string[];
  targetUserType?: string;
  maxImpressions?: number;
  maxImpressionsPerUser?: number;
  showAfterSeconds?: number;
  showOncePerSession?: boolean;
}

export interface CreateCreativeInput {
  displayType: string;
  position?: string;
  headline: string;
  bodyText?: string;
  imageUrl?: string;
  imageAlt?: string;
  ctaText?: string;
  ctaUrl?: string;
  ctaStyle?: string;
  secondaryCtaText?: string;
  bgColor?: string;
  textColor?: string;
  accentColor?: string;
  borderRadius?: string;
  animation?: string;
  sortOrder?: number;
}

export interface UpdateCreativeInput {
  displayType?: string;
  position?: string;
  headline?: string;
  bodyText?: string;
  imageUrl?: string;
  imageAlt?: string;
  ctaText?: string;
  ctaUrl?: string;
  ctaStyle?: string;
  secondaryCtaText?: string;
  bgColor?: string;
  textColor?: string;
  accentColor?: string;
  borderRadius?: string;
  animation?: string;
  sortOrder?: number;
}

export interface RecordAdEventInput {
  campaignId: string;
  creativeId?: string;
  eventType: 'impression' | 'click' | 'dismiss' | 'cta_click';
  sessionId?: string;
  page?: string;
}

export interface CampaignAnalytics {
  summary: {
    impressions: number;
    clicks: number;
    dismissals: number;
    ctr: number;
  };
  byPage: Array<{
    page: string | null;
    eventType: string;
    _count: number;
  }>;
  recentEvents: Array<{
    id: string;
    eventType: string;
    page: string | null;
    sessionId: string | null;
    createdAt: string;
  }>;
}
