import { useMemo, useState } from "react";
import type { JsonSchema } from "../types";

interface Props {
  schema: JsonSchema;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}

function schemaType(schema: JsonSchema): string {
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.type)) return schema.type[0] ?? "string";
  if (schema.enum) return "string";
  if (schema.properties) return "object";
  return "string";
}

function FieldInput({
  name,
  schema,
  required,
  value,
  onChange,
}: {
  name: string;
  schema: JsonSchema;
  required: boolean;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const type = schemaType(schema);
  const [jsonDraft, setJsonDraft] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const label = (
    <label className="field-label">
      <span className="field-name">{schema.title ?? name}</span>
      <span className="field-type">{type}</span>
      {required && <span className="field-required">required</span>}
    </label>
  );
  const description = schema.description && (
    <div className="field-desc">{schema.description}</div>
  );

  if (schema.enum) {
    return (
      <div className="field">
        {label}
        {description}
        <select
          className="input"
          value={value === undefined ? "" : String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            const match = schema.enum!.find((v) => String(v) === raw);
            onChange(raw === "" ? undefined : match ?? raw);
          }}
        >
          <option value="">— select —</option>
          {schema.enum.map((v) => (
            <option key={String(v)} value={String(v)}>
              {String(v)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (type === "boolean") {
    return (
      <div className="field field-row">
        <input
          id={`f-${name}`}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div>
          {label}
          {description}
        </div>
      </div>
    );
  }

  if (type === "number" || type === "integer") {
    return (
      <div className="field">
        {label}
        {description}
        <input
          className="input"
          type="number"
          value={value === undefined || value === null ? "" : String(value)}
          min={schema.minimum}
          max={schema.maximum}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return onChange(undefined);
            const n = Number(raw);
            onChange(Number.isNaN(n) ? raw : type === "integer" ? Math.trunc(n) : n);
          }}
        />
      </div>
    );
  }

  if (type === "object" || type === "array") {
    const display =
      jsonDraft ?? (value === undefined ? "" : JSON.stringify(value, null, 2));
    return (
      <div className="field">
        {label}
        {description}
        <textarea
          className={`input input-code ${jsonError ? "input-error" : ""}`}
          rows={5}
          placeholder={type === "array" ? "[ ... ]" : "{ ... }"}
          value={display}
          onChange={(e) => {
            const raw = e.target.value;
            setJsonDraft(raw);
            if (raw.trim() === "") {
              setJsonError(null);
              onChange(undefined);
              return;
            }
            try {
              onChange(JSON.parse(raw));
              setJsonError(null);
            } catch {
              setJsonError("Invalid JSON");
            }
          }}
        />
        {jsonError && <div className="field-error">{jsonError}</div>}
      </div>
    );
  }

  const long = (schema.maxLength as number | undefined) === undefined &&
    (schema.format === undefined || schema.format === "textarea");
  return (
    <div className="field">
      {label}
      {description}
      {long ? (
        <textarea
          className="input"
          rows={2}
          value={value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        />
      ) : (
        <input
          className="input"
          type="text"
          value={value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        />
      )}
    </div>
  );
}

export default function SchemaForm({ schema, values, onChange }: Props) {
  const properties = useMemo(
    () => Object.entries(schema.properties ?? {}),
    [schema]
  );
  const required = new Set(schema.required ?? []);

  if (properties.length === 0) {
    return <div className="empty-note">This tool takes no arguments.</div>;
  }

  return (
    <div className="schema-form">
      {properties.map(([name, fieldSchema]) => (
        <FieldInput
          key={name}
          name={name}
          schema={fieldSchema}
          required={required.has(name)}
          value={values[name]}
          onChange={(v) => {
            const next = { ...values };
            if (v === undefined) delete next[name];
            else next[name] = v;
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}
