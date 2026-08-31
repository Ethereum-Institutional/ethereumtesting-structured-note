-- Custodial investment platform store.
--
-- Deliberately separate from the chain. Personal and financial data lives here and never
-- leaves; what reaches the chain is a claim carrying the application reference and a digest of
-- the record, so an auditor can prove which file produced which permission without the chain
-- exposing anything about the investor.

-- ---------------------------------------------------------------- identity

create table if not exists users (
  id            text primary key,
  email         text not null unique,
  -- 'admin'    = compliance / transfer agent staff
  -- 'investor' = a client of the platform
  role          text not null default 'investor',
  display_name  text,
  created_at    text not null,
  last_login_at text
);

-- Single-use magic-link tokens. Only the hash is stored, so a leaked table cannot be replayed.
create table if not exists login_tokens (
  token_hash   text primary key,
  user_id      text not null references users(id) on delete cascade,
  created_at   text not null,
  expires_at   text not null,
  used_at      text,
  -- The role this particular link grants. Staff access requires the shared code at link-request
  -- time, so the privilege has to travel with the link rather than being inferred from the
  -- account — otherwise one code-less sign-in would either lock staff out or, worse, hand an
  -- admin session to anyone who typed a staff address.
  granted_role text not null default 'investor'
);

-- Idempotent migration for stores created before granted_role existed.
alter table login_tokens add column if not exists granted_role text not null default 'investor';

-- Sessions are looked up by hash for the same reason.
create table if not exists sessions (
  token_hash text primary key,
  user_id    text not null references users(id) on delete cascade,
  created_at text not null,
  expires_at text not null
);

create index if not exists login_tokens_user_idx on login_tokens(user_id);
create index if not exists sessions_user_idx on sessions(user_id);

-- ---------------------------------------------------------------- onboarding

create table if not exists applications (
  id                  text primary key,
  reference           text not null unique,
  user_id             text references users(id) on delete set null,
  applicant_name      text not null,
  -- Nullable: a custody account is provisioned on-chain shortly after signup, and the profile
  -- has to exist before that succeeds (or while the chain is unreachable).
  wallet              text,

  -- draft -> submitted -> in_review -> approved | rejected
  status              text not null default 'draft',
  submitted_at        text,

  -- 'individual' or 'entity'. Which set of fields below is required depends on this.
  account_type        text not null default 'individual',

  -- Individual
  legal_name          text,
  dob                 text,
  nationality         text,
  residential_address text,
  passport_number     text,
  tax_id              text,

  -- Entity
  entity_name         text,
  entity_form         text,
  registration_number text,
  incorporation_country text,
  registered_office   text,
  rep_name            text,
  rep_passport_number text,

  -- Shared
  country             integer,
  phone               text,
  source_of_funds     text,

  -- Accreditation. Amounts in the platform's reporting currency (SGD for this demo).
  annual_income        numeric,
  net_financial_assets numeric,
  entity_net_assets    numeric,
  -- 'retail' | 'accredited' | 'institutional', derived from the figures above.
  accreditation_level  text default 'retail',
  accreditation_basis  text,

  -- Screening
  sanctions_result    text,
  pep_result          text,
  adverse_media_result text,

  allocation          text,
  starting_cash       text,
  reviewer_notes      text,
  rejection_reason    text,

  -- Written once approval reaches the chain.
  onchain_identity    text,
  claim_digest        text,
  approved_at         text,
  approved_by         text,
  updated_at          text not null
);

-- Every change, so the admin view can show who touched a file and when. The compliance story
-- is noticeably weaker without it.
create table if not exists application_events (
  id             bigserial primary key,
  application_id text not null references applications(id) on delete cascade,
  at             text not null,
  actor          text not null,
  action         text not null,
  detail         text
);

-- Reference numbers come from a sequence rather than max()+1.
--
-- Computing the next number by reading the highest existing one is a race: two people signing up
-- at the same moment read the same value and the second insert dies on the unique constraint.
-- nextval is atomic, so concurrent sign-ups simply get different numbers.
create sequence if not exists application_reference_seq start with 500 increment by 1;

create index if not exists application_events_app_idx on application_events(application_id, id desc);
create index if not exists applications_status_idx on applications(status);
create index if not exists applications_user_idx on applications(user_id);

-- The trade tape's order journal. On serverless hosting each instance has its own memory and a
-- read-only filesystem, so a file-backed journal silently loses rows between requests — the tape
-- is the demo's centrepiece, so it gets the durable store.
create table if not exists demo_orders (
  id         text primary key,
  at         text not null,
  who        text not null,
  direction  text not null,
  amount_in  text not null,
  in_symbol  text not null,
  out_symbol text not null,
  received   text,
  ok         boolean not null,
  reason     text,
  tx_hash    text
);
create index if not exists demo_orders_at_idx on demo_orders(at desc);
