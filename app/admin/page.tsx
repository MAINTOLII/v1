"use client";

import { useEffect, useState, useMemo } from "react";

import DashboardSection from "./components/DashboardSection";
import CategoriesSection from "./components/CategoriesSection";
import ProductsSection from "./components/ProductsSection";
import VariantsSection from "./components/VariantsSection";
import InventorySection from "./components/InventorySection";
import MovementsSection from "./components/MovementsSection";
import SettingsSection from "./components/SettingsSection";
import MagicSection from "./components/magic";

import VariantsManagerSection from "./components/VariantsManagerSection";
import ProductsManagerSection from "./components/ProductsManagerSection";
import SupplierSection from "./components/SupplierSection";
import FastSection from "./components/FastSection";
import SalesSection from "./components/SalesSection";
import CustomerSection from "./components/CustomerSection";
import OnlineSection from "./components/Online";
import ViewOrdersSection from "./components/ViewOrders";
import CreditsSection from "./components/Credits";
import { supabase } from "@/lib/supabaseClient";

type Section =
  | "dashboard"
  | "categories"
  | "products"
  | "products_manager"
  | "variants"
  | "variants_manager"
  | "inventory"
  | "movements"
  | "suppliers"
  | "fastpos"
  | "online"
  | "orders_view"
  | "sales"
  | "customers"
  | "credits"
  | "expenses"
  | "settings"
  | "magic";

const NAV: Array<{ key: Section; label: string }> = [
  { key: "dashboard", label: "Dashboard" },

  // Highlighted quick actions
  { key: "fastpos", label: "Fast POS" },
  { key: "credits", label: "Credits" },
  { key: "expenses", label: "Expenses" },

  // Everything else
  { key: "categories", label: "Categories" },
  { key: "products", label: "Products" },
  { key: "products_manager", label: "Products Manager" },
  { key: "variants", label: "Variants" },
  { key: "variants_manager", label: "Variants Manager" },
  { key: "inventory", label: "Inventory" },
  { key: "movements", label: "Stock Movements" },
  { key: "suppliers", label: "Suppliers" },
  { key: "online", label: "Online Orders" },
  { key: "orders_view", label: "View Orders" },
  { key: "sales", label: "Sales" },
  { key: "customers", label: "Customers" }
];

const BOTTOM_NAV: Array<{ key: Section; label: string }> = [
  { key: "settings", label: "Settings" },
  { key: "magic", label: "Magic" }
];

