export type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "tel"
  | "number"
  | "date"
  | "select"
  | "checkbox"
  | "radio"
  | "combobox"
  | "contenteditable"
  | "protected";

export interface FieldFingerprint {
  tag: string;
  inputType?: string;
  name?: string;
  domId?: string;
  label: string;
  ariaLabel?: string;
  formIndex: number;
  domPath: string;
}

export interface FieldDescriptor {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  disabled: boolean;
  readonly: boolean;
  sensitive: boolean;
  options?: string[];
  optionsDynamic?: boolean;
  unit?: string;
  fingerprint: FieldFingerprint;
}

export interface FormManifest {
  version: 1;
  page: string;
  pageFingerprint: string;
  createdAt: string;
  fields: FieldDescriptor[];
  unsupportedCrossOriginFrames: number;
  mutationRevision: number;
}

export type PrimitiveFillValue = string | number | boolean | null;
export type FillActionName = "set" | "select" | "check" | "uncheck" | "clear" | "skip";

export interface FillOperation {
  action: FillActionName;
  value?: PrimitiveFillValue;
}

export interface FillRequest {
  version: 1;
  pageFingerprint?: string;
  fields: Record<string, PrimitiveFillValue | FillOperation>;
}

export type PreviewStatus = "ok" | "review" | "error" | "same" | "skip";

export interface PreviewItem {
  id: string;
  label: string;
  currentValue: PrimitiveFillValue;
  requestedValue: PrimitiveFillValue;
  status: PreviewStatus;
  confidence?: number;
  message?: string;
}

export interface PreviewResult {
  pageFingerprint: string;
  pageMismatch: boolean;
  items: PreviewItem[];
  counts: Record<PreviewStatus, number>;
}

export interface FillFieldResult {
  id: string;
  label: string;
  status: "filled" | "same" | "review" | "error" | "skipped";
  requestedValue?: PrimitiveFillValue;
  actualValue?: PrimitiveFillValue;
  message?: string;
}

export interface FillResult {
  startedAt: string;
  completedAt: string;
  fields: FillFieldResult[];
  filled: number;
  same: number;
  review: number;
  errors: number;
  skipped: number;
  newFieldCount: number;
}

export interface UndoResult {
  restored: number;
  errors: number;
}

export type ContentAction =
  | "ping"
  | "scan"
  | "toggleOverlay"
  | "highlightProblems"
  | "preview"
  | "fill"
  | "undo";

export interface TabRequest {
  scope: "tab";
  action: ContentAction;
  payload?: unknown;
}

export interface RpcResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface HistoryEntry {
  timestamp: string;
  page: string;
  fields: number;
  successful: number;
  review: number;
  errors: number;
}
