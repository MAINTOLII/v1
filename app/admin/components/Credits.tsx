"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function getSupabase() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Add them to your .env.local"
    );
  }
  return createClient(supabaseUrl, supabaseAnonKey);
}

function money(n: unknown) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0.00";
  return x.toFixed(2);
}

function fmtDate(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function formatErr(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message || "Unknown error";
  if (e?.message) return e.message;
  if (e?.error_description) return e.error_description;

  const bits: string[] = [];
  if (e?.code) bits.push(`code: ${e.code}`);
  if (e?.status) bits.push(`status: ${e.status}`);
  if (e?.details) bits.push(`details: ${e.details}`);
  if (e?.hint) bits.push(`hint: ${e.hint}`);
  if (bits.length) return bits.join(" • ");

  try {
    const keys = Object.getOwnPropertyNames(e);
    const obj: any = {};
    for (const k of keys) obj[k] = e[k];
    const s = JSON.stringify(obj);
    if (s && s !== "{}") return s;
  } catch {}

  try {
    return JSON.stringify(e);
  } catch {
    return "Unknown error";
  }
}

type CustomerRow = {
  id: string;
  name: string | null;
  phone: string;
  balance?: number | null;
};

type CreditRow = {
  id: string;
  customer_id: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  amount: number;
  amount_paid?: number | null; // IMPORTANT for partial payments
  note?: string | null;
  status?: string | null;
  created_at: string;
  paid_at?: string | null;
  is_paid?: boolean | null;
};

type CreditGroup = {
  key: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  total_amount: number;
  total_paid: number;
  total_balance: number;
  last_activity_at: string;
  rows: CreditRow[];
};

function nnum(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function creditPaidAmount(c: any): number {
  return nnum(c.amount_paid ?? c.paid_amount ?? 0);
}

function creditBalance(c: any): number {
  return Math.max(nnum(c.amount) - creditPaidAmount(c), 0);
}

function isPaidLike(c: CreditRow): boolean {
  const st = String(c.status || "").toLowerCase();
  if (st) return ["paid", "settled", "closed"].includes(st);
  if (typeof c.is_paid === "boolean") return !!c.is_paid;
  if (c.paid_at != null) return true;
  return creditBalance(c as any) <= 0.000001 && nnum((c as any).amount) > 0;
}

function isOutstanding(c: CreditRow): boolean {
  return creditBalance(c as any) > 0.000001;
}

function groupCredits(rows: CreditRow[]): CreditGroup[] {
  const m = new Map<string, CreditGroup>();

  for (const r of rows) {
    const customerId = r.customer_id ?? null;
    const phone = String((r as any).customer_phone || "").trim();
    const name = String((r as any).customer_name || "").trim();
    const key = customerId || (phone ? `phone:${phone}` : name ? `name:${name}` : `id:${r.id}`);

    const amt = nnum((r as any).amount);
    const paid = creditPaidAmount(r as any);
    const bal = creditBalance(r as any);
    const ts = String((r as any).paid_at || r.created_at || "");

    const g = m.get(key);
    if (!g) {
      m.set(key, {
        key,
        customer_id: customerId,
        customer_name: name || "(no name)",
        customer_phone: phone,
        total_amount: amt,
        total_paid: paid,
        total_balance: bal,
        last_activity_at: ts,
        rows: [r],
      });
    } else {
      g.total_amount += amt;
      g.total_paid += paid;
      g.total_balance += bal;
      g.rows.push(r);
      if (new Date(ts).getTime() > new Date(g.last_activity_at).getTime()) g.last_activity_at = ts;
      if (!g.customer_phone) g.customer_phone = phone;
      if (!g.customer_name || g.customer_name === "(no name)") g.customer_name = name || g.customer_name;
    }
  }

  const groups = Array.from(m.values());
  groups.sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime());
  for (const g of groups) {
    g.rows.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
  return groups;
}

export default function CreditsSection() {
  const [tab, setTab] = useState<"outstanding" | "paid">("outstanding");
  const [q, setQ] = useState("");

  const [credits, setCredits] = useState<CreditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // create credit form
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerRow[]>([]);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);

  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  // right panel (details)
  const [activeKey, setActiveKey] = useState<string>("");
  const [payAmount, setPayAmount] = useState<string>("");
  const [payNote, setPayNote] = useState<string>("");

  async function loadCredits() {
    setLoading(true);
    setErr(null);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("credits")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(800);

      if (error) throw error;

      const rows: CreditRow[] = (data ?? []).map((r: any) => ({
        ...r,
        amount: nnum(r.amount),
        amount_paid: r.amount_paid == null ? 0 : nnum(r.amount_paid),
      }));
      setCredits(rows);

      // reset details after refresh (keeps UI simple + avoids stale key)
      setActiveKey("");
      setPayAmount("");
      setPayNote("");
    } catch (e: any) {
      setErr(formatErr(e));
      setCredits([]);
    } finally {
      setLoading(false);
    }
  }

  async function searchCustomers(text: string) {
    const s = text.trim();
    setCustomerLoading(true);
    try {
      const supabase = getSupabase();
      if (!s) {
        setCustomerResults([]);
        return;
      }

      const like = `%${s}%`;
      let res = await supabase.from("customers").select("id,name,phone,balance").ilike("name", like).limit(12);
      if (res.error) {
        res = await supabase.from("customers").select("id,name,phone,balance").ilike("phone", like).limit(12);
      }
      if (res.error) throw res.error;
      setCustomerResults((res.data ?? []) as any);
    } catch {
      setCustomerResults([]);
    } finally {
      setCustomerLoading(false);
    }
  }

  async function createCredit() {
    setSaveErr(null);
    setSaveOk(null);

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setSaveErr("Enter a valid amount.");
      return;
    }

    if (!selectedCustomer && customerQuery.trim().length < 3) {
      setSaveErr("Search and select a customer (or type at least 3 chars).");
      return;
    }

    setSaving(true);
    try {
      const supabase = getSupabase();

      const payload: any = {
        amount: amt,
        amount_paid: 0,
        note: note.trim() || null,
        status: "open",
        created_at: new Date().toISOString(),
      };

      if (selectedCustomer) {
        payload.customer_id = selectedCustomer.id;
        payload.customer_name = selectedCustomer.name ?? null;
        payload.customer_phone = selectedCustomer.phone ?? null;
      } else {
        payload.customer_name = customerQuery.trim();
      }

      const { error } = await supabase.from("credits").insert(payload);
      if (error) throw error;

      setSaveOk("Credit saved.");
      setAmount("");
      setNote("");
      setSelectedCustomer(null);
      setCustomerQuery("");
      setCustomerResults([]);
      await loadCredits();
    } catch (e: any) {
      setSaveErr(formatErr(e));
    } finally {
      setSaving(false);
    }
  }

  const filteredGroups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const relevantRows = credits.filter((c) => (tab === "paid" ? isPaidLike(c) : isOutstanding(c)));
    const groups = groupCredits(relevantRows);

    if (!s) return groups;
    return groups.filter((g) => {
      const name = String(g.customer_name || "").toLowerCase();
      const phone = String(g.customer_phone || "").toLowerCase();
      const anyNote = g.rows.some((r) => String((r as any).note || "").toLowerCase().includes(s));
      return name.includes(s) || phone.includes(s) || anyNote || g.key.toLowerCase().includes(s);
    });
  }, [credits, q, tab]);

  const activeGroup = useMemo(() => {
    if (!activeKey) return null;
    return filteredGroups.find((g) => g.key === activeKey) || null;
  }, [activeKey, filteredGroups]);

  const totals = useMemo(() => {
    const count = filteredGroups.length;
    const total = filteredGroups.reduce((sum, g) => sum + (tab === "paid" ? g.total_paid : g.total_balance), 0);
    return { count, total };
  }, [filteredGroups, tab]);

  async function applyPaymentToGroup() {
    if (!activeGroup) return;

    setSaveErr(null);
    setSaveOk(null);

    const amt = Number(payAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setSaveErr("Enter a valid payment amount.");
      return;
    }

    const remaining = activeGroup.total_balance;
    const pay = Math.min(amt, remaining);

    setSaving(true);
    try {
      const supabase = getSupabase();
      const now = new Date().toISOString();

      // Apply payment oldest-first (simple)
      let left = pay;

    for (const row of activeGroup.rows) {
      if (left <= 0) break;

      const bal = creditBalance(row as any);
      if (bal <= 0) continue;

      const take = Math.min(left, bal);
      const currentPaid = creditPaidAmount(row as any);
      const nextPaid = currentPaid + take;
      const nextBal = Math.max(nnum((row as any).amount) - nextPaid, 0);

      // Requires amount_paid column
      const { error } = await supabase
        .from("credits")
        .update({
          amount_paid: nextPaid,
          status: nextBal <= 0.000001 ? "paid" : "open",
          paid_at: nextBal <= 0.000001 ? now : null,
        })
        .eq("id", (row as any).id);

      if (error) {
        throw new Error(formatErr(error));
      }

      left -= take;
    }

      // Optional: add payment note to newest row
      if (payNote.trim()) {
        const newest = [...activeGroup.rows].sort(
          (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0];
        if (newest) {
          await supabase
            .from("credits")
            .update({
              note: `${String((newest as any).note || "").trim()}${
                String((newest as any).note || "").trim() ? "\n" : ""
              }Payment: $${money(pay)} • ${payNote.trim()}`.trim(),
            })
            .eq("id", (newest as any).id);
        }
      }

      setSaveOk(`Payment recorded: $${money(pay)}.`);
      setPayAmount("");
      setPayNote("");
      await loadCredits();
      setTab("outstanding");
    } catch (e: any) {
      setSaveErr(formatErr(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadCredits().catch(() => void 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      searchCustomers(customerQuery).catch(() => void 0);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerQuery]);

  return (
    <div className="max-w-full overflow-x-hidden text-gray-900">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Credits</h2>
          <p className="mt-1 text-sm text-gray-600">
            Quick credits + grouped outstanding balances. Partial payments supported.
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadCredits()}
          disabled={loading}
          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Tabs */}
      <div className="mt-4 flex max-w-full flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setTab("outstanding");
            setActiveKey("");
            setSaveErr(null);
            setSaveOk(null);
          }}
          className={`rounded-full px-3 py-1 text-xs ${
            tab === "outstanding" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700"
          }`}
        >
          Outstanding
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("paid");
            setActiveKey("");
            setSaveErr(null);
            setSaveOk(null);
          }}
          className={`rounded-full px-3 py-1 text-xs ${
            tab === "paid" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700"
          }`}
        >
          Paid (recent)
        </button>
      </div>

      {/* Create credit */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <label className="text-xs text-gray-600">Customer (search by name/phone)</label>
            <input
              value={customerQuery}
              onChange={(e) => {
                setCustomerQuery(e.target.value);
                setSelectedCustomer(null);
              }}
              placeholder="e.g. John or 061..."
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />

            {(customerLoading || customerResults.length > 0) && (
              <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
                {customerLoading && <div className="p-2 text-xs text-gray-500">Searching…</div>}
                {!customerLoading && customerResults.length > 0 && (
                  <div className="max-h-44 overflow-auto">
                    {customerResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedCustomer(c);
                          setCustomerQuery(`${c.name || "(no name)"} — ${c.phone}`);
                          setCustomerResults([]);
                        }}
                        className="block w-full border-t border-gray-100 px-3 py-2 text-left text-sm hover:bg-gray-50"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate font-semibold">{c.name || "(no name)"}</div>
                            <div className="truncate text-xs text-gray-600">{c.phone}</div>
                          </div>
                          {typeof c.balance !== "undefined" && (
                            <div className="shrink-0 text-xs text-gray-700">Bal: ${money(c.balance)}</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="min-w-0 w-full lg:w-48">
            <label className="text-xs text-gray-600">Amount (USD)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 5"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </div>

          <div className="min-w-0 flex-1">
            <label className="text-xs text-gray-600">Note (items taken)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Milk x2 + bread"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </div>

          <div className="w-full lg:w-auto">
            <button
              type="button"
              onClick={createCredit}
              disabled={saving}
              className="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
            >
              {saving ? "Saving…" : "Add credit"}
            </button>
          </div>
        </div>

        {(saveErr || saveOk) && (
          <div
            className={`mt-3 rounded-lg border p-3 text-sm ${
              saveErr ? "border-red-200 bg-red-50 text-red-900" : "border-green-200 bg-green-50 text-green-900"
            }`}
          >
            {saveErr || saveOk}
          </div>
        )}
      </div>

      {/* Search + summary */}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <label className="text-xs text-gray-600">
            {tab === "paid" ? "Search paid (name/phone/note)" : "Search outstanding (name/phone/note)"}
          </label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. John"
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          />
        </div>
        <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between text-sm">
            <div className="text-gray-600">{tab === "paid" ? "Paid total" : "Outstanding"}</div>
            <div className="font-semibold">${money(totals.total)}</div>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <div className="text-gray-600">Customers</div>
            <div className="font-semibold">{totals.count}</div>
          </div>
        </div>
      </div>

      {/* Groups + Details */}
      <div className="mt-4 grid max-w-full gap-4 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-200 p-3 text-sm font-semibold">
              {tab === "paid" ? "Recently paid" : "Outstanding credits"}
            </div>

            {err && <div className="p-3 text-sm text-red-700">{err}</div>}

            <div className="max-h-[520px] overflow-auto">
              {!loading && filteredGroups.length === 0 && (
                <div className="p-4 text-sm text-gray-500">
                  {tab === "paid" ? "No paid credits yet." : "No outstanding credits."}
                </div>
              )}

              {filteredGroups.map((g) => {
                const isActive = g.key === activeKey;
                const headline = g.customer_phone ? `${g.customer_name} • ${g.customer_phone}` : g.customer_name;
                const main = tab === "paid" ? g.total_paid : g.total_balance;

                return (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => {
                      setActiveKey(g.key);
                      setPayAmount("");
                      setPayNote("");
                      setSaveErr(null);
                      setSaveOk(null);
                    }}
                    className={`block w-full border-t border-gray-100 px-3 py-3 text-left hover:bg-gray-50 ${
                      isActive ? "bg-gray-50" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-900">{headline}</div>
                        <div className="mt-0.5 truncate text-xs text-gray-600">
                          {tab === "paid" ? "Paid" : "Outstanding"} • {g.rows.length} times
                        </div>
                        <div className="mt-1 truncate text-xs text-gray-500">{fmtDate(g.last_activity_at)}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold">${money(main)}</div>
                        <div className="mt-0.5 text-xs text-gray-500">Tap</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="min-w-0 lg:col-span-3">
          <div className="min-w-0 rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-200 p-3 text-sm font-semibold">Details</div>

            {!activeGroup && <div className="p-4 text-sm text-gray-500">Select a customer to view history.</div>}

            {activeGroup && (
              <div className="p-4">
                <div className="text-sm font-semibold">
                  {activeGroup.customer_name}
                  {activeGroup.customer_phone ? ` • ${activeGroup.customer_phone}` : ""}
                </div>
                <div className="mt-1 text-xs text-gray-600">
                  Total: ${money(activeGroup.total_amount)} • Paid: ${money(activeGroup.total_paid)} • Balance: $
                  {money(activeGroup.total_balance)}
                </div>

                {tab === "outstanding" && activeGroup.total_balance > 0 && (
                  <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <div className="text-sm font-semibold">Record payment (partial ok)</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <div className="min-w-0">
                        <label className="text-xs text-gray-600">Amount</label>
                        <input
                          value={payAmount}
                          onChange={(e) => setPayAmount(e.target.value)}
                          inputMode="decimal"
                          placeholder={`Max ${money(activeGroup.total_balance)}`}
                          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="min-w-0 sm:col-span-2">
                        <label className="text-xs text-gray-600">Note</label>
                        <input
                          value={payNote}
                          onChange={(e) => setPayNote(e.target.value)}
                          placeholder="e.g. paid half"
                          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        onClick={applyPaymentToGroup}
                        disabled={saving}
                        className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                      >
                        {saving ? "Working…" : "Apply payment"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPayAmount(String(activeGroup.total_balance));
                          setPayNote("full payment");
                        }}
                        disabled={saving}
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Fill full amount
                      </button>
                    </div>
                  </div>
                )}

                {(saveErr || saveOk) && (
                  <div
                    className={`mt-3 rounded-lg border p-3 text-sm ${
                      saveErr ? "border-red-200 bg-red-50 text-red-900" : "border-green-200 bg-green-50 text-green-900"
                    }`}
                  >
                    {saveErr || saveOk}
                  </div>
                )}

                <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-[720px] w-full">
                    <thead className="bg-gray-50">
                      <tr className="text-left">
                        <th className="px-3 py-2 text-xs font-medium text-gray-600">Date</th>
                        <th className="px-3 py-2 text-xs font-medium text-gray-600">Note</th>
                        <th className="px-3 py-2 text-xs font-medium text-gray-600">Amount</th>
                        <th className="px-3 py-2 text-xs font-medium text-gray-600">Paid</th>
                        <th className="px-3 py-2 text-xs font-medium text-gray-600">Balance</th>
                        <th className="px-3 py-2 text-xs font-medium text-gray-600">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeGroup.rows.map((r: any) => {
                        const amt = nnum(r.amount);
                        const paid = creditPaidAmount(r);
                        const bal = creditBalance(r);
                        const st = String(r.status || (isPaidLike(r) ? "paid" : "open"));
                        const paidLike = isPaidLike(r);
                        const rowBg = paidLike ? "bg-green-50" : "bg-red-50";

                        return (
                          <tr key={r.id} className={`border-t ${rowBg}`}>
                            <td className="px-3 py-2 text-xs text-gray-700">{fmtDate(String(r.created_at))}</td>
                            <td className="px-3 py-2 text-xs text-gray-700">
                              <div className="max-w-[380px] truncate">{String(r.note || "—")}</div>
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-700">${money(amt)}</td>
                            <td className="px-3 py-2 text-xs text-gray-700">${money(paid)}</td>
                            <td className="px-3 py-2 text-xs font-semibold text-gray-900">${money(bal)}</td>
                            <td className="px-3 py-2 text-xs text-gray-700">{st}</td>
                          </tr>
                        );
                      })}

                      {activeGroup.rows.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-6 text-center text-sm text-gray-500">
                            No history.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  Partial payments need <code className="rounded bg-white/60 px-1">credits.amount_paid</code>.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Credits() {
  return <CreditsSection />;
}