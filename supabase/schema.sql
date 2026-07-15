-- Vitcare POS — Supabase schema
-- Run in the Supabase SQL editor (Dashboard → SQL). Then enable Realtime on `orders`.

-- ── Authentication model ────────────────────────────────────────────────────
-- Login is passwordless email OTP (see src/app/login/page.tsx) — there is no
-- password to store or leak. Supabase Auth hashes/manages sessions; we never
-- touch credentials directly. Accounts are admin-provisioned, not self-signup:
--   1. Dashboard → Authentication → Users → "Add user" → "Send invite email"
--      (or the Admin API: supabase.auth.admin.inviteUserByEmail / createUser)
--   2. The trigger below auto-creates their `profiles` row (default: cashier)
--   3. Promote as needed: update profiles set role = 'admin' where id = '<uuid>';
--   4. They sign in at /login with just their email — Supabase emails the code.
-- Optional extra factor: staff can enrol a TOTP authenticator app in Settings
-- for a second code on top of the email OTP (see supabase.auth.mfa.enroll).

-- ── Roles ─────────────────────────────────────────────────────────────────
-- Staff roles live in profiles; RLS below enforces admin/pharmacist/cashier.
-- New signups default to 'cashier' (least privilege); promote via SQL:
--   update profiles set role = 'admin' where id = '<user-uuid>';
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'cashier' check (role in ('admin','pharmacist','cashier')),
  created_at timestamptz default now()
);

create or replace function public.role_of(uid uuid) returns text
language sql stable security definer set search_path = public as
$$ select role from profiles where id = uid $$;

