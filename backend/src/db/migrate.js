require('dotenv').config();
const { query } = require('./index');

async function migrate() {
  console.log('Running database migrations...');

  await query(`
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

    -- ═══════════════════════════════════════════════════════════
    -- TERMINOLOGY MIGRATION: batch → class
    -- One-time compatibility shim for databases created before the
    -- "batch" terminology was renamed to "class" throughout the app.
    -- Each rename is a no-op (caught) on a fresh install, where these
    -- tables/columns don't exist under the old names yet, and a no-op
    -- on a database that's already been migrated once.
    -- ═══════════════════════════════════════════════════════════
    DO $$ BEGIN
      ALTER TABLE batches RENAME TO classes;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE student_batches RENAME TO student_classes;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE test_batches RENAME TO test_classes;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE drive_batches RENAME TO drive_classes;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;

    -- Note: each of these column renames can fail two different ways on a
    -- database that predates this migration entirely — either the column
    -- doesn't exist yet (undefined_column) or, on a truly fresh database,
    -- the whole table doesn't exist yet either since it's created further
    -- down this same script (undefined_table). Both are harmless no-ops.
    DO $$ BEGIN
      ALTER TABLE student_classes RENAME COLUMN batch_id TO class_id;
    EXCEPTION WHEN undefined_column THEN NULL;
    WHEN undefined_table THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE test_classes RENAME COLUMN batch_id TO class_id;
    EXCEPTION WHEN undefined_column THEN NULL;
    WHEN undefined_table THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE drive_classes RENAME COLUMN batch_id TO class_id;
    EXCEPTION WHEN undefined_column THEN NULL;
    WHEN undefined_table THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE users RENAME COLUMN batch TO class_name;
    EXCEPTION WHEN undefined_column THEN NULL;
    WHEN undefined_table THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE submissions RENAME COLUMN batch_snapshot TO class_snapshot;
    EXCEPTION WHEN undefined_column THEN NULL;
    WHEN undefined_table THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE announcements RENAME COLUMN target_batches TO target_classes;
    EXCEPTION WHEN undefined_column THEN NULL;
    WHEN undefined_table THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE tests RENAME COLUMN batches TO classes;
    EXCEPTION WHEN undefined_column THEN NULL;
    WHEN undefined_table THEN NULL;
    END $$;

    -- Payment/billing was never wired up to an actual provider — drop the
    -- dead schema outright rather than carrying it forward unused.
    DROP TABLE IF EXISTS payment_transactions;
    DROP TABLE IF EXISTS payment_plans;

    -- Scheduled Reports feature was removed — drop its table.
    DROP TABLE IF EXISTS scheduled_reports;

    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name VARCHAR(255),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255),
      role VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (role IN ('super_admin', 'admin', 'student')),
      department VARCHAR(100),
      google_id VARCHAR(255) UNIQUE,
      avatar_url TEXT,
      branch VARCHAR(100),
      roll_number VARCHAR(50),
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      is_active BOOLEAN DEFAULT true,
      last_login TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Tests table
    CREATE TABLE IF NOT EXISTS tests (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      title VARCHAR(500) NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      start_time TIMESTAMPTZ,
      end_time TIMESTAMPTZ,
      duration_minutes INTEGER NOT NULL DEFAULT 90,
      department VARCHAR(100) NOT NULL,
      settings JSONB DEFAULT '{}',
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Sections table
    CREATE TABLE IF NOT EXISTS sections (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      type VARCHAR(20) NOT NULL CHECK (type IN ('aptitude', 'coding')),
      order_index INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Questions table (aptitude)
    CREATE TABLE IF NOT EXISTS questions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
      type VARCHAR(30) NOT NULL DEFAULT 'mcq',
      text TEXT NOT NULL,
      image_url TEXT,
      options JSONB,
      option_images JSONB,
      correct_answer JSONB,
      explanation TEXT,
      marks INTEGER DEFAULT 2,
      difficulty VARCHAR(10) DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
      genre VARCHAR(30) DEFAULT 'general',
      order_index INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Coding problems table
    CREATE TABLE IF NOT EXISTS coding_problems (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
      title VARCHAR(500) NOT NULL,
      description TEXT,
      image_url TEXT,
      input_format TEXT,
      output_format TEXT,
      constraints TEXT,
      sample_input TEXT,
      sample_output TEXT,
      explanation TEXT,
      test_cases JSONB DEFAULT '[]',
      starter_code JSONB DEFAULT '{}',
      time_limit_seconds INTEGER DEFAULT 2,
      memory_limit_mb INTEGER DEFAULT 256,
      marks INTEGER DEFAULT 10,
      difficulty VARCHAR(10) DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
      tags TEXT,
      order_index INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Images table (question / option images stored directly in Postgres as bytea,
    -- so uploads survive redeploys/restarts and work across multiple backend instances
    -- without needing a shared disk or a third-party file host)
    CREATE TABLE IF NOT EXISTS images (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      data BYTEA NOT NULL,
      mimetype VARCHAR(100) NOT NULL DEFAULT 'image/jpeg',
      filename VARCHAR(255),
      size_bytes INTEGER,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_images_created_by ON images(created_by);

    -- Submissions table
    CREATE TABLE IF NOT EXISTS submissions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'auto_submitted')),
      score NUMERIC(8,2) DEFAULT 0,
      max_score NUMERIC(8,2) DEFAULT 0,
      answers JSONB DEFAULT '{}',
      code_solutions JSONB DEFAULT '{}',
      code_results JSONB DEFAULT '{}',
      started_at TIMESTAMPTZ DEFAULT NOW(),
      submitted_at TIMESTAMPTZ,
      time_taken_seconds INTEGER,
      ip_address INET,
      flagged_questions JSONB DEFAULT '[]',
      UNIQUE(test_id, user_id)
    );

    -- Test invitations / allowed users
    CREATE TABLE IF NOT EXISTS test_invitations (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      email VARCHAR(255),
      invited_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Classes table
    CREATE TABLE IF NOT EXISTS classes (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name VARCHAR(100) NOT NULL,
      department VARCHAR(100) NOT NULL,
      year_of_study INTEGER DEFAULT 1,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(name, department)
    );

    -- Test-to-class mapping (reconfigurable per drive)
    CREATE TABLE IF NOT EXISTS test_classes (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      section_mapping JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(test_id, class_id)
    );

    -- Student class assignments (semester-based)
    CREATE TABLE IF NOT EXISTS student_classes (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      year_of_study INTEGER NOT NULL DEFAULT 1,
      semester VARCHAR(20),
      assigned_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, semester)
    );

    -- Add genre column to questions (if not present)
    DO $$ BEGIN
      ALTER TABLE questions ADD COLUMN IF NOT EXISTS genre VARCHAR(30) DEFAULT 'general';
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    -- Add class/year columns to users
    DO $$ BEGIN
      ALTER TABLE users ADD COLUMN IF NOT EXISTS class_name VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS year_of_study INTEGER DEFAULT 1;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    -- Add resume support to submissions
    DO $$ BEGIN
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ;
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS tab_switch_count INTEGER DEFAULT 0;
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS selected_problems JSONB DEFAULT '[]';
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    -- Historical snapshot of the student's class/year at the time they took the
    -- test, so later semester reshuffles don't rewrite past class-wise results.
    DO $$ BEGIN
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS class_snapshot VARCHAR(100);
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS year_snapshot INTEGER;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    -- MCQ "set" (A/B/C/D) — lets an admin tag questions into up to 4 variants
    -- and map different classes to different sets for the same drive, to
    -- reduce answer-sharing between classes sitting the same aptitude round.
    DO $$ BEGIN
      ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_set CHAR(1) DEFAULT 'A';
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
    CREATE INDEX IF NOT EXISTS idx_questions_set ON questions(question_set);

    -- Question Bank — reusable MCQ / coding questions, independent of any test
    CREATE TABLE IF NOT EXISTS bank_questions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      type VARCHAR(10) NOT NULL CHECK (type IN ('mcq', 'coding')),
      data JSONB NOT NULL,
      genre VARCHAR(30) DEFAULT 'general',
      difficulty VARCHAR(10) DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
      marks INTEGER DEFAULT 2,
      tags TEXT,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_bank_questions_type ON bank_questions(type);
    CREATE INDEX IF NOT EXISTS idx_bank_questions_genre ON bank_questions(genre);

    -- Drives — a pure grouping of existing Tests for combined analytics
    -- and viewing. A drive has no schedule/duration/passing-score/status
    -- of its own; every one of those lives on each linked Test.
    CREATE TABLE IF NOT EXISTS drives (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      title VARCHAR(500) NOT NULL,
      description TEXT,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Drive-to-test mappings (a drive can have multiple tests)
    CREATE TABLE IF NOT EXISTS drive_tests (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      drive_id UUID NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
      test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      round_number INTEGER DEFAULT 1,
      round_type VARCHAR(20) DEFAULT 'aptitude' CHECK (round_type IN ('aptitude', 'coding', 'combined')),
      order_index INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(drive_id, test_id)
    );

    -- Drives used to be their own independent, schedulable entity with a
    -- lifecycle status, timing/duration, department and passing score, and
    -- a separate class mapping (drive_classes) that triggered its own
    -- reminder emails. Repurposed into a plain grouping of existing Tests
    -- — those fields and drive_classes are gone; drop them from any DB
    -- that already ran the old schema.
    DO $$ BEGIN
      ALTER TABLE drives DROP COLUMN IF EXISTS status;
      ALTER TABLE drives DROP COLUMN IF EXISTS start_time;
      ALTER TABLE drives DROP COLUMN IF EXISTS end_time;
      ALTER TABLE drives DROP COLUMN IF EXISTS department;
      ALTER TABLE drives DROP COLUMN IF EXISTS mcq_duration_minutes;
      ALTER TABLE drives DROP COLUMN IF EXISTS coding_duration_minutes;
      ALTER TABLE drives DROP COLUMN IF EXISTS passing_score;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;
    DROP TABLE IF EXISTS drive_classes;

    -- Audit log
    CREATE TABLE IF NOT EXISTS audit_log (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50),
      entity_id UUID,
      metadata JSONB,
      ip_address INET,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Additional indexes for performance
    CREATE INDEX IF NOT EXISTS idx_questions_genre ON questions(genre);
    CREATE INDEX IF NOT EXISTS idx_submissions_tab_switch ON submissions(tab_switch_count);
    CREATE INDEX IF NOT EXISTS idx_test_classes_test_id ON test_classes(test_id);
    CREATE INDEX IF NOT EXISTS idx_test_classes_class_id ON test_classes(class_id);
    CREATE INDEX IF NOT EXISTS idx_student_classes_user_id ON student_classes(user_id);
    CREATE INDEX IF NOT EXISTS idx_student_classes_class_id ON student_classes(class_id);
    CREATE INDEX IF NOT EXISTS idx_users_class_name ON users(class_name);

    -- ═══════════════════════════════════════════════════════════
    -- LEADERBOARD (student XP backing data)
    -- ═══════════════════════════════════════════════════════════

    -- Student XP & Leveling
    CREATE TABLE IF NOT EXISTS student_xp (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      xp_points BIGINT DEFAULT 0,
      level INTEGER DEFAULT 1,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS xp_transactions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      reason VARCHAR(255),
      reference_type VARCHAR(50),
      reference_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_xp_transactions_user ON xp_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_xp_transactions_created ON xp_transactions(created_at);

    -- ═══════════════════════════════════════════════════════════
    -- COMMUNICATION & NOTIFICATIONS
    -- ═══════════════════════════════════════════════════════════

    -- Notifications table
    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(50) NOT NULL,
      title VARCHAR(500) NOT NULL,
      body TEXT,
      data JSONB DEFAULT '{}',
      is_read BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

    -- SMS opt-in for users
    DO $$ BEGIN
      ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_opt_in BOOLEAN DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    -- Test messages (student-to-admin during tests)
    CREATE TABLE IF NOT EXISTS test_messages (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      submission_id UUID REFERENCES submissions(id) ON DELETE SET NULL,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      is_from_student BOOLEAN DEFAULT true,
      resolved BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_test_messages_test ON test_messages(test_id);
    CREATE INDEX IF NOT EXISTS idx_test_messages_user ON test_messages(user_id);

    -- Announcements table
    CREATE TABLE IF NOT EXISTS announcements (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      title VARCHAR(500) NOT NULL,
      body TEXT NOT NULL,
      priority VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
      target_role VARCHAR(20) DEFAULT 'all' CHECK (target_role IN ('all', 'student', 'admin')),
      target_classes JSONB DEFAULT '[]',
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_announcements_role ON announcements(target_role);
    CREATE INDEX IF NOT EXISTS idx_announcements_priority ON announcements(priority);
    CREATE INDEX IF NOT EXISTS idx_announcements_expires ON announcements(expires_at);

    -- Forum threads for coding problems
    CREATE TABLE IF NOT EXISTS forum_threads (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      problem_id UUID NOT NULL REFERENCES coding_problems(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(500) NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_forum_threads_problem ON forum_threads(problem_id);

    -- Forum replies
    CREATE TABLE IF NOT EXISTS forum_replies (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      thread_id UUID NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      parent_reply_id UUID REFERENCES forum_replies(id) ON DELETE CASCADE,
      upvotes INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_forum_replies_thread ON forum_replies(thread_id);

    -- Forum upvotes
    CREATE TABLE IF NOT EXISTS forum_upvotes (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      reply_id UUID NOT NULL REFERENCES forum_replies(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(reply_id, user_id)
    );

    -- ═══════════════════════════════════════════════════════════
    -- CHEATING DETECTION
    -- ═══════════════════════════════════════════════════════════

    -- Keystroke logs for cheating analysis
    CREATE TABLE IF NOT EXISTS keystroke_logs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      question_id UUID,
      test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('keydown', 'paste', 'focus_change', 'copy', 'answer_change')),
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_keystroke_logs_submission ON keystroke_logs(submission_id);
    CREATE INDEX IF NOT EXISTS idx_keystroke_logs_test ON keystroke_logs(test_id);
    CREATE INDEX IF NOT EXISTS idx_keystroke_logs_event ON keystroke_logs(event_type);

    -- Suspicious activity flags
    CREATE TABLE IF NOT EXISTS suspicious_flags (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
      user_name VARCHAR(255),
      email VARCHAR(255),
      roll_number VARCHAR(50),
      suspicion_score INTEGER DEFAULT 0,
      reasons JSONB DEFAULT '[]',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_suspicious_flags_test ON suspicious_flags(test_id);
    CREATE INDEX IF NOT EXISTS idx_suspicious_flags_score ON suspicious_flags(suspicion_score DESC);

    DO $$ BEGIN
      ALTER TABLE suspicious_flags ADD COLUMN IF NOT EXISTS reviewed BOOLEAN DEFAULT false;
      ALTER TABLE suspicious_flags ADD COLUMN IF NOT EXISTS severity VARCHAR(10) DEFAULT 'medium'
        CHECK (severity IN ('low', 'medium', 'high', 'critical'));
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    -- controllers/security.js's reviewAlert/disqualifySubmission already
    -- read and write these three columns (flag_type, reviewed_by,
    -- action_taken) — they were never actually added to the table, so
    -- reviewing any security alert has been failing with a DB error since
    -- that feature shipped. Adding them now also gives the new plagiarism
    -- bulk-action endpoint (ignore/warn/disqualify) the same audit trail.
    DO $$ BEGIN
      ALTER TABLE suspicious_flags ADD COLUMN IF NOT EXISTS flag_type VARCHAR(50) DEFAULT 'other';
      ALTER TABLE suspicious_flags ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE suspicious_flags ADD COLUMN IF NOT EXISTS action_taken VARCHAR(20)
        CHECK (action_taken IS NULL OR action_taken IN ('warn', 'disqualify', 'ignore'));
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    -- Proctoring snapshots table
    CREATE TABLE IF NOT EXISTS proctoring_snapshots (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      image_url TEXT,
      face_detected BOOLEAN DEFAULT true,
      faces_count INTEGER DEFAULT 1,
      gaze_ok BOOLEAN DEFAULT true,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_proctoring_snapshots_submission ON proctoring_snapshots(submission_id);

    -- Proctoring flags table
    CREATE TABLE IF NOT EXISTS proctoring_flags (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      flag_type VARCHAR(50) NOT NULL CHECK (flag_type IN ('face_absent', 'multiple_faces', 'gaze_deviation')),
      severity VARCHAR(10) NOT NULL DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high')),
      timestamp TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_proctoring_flags_submission ON proctoring_flags(submission_id);

    -- Test shuffles table
    CREATE TABLE IF NOT EXISTS test_shuffles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question_order JSONB DEFAULT '{}',
      option_orders JSONB DEFAULT '{}',
      seed VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(test_id, user_id)
    );

    -- Add security columns to existing tables
    DO $$ BEGIN
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS fingerprint_hash VARCHAR(255);
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS fullscreen_exit_count INTEGER DEFAULT 0;
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS paste_attempts INTEGER DEFAULT 0;
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS keystroke_count INTEGER DEFAULT 0;
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS device_fingerprint JSONB DEFAULT '{}';
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE questions ADD COLUMN IF NOT EXISTS time_bomb JSONB DEFAULT '{"enabled":false,"duration_seconds":0}';
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    -- ═══════════════════════════════════════════════════════════
    -- CODING PLATFORM ENHANCEMENTS
    -- ═══════════════════════════════════════════════════════════

    -- File structure for multi-file coding problems
    DO $$ BEGIN
      ALTER TABLE coding_problems ADD COLUMN IF NOT EXISTS file_structure JSONB DEFAULT '[]';
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    -- Code snapshots for playback timeline
    CREATE TABLE IF NOT EXISTS code_snapshots (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
      problem_id UUID REFERENCES coding_problems(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      language VARCHAR(50) NOT NULL,
      snapshot_type VARCHAR(50) NOT NULL DEFAULT 'auto' CHECK (snapshot_type IN ('keystroke','paste','auto','manual')),
      file_path VARCHAR(500) DEFAULT 'main',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_code_snapshots_submission ON code_snapshots(submission_id);
    CREATE INDEX IF NOT EXISTS idx_code_snapshots_problem ON code_snapshots(problem_id);
    CREATE INDEX IF NOT EXISTS idx_code_snapshots_user ON code_snapshots(user_id);
    CREATE INDEX IF NOT EXISTS idx_code_snapshots_created ON code_snapshots(created_at);

    -- Code quality reports
    CREATE TABLE IF NOT EXISTS code_quality_reports (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      problem_id UUID REFERENCES coding_problems(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      language VARCHAR(50) NOT NULL,
      lines_of_code INTEGER DEFAULT 0,
      total_lines INTEGER DEFAULT 0,
      comment_lines INTEGER DEFAULT 0,
      blank_lines INTEGER DEFAULT 0,
      comment_ratio NUMERIC(5,2) DEFAULT 0,
      cyclomatic_complexity INTEGER DEFAULT 1,
      num_functions INTEGER DEFAULT 0,
      num_classes INTEGER DEFAULT 0,
      max_nesting_depth INTEGER DEFAULT 0,
      maintainability_index INTEGER DEFAULT 100,
      readability_score INTEGER DEFAULT 50,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_code_quality_submission ON code_quality_reports(submission_id);
    CREATE INDEX IF NOT EXISTS idx_code_quality_user ON code_quality_reports(user_id);

    -- Saved custom test cases
    CREATE TABLE IF NOT EXISTS saved_custom_tests (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      problem_id UUID NOT NULL REFERENCES coding_problems(id) ON DELETE CASCADE,
      input TEXT NOT NULL,
      expected_output TEXT,
      name VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_saved_custom_tests_user ON saved_custom_tests(user_id);
    CREATE INDEX IF NOT EXISTS idx_saved_custom_tests_problem ON saved_custom_tests(problem_id);

    -- Indexes for performance with 1000 concurrent users
    CREATE INDEX IF NOT EXISTS idx_submissions_test_id ON submissions(test_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_user_id ON submissions(user_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
    CREATE INDEX IF NOT EXISTS idx_questions_section_id ON questions(section_id);
    CREATE INDEX IF NOT EXISTS idx_coding_problems_section_id ON coding_problems(section_id);
    CREATE INDEX IF NOT EXISTS idx_sections_test_id ON sections(test_id);
    CREATE INDEX IF NOT EXISTS idx_tests_status ON tests(status);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);

    -- ═══════════════════════════════════════════════════════════
    -- MULTI-TENANT ARCHITECTURE
    -- ═══════════════════════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) UNIQUE NOT NULL,
      domain VARCHAR(255) UNIQUE,
      logo_url TEXT,
      primary_color VARCHAR(7) DEFAULT '#2F5D56',
      secondary_color VARCHAR(7) DEFAULT '#565C86',
      favicon_url TEXT,
      is_active BOOLEAN DEFAULT true,
      settings JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    DO $$ BEGIN
      ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE tests ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE classes ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE drives ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_tests_tenant ON tests(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_classes_tenant ON classes(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_drives_tenant ON drives(tenant_id);

    -- ═══════════════════════════════════════════════════════════
    -- RBAC: ROLES & PERMISSIONS
    -- ═══════════════════════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS roles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name VARCHAR(50) UNIQUE NOT NULL CHECK (name IN ('super_admin', 'dept_admin', 'proctor', 'auditor', 'student')),
      description TEXT,
      permissions JSONB DEFAULT '[]',
      tenant_id UUID REFERENCES tenants(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      tenant_id UUID REFERENCES tenants(id),
      department VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, role_id)
    );

    -- Seed default roles
    INSERT INTO roles (name, description, permissions) VALUES
      ('super_admin', 'Full system access', '["*"]'),
      ('dept_admin', 'Department-level administration', '["tests:create","tests:edit","tests:delete","tests:publish","results:view","results:export","users:view","users:create","users:edit","question-bank:manage","classes:manage"]'),
      ('proctor', 'Live exam monitoring', '["proctor:view-sessions","proctor:terminate","proctor:attendance","results:view"]'),
      ('auditor', 'Read-only access to logs and results', '["audit:view","audit:export","results:view"]'),
      ('student', 'Test taking and own results', '[]')
    ON CONFLICT (name) DO NOTHING;

    -- ═══════════════════════════════════════════════════════════
    -- USAGE QUOTAS (per-tenant resource limits)
    -- ═══════════════════════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS usage_quotas (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      max_students INTEGER DEFAULT 100,
      max_tests INTEGER DEFAULT 50,
      max_storage_mb INTEGER DEFAULT 1000,
      max_api_calls INTEGER DEFAULT 10000,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS usage_records (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      metric_type VARCHAR(50) NOT NULL CHECK (metric_type IN ('students', 'tests', 'storage', 'api_calls')),
      value INTEGER DEFAULT 1,
      recorded_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_usage_records_tenant ON usage_records(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_usage_records_type ON usage_records(metric_type);
    CREATE INDEX IF NOT EXISTS idx_usage_quotas_tenant ON usage_quotas(tenant_id);

    -- ═══════════════════════════════════════════════════════════
    -- TEST TEMPLATES
    -- ═══════════════════════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS test_templates (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      config JSONB NOT NULL DEFAULT '{}',
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- ═══════════════════════════════════════════════════════════
    -- QUESTION COLLABORATION & VERSIONING
    -- ═══════════════════════════════════════════════════════════

    DO $$ BEGIN
      ALTER TABLE bank_questions ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft'
        CHECK (status IN ('draft', 'review', 'published', 'archived'));
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE bank_questions ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE questions ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'published'
        CHECK (status IN ('draft', 'review', 'published', 'archived'));
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS question_versions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      question_id UUID NOT NULL,
      source_type VARCHAR(10) NOT NULL CHECK (source_type IN ('bank', 'test')),
      data JSONB NOT NULL,
      version INTEGER NOT NULL,
      changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_question_versions_q ON question_versions(question_id);

    -- ═══════════════════════════════════════════════════════════
    -- BILINGUAL QUESTION SUPPORT
    -- ═══════════════════════════════════════════════════════════

    DO $$ BEGIN
      ALTER TABLE questions ADD COLUMN IF NOT EXISTS text_secondary TEXT;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE questions ADD COLUMN IF NOT EXISTS options_secondary JSONB;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE coding_problems ADD COLUMN IF NOT EXISTS description_secondary TEXT;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    -- ═══════════════════════════════════════════════════════════
    -- SCHEDULED PUBLISHING
    -- ═══════════════════════════════════════════════════════════

    DO $$ BEGIN
      ALTER TABLE tests ADD COLUMN IF NOT EXISTS scheduled_publish_at TIMESTAMPTZ;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    -- Multi-department targeting: a test can be shown to several branches.
    -- 'department' is kept as the primary/legacy single value (first selected
    -- or 'all'); 'departments' holds the full JSON array.
    DO $$ BEGIN
      ALTER TABLE tests ADD COLUMN IF NOT EXISTS departments JSONB DEFAULT '[]'::jsonb;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
    UPDATE tests
       SET departments = CASE
             WHEN department = 'all' THEN '["all"]'::jsonb
             WHEN department IS NOT NULL AND department <> '' THEN jsonb_build_array(department)
             ELSE '[]'::jsonb
           END
     WHERE departments IS NULL
        OR departments = '[]'::jsonb
        OR departments = 'null'::jsonb;

    -- Year-of-study targeting: which academic years can sit this test.
    -- 'years' holds a JSON array of integers (e.g. [1, 3]); an empty array
    -- means all years.
    DO $$ BEGIN
      ALTER TABLE tests ADD COLUMN IF NOT EXISTS years JSONB DEFAULT '[]'::jsonb;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    -- Class targeting: which classes can sit this test. 'classes' holds a
    -- JSON array of class names (matching users.class_name); an empty array
    -- means every class.
    DO $$ BEGIN
      ALTER TABLE tests ADD COLUMN IF NOT EXISTS classes JSONB DEFAULT '[]'::jsonb;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    -- Manual results release: when settings.showResults is 'manual', a
    -- submission's score/breakdown stays hidden from the student until an
    -- admin explicitly flips this. Also doubles as the marker used for
    -- 'after_end' tests whose end_time is unset.
    DO $$ BEGIN
      ALTER TABLE tests ADD COLUMN IF NOT EXISTS results_published_at TIMESTAMPTZ;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    -- ═══════════════════════════════════════════════════════════
    -- 2FA / TOTP
    -- ═══════════════════════════════════════════════════════════

    DO $$ BEGIN
      ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    -- ═══════════════════════════════════════════════════════════
    -- GDPR CONSENT
    -- ═══════════════════════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS consent_records (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      consent_type VARCHAR(50) NOT NULL,
      granted BOOLEAN NOT NULL DEFAULT true,
      granted_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, consent_type)
    );

    -- ═══════════════════════════════════════════════════════════
    -- PARAMETERIZED / TEMPLATE QUESTIONS
    -- ═══════════════════════════════════════════════════════════

    DO $$ BEGIN
      ALTER TABLE bank_questions ADD COLUMN IF NOT EXISTS template JSONB;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE questions ADD COLUMN IF NOT EXISTS template JSONB;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

  -- ═══════════════════════════════════════════════════════════
  -- ADVANCED ANALYTICS & REPORTING TABLES
  -- ═══════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS threshold_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(500) NOT NULL,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    threshold_pct NUMERIC(5,2) NOT NULL DEFAULT 20.00,
    email_recipients JSONB NOT NULL DEFAULT '[]',
    enabled BOOLEAN DEFAULT true,
    last_triggered_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- Report builder saved reports
  CREATE TABLE IF NOT EXISTS saved_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(500) NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- Automated email suppression rules — a row here means the given
  -- automated email type is DISABLED for the given scope (default is
  -- everything enabled, so absence of a row = emails go out normally).
  -- scope_type 'global' suppresses for everyone; 'department' / 'class' /
  -- 'year_of_study' match users.department / class_name / year_of_study;
  -- 'student' matches a single users.id (scope_value holds the UUID text).
  CREATE TABLE IF NOT EXISTS email_suppression_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email_type VARCHAR(50) NOT NULL CHECK (email_type IN ('test_reminder', 'result_announcement', 'weekly_digest')),
    scope_type VARCHAR(20) NOT NULL CHECK (scope_type IN ('global', 'department', 'class', 'year_of_study', 'student')),
    scope_value VARCHAR(255) NOT NULL DEFAULT '',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(email_type, scope_type, scope_value)
  );
  CREATE INDEX IF NOT EXISTS idx_email_suppression_type ON email_suppression_rules(email_type);

  -- Drive Reminders no longer exist (drives are a plain test-grouping now,
  -- not their own schedulable entity) — drop any stale rules and loosen
  -- the old CHECK constraint on DBs that already ran the prior schema.
  DELETE FROM email_suppression_rules WHERE email_type = 'drive_reminder';
  DO $$ BEGIN
    ALTER TABLE email_suppression_rules DROP CONSTRAINT IF EXISTS email_suppression_rules_email_type_check;
    ALTER TABLE email_suppression_rules ADD CONSTRAINT email_suppression_rules_email_type_check
      CHECK (email_type IN ('test_reminder', 'result_announcement', 'weekly_digest'));
  EXCEPTION WHEN undefined_table THEN NULL;
  END $$;

  -- ═══════════════════════════════════════════════════════════
  -- THIRD-PARTY INTEGRATIONS & NEW FEATURES
  -- ═══════════════════════════════════════════════════════════

  -- Add phone column to users (for SMS)
  DO $$ BEGIN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_opted_in BOOLEAN DEFAULT false;
  EXCEPTION WHEN duplicate_column THEN NULL;
  END $$;

  -- Calendar tokens for Google/Outlook sync
  DO $$ BEGIN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS google_calendar_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_calendar_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS google_calendar_refresh_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_calendar_refresh_token TEXT;
  EXCEPTION WHEN duplicate_column THEN NULL;
  END $$;

  -- Webhook configs (Slack/Discord)
  CREATE TABLE IF NOT EXISTS webhook_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(10) NOT NULL CHECK (type IN ('slack', 'discord')),
    webhook_url TEXT NOT NULL,
    events JSONB DEFAULT '[]',
    enabled BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- SSO state tracking
  CREATE TABLE IF NOT EXISTS sso_states (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider VARCHAR(20) NOT NULL,
    state VARCHAR(255) NOT NULL UNIQUE,
    data JSONB DEFAULT '{}',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- LMS sync logs
  CREATE TABLE IF NOT EXISTS lms_sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(20) NOT NULL CHECK (type IN ('roster', 'scores')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed')),
    details JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- ATS push logs
  CREATE TABLE IF NOT EXISTS ats_push_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_ids JSONB NOT NULL DEFAULT '[]',
    status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed')),
    provider_response JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- SMS history
  CREATE TABLE IF NOT EXISTS sms_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    phone VARCHAR(20) NOT NULL,
    body TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
    provider_sid VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════
  -- STUDENT EXPERIENCE & SELF-SERVICE FEATURES
  -- ═══════════════════════════════════════════════════════════

  DO $$ BEGIN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS skills JSONB DEFAULT '[]';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS github_url VARCHAR(500);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS linkedin_url VARCHAR(500);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS resume_url TEXT;
  EXCEPTION WHEN duplicate_column THEN NULL;
  END $$;

  CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    technologies JSONB DEFAULT '[]',
    project_url VARCHAR(500),
    github_url VARCHAR(500),
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

  CREATE TABLE IF NOT EXISTS certifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(500) NOT NULL,
    issuer VARCHAR(500),
    issue_date DATE,
    expiry_date DATE,
    credential_url VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_certifications_user_id ON certifications(user_id);

  CREATE TABLE IF NOT EXISTS practice_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    genre VARCHAR(30) NOT NULL,
    question_count INTEGER DEFAULT 0,
    correct_count INTEGER DEFAULT 0,
    duration_seconds INTEGER DEFAULT 0,
    completed_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_practice_sessions_user_id ON practice_sessions(user_id);

  CREATE TABLE IF NOT EXISTS bookmarked_questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    test_id UUID REFERENCES tests(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, question_id)
  );
  CREATE INDEX IF NOT EXISTS idx_bookmarked_questions_user_id ON bookmarked_questions(user_id);

  CREATE TABLE IF NOT EXISTS question_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issue_type VARCHAR(20) NOT NULL CHECK (issue_type IN ('wrong_answer','ambiguous','formatting','other')),
    comment TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','reviewed','resolved')),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_question_feedback_question_id ON question_feedback(question_id);
  CREATE INDEX IF NOT EXISTS idx_question_feedback_status ON question_feedback(status);

  -- ═══════════════════════════════════════════════════════════
  -- QUESTION BANK ⇄ TEST LINKAGE
  -- Tracks which bank question a test question was pulled from
  -- (or auto-saved to), so the bank can show "used in" clustering
  -- and so re-saving a test doesn't lose that link.
  -- ═══════════════════════════════════════════════════════════
  DO $$ BEGIN
    ALTER TABLE questions ADD COLUMN IF NOT EXISTS bank_question_id UUID REFERENCES bank_questions(id) ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_column THEN NULL;
  END $$;

  DO $$ BEGIN
    ALTER TABLE coding_problems ADD COLUMN IF NOT EXISTS bank_question_id UUID REFERENCES bank_questions(id) ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_column THEN NULL;
  END $$;

  CREATE INDEX IF NOT EXISTS idx_questions_bank_question_id ON questions(bank_question_id);
  CREATE INDEX IF NOT EXISTS idx_coding_problems_bank_question_id ON coding_problems(bank_question_id);

  -- ═══════════════════════════════════════════════════════════
  -- DEPARTMENT RESTRICTION
  -- The platform is restricted to the eligible departments below.
  -- Existing student accounts that belong to any other department
  -- are deactivated so they can no longer sign in or sit tests.
  -- ═══════════════════════════════════════════════════════════
  UPDATE users
     SET is_active = false,
         updated_at = NOW()
   WHERE role = 'student'
     AND COALESCE(department, '') NOT IN (
       'Computer Engineering',
       'Computer Science and Design',
       'Aeronautical Engineering',
       'Information Technology',
       'Civil Engineering',
       'Electronics and Communication Engineering',
       'Electrical Engineering',
       'Mechanical Engineering'
     );

  -- ═══════════════════════════════════════════════════════════
  -- TERMINOLOGY MIGRATION (data values): "Batch N" → "Class N"
  -- Runs after every table above is guaranteed to exist, so it's safe
  -- to reference them directly without existence guards.
  -- ═══════════════════════════════════════════════════════════
  UPDATE classes SET name = REPLACE(name, 'Batch ', 'Class ') WHERE name LIKE 'Batch %';
  UPDATE users SET class_name = REPLACE(class_name, 'Batch ', 'Class ') WHERE class_name LIKE 'Batch %';
  UPDATE submissions SET class_snapshot = REPLACE(class_snapshot, 'Batch ', 'Class ') WHERE class_snapshot LIKE 'Batch %';
  UPDATE tests SET classes = (
    SELECT COALESCE(jsonb_agg(REPLACE(elem::text, '"Batch ', '"Class ')::jsonb), '[]'::jsonb)
    FROM jsonb_array_elements(classes) elem
  ) WHERE classes::text LIKE '%Batch %';
  UPDATE announcements SET target_classes = (
    SELECT COALESCE(jsonb_agg(REPLACE(elem::text, '"Batch ', '"Class ')::jsonb), '[]'::jsonb)
    FROM jsonb_array_elements(target_classes) elem
  ) WHERE target_classes::text LIKE '%Batch %';

  -- ═══════════════════════════════════════════════════════════
  -- MANUAL GRADING + ADMIN-FORCED START/STOP
  -- Lets an admin/super_admin override a submission's score (single or
  -- bulk via CSV/JSON) and force-end an in-progress test from a
  -- student's profile, with a record of who did it.
  -- ═══════════════════════════════════════════════════════════
  DO $$ BEGIN
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS graded_by UUID REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS graded_at TIMESTAMPTZ;
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS grading_note TEXT;
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ended_by UUID REFERENCES users(id) ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_column THEN NULL;
  END $$;

  -- ═══════════════════════════════════════════════════════════
  -- PLACEMENT RESOURCES (study material library)
  -- Admin-uploaded files (PDF/DOC/DOCX/PPT/PPTX/XLS/XLSX) grouped into
  -- four fixed categories, stored as bytea rows the same way the
  -- images table already does — no third-party file host in this app.
  -- Targeting (departments/years/classes) mirrors the tests table's
  -- own targeting columns exactly, so the same access-check shape can
  -- be reused for "can this student see this resource".
  -- ═══════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS resources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(500) NOT NULL,
    description TEXT,
    category VARCHAR(20) NOT NULL CHECK (category IN ('aptitude', 'coding', 'gd', 'pi')),
    file_data BYTEA NOT NULL,
    mimetype VARCHAR(150) NOT NULL,
    filename VARCHAR(255),
    size_bytes INTEGER,
    departments JSONB DEFAULT '[]'::jsonb,
    years JSONB DEFAULT '[]'::jsonb,
    classes JSONB DEFAULT '[]'::jsonb,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_resources_category ON resources(category);
  CREATE INDEX IF NOT EXISTS idx_resources_created_by ON resources(created_by);
  `);

  console.log('✅ Migrations complete.');
  process.exit(0);
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
