/* One-time setup of the storefront's welcome offer — run by the store owner.

   Creates (or corrects) the coupon TULSI100 — flat ₹100 off the first order,
   no expiry — and saves the top strip's offer (settings/site.announcement)
   to use it. Saved settings override the code defaults on the live site, so
   without this a store that ever saved the announcement keeps its old offer.

   Run from the repo root with the same env vars the app uses:
     node --env-file=.env.local scripts/setup-welcome-offer.mjs            (dry run — prints, writes nothing)
     node --env-file=.env.local scripts/setup-welcome-offer.mjs --apply    (writes)
   Safe to re-run. Logic: scripts/lib/welcome-offer-setup.mjs. */
import { db, APPLY } from './migrations/_lib.mjs';
import { runSetup } from './lib/welcome-offer-setup.mjs';

const { ok } = await runSetup(db(), { apply: APPLY });
if (!ok) process.exitCode = 1;
