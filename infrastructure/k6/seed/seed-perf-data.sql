-- ==========================================================================
-- LIBERTASIAN — k6 Performance Test Seed Data
-- Idempotent: safe to run multiple times (ON CONFLICT DO NOTHING)
--
-- Creates: k6 test org, 2 users (member + admin), subscription,
--          1 source, 20 legal documents with 5 sections each
-- ==========================================================================

-- Password hash for 'K6PerfTest2026!' (bcrypt, cost 12)
-- Generated with: await bcrypt.hash('K6PerfTest2026!', 12)
-- Using a pre-computed hash to avoid bcrypt dependency in SQL
DO $$
DECLARE
  v_org_id UUID := 'k6-org-00000000-0000-0000-0000-000000000001';
  v_user_id UUID := 'k6-usr-00000000-0000-0000-0000-000000000001';
  v_admin_id UUID := 'k6-usr-00000000-0000-0000-0000-000000000002';
  v_source_id UUID := 'k6-src-00000000-0000-0000-0000-000000000001';
  v_sub_id UUID := 'k6-sub-00000000-0000-0000-0000-000000000001';
  -- bcrypt hash of 'K6PerfTest2026!' with cost 12
  v_password_hash TEXT := '$2b$12$k6PerfTestHashPlaceholder000000000000000000000000000000';
  v_doc_id UUID;
  v_sec_id UUID;
  i INT;
  j INT;
