'use client';
import { create } from 'zustand';
import type { CartLine, Discount, Drug, Sale } from './types';

interface HeldSale { id: string; lines: CartLine[]; note: string; at: number }

interface PosState {
  lines: CartLine[];
  held: HeldSale[];
  lastSale: Sale | null;
  discount: Discount | null;
  addDrug: (d: Drug) => void;
  setQty: (drugId: string, qty: number) => void;
  remove: (drugId: string) => void;
  clear: () => void;
  hold: (note: string) => void;
  recall: (id: string) => void;
  setLastSale: (s: Sale | null) => void;
  setDiscount: (d: Discount | null) => void;
}

export const usePos = create<PosState>((set, get) => ({
  lines: [],
  held: [],
  lastSale: null,
  discount: null,
  addDrug: (d) =>
    set((s) => {
      const i = s.lines.findIndex((l) => l.drugId === d.id);
      if (i >= 0) {
        const lines = [...s.lines];
        lines[i] = { ...lines[i], qty: lines[i].qty + 1 };
        return { lines };
      }
      return {
        lines: [
          ...s.lines,
          { drugId: d.id, name: d.name, strength: d.strength, qty: 1, unitPrice: d.unitPrice, taxRate: d.taxRate, costPrice: d.costPrice },
        ],
      };
    }),
  setQty: (drugId, qty) =>
    set((s) => ({
      lines: qty <= 0 ? s.lines.filter((l) => l.drugId !== drugId)
        : s.lines.map((l) => (l.drugId === drugId ? { ...l, qty } : l)),
    })),
  remove: (drugId) => set((s) => ({ lines: s.lines.filter((l) => l.drugId !== drugId) })),
  clear: () => set({ lines: [], discount: null }),
  hold: (note) => {
    const { lines, held } = get();
    if (!lines.length) return;
    set({ held: [...held, { id: `${Date.now()}`, lines, note, at: Date.now() }], lines: [] });
  },
  recall: (id) => {
    const { held } = get();
    const h = held.find((x) => x.id === id);
    if (!h) return;
    set({ lines: h.lines, held: held.filter((x) => x.id !== id) });
  },
  setLastSale: (s) => set({ lastSale: s }),
  setDiscount: (d) => set({ discount: d }),
}));
