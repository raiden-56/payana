import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema for release 0.1. Hand-written SQL - the schema is never
 * derived from entity metadata (`synchronize` is off everywhere).
 *
 * Conventions
 *  - uuid primary keys, timestamptz timestamps, money as integer minor units.
 *  - Coordinates are stored as lat/lng doubles with a STORED generated
 *    geography(Point,4326) column next to them, so application code reads and
 *    writes plain numbers while PostGIS indexes the generated column.
 *  - Status columns are text with CHECK constraints (values mirror
 *    packages/contracts), which keeps adding a value a one-line migration.
 */
export class InitialSchema1762700000000 implements MigrationInterface {
  name = 'InitialSchema1762700000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS citext`);

    // ---------------------------------------------------------------- platform
    await q.query(`
      CREATE TABLE audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        at timestamptz NOT NULL DEFAULT now(),
        actor_id uuid,
        actor_label text NOT NULL,
        action text NOT NULL,
        target_type text,
        target_id text,
        metadata jsonb NOT NULL DEFAULT '{}',
        ip text,
        request_id text
      )`);
    await q.query(`CREATE INDEX audit_logs_at_idx ON audit_logs (at DESC)`);
    await q.query(`CREATE INDEX audit_logs_action_idx ON audit_logs (action, at DESC)`);
    await q.query(`CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, at DESC)`);

    await q.query(`
      CREATE TABLE platform_settings (
        key text PRIMARY KEY,
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by uuid
      )`);

    await q.query(`
      CREATE TABLE idempotency_keys (
        scope text NOT NULL,
        user_id uuid NOT NULL,
        key text NOT NULL,
        request_hash text NOT NULL,
        status_code int,
        response jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (scope, user_id, key)
      )`);
    await q.query(`CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at)`);

    await q.query(`
      CREATE TABLE outbox_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz,
        attempts int NOT NULL DEFAULT 0,
        last_error text
      )`);
    await q.query(`CREATE INDEX outbox_events_pending_idx ON outbox_events (created_at) WHERE processed_at IS NULL`);

