# tmy_garage UX review: changes to make (November 2026)

For Claude Code. This is a list of recommended changes, written by a UX review done from the source and from screenshots
of the deployed desktop build. Follow `UX-GUIDELINES.md` (sections 3, 4, 6, 11 and 12 were extended by this review) and this
project's `CLAUDE.md`. Every visible string goes in `i18n.ts` in both languages. No personal data in tests, fixtures or this
doc: the figures quoted below are made-up examples.

`UX-GUIDELINES.md` lives in `C:\Projects` (not a repo, not in this repo): it is not visible to `git diff` and a reader of
this public repo cannot open it.

Not seen yet: the phone itself (S25) and the screens `SetupForms.tsx`, `Catalogue.tsx`, `Documents.tsx`, the end of
`Workshop.tsx`. Check them against the same rules (B8 covers the entry forms; for `Documents.tsx` and `Workshop.tsx`, review
and list findings before changing anything).

**Order of work:** C (redeploy and re-check first), A (review), then B1, B2, B5 (high), B9a, B7, B3, B4, B6, B8 (medium),
the rest of B9 (low). The B numbers are labels, not the order. Each item below has an "Done when" line.

## C. Deployment (do first)

The deployed desktop build still has the old amber accent (the language button "Français" is orange) while `styles.css`
has the steel-blue accent, so the screenshots behind this review are stale. Merging to `main` rebuilds the NAS app and
publishes the Android release; after the merge, re-check the screens before going further.

## A. Already applied in the working tree (uncommitted): review with `git diff`

These were edited directly on disk during the review and have not been built, tested or committed. Review them, run
`npm run build` and the tests, then keep or adjust. (The `UX-GUIDELINES.md` edits are outside this repo: read that file
directly.)

- `pages/Dashboard.tsx`: each owned vehicle's card now has "Ajouter un entretien" (primary, links to
  `#/vehicles/<id>/service`) next to "Relevé kilométrique", both full-height buttons in `.actions.card-action`. "Gérer" and
  "Ajouter un véhicule" moved below the cards (normal 48px buttons). `LanguageSwitch` removed from the home page (it stays in
  Settings and on the first-launch screen).
- `styles.css`: `--muted` in light mode `#6b7280` to `#4b5563`; tab bar, chips, `.due-group` and `.sync` text to 0.85rem;
  `.button-small` 36px to 44px; `.back` and `.sync` given 48px and 44px tap areas with negative margins; toast and
  `.sticky-actions` raised by a few px; new block at the end hiding `.tabbar-entry` below 1000px (with `body:has(...)`
  adjustments for `main` padding, `.sticky-actions` and `.toast-host`).
- `components.tsx`: `Layout` takes `entry?: boolean`, passed to `NavBar`, which adds `tabbar-entry` to the nav.
- `pages/ServiceForm.tsx`: field order is now kind (Service / Repair), repair title and category, tasks done, date,
  odometer, performed by and cost. `Layout entry` on `ServiceForm` and `ReadingForm`.
- `pages/Parts.tsx`: `Layout entry` on `VehiclePartForm`.
- `UX-GUIDELINES.md` (in `C:\Projects`): new rules in sections 3 and 6, new section 11 "Flows, navigation and forms",
  checklist moved to section 12.

Things to verify: `body:has()` works in the Capacitor WebView on the S25; the top bar height with the larger back arrow and
sync badge; the 3 buttons per row on narrow cards; sticky save button position without the tab bar.

## B. To do

### B1. Dashboard: make "tasks with no history" visible (high)
Today it is a small grey underlined link (about 25px tall): "12 tâches sans historique". It means those tasks have no due
date and cannot trigger a reminder, so it is the most important message on the card.
- Make it a full-width row or button of at least 48px, with the count and a verb, linking to the vehicle's set-up block.
- Use one wording everywhere for this idea: **"à initialiser" / "to set up"** (the vehicle page already says
  `setupTitle`: "9 tâches à initialiser"). Replace `dashboard.noHistory` and `dashboard.noHistoryOnly` texts in both
  languages ("sans historique" / "with no history yet") accordingly.
- When the vehicle page opens from this link, open the `SetupTasks` `<details>` block and scroll to it. The routes are
  hash routes, so carry the intent in the route (for example a `?setup=1` part after the hash path), not in React state.
- Done when: the link is 48px high at 360px, reads the same on the vehicle page, and tapping it lands on the opened block.
  Add a test for the new wording in both languages.

### B2. Dashboard: overdue wording (high)
An overdue line reads "il y a 1010 jours" (`due.daysAgo`): it is unclear whether that is the due date or the last service.
- For overdue items, show "En retard de 45 jours" / "Overdue by 45 days" (new key `due.overdueBy`, with singular for 1).
  Keep "dans N jours" for the future.
