-- Vitcare POS — Supabase schema
-- Run in the Supabase SQL editor (Dashboard → SQL). Then enable Realtime on `orders`.

-- ── Roles ─────────────────────────────────────────────────────────────────
-- Staff roles live in profiles; RLS below enforces admin/pharmacist/viewer.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'viewer' check (role in ('admin','pharmacist','viewer')),
  created_at timestamptz default now()
);

create or replace function public.role_of(uid uuid) returns text
language sql stable security definer set search_path = public as
$$ select role from profiles where id = uid $$;

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
  tax_rate numeric default 0,
  category text default '',
  barcode text default '',
  notes text,
  updated_at bigint default 0
);

create table if not exists sales (
  id text primary key,
  invoice_no text unique not null,
  lines jsonb not null,
  subtotal numeric not null,
  tax_total numeric not null,
  total numeric not null,
  method text not null,
  status text not null default 'paid',
  customer_name text,
  customer_phone text,
  customer_pin text,
  mpesa_ref text,
  cashier_id text,
  created_at bigint not null,
  synced int default 1,
  etims jsonb
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

-- ── Row Level Security ────────────────────────────────────────────────────
alter table profiles enable row level security;
alter table drugs enable row level security;
alter table sales enable row level security;
alter table orders enable row level security;
alter table audit enable row level security;
alter table payments enable row level security;   -- no anon policies: service-role only

create policy "read own profile" on profiles for select using (auth.uid() = id);

-- Staff (any authenticated role) can read the catalog; write requires pharmacist/admin
create policy "staff read drugs"  on drugs for select using (auth.role() = 'authenticated');
create policy "staff write drugs" on drugs for all
  using (role_of(auth.uid()) in ('admin','pharmacist'))
  with check (role_of(auth.uid()) in ('admin','pharmacist'));

create policy "staff read sales"  on sales for select using (auth.role() = 'authenticated');
create policy "staff write sales" on sales for insert
  with check (role_of(auth.uid()) in ('admin','pharmacist'));

create policy "staff read audit"  on audit for select using (role_of(auth.uid()) = 'admin');
create policy "staff write audit" on audit for insert with check (auth.role() = 'authenticated');

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

-- ── Realtime ──────────────────────────────────────────────────────────────
-- Dashboard → Database → Replication → enable for table `orders`.
