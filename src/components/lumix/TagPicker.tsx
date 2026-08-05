import { useMemo, useState } from "react";
import { Check, Plus, X, type LucideIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Generic multi-select tag picker: browse every existing label, select /
 * deselect any number of them, or type a brand new one and add it inline.
 */
export function TagPicker({
  value,
  onChange,
  suggestions,
  disabled,
  icon: Icon,
  tone = "cyan",
  placeholder,
  emptyText = "Nothing selected yet.",
  maxLength = 40,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
  disabled?: boolean | undefined;
  icon: LucideIcon;
  tone?: "cyan" | "pink";
  placeholder: string;
  emptyText?: string;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState("");

  const unique = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of suggestions) {
      const label = s.trim();
      if (label && !seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [suggestions]);

  const filtered = useMemo(() => {
    const q = draft.trim().toLowerCase();
    return unique
      .filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()))
      .filter((s) => (q ? s.toLowerCase().includes(q) : true));
  }, [draft, unique, value]);

  const canCreate =
    draft.trim().length > 0 &&
    !unique.some((s) => s.toLowerCase() === draft.trim().toLowerCase()) &&
    !value.some((s) => s.toLowerCase() === draft.trim().toLowerCase());

  const toggle = (label: string) => {
    onChange(
      value.some((v) => v.toLowerCase() === label.toLowerCase())
        ? value.filter((v) => v.toLowerCase() !== label.toLowerCase())
        : [...value, label],
    );
  };

  const create = () => {
    const label = draft.trim();
    if (!label) return;
    if (!value.some((v) => v.toLowerCase() === label.toLowerCase())) onChange([...value, label]);
    setDraft("");
  };

  const chipClass =
    tone === "pink"
      ? "bg-gradient-pink glow-pink text-primary-foreground"
      : "bg-gradient-cyan glow-cyan text-primary-foreground";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {value.length === 0 ? (
          <span className="text-muted-foreground text-xs">{emptyText}</span>
        ) : null}
        {value.map((label) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            onClick={() => toggle(label)}
            className={`spring-press inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${chipClass}`}
          >
            {label}
            <X className="size-3.5" />
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Icon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value.slice(0, maxLength))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                create();
              }
            }}
            placeholder={placeholder}
            className="pl-9"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || !canCreate}
          onClick={create}
          className="spring-press shrink-0"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">Add</span>
        </Button>
      </div>

      {filtered.length > 0 ? (
        <div className="glass/40 max-h-40 overflow-y-auto rounded-2xl p-1">
          <div className="flex flex-wrap gap-2">
            {filtered.map((label) => (
              <button
                key={label}
                type="button"
                disabled={disabled}
                onClick={() => toggle(label)}
                className="glass spring-press hover:border-primary inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors"
              >
                <Check className="text-primary size-3.5 opacity-40" />
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
