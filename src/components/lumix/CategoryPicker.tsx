import { Tag } from "lucide-react";

import { TagPicker } from "./TagPicker";

/**
 * Category selector: browse every existing category, select/deselect any
 * number of them, or type a brand new category and add it inline.
 */
export function CategoryPicker({
  value,
  onChange,
  suggestions,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
  disabled?: boolean;
}) {
  return (
    <TagPicker
      value={value}
      onChange={onChange}
      suggestions={suggestions}
      disabled={disabled}
      icon={Tag}
      tone="cyan"
      placeholder="Search or type a new category"
      emptyText="No category selected yet."
    />
  );
}
