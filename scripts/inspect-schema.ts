import { userDomain }  from "../src/domains/user.domain";
import { orderDomain } from "../src/domains/order.domain";
import { buildSchemas } from "../src/core/schema/domainBuilder";

const schemas = buildSchemas({
  domains: [userDomain, orderDomain],
  ui: { screens: {} },           // empty UI — we only care about the domain output
  datasources: {},
  env: { mode: "development" },
});

const { uiHints, validations, access, uiExtensions, computed, domains } = schemas;

console.log("\n=== domains ===");
console.dir(domains, { depth: null });

console.log("\n=== validations ===");
console.dir(validations, { depth: null });

console.log("\n=== access ===");
console.dir(access, { depth: null });

console.log("\n=== uiExtensions ===");
console.dir(uiExtensions, { depth: null });

console.log("\n=== computed ===");
console.dir(computed, { depth: null });

console.log("\n=== uiHints ===");
console.dir(uiHints, { depth: null });
