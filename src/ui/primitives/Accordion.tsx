import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn.js";

export interface AccordionItem {
  id: string;
  title: ReactNode;
  content: ReactNode;
}
export interface AccordionProps {
  items: readonly AccordionItem[];
  single?: boolean;
  padded?: boolean;
  defaultOpen?: readonly string[];
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  className?: string;
}

export function Accordion({
  items,
  single = false,
  padded = false,
  defaultOpen = [],
  headingLevel = 3,
  className,
}: AccordionProps) {
  const id = useId();
  const [open, setOpen] = useState<readonly string[]>(defaultOpen);
  const Heading = `h${headingLevel}` as const;
  return (
    <div className={cn("accordion", padded && "accordion--padded", className)}>
      {items.map((item, index) => {
        const expanded = open.includes(item.id);
        return (
          <div
            className="accordion__item"
            data-open={expanded || undefined}
            key={item.id}
          >
            <Heading className="accordion__heading">
              <button
                className="accordion__trigger"
                type="button"
                id={`${id}-trigger-${index}`}
                aria-controls={`${id}-panel-${index}`}
                aria-expanded={expanded}
                onClick={() =>
                  setOpen(
                    expanded
                      ? open.filter((entry) => entry !== item.id)
                      : single
                        ? [item.id]
                        : [...open, item.id],
                  )
                }
              >
                <span>{item.title}</span>
                <ChevronDown className="accordion__icon" aria-hidden="true" />
              </button>
            </Heading>
            <div
              className="accordion__panel"
              id={`${id}-panel-${index}`}
              role="region"
              aria-labelledby={`${id}-trigger-${index}`}
              inert={!expanded}
            >
              <div className="accordion__panel-inner">
                <div className="accordion__content">{item.content}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
