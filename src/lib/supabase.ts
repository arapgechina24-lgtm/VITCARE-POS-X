'use client';
/**
 * Supabase connectivity + sync engine.
 *
 * Demo Mode: when NEXT_PUBLIC_SUPABASE_URL is unset the app runs entirely on
 * IndexedDB — perfect for evaluation and offline demos.
 *
 * Connected Mode: mutations queued in Dexie's syncQueue are replayed to
 * Supabase whenever the browser is online (on load, on `online` event, and on
 * a 30 s heartbeat). Online orders arrive over Supabase Realtime and are
 * mirrored into the local store. Conflict policy: last-write-wins by
 * `updated_at` — appropriate for a single-branch pharmacy; revisit for
 * multi-branch scale.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { db } from './db';
import type { OnlineOrder, SyncTask } from './types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null = url && anon ? createClient(url, anon) : null;
export const isDemoMode = !supabase;

let started = false;

export function startSync(onOrder?: (o: OnlineOrder) => void) {
  if (started || typeof window === 'undefined') return;
  started = true;

  const push = () => void pushQueue();
  window.addEventListener('online', push);
  const t = setInterval(push, 30_000);
  window.addEventListener('beforeunload', () => clearInterval(t));
  void pushQueue();

  if (supabase && onOrder) {
    supabase
      .channel('online-orders')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
        const row = payload.new as Record<string, unknown>;
        const order: OnlineOrder = {
          id: String(row.id),
          customerName: String(row.customer_name ?? ''),
          customerPhone: String(row.customer_phone ?? ''),
          lines: (row.lines as OnlineOrder['lines']) ?? [],
          total: Number(row.total ?? 0),
          status: (row.status as OnlineOrder['status']) ?? 'new',
          createdAt: Date.parse(String(row.created_at ?? '')) || Date.now(),
          synced: 1,
        };
        void db.orders.put(order);
        onOrder(order);
      })
      .subscribe();
  }
}

async function pushQueue() {
  if (!supabase || !navigator.onLine) return;
  const tasks = await db.syncQueue.orderBy('createdAt').limit(50).toArray();
  for (const task of tasks) {
    try {
      await replay(task);
      if (task.id !== undefined) await db.syncQueue.delete(task.id);
    } catch (e) {
      console.warn('[sync] deferred', task.table, e);
      break; // preserve order; retry on next heartbeat
    }
  }
}

async function replay(task: SyncTask) {
  if (!supabase) return;
  const p = task.payload as Record<string, unknown>;
  if (task.op === 'delete') {
    const { error } = await supabase.from(task.table).delete().eq('id', p.id as string);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from(task.table).upsert(toSnake(p));
  if (error) throw error;
}

/** camelCase → snake_case for Postgres columns */
function toSnake(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    out[k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)] = v;
  }
  return out;
}
