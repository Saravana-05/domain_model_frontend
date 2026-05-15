import type { AccessConfig } from "../core/schema/types";
import { rbacConfig } from "./rbac";
import { abacConfig }  from "./abac";

export { rbacConfig } from "./rbac";
export { abacConfig }  from "./abac";

export const accessConfig: AccessConfig = {
  rbac: rbacConfig,
  abac: abacConfig,
};
