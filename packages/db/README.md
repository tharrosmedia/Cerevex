# `@cerevex/db`

Reserved shared DB package. Brain Neon stays in `apps/brain`. Ads module uses isolated schema `os` (`ADS_DB_SCHEMA` — do not rename).

Skill client and store config (Brief 1.0 §3) is not a third database. The typed import lives in `@cerevex/skills`. The tables are `os.skill_client_configs` and `os.skill_store_configs` (`apps/ads/shared/drizzle/0005_skill_config.sql`), because client identity is `os.clients` and Brain stores stay `store_id`-keyed with no cross-schema foreign key.

Formerly `@shopify-brain/db`.
