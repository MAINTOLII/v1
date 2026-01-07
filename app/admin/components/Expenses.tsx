"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

function formatErr(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e?.message) return e.message;
  if (e?.error_description) return e.error_description;
  try {
    return JSON.stringify(e);
  } catch {
    return "Unknown error";
  }
}

function money(n: number, currency = "USD") {
  const v = Number(n || 0);
  const sym = currency === "USD" ? "$" : "";
  return `${sym}${v.toFixed(2)}${currency === "USD" ? "" : ` ${currency}`}`;
}

const CATEGORIES = ["Liiban", "Abdirazak", "MATO"] as const;

type Category = (typeof CATEGORIES)[number];

type ExpenseRow = {
  id: string;
  created_at: string;
  incurred_at: string;
  category: Category;
  amount: number;
  currency: string;
  note: string | null;
};

export default function Expenses() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [rows, setRows] = useState<ExpenseRow[]>([]);

  // filters
  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date();
    // default: first day of current month
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    return first.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });

  // create form
  const [incurredAt, setIncurredAt] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<Category>("MATO");
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<string>("USD");
  const [note, setNote] = useState<string>("");

  const total = useMemo(
    () => rows.reduce((s, r) => s + Number(r.amount ?? 0), 0),
    [rows]
  );

  const totalsByCategory = useMemo(() => {
    const out: Record<string, number> = { Liiban: 0, Abdirazak: 0, MATO: 0 };
    for (const r of rows) out[r.category] = (out[r.category] ?? 0) + Number(r.amount ?? 0);
    return out as Record<Category, number>;
  }, [rows]);

  async function load() {
    setLoading(true);
    setErr(null);

    try {
      const fromIso = `${fromDate}T00:00:00.000Z`;
      const toIso = `${toDate}T23:59:59.999Z`;

      const { data, error } = await supabase
        .from("expenses")
        .select("id,created_at,incurred_at,category,amount,currency,note")
        .gte("incurred_at", fromIso)
        .lte("incurred_at", toIso)
        .order("incurred_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) throw error;

      const list = (data ?? []) as any[];
      setRows(
        list.map((r) => ({
          ...r,
          amount: Number(r.amount ?? 0),
        })) as ExpenseRow[]
      );
    } catch (e: any) {
      console.error("Expenses load error:", e);
      setErr(formatErr(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addExpense() {
    setErr(null);

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setErr("Amount must be a number greater than 0");
      return;
    }
    if (!CATEGORIES.includes(category)) {
      setErr("Invalid category");
      return;
    }

    setLoading(true);
    try {
      // store as timestamptz (midnight UTC for the picked date)
      const incurredIso = new Date(`${incurredAt}T00:00:00.000Z`).toISOString();

      const payload = {
        incurred_at: incurredIso,
        category,
        amount: amt,
        currency: currency || "USD",
        note: note.trim() ? note.trim() : null,
      };

      const { error } = await supabase.from("expenses").insert(payload);
      if (error) throw error;

      setAmount("");
      setNote("");
      await load();
    } catch (e: any) {
      console.error("Expenses insert error:", e);
      setErr(formatErr(e));
    } finally {
      setLoading(false);
    }
  }

  async function deleteExpense(id: string) {
    if (!confirm("Delete this expense?")) return;
    setErr(null);
    setLoading(true);
    try {
      const { error } = await supabase.from("expenses").delete().eq("id", id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      console.error("Expenses delete error:", e);
      setErr(formatErr(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Expenses</h2>
          <p className="mt-1 text-sm text-gray-600">Track daily expenses for Liiban, Abdirazak, and MATO.</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {err && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{err}</div>
      )}

      {/* Filters */}
      <div className="rounded-2xl border bg-white p-4">
        <div className="text-sm font-semibold">Filter</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <div className="text-xs text-gray-600">From</div>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <div className="text-xs text-gray-600">To</div>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={load}
              className="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-black"
            >
              Apply
            </button>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs text-gray-600">Total</div>
          <div className="mt-1 text-2xl font-semibold">{money(total, currency)}</div>
          <div className="mt-1 text-xs text-gray-500">Selected range</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs text-gray-600">Liiban</div>
          <div className="mt-1 text-2xl font-semibold">{money(totalsByCategory.Liiban, currency)}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs text-gray-600">Abdirazak</div>
          <div className="mt-1 text-2xl font-semibold">{money(totalsByCategory.Abdirazak, currency)}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs text-gray-600">MATO</div>
          <div className="mt-1 text-2xl font-semibold">{money(totalsByCategory.MATO, currency)}</div>
        </div>
      </div>

      {/* Add expense */}
      <div className="rounded-2xl border bg-white p-4">
        <div className="text-sm font-semibold">Add expense</div>

        <div className="mt-3 grid gap-3 md:grid-cols-5">
          <label className="block">
            <div className="text-xs text-gray-600">Date</div>
            <input
              type="date"
              value={incurredAt}
              onChange={(e) => setIncurredAt(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <div className="text-xs text-gray-600">Category</div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <div className="text-xs text-gray-600">Amount</div>
            <input
              inputMode="decimal"
              placeholder="e.g. 15"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <div className="text-xs text-gray-600">Currency</div>
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={addExpense}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700"
              disabled={loading}
            >
              Add
            </button>
          </div>

          <label className="block md:col-span-5">
            <div className="text-xs text-gray-600">Note (optional)</div>
            <input
              placeholder="e.g. fuel, lunch, delivery fee…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Note</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-sm text-gray-500" colSpan={5}>
                  No expenses in this date range.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {new Date(r.incurred_at).toISOString().slice(0, 10)}
                  </td>
                  <td className="px-3 py-2">{r.category}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{money(Number(r.amount ?? 0), r.currency)}</td>
                  <td className="px-3 py-2 max-w-[420px] truncate" title={r.note ?? ""}>
                    {r.note ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => deleteExpense(r.id)}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 hover:bg-red-100"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-500">
        Tip: add a link in your admin nav to render this component, e.g. <code>{"<Expenses />"}</code>.
      </div>
    </div>
  );
}