- Rule: up to 90 days show days; beyond that show years and months ("En retard de 2 ans 9 mois").
- Group digits the same way as kilometres (`numberFormat` in `format.ts`, so French uses a non-breaking space):
  "1 010 jours" matches "1 200 km".
- Done when: unit tests cover 1, 45, 90, 91 and 1010 days in both languages, and no `daysAgo` is left on an overdue row.

### B3. Dashboard: urgent items offer their action (medium)
`UpcomingLine` is one link to the task page. For `overdue` and `dueSoon` rows, add a second target on the row: a button
with the **same verb as the card button** (short label "Ajouter", with an `aria-label` of "Ajouter un entretien: <task>")
linking to `#/vehicles/<vehicleId>/service/<taskId>` (the `preselect` route already exists). A button cannot sit inside the
`<a>`: make the row a flex container holding two sibling elements, each with a 48px-high tap area.
- Done when: at 360px the task name still reads on at most two lines next to the button, and both targets are 48px.

### B4. Dashboard grid alignment on wide screens (medium)
- `.card-grid` uses `align-items: start`, so cards of different content have ragged bottoms. Use `stretch`.
- In `.vehicle-head`, the vehicle logo makes the title taller than a text-only brand title: the km figure and the button
  below drift 3 to 5px between cards. Do not fix it with a magic `min-height`: make each card a flex column with the action
  row pushed to the bottom (`margin-top: auto`) and give the head `align-items: center`.
- Done when: at 1280px the km figures and the buttons line up across cards with and without a logo, with a long name and with
  a large browser font size.

### B5. Vehicle page: lighter task rows (high)
Each task row is about 125px tall with 4 lines, and nearly all show a green "Dans les temps" chip and a "Standard" chip.
- Show the status chip only when it is not `ok` (overdue, due soon, never done, paused). The text always stays; never
  colour alone. Keep the grouped "à initialiser" block for never-done tasks. First check that "paused" and "never done"
  exist in the status type; show a chip for every non-ok status that does.
- Remove the "Standard" chip (`vehicle.standardTask`) from rows. If a distinction is wanted, mark the owner's own tasks
  instead, or show it only on the task page (`standardTaskHint` already exists).
- Split the long due sentence of `describeDue` ("Échéance 6 févr. 2027 (dans 91 jours) · à 123 456 km (encore 1 200 km)")
  into two short facts: "6 févr. 2027 · dans 91 jours" and "encore 1 200 km". The "à 123 456 km" target can go to the
  task page.
- On wide screens, aim for one line per task: name, interval, next due, last done.
- Done when: a task that is on time is at most 2 lines (about 70px) at 360px and one line at 1280px.

### B6. Vehicle page: History (medium)
- Each history row shows both an "Modifier" hint and a chevron. Keep one (the chevron). Until the read view below exists,
  keep the "Modifier" hint so the row stays clearly tappable.
- Odometer readings (three in a row today) drown the services. Separate them: two segments "Entretiens" and "Relevés", or
  show services and a single line "3 relevés récents" that expands.
- A repair's title runs into its tasks ("Pneus avant, Remplacer le liquide de frein"). Show the repair title in bold on
  its own line, then the tasks on the next line.
- Tapping a row should open a read view with an "Modifier" button inside (see guideline 11), once a read view exists
  (a separate piece of work: do not build it as part of this item).

### B7. Vehicle page on phone (medium)
In one column the history is below 20 or more task rows. Add a segmented switch at the top (Plan / Historique / Fiches /
Pièces) on narrow screens; wide screens keep the two columns, which work well. Build it as `role="tablist"` with arrow-key
handling (see B9a), and make it visually different from the bottom tab bar (outlined, not filled).
- Done when: at 360px the history is one tap away, the choice is remembered when coming back from a task, and the screen
  works with the keyboard.

### B8. Hide the tab bar on the other entry screens (medium)
Add `entry` to the `Layout` of the forms in `SetupForms.tsx` (vehicle, task, sale, copy tasks) and the parts catalogue form
in `Catalogue.tsx`. Read each screen first: skip any that has no typed input.

### B9. Small things (low)
- **B9a (do before B7).** Segmented controls have `role="radio"` but no arrow-key handling: add it, and use `tablist` where
  the control switches views.
- Verify (not necessarily a change): `<html lang>` follows the chosen language (`index.html` says `lang="en"`; `main.tsx` or
  `i18n.ts` may set it).
- "Marquer comme vendu" (`vehicle.markSold`) uses `button-danger`. It is reversible, so use a normal button.
- Parts page: the intro paragraph shows on every visit. Reduce it to one line or make it dismissible.

## D. How to check (guideline 12)

For each change: 360px and 1280px, light, dark and true-black dark, empty / error / offline states, French and English
wording, tap sizes, and count the taps of the two frequent tasks (log a service, log an odometer reading) from the home
screen. Say plainly if the S25 over `adb` was not tried.