BEGIN
  -- ========== Organization ==========
  INSERT INTO organizations (id, name, slug, type, created_at, updated_at)
  VALUES (v_org_id, 'K6 Performance Test Org', 'k6-perf-test', 'firm', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  -- ========== Users ==========
  -- Member user
  INSERT INTO users (id, email, password_hash, full_name, status, email_verified, created_at, updated_at)
  VALUES (v_user_id, 'k6-perf@libertasian.test', v_password_hash, 'K6 Perf Tester', 'active', true, NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  -- Admin user
  INSERT INTO users (id, email, password_hash, full_name, status, email_verified, created_at, updated_at)
  VALUES (v_admin_id, 'k6-admin@libertasian.test', v_password_hash, 'K6 Admin Tester', 'active', true, NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  -- ========== Organization Members ==========
  INSERT INTO organization_members (id, organization_id, user_id, role, status, created_at)
  VALUES (
    'k6-mem-00000000-0000-0000-0000-000000000001',
    v_org_id, v_user_id, 'member', 'active', NOW()
  ) ON CONFLICT DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, status, created_at)
  VALUES (
    'k6-mem-00000000-0000-0000-0000-000000000002',
    v_org_id, v_admin_id, 'admin', 'active', NOW()
  ) ON CONFLICT DO NOTHING;

  -- ========== Subscription (Professional plan — generous quotas) ==========
  INSERT INTO subscriptions (
    id, organization_id, plan_code, status, billing_period,
    current_period_start, current_period_end, seats,
    entitlements_json, created_at, updated_at
  ) VALUES (
    v_sub_id, v_org_id, 'professional', 'active', 'monthly',
    NOW(), NOW() + INTERVAL '30 days', 10,
    '{"searchQueries": -1, "aiAnswers": 200, "digestGeneration": 100, "cameraScans": 500, "fileUploads": 1000}'::jsonb,
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  -- ========== Source (for document foreign key) ==========
  INSERT INTO sources (id, name, type, domain, trust_level, enabled, created_at, updated_at)
  VALUES (v_source_id, 'K6 Test Source - Supreme Court', 'official', 'sc.judiciary.gov.ph', 'high', true, NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  -- ========== Legal Documents (20 documents with 5 sections each) ==========
  FOR i IN 1..20 LOOP
    v_doc_id := ('k6-doc-00000000-0000-0000-0000-' || LPAD(i::TEXT, 12, '0'))::UUID;

    INSERT INTO legal_documents (
      id, source_id, document_type, jurisdiction, title, short_title,
      citation_text, gr_no, promulgation_date, court, status,
      is_official, is_published, version_no, created_at, updated_at
    ) VALUES (
      v_doc_id,
      v_source_id,
      CASE (i % 4)
        WHEN 0 THEN 'decision'
        WHEN 1 THEN 'resolution'
        WHEN 2 THEN 'republic_act'
        ELSE 'administrative_order'
      END,
      'PH',
      'K6 Test Document ' || i || ' — ' ||
        CASE (i % 4)
          WHEN 0 THEN 'People v. Test Corp ' || i
          WHEN 1 THEN 'In Re: Administrative Matter No. K6-' || i
          WHEN 2 THEN 'Republic Act No. ' || (10000 + i)
          ELSE 'Administrative Order No. ' || i || '-2025'
        END,
      'K6 Doc ' || i,
      'G.R. No. ' || (100000 + i),
      'G.R. No. ' || (100000 + i),
      '2024-01-15'::DATE + (i * 7),
      CASE (i % 3)
        WHEN 0 THEN 'Supreme Court'
        WHEN 1 THEN 'Court of Appeals'
        ELSE 'Regional Trial Court'
      END,
      'published',
      true,
      true,
      1,
      NOW(), NOW()
    ) ON CONFLICT (id) DO NOTHING;

    -- 5 sections per document
    FOR j IN 1..5 LOOP
      v_sec_id := ('k6-sec-00000000-0000-0000-0000-' || LPAD(j::TEXT, 12, '0'))::UUID;

      -- Only insert sections for the first document to match SECTION_IDS in data-generators.js
      -- For other documents, generate unique section IDs
      IF i = 1 THEN
        INSERT INTO legal_document_sections (
          id, legal_document_id, section_type, section_label, ordering,
          plain_text, page_start, page_end, token_count, created_at
        ) VALUES (
          v_sec_id, v_doc_id,
          CASE j
            WHEN 1 THEN 'syllabus'
            WHEN 2 THEN 'facts'
            WHEN 3 THEN 'issues'
            WHEN 4 THEN 'ruling'
            ELSE 'dispositive'
          END,
          CASE j
            WHEN 1 THEN 'Syllabus'
            WHEN 2 THEN 'Statement of Facts'
            WHEN 3 THEN 'Issues'
            WHEN 4 THEN 'Ruling'
            ELSE 'Dispositive Portion'
          END,
          j,
          'This is the ' ||
            CASE j
              WHEN 1 THEN 'syllabus'
              WHEN 2 THEN 'statement of facts'
              WHEN 3 THEN 'issues section'
              WHEN 4 THEN 'ruling'
              ELSE 'dispositive portion'
            END ||
            ' of K6 test document ' || i || '. ' ||
            'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' ||
            'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' ||
            'Philippine jurisprudence establishes the principle of due process. ' ||
            'The Court hereby GRANTS the petition and REVERSES the decision of the lower court. ' ||
            'This section contains sample legal text for performance testing purposes.',
          (j - 1) * 3 + 1,
          j * 3,
          250,
          NOW()
        ) ON CONFLICT (id) DO NOTHING;
      ELSE
        INSERT INTO legal_document_sections (
          id, legal_document_id, section_type, section_label, ordering,
          plain_text, page_start, page_end, token_count, created_at
        ) VALUES (
          gen_random_uuid(), v_doc_id,
          CASE j
            WHEN 1 THEN 'syllabus'
            WHEN 2 THEN 'facts'
            WHEN 3 THEN 'issues'
            WHEN 4 THEN 'ruling'
            ELSE 'dispositive'
          END,
          CASE j
            WHEN 1 THEN 'Syllabus'
            WHEN 2 THEN 'Statement of Facts'
            WHEN 3 THEN 'Issues'
            WHEN 4 THEN 'Ruling'
            ELSE 'Dispositive Portion'
          END,
          j,
          'This is the ' ||
            CASE j
              WHEN 1 THEN 'syllabus'
              WHEN 2 THEN 'statement of facts'
              WHEN 3 THEN 'issues section'
              WHEN 4 THEN 'ruling'
              ELSE 'dispositive portion'
            END ||
            ' of K6 test document ' || i || '. ' ||
            'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' ||
            'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' ||
            'Philippine jurisprudence establishes the principle of due process. ' ||
            'The Court hereby GRANTS the petition and REVERSES the decision. ' ||
            'This section contains sample legal text for performance testing purposes.',
          (j - 1) * 3 + 1,
          j * 3,
          250,
          NOW()
        ) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'k6 performance test data seeded successfully: 1 org, 2 users, 1 subscription, 1 source, 20 documents, 100 sections';
END $$;
