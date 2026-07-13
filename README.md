# Vitcare POS

**Vitcare Pharmacy and Medical Centre — Your Trusted Pharmacy Partner in Naivasha (next to the Modern Market).**

An offline-first, installable (PWA) pharmacy point of sale with M-Pesa STK Push, KRA eTIMS-format tax invoices, live online-order intake, an AI store assistant, and a security posture designed for a licensed pharmacy.

---

## 1. Architecture & stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js 15 (App Router) + TypeScript strict + Tailwind** | Modern, type-safe, one deployable unit for POS + shop + API |
| Offline store | **IndexedDB via Dexie** | Local source of truth: sells with zero connectivity |
| Backend | **Supabase** (Postgres, Auth+MFA, Realtime, RLS) | Best free tier with row-level security and realtime built in |
| Hosting | **Vercel** free tier | HTTPS by default, serverless API routes for Daraja/AI keys |
| Payments | **Safaricom Daraja** STK Push (server-side only) | Credentials never reach the browser |
| AI | **Anthropic Messages API** with rule-based fallback | Works with or without an API key, even offline |
| Sound / animation | Web Audio API (synthesized) + Framer Motion | No assets to load; fully offline |

**Data flow:** every read/write hits IndexedDB first → a sync queue replays mutations to Supabase when online → online orders arrive over Supabase Realtime into every open POS. Conflict policy is last-write-wins by `updated_at` (fine for a single branch; revisit for multi-branch).

**Demo Mode:** with no environment variables at all, the app runs entirely locally with a realistic seeded catalog, simulated M-Pesa, and the rule-based assistant. Nothing to configure — `npm run dev` and sell.

## 2. Run locally

```bash
npm install
cp .env.example .env.local   # optional — blank env = Demo Mode
npm run dev                  # http://localhost:3000
```

Sign in with any email (Demo Mode), open **Sell**, tap products, take a Cash or simulated M-Pesa payment, print the receipt. Place an order from `/shop` and watch it appear under **Online orders**.

## 3. Go live (free tier)

### 3.1 Supabase
1. Create a project at supabase.com → copy the Project URL and anon key into `.env.local`.
2. SQL editor → paste and run `supabase/schema.sql`.
3. Database → Replication → enable Realtime for `orders`.
4. Auth → create staff users; insert a row in `profiles` per user with role `admin` / `pharmacist` / `viewer`.
5. Auth → enable **MFA (TOTP)**. Staff enrol from **Settings → Enrol authenticator app**; sign-in then requires the 6-digit code.

### 3.2 Vercel
1. Push this repo to GitHub → “Import project” on vercel.com.
2. Add all variables from `.env.example` under Project → Settings → Environment Variables. `SUPABASE_SERVICE_ROLE_KEY`, `MPESA_*` and `ANTHROPIC_API_KEY` are **server-only — never prefix them with `NEXT_PUBLIC_`**.
3. Deploy. Set `MPESA_CALLBACK_URL=https://<your-app>.vercel.app/api/mpesa/callback`.

### 3.3 M-Pesa (Daraja)
1. Create an app at **developer.safaricom.co.ke** → copy Consumer Key/Secret.
2. Sandbox: shortcode `174379` + the public sandbox passkey (on the Daraja “Lipa na M-Pesa Online” page); test with sandbox MSISDNs.
3. Production: complete Safaricom's Go-Live with your Paybill/Till, then switch `MPESA_ENV=production`.
4. Flow implemented: `POST /api/mpesa/stkpush` (validates + rate-limits, sends STK Push) → Safaricom calls `/api/mpesa/callback` → the POS polls `/api/mpesa/status` and completes the sale on confirmation. Without credentials the route simulates a successful payment after ~5 s so the full UX is demonstrable.

### 3.4 KRA eTIMS
Receipts are already formatted as tax invoices: per-item price excl. VAT, VAT amount, total incl. VAT, company KRA PIN, buyer PIN field, invoice number, SCU ID + receipt-signature area and an iTax verification QR. In demo they carry clearly-marked placeholder control-unit values.

For legal fiscalisation you must transmit invoices in real time through a KRA **OSCU** (online) or **VSCU** (virtual) control unit — this requires registering on eTIMS via iTax and integrating through KRA's certification process or an approved integration partner. The `Sale.etims` structure and `demoEtimsStamp()` in `src/lib/utils.ts` mark exactly where the real OSCU response fields plug in. Until certified, treat printed receipts as non-fiscal.

### 3.5 AI assistant
Add `ANTHROPIC_API_KEY` (console.anthropic.com) and the floating **Vita** assistant answers natural-language questions grounded in live inventory/sales. Without a key (or offline) it falls back to a built-in rule engine — low stock, expiries, sales summaries and alternative suggestions still work.

## 4. Security model & production hardening

Implemented: server-side middleware auth gate on `/dashboard` (Supabase session, refreshed per request) · TOTP MFA enrolment + challenge · role-based access enforced in Postgres RLS (not just UI) · all secrets server-side env vars · input validation and normalisation on every API route · basic rate limiting on the payment route · security headers (`X-Frame-Options`, `nosniff`, referrer/permissions policies) · HTTPS + encryption at rest via Vercel/Supabase defaults · audit logging of sign-ins, sales, stock moves and order actions.

Before real trading:
- [ ] Configure Supabase and **disable Demo Mode assumptions** (demo sign-in is local-only and NOT authentication).
- [ ] Run `supabase/schema.sql` and verify RLS with a viewer-role account.
- [ ] Rotate any key ever pasted in chat/commits; keep `.env*` out of git (already ignored).
- [ ] Put the M-Pesa callback behind an IP allowlist for Safaricom egress ranges (Vercel WAF / middleware).
- [ ] Replace the in-memory rate limiter with Upstash Redis or Vercel WAF rules for multi-instance correctness.
- [ ] Review pharmacy regulatory requirements (PPB) for online sale of prescription-only medicines — the shop already flags Rx confirmation at pickup.
- [ ] Enable Vercel + Supabase log drains and backups (Supabase PITR on paid tier when revenue justifies).

## 5. Project map

```
src/
  app/
    page.tsx                    Splash / brand intro
    login/                      Password + TOTP MFA sign-in (demo-aware)
    dashboard/                  Staff shell: overview, POS, inventory, orders, reports, settings
    shop/                       Customer catalog + online ordering
    api/mpesa/{stkpush,callback,status}   Daraja server routes
    api/assistant/              LLM proxy (falls back to client rule engine)
  components/                   Receipt (eTIMS/thermal print), Assistant
  lib/                          types · Dexie offline db + seed · sync engine · mpesa · sounds · store · utils
  middleware.ts                 Server auth gate
public/                         manifest, service worker, icons
supabase/schema.sql             Tables + RLS + realtime notes
```

## 6. Costs & scaling

KSh 0 to launch: Vercel Hobby + Supabase Free + Daraja sandbox. First paid step is usually Supabase Pro (~$25/mo) for backups/PITR once real sales data matters. The offline-first design means a Safaricom outage never stops the counter — sales queue locally and reconcile later.

Roadmap suggestions: batch-level stock (multiple batches per SKU), supplier purchase orders, card payments, multi-branch sync with CRDTs or server-authoritative stock, certified eTIMS OSCU integration, PPB prescription-upload workflow on the shop.
