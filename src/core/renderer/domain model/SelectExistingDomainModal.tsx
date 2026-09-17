// import React, { useState, useMemo, useEffect } from "react";
// import ReactDOM from "react-dom";
// import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
// import CheckIcon from "@mui/icons-material/Check";
// import CloseIcon from "@mui/icons-material/Close";
// import SearchIcon from "@mui/icons-material/Search";

// interface SelectExistingDomainModalProps {
//   open: boolean;
//   onClose: () => void;
//   domainNames: string[];
//   /** Domains that are already associated (e.g. already added as a relation
//    *  field on this domain) — pre-checked and shown but not required to be
//    *  re-selected. */
//   alreadyAssociated?: string[];
//   onConfirm: (selected: string[]) => void;
// }

// /**
//  * "🔗 Add Existing Domain" — search + multi-select picker. Confirming adds
//  * one relation field per selected domain in one step, instead of repeating
//  * the name→type→relation flow once per domain.
//  */
// export function SelectExistingDomainModal({
//   open, onClose, domainNames, alreadyAssociated = [], onConfirm,
// }: SelectExistingDomainModalProps) {
//   const [search, setSearch] = useState("");
//   const [selected, setSelected] = useState<Set<string>>(new Set());

//   useEffect(() => {
//     if (open) {
//       setSearch("");
//       setSelected(new Set());
//     }
//   }, [open]);

//   const filtered = useMemo(() => {
//     const q = search.trim().toLowerCase();
//     if (!q) return domainNames;
//     return domainNames.filter((d) => d.toLowerCase().includes(q));
//   }, [domainNames, search]);

//   if (!open) return null;

//   function toggle(name: string) {
//     setSelected((prev) => {
//       const next = new Set(prev);
//       if (next.has(name)) next.delete(name); else next.add(name);
//       return next;
//     });
//   }

//   function handleConfirm() {
//     if (selected.size === 0) return;
//     onConfirm(Array.from(selected));
//     onClose();
//   }

//   return ReactDOM.createPortal(
//     <div className="ldm-overlay" onClick={onClose}>
//       <div className="ldm-modal" onClick={(e) => e.stopPropagation()}>
//         <div className="ldm-header">
//           <LinkOutlinedIcon sx={{ fontSize: 16 }} />
//           <span>Select Domain</span>
//           <button className="ldm-close" type="button" onClick={onClose}>
//             <CloseIcon sx={{ fontSize: 16 }} />
//           </button>
//         </div>

//         <div className="ldm-body">
//           <div style={{ position: "relative", marginBottom: 12 }}>
//             <SearchIcon sx={{ fontSize: 16, position: "absolute", left: 10, top: 10, color: "#9ca3af" }} />
//             <input
//               className="si-form-input"
//               style={{ paddingLeft: 32 }}
//               value={search}
//               onChange={(e) => setSearch(e.target.value)}
//               placeholder="Search domains…"
//               autoFocus
//             />
//           </div>

//           {domainNames.length === 0 ? (
//             <p className="ldm-empty">No domains exist yet — create one first.</p>
//           ) : filtered.length === 0 ? (
//             <p className="ldm-empty">No domains match "{search}".</p>
//           ) : (
//             <ul className="ldm-list" style={{ maxHeight: 260, overflowY: "auto" }}>
//               {filtered.map((name) => {
//                 const isChecked = selected.has(name) || alreadyAssociated.includes(name);
//                 const isLocked  = alreadyAssociated.includes(name);
//                 return (
//                   <li key={name}>
//                     <label
//                       className="ldm-item"
//                       style={{
//                         display: "flex", alignItems: "center", gap: 8,
//                         cursor: isLocked ? "default" : "pointer",
//                         opacity: isLocked ? 0.6 : 1,
//                       }}
//                     >
//                       <input
//                         type="checkbox"
//                         checked={isChecked}
//                         disabled={isLocked}
//                         onChange={() => !isLocked && toggle(name)}
//                       />
//                       <LinkOutlinedIcon sx={{ fontSize: 13 }} />
//                       {name}
//                       {isLocked && (
//                         <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: "auto" }}>already added</span>
//                       )}
//                     </label>
//                   </li>
//                 );
//               })}
//             </ul>
//           )}
//         </div>

//         <div className="ldm-footer ldm-footer--gap">
//           <button
//             type="button"
//             className="btn btn-primary"
//             onClick={handleConfirm}
//             disabled={selected.size === 0}
//           >
//             <CheckIcon sx={{ fontSize: 15 }} />
//             {selected.size > 0 ? `Add ${selected.size} domain${selected.size > 1 ? "s" : ""}` : "Add"}
//           </button>
//           <button className="btn btn-secondary" type="button" onClick={onClose}>
//             Cancel
//           </button>
//         </div>
//       </div>
//     </div>,
//     document.body
//   );
// }