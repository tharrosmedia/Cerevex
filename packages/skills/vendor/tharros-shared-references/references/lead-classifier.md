# Lead classifier (shared)

One label set for calls, web forms, and platform lead forms, used by `lead-quality-review`, `review-mining`, `conversion-tracking-audit`, and `attribution`. Label from the recording, transcript, CRM stage, or CSR/sales disposition. If none exists, label `unknown`; never guess from duration or form completion alone.

| Label | Counts as a lead? | Definition |
|---|---|---|
| qualified_converted | yes, qualified | Reached the profile's qualified outcome (booked, order placed by phone, demo booked or trial started) |
| qualified_open | yes, qualified | Fits the profile's qualifying rules and wants the product or service, not converted yet |
| low_intent | yes, low quality | Price check only, no intent this period |
| existing_customer | no | Service, account, order-status, or billing contact |
| out_of_area_or_ineligible | no | Outside geo or failing an eligibility rule in the profile (e.g. unsupported product, outside the service area, not a home-service operator for Tharros) |
| wrong_product | no | Asked for something the client does not sell |
| spam_bot | no | Robocall, bot form fill, fake data |
| vendor_solicitor | no | Selling to the business |
| job_seeker | no | Asking about jobs |
| missed_unanswered | unknown | Not answered and no follow-up reached them; track separately |
| unknown | unknown | No recording, transcript, stage, or disposition |

The profile's `qualifying_rules` define `qualified_*` for that client. A vertical pack may add sub-labels (home-service adds job type; saas-b2b adds company size and role). Strip names, phone numbers, emails, and addresses from anything saved.
