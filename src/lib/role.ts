'use client';
/**
 * Role-based access control. Connected Mode reads the caller's role from the
 * `profiles` table (server-enforced via RLS — see supabase/schema.sql); the
 * client-side checks here only drive UI gating, never the source of truth.
 * Demo Mode has no real accounts, so the role picked at sign-in is kept in
 * sessionStorage for the duration of the session.
 */
import { createContext, useContext } from 'react';
import { supabase } from './supabase';
import type { Role } from './types';

const DEMO_ROLE_KEY = 'vitcare-demo-role';

export function setDemoRole(role: Role) {
  sessionStorage.setItem(DEMO_ROLE_KEY, role);
}

export function getDemoRole(): Role {
  return (sessionStorage.getItem(DEMO_ROLE_KEY) as Role | null) || 'cashier';
}

/** Resolves the signed-in user's role. Falls back to 'cashier' (least privilege). */
export async function getRole(): Promise<Role> {
  if (!supabase) return getDemoRole();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 'cashier';
  const { data } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  return (data?.role as Role | undefined) ?? 'cashier';
}

export const CAN = {
  manageInventory: (r: Role) => r === 'admin' || r === 'pharmacist',
  manageSettings: (r: Role) => r === 'admin',
  viewReports: (r: Role) => r === 'admin' || r === 'pharmacist',
  manageDirectory: (r: Role) => r === 'admin' || r === 'pharmacist', // customers & suppliers
  processRefunds: (r: Role) => r === 'admin' || r === 'pharmacist',
  manageInsurance: (r: Role) => r === 'admin' || r === 'pharmacist', // providers & claim lifecycle
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrator',
  pharmacist: 'Pharmacist',
  cashier: 'Cashier',
};

export const RoleContext = createContext<Role>('cashier');
export const useRole = () => useContext(RoleContext);
