"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";

export function ChangePasswordForm() {
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
        setError(body.error || "Failed to change password");
        return;
      }
      toast.push("Password changed successfully", "success");
      setCurrentPassword("");
      setNewPassword("");
    } catch {
      setError("Unexpected error, please try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="card flex max-w-md flex-col gap-3 p-5">
      <h3 className="text-sm font-semibold">Change Password</h3>
      {error && <div className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Current Password</span>
        <input type="password" className="input-base" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">New Password</span>
        <input type="password" className="input-base" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
      </label>
      <button type="submit" className="btn-primary self-start" disabled={saving}>
        {saving ? "Saving..." : "Update Password"}
      </button>
    </form>
  );
}
