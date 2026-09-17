// SchemaInspector was split into multiple files for maintainability.
// The implementation now lives in ./domain model/ (DomainModelTab,
// CreateDomainTab, FieldBuilder, mergeSchemas, etc.) — this file is kept
// as a thin re-export so existing imports like
//   import { SchemaInspector } from "./core/renderer/SchemaInspector"
// keep working unchanged. New code should prefer importing directly from
// "./core/renderer/domain model/SchemaInspector".
export { SchemaInspector } from "./domain model/SchemaInspector";
export type { MainTab, SchemaInspectorHandle } from "./domain model/SchemaInspector";