    // ---------------------------------------------------------------- identity
    await q.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        phone text UNIQUE,
        email citext UNIQUE,
        display_name text,
        roles text[] NOT NULL DEFAULT '{}',
        status text NOT NULL DEFAULT 'active'
          CHECK (status IN ('active','suspended','deletion_requested','deleted')),
        locale text NOT NULL DEFAULT 'en',
        admin_role text,
        password_hash text,
        mfa_secret_enc text,
        mfa_enabled boolean NOT NULL DEFAULT false,
        mfa_last_step bigint,
        failed_login_count int NOT NULL DEFAULT 0,
        locked_until timestamptz,
        suspended_reason text,
        deletion_requested_at timestamptz,
        deletion_scheduled_for timestamptz,
        deletion_reason text,
        deleted_at timestamptz,
        last_seen_at timestamptz,
        last_login_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX users_deletion_idx ON users (deletion_scheduled_for) WHERE status = 'deletion_requested'`);

    await q.query(`
      CREATE TABLE otp_challenges (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        phone text NOT NULL,
        code_hash text NOT NULL,
        intent text NOT NULL DEFAULT 'customer',
        attempts int NOT NULL DEFAULT 0,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        ip text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX otp_challenges_phone_idx ON otp_challenges (phone, created_at DESC)`);

    await q.query(`
      CREATE TABLE auth_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_label text,
        ip text,
        user_agent text,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        revoked_reason text
      )`);
    await q.query(`CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id) WHERE revoked_at IS NULL`);

    await q.query(`
      CREATE TABLE refresh_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
        token_hash text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now(),
        used_at timestamptz,
        expires_at timestamptz NOT NULL
      )`);
    await q.query(`CREATE INDEX refresh_tokens_session_idx ON refresh_tokens (session_id)`);

    await q.query(`
      CREATE TABLE emergency_contacts (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        name text NOT NULL,
        phone text NOT NULL,
        relationship text,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE saved_places (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label text NOT NULL,
        address text,
        lat double precision NOT NULL,
        lng double precision NOT NULL,
        kind text NOT NULL DEFAULT 'other' CHECK (kind IN ('home','stay','work','other')),
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX saved_places_user_idx ON saved_places (user_id)`);

    await q.query(`
      CREATE TABLE user_consents (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        analytics boolean NOT NULL DEFAULT false,
        advertising boolean NOT NULL DEFAULT false,
        marketing_messages boolean NOT NULL DEFAULT false,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    // ----------------------------------------------------------------- catalog
    await q.query(`
      CREATE TABLE regions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug text NOT NULL UNIQUE,
        name text NOT NULL,
        name_local text,
        state text NOT NULL,
        center_lat double precision NOT NULL,
        center_lng double precision NOT NULL,
        center geography(Point,4326) GENERATED ALWAYS AS
          (ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)::geography) STORED,
        radius_km double precision NOT NULL,
        status text NOT NULL DEFAULT 'coming_soon' CHECK (status IN ('live','coming_soon','hidden')),
        tagline text,
        sort_order int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE vehicle_categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code text NOT NULL UNIQUE,
        name text NOT NULL,
        description text,
        icon text NOT NULL,
        seats int NOT NULL CHECK (seats > 0),
        luggage_capacity int NOT NULL DEFAULT 0,
        base_fare_minor int NOT NULL,
        per_km_minor int NOT NULL,
        min_per_km_minor int NOT NULL,
        max_per_km_minor int NOT NULL,
        per_hour_waiting_minor int NOT NULL,
        sort_order int NOT NULL DEFAULT 0,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (min_per_km_minor <= per_km_minor AND per_km_minor <= max_per_km_minor)
      )`);

    await q.query(`
      CREATE TABLE places (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        region_id uuid NOT NULL REFERENCES regions(id),
        label text NOT NULL,
        address text,
        lat double precision NOT NULL,
        lng double precision NOT NULL,
        location geography(Point,4326) GENERATED ALWAYS AS
          (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED,
        kind text NOT NULL CHECK (kind IN ('transport','beach','temple','town','landmark')),
        sort_order int NOT NULL DEFAULT 0,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (region_id, label)
      )`);
    await q.query(`CREATE INDEX places_region_idx ON places (region_id, sort_order, label) WHERE is_active`);

    // ----------------------------------------------------------------- billing
    await q.query(`
      CREATE TABLE subscription_plans (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code text NOT NULL UNIQUE,
        name text NOT NULL,
        description text NOT NULL DEFAULT '',
        price_minor int NOT NULL CHECK (price_minor >= 0),
        billing_period text NOT NULL CHECK (billing_period IN ('monthly','quarterly','yearly')),
        entitlements jsonb NOT NULL,
        highlights text[] NOT NULL DEFAULT '{}',
        is_recommended boolean NOT NULL DEFAULT false,
        is_active boolean NOT NULL DEFAULT true,
        sort_order int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    // ------------------------------------------------------------- marketplace
    await q.query(`
      CREATE TABLE driver_profiles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL UNIQUE REFERENCES users(id),
        partner_type text NOT NULL CHECK (partner_type IN ('owner_driver','fleet_owner','hired_driver')),
        display_name text NOT NULL,
        bio text,
        photo_key text,
        languages text[] NOT NULL DEFAULT '{}',
        years_experience int,
        service_areas text[] NOT NULL DEFAULT '{}',
        verification_status text NOT NULL DEFAULT 'incomplete'
          CHECK (verification_status IN ('incomplete','pending','approved','changes_requested','rejected','suspended')),
        listing_status text NOT NULL DEFAULT 'unlisted'
          CHECK (listing_status IN ('published','unlisted','suspended')),
        availability text NOT NULL DEFAULT 'offline' CHECK (availability IN ('available','busy','offline')),
        operating_hours jsonb,
        active_vehicle_id uuid,
        last_lat double precision,
        last_lng double precision,
        last_location geography(Point,4326) GENERATED ALWAYS AS (
          CASE WHEN last_lat IS NULL OR last_lng IS NULL THEN NULL
               ELSE ST_SetSRID(ST_MakePoint(last_lng, last_lat), 4326)::geography END) STORED,
        location_accuracy_m real,
        location_updated_at timestamptz,
        rating_average numeric(2,1),
        rating_count int NOT NULL DEFAULT 0,
        completed_trips int NOT NULL DEFAULT 0,
        accepted_bookings int NOT NULL DEFAULT 0,
        cancelled_bookings int NOT NULL DEFAULT 0,
        profile_views int NOT NULL DEFAULT 0,
        submitted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX driver_profiles_location_gix ON driver_profiles USING gist (last_location)`);
    await q.query(`CREATE INDEX driver_profiles_listing_idx ON driver_profiles (listing_status, verification_status)`);
    await q.query(`CREATE INDEX driver_profiles_areas_gin ON driver_profiles USING gin (service_areas)`);

    await q.query(`
      CREATE TABLE vehicles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_profile_id uuid NOT NULL REFERENCES driver_profiles(id),
        category_code text NOT NULL REFERENCES vehicle_categories(code),
        make text NOT NULL,
        model text NOT NULL,
        year int,
        color text,
        registration_number text NOT NULL,
        seats int NOT NULL CHECK (seats > 0),
        luggage_capacity int NOT NULL DEFAULT 0,
        has_ac boolean NOT NULL DEFAULT false,
        photo_keys text[] NOT NULL DEFAULT '{}',
        base_fare_minor int,
        per_km_minor int,
        per_hour_waiting_minor int,
        full_day_minor int,
        verification_status text NOT NULL DEFAULT 'incomplete'
          CHECK (verification_status IN ('incomplete','pending','approved','changes_requested','rejected','suspended')),
        listing_status text NOT NULL DEFAULT 'unlisted'
          CHECK (listing_status IN ('published','unlisted','suspended')),
        deleted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX vehicles_registration_uq ON vehicles (registration_number) WHERE deleted_at IS NULL`);
    await q.query(`CREATE INDEX vehicles_owner_idx ON vehicles (owner_profile_id) WHERE deleted_at IS NULL`);
    await q.query(`ALTER TABLE driver_profiles ADD CONSTRAINT driver_profiles_active_vehicle_fk
                     FOREIGN KEY (active_vehicle_id) REFERENCES vehicles(id)`);

    await q.query(`
      CREATE TABLE driver_documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        driver_profile_id uuid NOT NULL REFERENCES driver_profiles(id),
        vehicle_id uuid REFERENCES vehicles(id),
        type text NOT NULL,
        document_number_enc text,
        document_number_tail text,
        expires_on date,
        file_key text NOT NULL,
        content_type text NOT NULL,
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
        rejection_reason text,
        reviewer_note text,
        is_current boolean NOT NULL DEFAULT true,
        expiry_notice_days int,
        submitted_at timestamptz NOT NULL DEFAULT now(),
        reviewed_at timestamptz,
        reviewed_by uuid,
        reviewed_by_label text
      )`);
    await q.query(`CREATE INDEX driver_documents_profile_idx ON driver_documents (driver_profile_id) WHERE is_current`);
    await q.query(`CREATE INDEX driver_documents_vehicle_idx ON driver_documents (vehicle_id) WHERE is_current`);
    await q.query(`CREATE INDEX driver_documents_expiry_idx ON driver_documents (expires_on) WHERE is_current AND status = 'approved'`);

    await q.query(`
      CREATE FUNCTION vehicle_documents_ok(p_vehicle uuid, p_required text[]) RETURNS boolean
      LANGUAGE sql STABLE AS $$
        SELECT count(DISTINCT d.type) = cardinality(p_required)
        FROM driver_documents d
        WHERE d.vehicle_id = p_vehicle AND d.is_current AND d.status = 'approved'
          AND (d.expires_on IS NULL OR d.expires_on >= CURRENT_DATE)
          AND d.type = ANY (p_required)
      $$`);

    await q.query(`
      CREATE TABLE vehicle_authorizations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id uuid NOT NULL REFERENCES vehicles(id),
        owner_profile_id uuid NOT NULL REFERENCES driver_profiles(id),
        driver_profile_id uuid REFERENCES driver_profiles(id),
        driver_phone text NOT NULL,
        status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','revoked','expired')),
        valid_until date,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX vehicle_authorizations_open_uq ON vehicle_authorizations (vehicle_id, driver_phone)
                     WHERE status IN ('invited','active')`);
    await q.query(`CREATE INDEX vehicle_authorizations_driver_idx ON vehicle_authorizations (driver_profile_id)`);
    await q.query(`CREATE INDEX vehicle_authorizations_phone_idx ON vehicle_authorizations (driver_phone)`);

    await q.query(`
      CREATE TABLE verification_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        driver_profile_id uuid NOT NULL REFERENCES driver_profiles(id),
        at timestamptz NOT NULL DEFAULT now(),
        actor_label text NOT NULL,
        action text NOT NULL,
        note text
      )`);
    await q.query(`CREATE INDEX verification_events_profile_idx ON verification_events (driver_profile_id, at DESC)`);

    await q.query(`
      CREATE TABLE uploads (
        file_key text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        purpose text NOT NULL,
        content_type text NOT NULL,
        size_bytes int NOT NULL,
        uploaded_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE driver_subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        driver_profile_id uuid NOT NULL REFERENCES driver_profiles(id),
        plan_id uuid NOT NULL REFERENCES subscription_plans(id),
        status text NOT NULL CHECK (status IN ('active','pending_payment','past_due','cancelled','expired')),
        current_period_start timestamptz NOT NULL,
        current_period_end timestamptz NOT NULL,
        auto_renew boolean NOT NULL DEFAULT true,
        quotes_used int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX driver_subscriptions_current_uq ON driver_subscriptions (driver_profile_id)
                     WHERE status IN ('active','pending_payment','past_due')`);

    await q.query(`CREATE SEQUENCE invoice_number_seq START 1`);
    await q.query(`
      CREATE TABLE invoices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        number text NOT NULL UNIQUE,
        driver_profile_id uuid NOT NULL REFERENCES driver_profiles(id),
        kind text NOT NULL CHECK (kind IN ('subscription','featured_placement')),
        reference_id uuid,
        description text NOT NULL,
        amount_minor int NOT NULL,
        status text NOT NULL CHECK (status IN ('open','paid','void','refunded')),
        provider text NOT NULL,
        provider_order_id text,
        issued_at timestamptz NOT NULL DEFAULT now(),
        paid_at timestamptz
      )`);
    await q.query(`CREATE INDEX invoices_driver_idx ON invoices (driver_profile_id, issued_at DESC)`);

    await q.query(`
      CREATE TABLE featured_placements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        driver_profile_id uuid NOT NULL REFERENCES driver_profiles(id),
        vehicle_id uuid NOT NULL REFERENCES vehicles(id),
        region_slug text NOT NULL,
        starts_on date NOT NULL,
        ends_on date NOT NULL,
        status text NOT NULL CHECK (status IN ('scheduled','active','ended','cancelled')),
        from_plan_allowance boolean NOT NULL DEFAULT false,
        invoice_id uuid REFERENCES invoices(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (ends_on >= starts_on)
      )`);
    await q.query(`CREATE INDEX featured_placements_active_idx ON featured_placements (driver_profile_id, starts_on, ends_on)
                     WHERE status IN ('scheduled','active')`);

    // -------------------------------------------------------------- promotions
    await q.query(`
      CREATE TABLE tour_packages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug text NOT NULL UNIQUE,
        title text NOT NULL,
        summary text NOT NULL,
        region_slug text NOT NULL,
        artwork text NOT NULL,
        duration_hours double precision NOT NULL,
        distance_km double precision NOT NULL,
        stops jsonb NOT NULL DEFAULT '[]',
        highlights text[] NOT NULL DEFAULT '{}',
        price_from jsonb NOT NULL DEFAULT '[]',
        best_time text,
        is_active boolean NOT NULL DEFAULT true,
        sort_order int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE ad_campaigns (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        advertiser_name text NOT NULL,
        advertiser_contact text,
        title text NOT NULL,
        body text NOT NULL,
        image_url text,
        cta_label text NOT NULL,
        cta_url text NOT NULL,
        placements text[] NOT NULL DEFAULT '{}',
        region_slugs text[] NOT NULL DEFAULT '{}',
        starts_on date NOT NULL,
        ends_on date NOT NULL,
        status text NOT NULL CHECK (status IN ('draft','scheduled','paused')),
        weight int NOT NULL DEFAULT 5 CHECK (weight BETWEEN 1 AND 10),
        impressions bigint NOT NULL DEFAULT 0,
        clicks bigint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (ends_on >= starts_on)
      )`);

    // ---------------------------------------------------------------- bookings
    await q.query(`
      CREATE TABLE ride_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id uuid NOT NULL REFERENCES users(id),
        status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','booked','expired','cancelled')),
        trip_type text NOT NULL CHECK (trip_type IN ('immediate','scheduled','outstation','sightseeing')),
        pickup jsonb NOT NULL,
        pickup_lat double precision NOT NULL,
        pickup_lng double precision NOT NULL,
        pickup_location geography(Point,4326) GENERATED ALWAYS AS
          (ST_SetSRID(ST_MakePoint(pickup_lng, pickup_lat), 4326)::geography) STORED,
        drop_place jsonb,
        region_slug text,
        scheduled_at timestamptz,
        return_at timestamptz,
        category_code text NOT NULL REFERENCES vehicle_categories(code),
        passengers int NOT NULL,
        luggage int NOT NULL DEFAULT 0,
        notes text,
        package_id uuid REFERENCES tour_packages(id),
        package_title text,
        target_driver_id uuid REFERENCES driver_profiles(id),
        estimate jsonb,
        drivers_notified int NOT NULL DEFAULT 0,
        booking_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      )`);
    await q.query(`CREATE INDEX ride_requests_customer_idx ON ride_requests (customer_id, created_at DESC)`);
    await q.query(`CREATE INDEX ride_requests_open_idx ON ride_requests (expires_at) WHERE status = 'open'`);
    await q.query(`CREATE INDEX ride_requests_pickup_gix ON ride_requests USING gist (pickup_location)`);

    await q.query(`
      CREATE TABLE request_declines (
        request_id uuid NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
        driver_profile_id uuid NOT NULL REFERENCES driver_profiles(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (request_id, driver_profile_id)
      )`);

    await q.query(`
      CREATE TABLE quotes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id uuid NOT NULL REFERENCES ride_requests(id),
        driver_profile_id uuid NOT NULL REFERENCES driver_profiles(id),
        vehicle_id uuid NOT NULL REFERENCES vehicles(id),
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','accepted','closed','withdrawn','expired')),
        fare_minor int NOT NULL CHECK (fare_minor > 0),
        inclusions text[] NOT NULL DEFAULT '{}',
        exclusions text[] NOT NULL DEFAULT '{}',
        pickup_note text,
        eta_minutes int,
        valid_until timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX quotes_one_active_per_driver_uq ON quotes (request_id, driver_profile_id) WHERE status = 'active'`);
    await q.query(`CREATE INDEX quotes_request_idx ON quotes (request_id)`);
    await q.query(`CREATE INDEX quotes_driver_idx ON quotes (driver_profile_id, created_at DESC)`);
    await q.query(`CREATE INDEX quotes_active_expiry_idx ON quotes (valid_until) WHERE status = 'active'`);

    await q.query(`
      CREATE TABLE bookings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code text NOT NULL UNIQUE,
        request_id uuid NOT NULL UNIQUE REFERENCES ride_requests(id),
        quote_id uuid NOT NULL UNIQUE REFERENCES quotes(id),
        customer_id uuid NOT NULL REFERENCES users(id),
        driver_profile_id uuid NOT NULL REFERENCES driver_profiles(id),
        vehicle_id uuid NOT NULL REFERENCES vehicles(id),
        status text NOT NULL DEFAULT 'confirmed' CHECK (status IN (
          'confirmed','driver_en_route','driver_arrived','in_progress','completed',
          'cancelled_by_customer','cancelled_by_driver','cancelled_by_admin','no_show','disputed')),
        trip_type text NOT NULL,
        pickup jsonb NOT NULL,
        drop_place jsonb,
        scheduled_at timestamptz NOT NULL,
        return_at timestamptz,
        passengers int NOT NULL,
        luggage int NOT NULL DEFAULT 0,
        notes text,
        package_title text,
        quoted_minor int NOT NULL,
        booking_fee_minor int NOT NULL DEFAULT 0,
        total_minor int NOT NULL,
        inclusions text[] NOT NULL DEFAULT '{}',
        exclusions text[] NOT NULL DEFAULT '{}',
        pickup_note text,
        cancellation_policy jsonb NOT NULL,
        cancellation jsonb,
        review_submitted boolean NOT NULL DEFAULT false,
        started_at timestamptz,
        completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX bookings_customer_idx ON bookings (customer_id, scheduled_at DESC)`);
    await q.query(`CREATE INDEX bookings_driver_idx ON bookings (driver_profile_id, scheduled_at DESC)`);
    await q.query(`CREATE INDEX bookings_status_idx ON bookings (status, created_at DESC)`);
    await q.query(`ALTER TABLE ride_requests ADD CONSTRAINT ride_requests_booking_fk
                     FOREIGN KEY (booking_id) REFERENCES bookings(id)`);

    await q.query(`
      CREATE TABLE booking_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        status text NOT NULL,
        at timestamptz NOT NULL DEFAULT now(),
        actor text NOT NULL CHECK (actor IN ('customer','driver','admin','system')),
        note text
      )`);
    await q.query(`CREATE INDEX booking_events_booking_idx ON booking_events (booking_id, at)`);

    // -------------------------------------------------------------- engagement
    await q.query(`
      CREATE TABLE reviews (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id),
        driver_profile_id uuid NOT NULL REFERENCES driver_profiles(id),
        customer_id uuid REFERENCES users(id),
        rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment text,
        author_name text NOT NULL,
        trip_type text NOT NULL,
        reply_text text,
        reply_at timestamptz,
        status text NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX reviews_driver_idx ON reviews (driver_profile_id, created_at DESC)`);

    await q.query(`
      CREATE TABLE notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type text NOT NULL,
        title text NOT NULL,
        body text NOT NULL,
        link text,
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC)`);
    await q.query(`CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL`);

    await q.query(`CREATE SEQUENCE ticket_reference_seq START 1`);
    await q.query(`
      CREATE TABLE support_tickets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reference text NOT NULL UNIQUE,
        user_id uuid NOT NULL REFERENCES users(id),
        category text NOT NULL,
        status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting_on_user','resolved','closed')),
        priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','urgent')),
        subject text NOT NULL,
        booking_id uuid REFERENCES bookings(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX support_tickets_user_idx ON support_tickets (user_id, updated_at DESC)`);
    await q.query(`CREATE INDEX support_tickets_status_idx ON support_tickets (status, priority, updated_at DESC)`);

    await q.query(`
      CREATE TABLE ticket_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        author text NOT NULL CHECK (author IN ('user','support')),
        author_id uuid,
        author_name text NOT NULL,
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX ticket_messages_ticket_idx ON ticket_messages (ticket_id, created_at)`);
  }

  async down(q: QueryRunner): Promise<void> {
    const tables = [
      'ticket_messages', 'support_tickets', 'notifications', 'reviews', 'booking_events',
      'request_declines', 'featured_placements', 'invoices', 'driver_subscriptions',
      'ad_campaigns', 'uploads', 'verification_events', 'vehicle_authorizations', 'driver_documents',
      'subscription_plans', 'places', 'regions', 'user_consents', 'saved_places', 'emergency_contacts',
      'refresh_tokens', 'auth_sessions', 'otp_challenges', 'outbox_events', 'idempotency_keys',
      'platform_settings', 'audit_logs',
    ];
    await q.query(`ALTER TABLE ride_requests DROP CONSTRAINT IF EXISTS ride_requests_booking_fk`);
    await q.query(`ALTER TABLE driver_profiles DROP CONSTRAINT IF EXISTS driver_profiles_active_vehicle_fk`);
    await q.query(`DROP TABLE IF EXISTS bookings CASCADE`);
    await q.query(`DROP TABLE IF EXISTS quotes CASCADE`);
    await q.query(`DROP TABLE IF EXISTS ride_requests CASCADE`);
    await q.query(`DROP TABLE IF EXISTS tour_packages CASCADE`);
    for (const t of tables) await q.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    await q.query(`DROP FUNCTION IF EXISTS vehicle_documents_ok(uuid, text[])`);
    await q.query(`DROP TABLE IF EXISTS vehicles CASCADE`);
    await q.query(`DROP TABLE IF EXISTS driver_profiles CASCADE`);
    await q.query(`DROP TABLE IF EXISTS vehicle_categories CASCADE`);
    await q.query(`DROP TABLE IF EXISTS users CASCADE`);
    await q.query(`DROP SEQUENCE IF EXISTS invoice_number_seq`);
    await q.query(`DROP SEQUENCE IF EXISTS ticket_reference_seq`);
  }
}