-- Auto-provision a profile (default role: cashier) whenever someone signs up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name) values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Core tables (columns mirror the client's camelCase via snake_case) ────
create table if not exists drugs (
  id text primary key,
  name text not null,
  generic_name text default '',
  strength text default '',
  dosage_form text default '',
  manufacturer text default '',
  batch_number text default '',
  expiry_date text default '',
  stock int default 0,
  reorder_level int default 0,
  unit_price numeric default 0,
  cost_price numeric default 0,
  tax_rate numeric default 0,
  category text default '',
  barcode text default '',
  notes text,
  supplier_id text,
  updated_at bigint default 0
);

create table if not exists sales (
  id text primary key,
  invoice_no text unique not null,
  lines jsonb not null,
  subtotal numeric not null,
  tax_total numeric not null,
  total numeric not null,
  discount jsonb,
  discount_amount numeric default 0,
  method text not null,
  status text not null default 'paid' check (status in ('pending','paid','failed','refunded','partially_refunded')),
  customer_id text,
  customer_name text,
  customer_phone text,
  customer_pin text,
  mpesa_ref text,
  cashier_id text,
  created_at bigint not null,
  synced int default 1,
  etims jsonb,
  refunds jsonb default '[]'::jsonb,
  insurance_claim_id text
);

create table if not exists orders (
  id text primary key,
  customer_name text not null,
  customer_phone text not null,
  lines jsonb not null,
  total numeric not null,
  status text not null default 'new' check (status in ('new','fulfilled','rejected')),
  created_at timestamptz default now(),
  synced int default 1
);

create table if not exists audit (
  id text primary key,
  actor text,
  action text,
  detail text,
  at bigint,
  synced int default 1
);

-- STK push status, written server-side only (service role)
create table if not exists payments (
  id text primary key,
  status text not null default 'pending',
  ref text,
  reason text,
  updated_at timestamptz default now()
);

create table if not exists customers (
  id text primary key,
  name text not null,
  phone text not null,
  email text,
  kra_pin text,
  notes text,
  loyalty_points int default 0,
  insurance_provider_id text,
  insurance_member_no text,
  created_at bigint not null,
  updated_at bigint not null
);

create table if not exists suppliers (
  id text primary key,
  name text not null,
  contact_person text,
  phone text not null,
  email text,
  address text,
  outstanding_balance numeric default 0,
  rating int check (rating between 1 and 5),
  created_at bigint not null,
  updated_at bigint not null
);

create table if not exists purchase_orders (
  id text primary key,
  supplier_id text references suppliers(id) on delete set null,
  supplier_name text not null,
  lines jsonb not null,
  total numeric not null,
  status text not null default 'pending' check (status in ('pending','received','cancelled')),
  created_at bigint not null,
  received_at bigint
);

-- Payers that settle bills on a member's behalf: NHIF/SHA, private insurers
-- (AAR, Jubilee, Britam…), or a corporate self-funded scheme (e.g. KenGen).
create table if not exists insurance_providers (
  id text primary key,
  name text not null,
  payer_type text not null default 'private' check (payer_type in ('nhif','private','corporate')),
  contact_person text,
  phone text,
  claim_email text,
  default_co_pay_percent numeric default 0,
  notes text,
  created_at bigint not null,
  updated_at bigint not null
);

-- One row per insurance-billed sale; tracks the claim from filing to payment.
create table if not exists insurance_claims (
  id text primary key,
  sale_id text references sales(id) on delete cascade,
  invoice_no text not null,
  provider_id text references insurance_providers(id) on delete set null,
  provider_name text not null,
  member_no text not null,
  patient_name text not null,
  claim_amount numeric not null,
  co_pay_amount numeric default 0,
  status text not null default 'pending' check (status in ('pending','submitted','approved','rejected','paid')),
  approved_amount numeric,
  rejection_reason text,
  submitted_at bigint,
  responded_at bigint,
  paid_at bigint,
  notes text,
  created_at bigint not null,
  updated_at bigint not null
);

-- ── Row Level Security ────────────────────────────────────────────────────
alter table profiles enable row level security;
alter table drugs enable row level security;
alter table sales enable row level security;
alter table orders enable row level security;
alter table audit enable row level security;
alter table payments enable row level security;   -- no anon policies: service-role only
alter table customers enable row level security;
alter table suppliers enable row level security;
alter table purchase_orders enable row level security;
alter table insurance_providers enable row level security;
alter table insurance_claims enable row level security;

create policy "read own profile" on profiles for select using (auth.uid() = id);

-- Staff (any authenticated role) can read the catalog; write requires pharmacist/admin
create policy "staff read drugs"  on drugs for select using (auth.role() = 'authenticated');
create policy "staff write drugs" on drugs for all
  using (role_of(auth.uid()) in ('admin','pharmacist'))
  with check (role_of(auth.uid()) in ('admin','pharmacist'));

create policy "staff read sales"  on sales for select using (auth.role() = 'authenticated');
-- Every staff role (cashiers included) records sales — that's the point of the role.
create policy "staff write sales" on sales for insert with check (auth.role() = 'authenticated');
-- Refunds/voids (status update on an existing sale) are a higher-trust action.
create policy "staff refund sales" on sales for update
  using (role_of(auth.uid()) in ('admin','pharmacist'));

create policy "staff read audit"  on audit for select using (role_of(auth.uid()) in ('admin','pharmacist'));
create policy "staff write audit" on audit for insert with check (auth.role() = 'authenticated');

-- Customers, suppliers & purchase orders: all staff can read (e.g. cashier looking
-- up a customer at checkout); writes require admin/pharmacist.
create policy "staff read customers"  on customers for select using (auth.role() = 'authenticated');
create policy "staff write customers" on customers for all
  using (role_of(auth.uid()) in ('admin','pharmacist'))
  with check (role_of(auth.uid()) in ('admin','pharmacist'));

create policy "staff read suppliers"  on suppliers for select using (auth.role() = 'authenticated');
create policy "staff write suppliers" on suppliers for all
  using (role_of(auth.uid()) in ('admin','pharmacist'))
  with check (role_of(auth.uid()) in ('admin','pharmacist'));

create policy "staff read po"  on purchase_orders for select using (auth.role() = 'authenticated');
create policy "staff write po" on purchase_orders for all
  using (role_of(auth.uid()) in ('admin','pharmacist'))
  with check (role_of(auth.uid()) in ('admin','pharmacist'));

create policy "staff read insurance providers"  on insurance_providers for select using (auth.role() = 'authenticated');
create policy "staff write insurance providers" on insurance_providers for all
  using (role_of(auth.uid()) in ('admin','pharmacist'))
  with check (role_of(auth.uid()) in ('admin','pharmacist'));

create policy "staff read claims" on insurance_claims for select using (auth.role() = 'authenticated');
-- Any staff role can file a claim at checkout (mirrors "staff write sales" above).
create policy "staff create claims" on insurance_claims for insert with check (auth.role() = 'authenticated');
-- Progressing a claim (submit/approve/reject/paid) is a higher-trust action.
create policy "staff manage claims" on insurance_claims for update
  using (role_of(auth.uid()) in ('admin','pharmacist'));

-- Customers (anon) may create orders from the shop; only staff read/manage them
create policy "public create order" on orders for insert with check (true);
create policy "staff read orders"   on orders for select using (auth.role() = 'authenticated');
create policy "staff update orders" on orders for update
  using (role_of(auth.uid()) in ('admin','pharmacist'));

-- Optional: public read of shop catalog (name/price only — prefer a view)
create or replace view shop_catalog as
  select id, name, generic_name, strength, dosage_form, category, unit_price, tax_rate, stock
  from drugs where stock > 0;
grant select on shop_catalog to anon;

-- ── Function hardening ──────────────────────────────────────────────────────
-- role_of() and handle_new_user() are only ever meant to be called internally
-- (by RLS policy expressions and the auth.users trigger respectively) — they
-- never need to be invoked directly by a client. Revoking EXECUTE from
-- anon/authenticated closes them off as callable RPCs (/rest/v1/rpc/...)
-- without affecting RLS policy evaluation or the trigger, since Postgres
-- evaluates both using the function's own SECURITY DEFINER rights, not the
-- caller's grants.
revoke execute on function public.role_of(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- shop_catalog is intentionally SECURITY DEFINER: it's the only way anonymous
-- shop visitors can browse products (stock, price) while the underlying
-- `drugs` table (cost_price, supplier_id, batch_number, notes) stays fully
-- locked to authenticated staff. Switching it to SECURITY INVOKER would force
-- an anon SELECT policy directly on `drugs`, which — since RLS is row-level,
-- not column-level — would expose those sensitive columns via a direct
-- /rest/v1/drugs call. This comment documents the accepted advisor exception.
comment on view public.shop_catalog is
  'Intentional SECURITY DEFINER: exposes a safe public column subset of drugs without granting anon row access to the base table (which holds cost_price/supplier_id/notes). See migration harden_function_grants.';

-- ── Realtime ──────────────────────────────────────────────────────────────
-- Dashboard → Database → Replication → enable for table `orders`. Already run:
--   alter publication supabase_realtime add table orders;
