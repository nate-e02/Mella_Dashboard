"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

type UserOption = { id: string; name: string; email: string };
type TemplateOption = { id: string; name: string; phase: string };

export function CreateAccountModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [userId, setUserId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    fetch("/api/admin/users?pageSize=100")
      .then((r) => r.json())
      .then((d) => setUsers(d.items.map((u: UserOption) => ({ id: u.id, name: u.name, email: u.email }))))
      .catch(() => undefined);
    fetch("/api/admin/templates/options")
      .then((r) => r.json())
      .then(setTemplates)
      .catch(() => undefined);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, templateId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to create account");
      }
      toast.push("Account created and assigned", "success");
      setUserId("");
      setTemplateId("");
      onCreated();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Failed to create account", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create Account">
      <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Trader</span>
          <select className="input-base" value={userId} onChange={(e) => setUserId(e.target.value)} required>
            <option value="">Select trader...</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Template</span>
          <select className="input-base" value={templateId} onChange={(e) => setTemplateId(e.target.value)} required>
            <option value="">Select template...</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.phase.replace("_", " ")})
              </option>
            ))}
          </select>
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !userId || !templateId}>
            {saving ? "Creating..." : "Create Account"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
