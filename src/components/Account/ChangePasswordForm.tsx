import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

const ChangePasswordForm: React.FC<{ onDone?: () => void }> = ({ onDone }) => {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 10) return toast.error("The new password must be at least 10 characters");
    if (next !== repeat) return toast.error("The new passwords do not match");
    setBusy(true);
    const ok = await changePassword(current, next);
    setBusy(false);
    if (ok) {
      setCurrent("");
      setNext("");
      setRepeat("");
      onDone?.();
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="pw-current">Current password</Label>
        <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pw-new">New password (min. 10 characters)</Label>
        <Input id="pw-new" type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pw-repeat">Repeat new password</Label>
        <Input id="pw-repeat" type="password" autoComplete="new-password" minLength={10} value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
      </div>
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Change password"}</Button>
    </form>
  );
};

export default ChangePasswordForm;
