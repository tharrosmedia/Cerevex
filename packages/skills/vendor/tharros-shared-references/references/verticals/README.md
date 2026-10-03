# Vertical packs

A client profile names one vertical pack (and sometimes a second for a specific rule set). Skills load `pack.md` for economics, measurement, seasonality, and creative notes, and `compliance.md` for claims rules. `claims-check` loads the compliance file plus `/home/box/agent-data/workflows/claims-check/references/universal-rules.md`.

| Pack | For | Clients now (profiles) |
|---|---|---|
| `home-service/` | Local HVAC and home-service businesses; the equipment rules also apply to HVAC e-com; the customer-world notes also inform Tharros's agency marketing | kc-prestige-hvac, elmar-hvac; hvac-usa and got-ductless (equipment section) |
| `ecommerce-dtc/` | Online HVAC equipment sales (HVAC USA: Lennox and Trane; Got Ductless: mini-split retailer with a Maryland store): MAP, Merchant Center, feeds | hvac-usa, got-ductless |
| `saas-b2b/` | Tharros's own B2B brands: the Tharros Media agency. The Cerevex rows are dormant while Cerevex is internal-only | tharros-media (cerevex dormant) |
| `local-other/` | Fallback for a future local client outside home service, until a pack exists | none today |

Rules:
- Facts carry a verify-as-of date and source. Rows marked **verify** were written from working knowledge and must be checked against the primary source before client use.
- A pack never holds client-specific facts; those go in the profile.
- Not legal advice. Legal questions go to the agency owner and the client's counsel.
