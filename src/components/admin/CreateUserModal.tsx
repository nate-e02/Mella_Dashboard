"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

export function CreateUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("TRADER");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Failed to create user");
        return;
      }
      toast.push("User created", "success");
      setName("");
      setEmail("");
      setPassword("");
      setRole("TRADER");
      onCreated();
    } catch {
      setError("Unexpected error, please try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create User">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {error && <div className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Name</span>
          <input className="input-base" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Email</span>
          <input type="email" className="input-base" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Password</span>
          <input type="password" className="input-base" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Role</span>
          <select className="input-base" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="TRADER">Trader</option>
            <option value="ADMIN">Admin</option>
          </select>
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Creating..." : "Create User"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
