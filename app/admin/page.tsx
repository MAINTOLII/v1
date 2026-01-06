"use client";

import { useEffect, useState } from "react";

import DashboardSection from "./components/DashboardSection";
import CategoriesSection from "./components/CategoriesSection";
import ProductsSection from "./components/ProductsSection";
import VariantsSection from "./components/VariantsSection";
import InventorySection from "./components/InventorySection";
import MovementsSection from "./components/MovementsSection";
import SettingsSection from "./components/SettingsSection";
import VariantsManagerSection from "./components/VariantsManagerSection";
import ProductsManagerSection from "./components/ProductsManagerSection";
import SupplierSection from "./components/SupplierSection";
import FastSection from "./components/FastSection";
import SalesSection from "./components/SalesSection";
import CustomerSection from "./components/CustomerSection";
import OnlineSection from "./components/Online";
import ViewOrdersSection from "./components/ViewOrders";
import CreditsSection from "./components/Credits";

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
  | "settings";

const NAV: Array<{ key: Section; label: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "categories", label: "Categories" },
  { key: "products", label: "Products" },
  { key: "products_manager", label: "Products Manager" },
  { key: "variants", label: "Variants" },
  { key: "variants_manager", label: "Variants Manager" },
  { key: "inventory", label: "Inventory" },
  { key: "movements", label: "Stock Movements" },
  { key: "suppliers", label: "Suppliers" },
  { key: "fastpos", label: "Fast POS" },
  { key: "online", label: "Online Orders" },
  { key: "orders_view", label: "View Orders" },
  { key: "sales", label: "Sales" },
  { key: "customers", label: "Customers" },
  { key: "credits", label: "Credits" },
  { key: "settings", label: "Settings" },
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

        <nav className="space-y-1">
          {NAV.map((n) => (
            <button
              key={n.key}
              type="button"
              onClick={() => setActive(n.key)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                active === n.key
                  ? "bg-gray-900 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>
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
                    active === n.key
                      ? "bg-gray-900 text-white"
                      : "text-gray-700 hover:bg-gray-100"
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
            {active === "settings" && <SettingsSection />}
          </div>
        </main>
      </div>
    </div>
  );
}
