import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn.js";

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
}

export interface TabsProps {
  label: string;
  items: readonly TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}

export function Tabs({
  label,
  items,
  value,
  defaultValue,
  onValueChange,
  className,
}: TabsProps) {
  const id = useId();
  const [internal, setInternal] = useState(defaultValue ?? items[0]?.id);
  const selected = items.some((item) => item.id === (value ?? internal))
    ? (value ?? internal)
    : items[0]?.id;

  function select(next: string) {
    if (value === undefined) {
      setInternal(next);
    }
    if (next !== selected) {
      onValueChange?.(next);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % items.length;
        break;
      case "ArrowLeft":
        next = (index - 1 + items.length) % items.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]',
      )[next];
    const nextItem = items[next];
    if (!nextItem) {
      return;
    }
    select(nextItem.id);
    target?.focus();
    target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  return (
    <div className={cn("tabs", className)}>
      <div className="tabs__list" role="tablist" aria-label={label}>
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="tabs__tab"
            id={`${id}-tab-${index}`}
            aria-controls={`${id}-panel-${index}`}
            aria-selected={selected === item.id}
            tabIndex={selected === item.id ? 0 : -1}
            onClick={() => select(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item, index) => (
        <div
          key={item.id}
          className="tabs__panel"
          role="tabpanel"
          id={`${id}-panel-${index}`}
          aria-labelledby={`${id}-tab-${index}`}
          tabIndex={0}
          hidden={selected !== item.id}
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
