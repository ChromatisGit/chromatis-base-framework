import type { ReactNode } from "react";

export interface FieldFrameProps {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  optional?: string | undefined;
  visuallyHiddenLabel?: boolean | undefined;
  children: ReactNode;
}

export function fieldDescription(
  id: string,
  hint?: string,
  error?: string,
  describedBy?: string,
) {
  return (
    [describedBy, hint && `${id}-hint`, error && `${id}-error`]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

export function FieldFrame({
  id,
  label,
  hint,
  error,
  optional,
  visuallyHiddenLabel,
  children,
}: FieldFrameProps) {
  return (
    <div className="field">
      <label
        className={
          visuallyHiddenLabel ? "field__label visually-hidden" : "field__label"
        }
        htmlFor={id}
      >
        {label}
        {optional && (
          <>
            {" "}
            <span className="field__optional">{optional}</span>
          </>
        )}
      </label>
      {children}
      {hint && (
        <p className="field__help" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