export default function AdminPage() {
  const [active, setActive] = useState<Section>("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close the mobile drawer whenever the section changes
  useEffect(() => {
    setMobileNavOpen(false);
  }, [active]);

  return (
    <div className="flex min-h-screen max-w-full overflow-x-hidden bg-gray-50 text-gray-900">
      {/* Desktop sidebar (md+) */}
      <aside className="hidden w-64 border-r border-gray-200 bg-white p-4 text-gray-900 md:block">
        <h1 className="mb-6 text-lg font-bold">Mato Admin</h1>

        <div className="flex h-[calc(100vh-5rem)] flex-col">
          <nav className="space-y-1">
            {NAV.map((n) => (
              <button
                key={n.key}
                type="button"
                onClick={() => setActive(n.key)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                  n.key === "fastpos" || n.key === "credits" || n.key === "expenses"
                    ? active === n.key
                      ? "bg-green-700 text-white"
                      : "bg-green-50 text-green-900 hover:bg-green-100"
                    : active === n.key
                    ? "bg-gray-900 text-white"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {n.label}
              </button>
            ))}
          </nav>

          <div className="mt-auto pt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Settings</div>
            <nav className="space-y-1">
              {BOTTOM_NAV.map((n) => (
                <button
                  key={n.key}
                  type="button"
                  onClick={() => setActive(n.key)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                    active === n.key ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {n.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 h-full w-full bg-black/30"
            onClick={() => setMobileNavOpen(false)}
          />

          {/* Drawer */}
          <div className="absolute left-0 top-0 h-full w-72 bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-lg font-bold">Mato Admin</h1>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
              >
                Close
              </button>
            </div>

            <nav className="space-y-1">
              {NAV.map((n) => (
                <button
                  key={n.key}
                  type="button"
                  onClick={() => setActive(n.key)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                    n.key === "fastpos" || n.key === "credits" || n.key === "expenses"
                      ? active === n.key
                        ? "bg-green-700 text-white"
                        : "bg-green-50 text-green-900 hover:bg-green-100"
                      : active === n.key
                      ? "bg-gray-900 text-white"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {n.label}
                </button>
              ))}
              <div className="my-3 h-px bg-gray-200" />
              {BOTTOM_NAV.map((n) => (
                <button
                  key={n.key}
                  type="button"
                  onClick={() => setActive(n.key)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                    active === n.key ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {n.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* Mobile top navbar */}
        <header className="sticky top-0 z-30 border-b border-gray-200 bg-white px-4 py-3 md:hidden">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
              aria-label="Open navigation"
            >
              ☰
            </button>
            <div className="text-sm font-semibold text-gray-900">{NAV.find((n) => n.key === active)?.label}</div>
            <div className="w-[44px]" />
          </div>

          {/* Mobile section dropdown */}
          <div className="mt-3">
            <label className="sr-only" htmlFor="admin-section">
              Select section
            </label>
            <select
              id="admin-section"
              value={active}
              onChange={(e) => setActive(e.target.value as Section)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            >
              {NAV.map((n) => (
                <option key={n.key} value={n.key}>
                  {n.label}
                </option>
              ))}
              {BOTTOM_NAV.map((n) => (
                <option key={n.key} value={n.key}>
                  {n.label}
                </option>
              ))}
            </select>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 text-gray-900 md:p-6">
          <div className="min-w-0 rounded-2xl bg-white p-4 shadow-sm">
            {active === "dashboard" && <DashboardSection />}
            {active === "categories" && <CategoriesSection />}
            {active === "products" && <ProductsSection />}
            {active === "products_manager" && <ProductsManagerSection />}
            {active === "variants" && <VariantsSection />}
            {active === "variants_manager" && <VariantsManagerSection />}
            {active === "inventory" && <InventorySection />}
            {active === "movements" && <MovementsSection />}
            {active === "suppliers" && <SupplierSection />}
            {active === "fastpos" && <FastSection />}
            {active === "online" && <OnlineSection />}
            {active === "orders_view" && <ViewOrdersSection />}
            {active === "sales" && <SalesSection />}
            {active === "customers" && <CustomerSection />}
            {active === "credits" && <CreditsSection />}
            {active === "expenses" && <ExpensesSection />}
            {active === "settings" && <SettingsSection />}
            {active === "magic" && <MagicSection />}

          </div>
        </main>
      </div>
    </div>
  );
}

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

function money(n: any) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "$0.00";
  return `$${v.toFixed(2)}`;
}

function toLocalDateInputValue(d: Date) {
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type ExpenseCategory = "Liiban" | "Abdirazak" | "MATO";

type ExpenseRow = {
  id: string;
  created_at: string;
  incurred_at: string;
  category: ExpenseCategory;
  amount: number;
  currency: string;
  note: string | null;
};

function startOfLocalDayIso(dateStr: string) {
  // dateStr is YYYY-MM-DD
  const [y, m, d] = dateStr.split("-").map((x) => Number(x));
  const dt = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  return dt.toISOString();
}

function endOfLocalDayIso(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map((x) => Number(x));
  const dt = new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
  return dt.toISOString();
}

function ExpensesSection() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Create form
  const [category, setCategory] = useState<ExpenseCategory>("MATO");
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [incurredDate, setIncurredDate] = useState<string>(() => toLocalDateInputValue(new Date()));

  // Filters
  const [filterCategory, setFilterCategory] = useState<"all" | ExpenseCategory>("all");
  const [fromDate, setFromDate] = useState<string>(() => toLocalDateInputValue(new Date()));
  const [toDate, setToDate] = useState<string>(() => toLocalDateInputValue(new Date()));

  const [rows, setRows] = useState<ExpenseRow[]>([]);

  // Edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState<ExpenseCategory>("MATO");
  const [editAmount, setEditAmount] = useState<string>("");
  const [editNote, setEditNote] = useState<string>("");
  const [editIncurredDate, setEditIncurredDate] = useState<string>(() => toLocalDateInputValue(new Date()));

  const total = useMemo(() => rows.reduce((s, r) => s + Number(r.amount ?? 0), 0), [rows]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      let q = supabase
        .from("expenses")
        .select("id,created_at,incurred_at,category,amount,currency,note")
        .order("incurred_at", { ascending: false })
        .limit(500);

      if (fromDate) q = q.gte("incurred_at", startOfLocalDayIso(fromDate));
      if (toDate) q = q.lte("incurred_at", endOfLocalDayIso(toDate));
      if (filterCategory !== "all") q = q.eq("category", filterCategory);

      const { data, error } = await q;
      if (error) throw error;
      setRows((data ?? []) as any);
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
      setErr("Enter a valid amount > 0");
      return;
    }

    setLoading(true);
    try {
      const incurredAt = new Date(startOfLocalDayIso(incurredDate));
      // keep time = now local, but date picked by user
      const now = new Date();
      incurredAt.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());

      const payload = {
        category,
        amount: amt,
        currency: "USD",
        note: note.trim() ? note.trim() : null,
        incurred_at: incurredAt.toISOString(),
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
    setLoading(true);
    setErr(null);
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

  function beginEdit(r: ExpenseRow) {
    setEditId(r.id);
    setEditCategory(r.category);
    setEditAmount(String(r.amount ?? ""));
    setEditNote(r.note ?? "");
    // Use local date display for incurred_at
    const d = new Date(r.incurred_at);
    setEditIncurredDate(toLocalDateInputValue(d));
  }

  function cancelEdit() {
    setEditId(null);
  }

  async function saveEdit() {
    if (!editId) return;
    const amt = Number(editAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setErr("Enter a valid amount > 0");
      return;
    }

    setLoading(true);
    setErr(null);
    try {
      const incurredAt = new Date(startOfLocalDayIso(editIncurredDate));
      const now = new Date();
      incurredAt.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());

      const { error } = await supabase
        .from("expenses")
        .update({
          category: editCategory,
          amount: amt,
          note: editNote.trim() ? editNote.trim() : null,
          incurred_at: incurredAt.toISOString(),
        })
        .eq("id", editId);

      if (error) throw error;
      setEditId(null);
      await load();
    } catch (e: any) {
      console.error("Expenses update error:", e);
      setErr(formatErr(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Expenses</h2>
          <p className="mt-2 text-sm text-gray-600">Add expenses and track totals. Categories are limited to Liiban, Abdirazak, and MATO.</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {err && <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{err}</div>}

      {/* Add expense */}
      <div className="mt-6 rounded-2xl border bg-white p-4">
        <div className="text-sm font-semibold">Add expense</div>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div>
            <label className="text-xs text-gray-600">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="Liiban">Liiban</option>
              <option value="Abdirazak">Abdirazak</option>
              <option value="MATO">MATO</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-600">Amount (USD)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              step="0.01"
              inputMode="decimal"
              placeholder="e.g. 15"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Date</label>
            <input
              value={incurredDate}
              onChange={(e) => setIncurredDate(e.target.value)}
              type="date"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Note (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              type="text"
              placeholder="e.g. fuel, lunch, packaging"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={addExpense}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-60"
            disabled={loading}
          >
            Add
          </button>
        </div>
      </div>

      {/* Filters + total */}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-sm font-semibold">Filters</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <div>
              <label className="text-xs text-gray-600">Category</label>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value as any)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="all">All</option>
                <option value="Liiban">Liiban</option>
                <option value="Abdirazak">Abdirazak</option>
                <option value="MATO">MATO</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-600">From</label>
              <input
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                type="date"
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-xs text-gray-600">To</label>
              <input
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                type="date"
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="mt-3">
            <button
              type="button"
              onClick={load}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-60"
              disabled={loading}
            >
              Apply
            </button>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4 lg:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold">Total (filtered)</div>
              <div className="mt-2 text-2xl font-semibold">{money(total)}</div>
              <div className="mt-1 text-xs text-gray-500">Currency shown as USD.</div>
            </div>
            <div className="text-xs text-gray-500">Rows: {rows.length}</div>
          </div>

          {/* Edit box */}
          {editId && (
            <div className="mt-4 rounded-xl border bg-gray-50 p-3">
              <div className="text-sm font-semibold">Edit expense</div>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <div>
                  <label className="text-xs text-gray-600">Category</label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value as ExpenseCategory)}
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="Liiban">Liiban</option>
                    <option value="Abdirazak">Abdirazak</option>
                    <option value="MATO">MATO</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-gray-600">Amount (USD)</label>
                  <input
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600">Date</label>
                  <input
                    value={editIncurredDate}
                    onChange={(e) => setEditIncurredDate(e.target.value)}
                    type="date"
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600">Note</label>
                  <input
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    type="text"
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={saveEdit}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-60"
                  disabled={loading}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="mt-4 overflow-x-auto rounded-xl border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-600">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-sm text-gray-600" colSpan={5}>
                      No expenses found.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2 text-xs text-gray-700">
                        {new Date(r.incurred_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-sm font-medium">{r.category}</td>
                      <td className="px-3 py-2 text-sm font-semibold">{money(r.amount)}</td>
                      <td className="px-3 py-2 text-sm text-gray-700">{r.note ?? "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => beginEdit(r)}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-900 hover:bg-gray-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteExpense(r.id)}
                            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
