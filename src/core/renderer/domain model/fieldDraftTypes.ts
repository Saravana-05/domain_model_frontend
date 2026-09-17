import type { FieldType, ComponentType } from "../../schema/types";
import type { DraftValidation } from "./constants";

export interface FieldDraft {
  type:           FieldType;
  default:        string;
  computed:       boolean;
  datasource:     string;
  relatedDomain:  string;
  cardinality:    string;
  listDomain:     string;
  /**
   * Relation kind:
   *  - true   → Parent → Child: FK column added into the RELATED (child) domain
   *  - false  → Many-to-Many: junction table created
   *  - "fk"   → Belongs-to: the CURRENT domain gets a real `${relatedDomain}Id`
   *             column referencing an EXISTING related domain (no modal, no
   *             junction table — e.g. consultation.patientId → patient)
   */
  isPartOf:       boolean | "fk";
  /**
   * Only meaningful when isPartOf === "fk" (belongs-to an EXISTING domain).
   * The FK column placement (`${relatedDomain}Id` added to THIS domain) is
   * identical either way — this only tags whether that relationship is
   * structural or reassignable, for the view-builder to read later:
   *  - "integral"    → the record only ever exists under that related
   *                     domain (e.g. branch is integral to clinic) — no
   *                     Add Existing / Remove shown downstream.
   *  - "association" → a normal reassignable reference (e.g. doctor/patient
   *                     → branch) — Add Existing / Remove shown downstream.
   */
  relationKind:   "integral" | "association";
  validationRefs: string[];
  validations:    DraftValidation[];
  exprStr:        string;
  depsStr:        string;
  component:       ComponentType;
  labels:          Record<"en" | "ta" | "ar", string>;
  placeholder:     string;
  color:           string;
  backgroundColor: string;
  borderColor:     string;
  fontSize:        string;
  fontWeight:      string;
  textAlign:       string;
  width:           string;
  icon:            string;
  tooltip:         string;
  hidden:          boolean;
  readOnly:        boolean;
  abacVisible:  string;
  abacWrite:    boolean | null;
  abacDisabled: boolean | null;
  rbacVisible:  string;
  rbacRead:     string;
  rbacWrite:    string;
  rbacDisabled: string;
}

export const BLANK_DRAFT: FieldDraft = {
  type: "string", default: "", computed: false, datasource: "",
relatedDomain: "", listDomain: "", isPartOf: true, relationKind: "association", cardinality: "",
  validationRefs: [], validations: [], exprStr: "", depsStr: "",
  component: "text", labels: { en: "", ta: "", ar: "" }, placeholder: "",
  color: "", backgroundColor: "", borderColor: "",
  fontSize: "", fontWeight: "", textAlign: "", width: "",
  icon: "", tooltip: "", hidden: false, readOnly: false,
  abacVisible: "", abacWrite: null, abacDisabled: null,
  rbacVisible: "", rbacRead: "", rbacWrite: "", rbacDisabled: "",
};