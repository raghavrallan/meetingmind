-- Seed script: Populates the database with a device user, sample projects, and meetings.
-- Usage: docker exec -i ai-notetaker-postgres-1 psql -U notetaker -d ai_notetaker < seed.sql

-- ── 0. Abort if already seeded ─────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM users WHERE email = 'agent@local.device') THEN
        RAISE NOTICE 'Database already seeded. Skipping.';
        RETURN;
    END IF;

    -- ── 1. Create device user ──────────────────────────────────
    INSERT INTO users (id, email, name, auth_provider, provider_id, timezone, preferred_language, is_active, created_at, updated_at)
    VALUES (
        'a0000000-0000-0000-0000-000000000001',
        'agent@local.device',
        'Desktop Agent',
        'device',
        'local-device',
        'UTC',
        'en',
        true,
        NOW(),
        NOW()
    );
    RAISE NOTICE 'Created user: Desktop Agent';

    -- ── 2. Create projects ─────────────────────────────────────
    INSERT INTO projects (id, name, description, color, owner_id, is_archived, created_at, updated_at) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'Product Redesign Q1', 'Q1 product redesign initiative', '#6366f1', 'a0000000-0000-0000-0000-000000000001', false, NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000002', 'Client Onboarding',   'New client onboarding process',  '#10b981', 'a0000000-0000-0000-0000-000000000001', false, NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000003', 'Engineering Sprint',  'Bi-weekly engineering sprints',   '#f59e0b', 'a0000000-0000-0000-0000-000000000001', false, NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000004', 'Marketing Launch',    'Q1 marketing campaign launch',    '#ec4899', 'a0000000-0000-0000-0000-000000000001', false, NOW(), NOW());

    -- Owner memberships
    INSERT INTO project_members (id, project_id, user_id, role, joined_at) VALUES
    (gen_random_uuid(), 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'OWNER', NOW()),
    (gen_random_uuid(), 'b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'OWNER', NOW()),
    (gen_random_uuid(), 'b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'OWNER', NOW()),
    (gen_random_uuid(), 'b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'OWNER', NOW());
    RAISE NOTICE 'Created 4 projects with owner memberships';

    -- ── 3. Create meetings ─────────────────────────────────────
    INSERT INTO meetings (id, title, project_id, created_by_id, status, duration_seconds, actual_start, actual_end, language, created_at, updated_at) VALUES
    (
        'c0000000-0000-0000-0000-000000000001',
        'Sprint Planning - Q1',
        'b0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000001',
        'COMPLETED', 2722,
        NOW() - INTERVAL '2 hours',
        NOW() - INTERVAL '2 hours' + INTERVAL '2722 seconds',
        'en', NOW(), NOW()
    ),
    (
        'c0000000-0000-0000-0000-000000000002',
        'Product Design Review',
        'b0000000-0000-0000-0000-000000000002',
        'a0000000-0000-0000-0000-000000000001',
        'COMPLETED', 1935,
        NOW() - INTERVAL '4 hours',
        NOW() - INTERVAL '4 hours' + INTERVAL '1935 seconds',
        'en', NOW(), NOW()
    ),
    (
        'c0000000-0000-0000-0000-000000000003',
        'Client Sync - Acme Corp',
        'b0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000001',
        'COMPLETED', 1727,
        NOW() - INTERVAL '28 hours',
        NOW() - INTERVAL '28 hours' + INTERVAL '1727 seconds',
        'en', NOW(), NOW()
    ),
    (
        'c0000000-0000-0000-0000-000000000004',
        'Engineering Standup',
        'b0000000-0000-0000-0000-000000000003',
        'a0000000-0000-0000-0000-000000000001',
        'COMPLETED', 725,
        NOW() - INTERVAL '26 hours',
        NOW() - INTERVAL '26 hours' + INTERVAL '725 seconds',
        'en', NOW(), NOW()
    ),
    (
        'c0000000-0000-0000-0000-000000000005',
        '1:1 with Sarah',
        NULL,
        'a0000000-0000-0000-0000-000000000001',
        'COMPLETED', 1533,
        NOW() - INTERVAL '72 hours',
        NOW() - INTERVAL '72 hours' + INTERVAL '1533 seconds',
        'en', NOW(), NOW()
    ),
    (
        'c0000000-0000-0000-0000-000000000006',
        'Quarterly Business Review',
        'b0000000-0000-0000-0000-000000000002',
        'a0000000-0000-0000-0000-000000000001',
        'COMPLETED', 4542,
        NOW() - INTERVAL '96 hours',
        NOW() - INTERVAL '96 hours' + INTERVAL '4542 seconds',
        'en', NOW(), NOW()
    );
    RAISE NOTICE 'Created 6 meetings';

    -- ── 4. Create participants ──────────────────────────────────
    -- Sprint Planning (6 people)
    INSERT INTO meeting_participants (id, meeting_id, display_name, speaker_index, channel_index, talk_time_seconds, word_count) VALUES
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000001', 'Alice', 0, 0, 454, 1135),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000001', 'Bob', 1, 1, 454, 1135),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000001', 'Carol', 2, 1, 454, 1135),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000001', 'Dave', 3, 1, 454, 1135),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000001', 'Eve', 4, 1, 454, 1135),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000001', 'Frank', 5, 1, 454, 1135);

    -- Product Design Review (4 people)
    INSERT INTO meeting_participants (id, meeting_id, display_name, speaker_index, channel_index, talk_time_seconds, word_count) VALUES
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000002', 'Alice', 0, 0, 484, 1210),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000002', 'Bob', 1, 1, 484, 1210),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000002', 'Carol', 2, 1, 484, 1210),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000002', 'Grace', 3, 1, 484, 1210);

    -- Client Sync (3 people)
    INSERT INTO meeting_participants (id, meeting_id, display_name, speaker_index, channel_index, talk_time_seconds, word_count) VALUES
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000003', 'Alice', 0, 0, 576, 1440),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000003', 'Heidi', 1, 1, 576, 1440),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000003', 'Ivan', 2, 1, 576, 1440);

    -- Engineering Standup (8 people)
    INSERT INTO meeting_participants (id, meeting_id, display_name, speaker_index, channel_index, talk_time_seconds, word_count) VALUES
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000004', 'Alice', 0, 0, 91, 228),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000004', 'Bob', 1, 1, 91, 228),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000004', 'Carol', 2, 1, 91, 228),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000004', 'Dave', 3, 1, 91, 228),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000004', 'Eve', 4, 1, 91, 228),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000004', 'Frank', 5, 1, 91, 228),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000004', 'Grace', 6, 1, 91, 228),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000004', 'Heidi', 7, 1, 91, 228);

    -- 1:1 with Sarah (2 people)
    INSERT INTO meeting_participants (id, meeting_id, display_name, speaker_index, channel_index, talk_time_seconds, word_count) VALUES
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000005', 'Alice', 0, 0, 767, 1918),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000005', 'Sarah', 1, 1, 767, 1918);

    -- QBR (12 people)
    INSERT INTO meeting_participants (id, meeting_id, display_name, speaker_index, channel_index, talk_time_seconds, word_count) VALUES
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000006', 'Alice', 0, 0, 379, 948),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000006', 'Bob', 1, 1, 379, 948),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000006', 'Carol', 2, 1, 379, 948),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000006', 'Dave', 3, 1, 379, 948),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000006', 'Eve', 4, 1, 379, 948),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000006', 'Frank', 5, 1, 379, 948),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000006', 'Grace', 6, 1, 379, 948),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000006', 'Heidi', 7, 1, 379, 948),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000006', 'Ivan', 8, 1, 379, 948),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000006', 'Judy', 9, 1, 379, 948),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000006', 'Karl', 10, 1, 379, 948),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000006', 'Liam', 11, 1, 379, 948);

    -- ── 5. Create meeting notes ──────────────────────────────────
    INSERT INTO meeting_notes (id, meeting_id, version, executive_summary, key_points, decisions, action_items, open_questions, topics_discussed, full_notes_markdown, model_used, context_chunks_used, generation_time_ms, created_at) VALUES
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000001', 1,
     'Sprint Planning for Q1. Reviewed backlog priorities, assigned story points, and committed to sprint goals.',
     '["Reviewed 15 backlog items", "Assigned story points to top 8 stories", "Committed to 34 story points for the sprint"]',
     '["Prioritize performance optimization over new features", "Move deadline for auth refactor to next sprint"]',
     '[{"task": "Create detailed specs for search feature", "assignee": "Bob", "due": "Wednesday"}, {"task": "Set up staging environment", "assignee": "Carol", "due": "Thursday"}]',
     '["Should we adopt the new testing framework this sprint?"]',
     '["Sprint planning", "Backlog grooming", "Capacity planning"]',
     '# Sprint Planning - Q1\n\n## Summary\nThe team reviewed backlog priorities and committed to 34 story points for the upcoming sprint.\n\n## Key Decisions\n- Prioritize performance over new features\n- Auth refactor moved to next sprint\n\n## Action Items\n- Bob: Create specs for search feature (Wed)\n- Carol: Set up staging environment (Thu)',
     'claude-sonnet-4-20250514', 0, 2500, NOW()),

    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000002', 1,
     'Product Design Review covering new onboarding flow mockups and mobile responsive designs.',
     '["Reviewed 3 design iterations for onboarding", "Discussed mobile-first approach", "Approved final color palette"]',
     '["Go with iteration 3 for onboarding flow", "Use system fonts instead of custom fonts for performance"]',
     '[{"task": "Finalize high-fidelity mockups", "assignee": "Alice", "due": "Friday"}, {"task": "Create component library in Figma", "assignee": "Grace", "due": "Next Monday"}]',
     '["How to handle accessibility for color-blind users?"]',
     '["Design review", "UX improvements", "Mobile responsive"]',
     '# Product Design Review\n\n## Summary\nReviewed onboarding flow mockups and agreed on iteration 3.\n\n## Decisions\n- Iteration 3 approved\n- System fonts for performance',
     'claude-sonnet-4-20250514', 0, 2200, NOW()),

    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000004', 1,
     'Daily standup covering blockers, progress updates, and sprint health check.',
     '["All team members shared updates", "2 blockers identified", "Sprint is on track at 60% completion"]',
     '["Pair programming session for blocked API task"]',
     '[{"task": "Resolve CI pipeline failure", "assignee": "Dave", "due": "Today"}, {"task": "Review PR #142", "assignee": "Eve", "due": "Today"}]',
     '["Will the API integration be ready for demo?"]',
     '["Daily standup", "Blocker resolution", "Sprint progress"]',
     '# Engineering Standup\n\n## Summary\nDaily standup. Sprint at 60% completion with 2 blockers.\n\n## Blockers\n- CI pipeline failing on integration tests\n- API endpoint spec mismatch',
     'claude-sonnet-4-20250514', 0, 1800, NOW()),

    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000005', 1,
     'Weekly 1:1 with Sarah discussing career goals, current project satisfaction, and upcoming opportunities.',
     '["Discussed career growth path", "Reviewed Q1 goals progress", "Identified training opportunity"]',
     '["Sarah to lead the next feature demo", "Schedule shadow session with senior engineer"]',
     '[{"task": "Share conference talk proposals", "assignee": "Sarah", "due": "Next week"}, {"task": "Set up mentorship pairing", "assignee": "Alice", "due": "Friday"}]',
     '[]',
     '["1:1 meeting", "Career development", "Goal tracking"]',
     '# 1:1 with Sarah\n\n## Summary\nWeekly 1:1 covering career development and Q1 goal progress.\n\n## Decisions\n- Sarah leads next feature demo\n- Shadow session scheduled',
     'claude-sonnet-4-20250514', 0, 2100, NOW()),

    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000006', 1,
     'Quarterly Business Review covering Q4 results, Q1 targets, budget allocation, and strategic initiatives.',
     '["Q4 revenue exceeded target by 12%", "Customer retention at 94%", "3 new enterprise deals in pipeline", "Engineering velocity improved 18%"]',
     '["Increase marketing budget by 15% for Q1", "Hire 3 additional engineers", "Launch partner program in Q1"]',
     '[{"task": "Prepare Q1 marketing plan", "assignee": "Frank", "due": "Next Friday"}, {"task": "Draft engineering hiring JDs", "assignee": "Dave", "due": "Next week"}, {"task": "Partner program proposal", "assignee": "Grace", "due": "End of month"}]',
     '["What is the timeline for Series B preparation?", "How to handle enterprise pricing tiers?"]',
     '["Quarterly review", "Financial results", "Strategic planning", "Hiring"]',
     '# Quarterly Business Review\n\n## Summary\nQ4 exceeded targets. Q1 focused on growth: increased marketing budget, engineering hiring, and partner program launch.\n\n## Key Metrics\n- Revenue: +12% over target\n- Retention: 94%\n- Engineering velocity: +18%',
     'claude-sonnet-4-20250514', 0, 3200, NOW());

    -- ── 6. Create tasks ──────────────────────────────────────────
    INSERT INTO tasks (id, title, description, status, priority, assignee_id, project_id, source_meeting_id, due_date, created_by_id, resurface_count, created_at, updated_at) VALUES
    ('d0000000-0000-0000-0000-000000000001', 'Complete notification system',
     'Finish the real-time notification system including WebSocket push and email fallback.',
     'IN_PROGRESS', 'HIGH', 'a0000000-0000-0000-0000-000000000001',
     'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
     (NOW() + INTERVAL '5 days')::date,
     'a0000000-0000-0000-0000-000000000001', 0, NOW(), NOW()),

    ('d0000000-0000-0000-0000-000000000002', 'Build recording UI components',
     'Implement waveform visualization, transcript display, and audio controls.',
     'OPEN', 'HIGH', 'a0000000-0000-0000-0000-000000000001',
     'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
     (NOW() + INTERVAL '12 days')::date,
     'a0000000-0000-0000-0000-000000000001', 0, NOW(), NOW()),

    ('d0000000-0000-0000-0000-000000000003', 'Anthropic API proof of concept',
     'Create PoC for meeting summarization using Claude API with streaming responses.',
     'OPEN', 'MEDIUM', 'a0000000-0000-0000-0000-000000000001',
     'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
     (NOW() + INTERVAL '3 days')::date,
     'a0000000-0000-0000-0000-000000000001', 0, NOW(), NOW()),

    ('d0000000-0000-0000-0000-000000000004', 'Finalize mobile layouts',
     'Address pending feedback on mobile responsive designs for the dashboard.',
     'IN_PROGRESS', 'MEDIUM', 'a0000000-0000-0000-0000-000000000001',
     'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002',
     (NOW() + INTERVAL '5 days')::date,
     'a0000000-0000-0000-0000-000000000001', 0, NOW(), NOW()),

    ('d0000000-0000-0000-0000-000000000005', 'Write API documentation',
     'Document all REST endpoints with request/response examples.',
     'COMPLETED', 'LOW', 'a0000000-0000-0000-0000-000000000001',
     'b0000000-0000-0000-0000-000000000001', NULL,
     (NOW() - INTERVAL '2 days')::date,
     'a0000000-0000-0000-0000-000000000001', 0, NOW() - INTERVAL '7 days', NOW()),

    ('d0000000-0000-0000-0000-000000000006', 'Review security audit report',
     'Go through the security audit findings and prioritize fixes.',
     'OPEN', 'URGENT', 'a0000000-0000-0000-0000-000000000001',
     'b0000000-0000-0000-0000-000000000003', NULL,
     (NOW() + INTERVAL '1 day')::date,
     'a0000000-0000-0000-0000-000000000001', 0, NOW(), NOW()),

    ('d0000000-0000-0000-0000-000000000007', 'Set up CI/CD pipeline',
     'Configure GitHub Actions for automated testing and deployment.',
     'IN_PROGRESS', 'HIGH', 'a0000000-0000-0000-0000-000000000001',
     'b0000000-0000-0000-0000-000000000003', NULL,
     (NOW() + INTERVAL '8 days')::date,
     'a0000000-0000-0000-0000-000000000001', 0, NOW(), NOW()),

    ('d0000000-0000-0000-0000-000000000008', 'Fix login redirect bug',
     'Users are not being redirected correctly after OAuth login.',
     'CANCELLED', 'MEDIUM', 'a0000000-0000-0000-0000-000000000001',
     'b0000000-0000-0000-0000-000000000002', NULL,
     NULL,
     'a0000000-0000-0000-0000-000000000001', 0, NOW() - INTERVAL '3 days', NOW());

    RAISE NOTICE 'Created 8 tasks';

    RAISE NOTICE 'Seed complete: 1 user, 4 projects, 6 meetings with participants/notes, 8 tasks';
END
$$;
