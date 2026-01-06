"use client";

import { useEffect, useMemo, useState } from "react";

type Settings = {
  storeName: string;
  whatsappNumber: string; // E.164-ish or local
  city: string;

  currencyCode: string; // e.g. USD
  showCurrencySymbol: boolean;

  enableLowStockAlerts: boolean;
  defaultReorderLevelG: number; // grams
  defaultReorderLevelUnits: number;

  tiktokPixelId: string;
  googleAdsConversionId: string;
};

const STORAGE_KEY = "mato_admin_settings_v1";

const DEFAULTS: Settings = {
  storeName: "Mato Online",
  whatsappNumber: "",
  city: "",

  currencyCode: "USD",
  showCurrencySymbol: true,

  enableLowStockAlerts: true,
  defaultReorderLevelG: 5000, // 5kg default
  defaultReorderLevelUnits: 10,

  tiktokPixelId: "",
  googleAdsConversionId: "",
};

function safeParse(json: string | null) {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function toPosInt(v: string, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

export default function SettingsSection() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [storageOk, setStorageOk] = useState(true);

  const previewCurrency = useMemo(() => {
    const code = (settings.currencyCode || "USD").toUpperCase();
    const sym = settings.showCurrencySymbol ? "$" : "";
    return `${sym}${code}`;
  }, [settings.currencyCode, settings.showCurrencySymbol]);

  useEffect(() => {
    // Load from localStorage
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = safeParse(raw);
      if (parsed && typeof parsed === "object") {
        setSettings({ ...DEFAULTS, ...parsed });
      }
      setStorageOk(true);
    } catch (e) {
      console.warn("SettingsSection: localStorage not available", e);
      setStorageOk(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setStatus("idle");
    setErrorMsg(null);
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function save() {
    setStatus("idle");
    setErrorMsg(null);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1200);
    } catch (e: any) {
      console.error("SettingsSection save error:", e);
      setStatus("error");
      setErrorMsg(e?.message ?? "Failed to save settings (localStorage blocked).");
      setStorageOk(false);
    }
  }

  function reset() {
    setSettings(DEFAULTS);
    setStatus("idle");
    setErrorMsg(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  return (
    <div className="text-gray-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Settings</h2>
          <p className="mt-2 text-sm text-gray-600">
            Simple admin settings (saved locally for now). Later we can move this to Supabase.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white"
          >
            Save
          </button>
        </div>
      </div>

      {!storageOk && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <div className="font-semibold">Heads up</div>
          <div className="mt-1">
            Your browser blocked local storage. Settings may not persist after refresh.
          </div>
        </div>
      )}

      {status === "saved" && (
        <div className="mt-4 rounded-xl border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          Saved.
        </div>
      )}

      {status === "error" && errorMsg && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Store basics */}
        <div className="rounded-xl border p-4">
          <div className="text-sm font-medium">Store basics</div>
          <div className="mt-4 grid gap-3">
            <div>
              <label className="text-xs text-gray-600">Store name</label>
              <input
                value={settings.storeName}
                onChange={(e) => update("storeName", e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                placeholder="e.g. Mato Online"
              />
            </div>

            <div>
              <label className="text-xs text-gray-600">WhatsApp number</label>
              <input
                value={settings.whatsappNumber}
                onChange={(e) => update("whatsappNumber", e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                placeholder="e.g. +25261xxxxxxx"
              />
              <p className="mt-1 text-xs text-gray-500">Used for order confirmations and customer support.</p>
            </div>

            <div>
              <label className="text-xs text-gray-600">City</label>
              <input
                value={settings.city}
                onChange={(e) => update("city", e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                placeholder="e.g. Mogadishu"
              />
            </div>
          </div>
        </div>

        {/* Currency */}
        <div className="rounded-xl border p-4">
          <div className="text-sm font-medium">Currency & pricing</div>
          <div className="mt-4 grid gap-3">
            <div>
              <label className="text-xs text-gray-600">Currency code</label>
              <input
                value={settings.currencyCode}
                onChange={(e) => update("currencyCode", e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                placeholder="USD"
              />
              <p className="mt-1 text-xs text-gray-500">Preview: {previewCurrency}</p>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.showCurrencySymbol}
                onChange={(e) => update("showCurrencySymbol", e.target.checked)}
              />
              Show currency symbol
            </label>
          </div>
        </div>

        {/* Inventory alerts */}
        <div className="rounded-xl border p-4">
          <div className="text-sm font-medium">Inventory alerts</div>
          <div className="mt-4 grid gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.enableLowStockAlerts}
                onChange={(e) => update("enableLowStockAlerts", e.target.checked)}
              />
              Enable low-stock alerts
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-gray-600">Default reorder (grams)</label>
                <input
                  value={String(settings.defaultReorderLevelG)}
                  onChange={(e) =>
                    update("defaultReorderLevelG", toPosInt(e.target.value, settings.defaultReorderLevelG))
                  }
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                />
                <p className="mt-1 text-xs text-gray-500">Example: 5000g = 5kg</p>
              </div>

              <div>
                <label className="text-xs text-gray-600">Default reorder (units)</label>
                <input
                  value={String(settings.defaultReorderLevelUnits)}
                  onChange={(e) =>
                    update(
                      "defaultReorderLevelUnits",
                      toPosInt(e.target.value, settings.defaultReorderLevelUnits)
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                />
                <p className="mt-1 text-xs text-gray-500">Example: 10 units</p>
              </div>
            </div>

            <p className="text-xs text-gray-500">
              These defaults can be applied when you first set inventory for a variant.
            </p>
          </div>
        </div>

        {/* Marketing placeholders */}
        <div className="rounded-xl border p-4">
          <div className="text-sm font-medium">Marketing (optional)</div>
          <div className="mt-4 grid gap-3">
            <div>
              <label className="text-xs text-gray-600">TikTok Pixel ID</label>
              <input
                value={settings.tiktokPixelId}
                onChange={(e) => update("tiktokPixelId", e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                placeholder="(optional)"
              />
            </div>

            <div>
              <label className="text-xs text-gray-600">Google Ads Conversion ID</label>
              <input
                value={settings.googleAdsConversionId}
                onChange={(e) => update("googleAdsConversionId", e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                placeholder="(optional)"
              />
            </div>

            <p className="text-xs text-gray-500">
              We’ll use these later for tracking conversions from TikTok/Google Ads.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-xl border bg-gray-50 p-4 text-sm text-gray-600">
        <div className="font-medium">Next step (when you are ready)</div>
        <ul className="mt-2 list-disc pl-5">
          <li>Move settings into a Supabase table so they work across devices.</li>
          <li>Use WhatsApp number for order messages.</li>
          <li>Auto-fill reorder levels when creating inventory rows.</li>
        </ul>
      </div>
    </div>
  );
}
