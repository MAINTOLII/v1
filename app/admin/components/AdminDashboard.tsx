

"use client";

import Link from "next/link";

type Card = {
  title: string;
  description: string;
  href: string;
  icon: string;
};

const CARDS: Card[] = [
  {
    title: "Categories",
    description: "Manage categories, subcategories, and sub-subcategories",
    href: "/admin/categories",
    icon: "🗂️",
  },
  {
    title: "Products",
    description: "Create and update products",
    href: "/admin/products",
    icon: "📦",
  },
  {
    title: "Inventory",
    description: "Stock levels and adjustments",
    href: "/admin/inventory",
    icon: "📊",
  },
  {
    title: "Movements",
    description: "Inventory movements log",
    href: "/admin/movements",
    icon: "🔁",
  },
  {
    title: "Suppliers",
    description: "Suppliers and purchasing",
    href: "/admin/suppliers",
    icon: "🏷️",
  },
  {
    title: "Sales",
    description: "Orders and sales overview",
    href: "/admin/sales",
    icon: "🧾",
  },
  {
    title: "Customers",
    description: "Customer list and details",
    href: "/admin/customers",
    icon: "👥",
  },
  {
    title: "Settings",
    description: "Store and admin settings",
    href: "/admin/settings",
    icon: "⚙️",
  },
];

function CardLink({ card }: { card: Card }) {
  return (
    <Link
      href={card.href}
      className="group block rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-gray-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-gray-900/20"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-lg">
          {card.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="truncate text-sm font-semibold text-gray-900">{card.title}</div>
            <div className="shrink-0 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-gray-600">
              →
            </div>
          </div>
          <div className="mt-1 line-clamp-2 text-sm text-gray-600">{card.description}</div>
          <div className="mt-3 text-xs text-gray-500">Open</div>
        </div>
      </div>
    </Link>
  );
}

export default function AdminDashboard() {
  return (
    <div className="max-w-full overflow-x-hidden">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Dashboard</h2>
          <p className="mt-1 text-sm text-gray-600">Quick shortcuts to the admin tools.</p>
        </div>

        <div className="text-xs text-gray-500">Mato Admin</div>
      </div>

      <div className="mt-5 grid max-w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((card) => (
          <CardLink key={card.href} card={card} />
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
        <div className="font-medium text-gray-900">Tip</div>
        <div className="mt-1">
          If a link goes to a blank page, create that route (e.g. <code className="rounded bg-white px-1.5 py-0.5 text-xs">/admin/products</code>)
          or tell me and I can wire these cards to your existing in-page sections.
        </div>
      </div>
    </div>
  );
}

// Backwards-compatible alias if your admin page imports a DashboardSection name.
export function DashboardSection() {
  return <AdminDashboard />;
}