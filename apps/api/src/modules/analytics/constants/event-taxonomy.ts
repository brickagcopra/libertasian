/**
 * Analytics Event Taxonomy
 *
 * Whitelist of all valid event names, their categories, and required properties.
 * Events with unknown event_name values are rejected at the API layer.
 * Naming convention: verb_object (snake_case)
 */

// ---------------------------------------------------------------------------
// Event Categories
// ---------------------------------------------------------------------------

export const EVENT_CATEGORIES = [
  'search',
  'ai_answer',
  'digest',
  'scan',
  'study',
  'workspace',
  'auth',
  'billing',
  'navigation',
  'admin',
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Event Definitions — category + required property keys
// ---------------------------------------------------------------------------

interface EventDefinition {
  category: EventCategory;
  requiredProperties: string[];
}

export const EVENT_TAXONOMY: Record<string, EventDefinition> = {
  // =======================================================================
  // Search & Research
  // =======================================================================
  search_executed: {
    category: 'search',
    requiredProperties: ['query_length', 'search_type', 'result_count', 'has_zero_results'],
  },
  search_result_clicked: {
    category: 'search',
    requiredProperties: ['result_position', 'document_type', 'document_id'],
  },
  search_refined: {
    category: 'search',
    requiredProperties: ['original_query_hash', 'refinement_type'],
  },
  search_abandoned: {
    category: 'search',
    requiredProperties: ['query_length', 'time_on_results_ms', 'results_viewed_count'],
  },

  // =======================================================================
  // AI Answers
  // =======================================================================
  ai_answer_requested: {
    category: 'ai_answer',
    requiredProperties: ['query_length', 'mode'],
  },
  ai_answer_received: {
    category: 'ai_answer',
    requiredProperties: ['response_time_ms', 'citation_count', 'confidence_level', 'abstained'],
  },
  ai_answer_citation_clicked: {
    category: 'ai_answer',
    requiredProperties: ['citation_type', 'document_id'],
  },
  ai_answer_feedback: {
    category: 'ai_answer',
    requiredProperties: ['rating'],
  },
  ai_answer_copied: {
    category: 'ai_answer',
    requiredProperties: ['content_length', 'section'],
  },

  // =======================================================================
  // Digests
  // =======================================================================
  digest_generated: {
    category: 'digest',
    requiredProperties: ['source_origin', 'document_type', 'confidence_score', 'generation_time_ms'],
  },
  digest_viewed: {
    category: 'digest',
    requiredProperties: ['digest_id', 'view_duration_ms'],
  },
  digest_saved: {
    category: 'digest',
    requiredProperties: ['digest_type', 'visibility'],
  },
  digest_exported: {
    category: 'digest',
    requiredProperties: ['format'],
  },
  digest_reviewed: {
    category: 'digest',
    requiredProperties: ['verdict', 'reviewer_role'],
  },

  // =======================================================================
  // Camera Scan (Mobile)
  // =======================================================================
  scan_started: {
    category: 'scan',
    requiredProperties: ['capture_mode'],
  },
  scan_captured: {
    category: 'scan',
    requiredProperties: ['page_count', 'quality_score', 'device_platform'],
  },
  scan_ocr_completed: {
    category: 'scan',
    requiredProperties: ['text_length', 'ocr_confidence', 'processing_time_ms'],
  },
  scan_digest_generated: {
    category: 'scan',
    requiredProperties: ['entitled', 'prompted_upgrade', 'confidence_score'],
  },
  scan_saved: {
    category: 'scan',
    requiredProperties: ['privacy_level'],
  },
  scan_retake: {
    category: 'scan',
    requiredProperties: ['reason'],
  },

  // =======================================================================
  // Study Mode
  // =======================================================================
  codal_opened: {
    category: 'study',
    requiredProperties: ['subject_area', 'codal_name'],
  },
  codal_section_viewed: {
    category: 'study',
    requiredProperties: ['section_id', 'view_duration_ms'],
  },
  reviewer_pack_started: {
    category: 'study',
    requiredProperties: ['pack_id', 'subject_area'],
  },
  flashcard_session_started: {
    category: 'study',
    requiredProperties: ['card_count', 'subject_area', 'source'],
  },
  flashcard_answered: {
    category: 'study',
    requiredProperties: ['correct', 'time_to_answer_ms', 'difficulty_rating'],
  },
  study_session_completed: {
    category: 'study',
    requiredProperties: ['duration_minutes', 'cards_reviewed', 'sections_read', 'subject_area'],
  },

  // =======================================================================
  // Workspace
  // =======================================================================
  matter_created: {
    category: 'workspace',
    requiredProperties: ['matter_type'],
  },
  matter_document_attached: {
    category: 'workspace',
    requiredProperties: ['document_source', 'role'],
  },
  note_created: {
    category: 'workspace',
    requiredProperties: ['word_count'],
  },
  bookmark_created: {
    category: 'workspace',
    requiredProperties: ['document_type'],
  },
  annotation_created: {
    category: 'workspace',
    requiredProperties: ['color', 'text_length'],
  },
  collaboration_action: {
    category: 'workspace',
    requiredProperties: ['action', 'target_type'],
  },

  // =======================================================================
  // Auth & Lifecycle
  // =======================================================================
  user_signed_up: {
    category: 'auth',
    requiredProperties: ['method'],
  },
  user_logged_in: {
    category: 'auth',
    requiredProperties: ['method', 'device_type'],
  },
  user_activated: {
    category: 'auth',
    requiredProperties: ['activation_event', 'time_to_activate_hours'],
  },
  /**
   * Native social sign-in failed ON DEVICE, before (or at) the token exchange.
   * Emitted PRE-AUTH by the mobile login screen through the unauthenticated
   * POST /analytics/events, because a user who cannot sign in has no JWT and
   * would be dropped by /events/auth — which is exactly why six weeks of
   * mobile Google failures produced no evidence at all.
   *
   * `stage` is how far the flow got (configure > play_services >
   * native_sign_in > id_token > token_exchange) and is what separates a
   * console misconfiguration (DEVELOPER_ERROR at native_sign_in) from a
   * server-side rejection (token_exchange). `code` is the native error code.
   * Never carries token material — see mobile social-login-telemetry.ts.
   */
  social_login_failed: {
    category: 'auth',
    requiredProperties: ['provider', 'platform', 'stage'],
  },
  /**
   * The build shipped without the inlined EXPO_PUBLIC_GOOGLE_* client IDs, so
   * the button could never work. Deliberately NOT social_login_failed: nothing
   * was attempted, no native code exists, and the fix is a build-profile env
   * change rather than a retry.
   */
  social_login_unavailable: {
    category: 'auth',
    requiredProperties: ['provider', 'platform', 'reason'],
  },
  subscription_started: {
    category: 'billing',
    requiredProperties: ['plan_code', 'billing_period'],
  },
  subscription_upgraded: {
    category: 'billing',
    requiredProperties: ['from_plan', 'to_plan', 'trigger'],
  },
  subscription_cancelled: {
    category: 'billing',
    requiredProperties: ['plan_code', 'reason_category', 'tenure_days'],
  },
  subscription_churned: {
    category: 'billing',
    requiredProperties: ['plan_code', 'last_active_days_ago', 'lifetime_value'],
  },

  // =======================================================================
  // Navigation & Engagement
  // =======================================================================
  page_viewed: {
    category: 'navigation',
    requiredProperties: ['path'],
  },
  feature_discovered: {
    category: 'navigation',
    requiredProperties: ['feature_name', 'discovery_method'],
  },
  paywall_hit: {
    category: 'billing',
    requiredProperties: ['feature_attempted', 'current_plan'],
  },
  paywall_converted: {
    category: 'billing',
    requiredProperties: ['feature_attempted', 'time_on_paywall_seconds'],
  },

  // =======================================================================
  // Document Reader
  // =======================================================================
  document_opened: {
    category: 'navigation',
    requiredProperties: ['document_type', 'document_id', 'source'],
  },
  document_read_time: {
    category: 'navigation',
    requiredProperties: ['document_id', 'read_duration_ms', 'scroll_depth_percent'],
  },
  document_citation_followed: {
    category: 'navigation',
    requiredProperties: ['from_document_id', 'to_document_id', 'citation_type'],
  },

  // =======================================================================
  // Admin / Ingestion (internal)
  // =======================================================================
  ingestion_job_completed: {
    category: 'admin',
    requiredProperties: ['source_name', 'job_type', 'records_created', 'records_updated', 'duration_ms', 'error_count'],
  },
  editorial_review_completed: {
    category: 'admin',
    requiredProperties: ['verdict', 'document_type', 'review_duration_ms'],
  },
} as const;

// ---------------------------------------------------------------------------
// Derived types and helpers
// ---------------------------------------------------------------------------

export type EventName = keyof typeof EVENT_TAXONOMY;

export const VALID_EVENT_NAMES = Object.keys(EVENT_TAXONOMY) as EventName[];

export const VALID_EVENT_NAMES_SET = new Set<string>(VALID_EVENT_NAMES);

/**
 * Returns the category for a given event name, or undefined if unknown.
 */
export function getEventCategory(eventName: string): EventCategory | undefined {
  const def = EVENT_TAXONOMY[eventName];
  return def?.category;
}

/**
 * Validates that an event has all required properties.
 * Returns list of missing property names, or empty array if valid.
 */
export function validateEventProperties(eventName: string, properties: Record<string, unknown>): string[] {
  const def = EVENT_TAXONOMY[eventName];
  if (!def) return [];

  return def.requiredProperties.filter((key) => !(key in properties));
}

/** Maximum allowed size for event properties JSON (10 KB) */
export const MAX_PROPERTIES_SIZE_BYTES = 10_240;
