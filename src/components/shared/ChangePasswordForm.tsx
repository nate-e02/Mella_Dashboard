"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";

export function ChangePasswordForm() {
  const t = useT();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || body.issues?.[0]?.message || t("auth.changePassword.failed"));
        return;
      }
      toast.push(t("auth.changePassword.done"), "success");
      setCurrentPassword("");
      setNewPassword("");
    } catch {
      setError(t("common.unexpectedError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="card flex max-w-md flex-col gap-3 p-5">
      <h3 className="text-sm font-semibold">{t("auth.changePassword.title")}</h3>
      {error && <div className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("auth.changePassword.current")}</span>
        <input type="password" autoComplete="current-password" className="input-base" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("auth.changePassword.new")}</span>
        <input type="password" autoComplete="new-password" className="input-base" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={12} maxLength={72} />
        <span className="text-xs text-muted">{t("auth.changePassword.hint")}</span>
      </label>
      <button type="submit" className="btn-primary self-start" disabled={saving}>
        {saving ? t("common.saving") : t("auth.changePassword.submit")}
      </button>
    </form>
  );
}
