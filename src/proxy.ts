import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Server-side auth gate for the staff area. When Supabase is configured,
 * every /dashboard request must carry a valid session (refreshed here) or is
 * redirected to /login. In Demo Mode (no Supabase env) the gate is skipped —
 * demo data is local-only and non-sensitive; do NOT ship demo mode to
 * production (see README hardening checklist).
 */
export async function proxy(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.next(); // demo mode

  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => {
        cookies.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        cookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const to = req.nextUrl.clone();
    to.pathname = '/login';
    return NextResponse.redirect(to);
  }

  // Settings is admin-only — enforce server-side, not just via hidden nav.
  if (req.nextUrl.pathname.startsWith('/dashboard/settings')) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profile?.role !== 'admin') {
      const to = req.nextUrl.clone();
      to.pathname = '/dashboard';
      return NextResponse.redirect(to);
    }
  }
  return res;
}

export const config = { matcher: ['/dashboard/:path*'] };
