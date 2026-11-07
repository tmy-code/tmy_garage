# tmy_garage UX review, part 2: the screens part 1 had not seen (November 2026)

For Claude Code. This continues `docs/ux-review-2026-11.md` (part 1). It covers the screens that review listed as not seen:
`SetupForms.tsx`, `Catalogue.tsx`, `Documents.tsx` and `Workshop.tsx` (specs page, task page, workshop picker), plus
`Settings.tsx` and `Server.tsx`. It is a list of recommended changes; no code was edited.

Method: read from source only, checked against `CLAUDE.md` (screen layout conventions) and the vocabulary in `CONTEXT.md`.
Nothing was run, and the phone (S25) was not seen. Every item needs a check at 360px and 1280px before it counts as done.
Every visible string goes in `i18n.ts` in both languages. No personal data in tests or fixtures.

## Status of part 1 item B8

Already applied in the working tree: `Layout entry` is on `VehicleForm`, `SellForm`, `TaskForm` and the catalogue `PartForm`.
`CopyTasks` has no typed input (one select), so leaving it without `entry` is right. Part 1 can mark B8 done once built and
tested.

## High

### S1. Specs page: find a value fast (Workshop.tsx, `SpecsPage`)
The page is used mid-job ("what torque for the drain plug?"), yet the list is category first, then group, with no search. A
vehicle has dozens of lines, well over the "about eight rows" that `CLAUDE.md` says need a search box.
- Add a search box using `matchesQuery` (`format.ts`) over label, value and OEM reference.
- Add group filters (Fluids / Parts / Torque / Other) as an outlined toggle row with counts. Group is how the owner thinks
  mid-job; keep the category headings under the filter.
- Done when: at 360px, typing "drain" shows the matching lines within one screen, with no layout shift of the search box.

### F1. Long forms: sticky save (SetupForms.tsx, Catalogue.tsx)
`CLAUDE.md`: the save button of a long form goes in `<div className="sticky-actions">`. Only `ServiceForm` does this today.
`VehicleForm` (about a dozen fields plus six selects and option ticks), `TaskForm` (with notes, baseline, merge) and the
catalogue `PartForm` (six groups of checkboxes) end with a plain `<Submit>` / full-width button far below the fold.
- Put the save button of those three forms in `sticky-actions`. Keep destructive buttons outside it (see F2).
- Done when: the save button is visible at 360px without scrolling on all three, and not hidden by the keyboard.

### C1. Catalogue: car / motorcycle switch is a filled toggle (Catalogue.tsx, `CataloguePage`)
The switch uses `button-primary` for the selected side. `CLAUDE.md`: a choice that is only a toggle is outlined and ticked,
never filled with the accent, which is for the button that saves. It also uses `aria-pressed` buttons, so it differs from the
other toggles and has no arrow-key handling.
- Use the existing `.segmented` radiogroup with `segmentedKeys` (same as `VehicleForm` kind), with the car / motorcycle icons.
- Done when: it looks and behaves like the Car / Motorcycle control of the vehicle form, and arrow keys move the choice.

## Medium

### C2. Catalogue: search and counts
The task list per kind is dozens of rows across categories, with no search. Add a search box (`matchesQuery`) and a count per
category heading, as for the Parts page.

### F2. Destructive buttons sit right under Save
`TaskForm` ("Delete task"), `PartForm` ("Take off the list", "Delete") and `InlineEditor` (spec delete) put a full-width red
outlined button directly below Save, the same size, with the default form gap. A slip of the thumb lands on it (the confirm
dialog is the only safety).
- Move destructive actions to the end of the form, after a visible gap or a separator, and keep them out of `sticky-actions`.
- "Take off the list" on a built-in task is reversible (the task goes to the "removed" list and can be put back), so use a
  normal button, not `button-danger`. Same reasoning as part 1 B9 for "Mark as sold".

### F3. Disabled Save with no reason nearby
`useSubmit` disables the button when the server is not reachable; the only explanation is the `NeedsConnection` banner at the
top of the page, which is off screen on long forms.
- With F1 in place, show the reason next to the save button when it is disabled for being offline (short line, linked with
  `aria-describedby`).

### D1. Documents panel (Documents.tsx)
- The link that opens a document is a bare `<strong>` line (about 24px tall); the Delete button beside it is 44px. Give the
  open link a 44px tap area (as part 1 does for other links).
- The camera button is a `label.button` around an `<input hidden>`: a keyboard user cannot reach it. Use a visually-hidden
  (not `hidden`) input and show a focus ring on the label (`:focus-within`).
- On a wide screen `capture` does nothing, so "Take a photo" just opens the file picker like the field above it. Show it only
  on touch devices (`pointer: coarse`) or in the Android app.
- After picking a photo only its file name is shown. A small thumbnail for images makes the confirmation before "Upload"
  meaningful.

### W1. Workshop picker (Workshop.tsx, `WorkshopPage`)
The "Fiches techniques" page is only a list of vehicle buttons that lead to the specs page. With one vehicle (the usual case)
that is a wasted tap, and the buttons do not say what is behind them.
- If exactly one vehicle is shown, go straight to its specs page (replace navigation, so back does not loop).
- Otherwise add a one-line description under each vehicle name (for example the number of lines), and drop the `aria-label`
  that repeats the page title.

### W2. Specs page: "Add the usual specs" is always the first thing
`addStandard` is a full-width button above the list on every visit, but it is a one-time action. Show it prominently only
when the list is empty; otherwise move it below the list (or into the title action menu), so the first thing on screen is the
specs.

### W3. Task page: string hack for "before tracking" (Workshop.tsx, `TaskPage`)
`t.vehicle.beforeTracking.replace(/^[\s(·]+|[)\s]+$/g, '')` strips punctuation from a string that was written to sit in
brackets after another text. Add a plain key (for example `vehicle.beforeTrackingLabel`) in both languages and use it here;
the regex goes away. Add a test that the baseline row reads the same in French and English.

## Low

- **D2. Document title and expiry.** `DocumentRow` shows a title and an expiry note, but `DocumentsPanel` only lets the owner
  choose a file; the type is fixed to `defaultType`. Check where title and expiry are entered. If nowhere, the expiry code is
  dead UI: either add the two fields (optional) or remove the display.
- **F4. Merge control (TaskForm).** The merge select and its button are both inside one `<label>` (via `Field`). A button
  inside a label is invalid for assistive tech and a tap on the label text can move focus unpredictably. Give the select its
  own `Field` and put the button outside the label.
- **F5. Spec editor autofocus.** `SpecEditor` has `autoFocus` on the label even when opening an existing line, so a tap on a
  row to look at it opens the keyboard. Autofocus only when adding.
- **F6. Required fields.** Required inputs (name, make, model, cylinders for a motorcycle) rely on the browser's native
  message. `Field` could show a small "required" marker, and optional ones "optional" (VIN, dates), so the vehicle form is
  scannable. Keep one wording in both languages.
- **C3. Catalogue chips.** "Own" and "Changed" use the same grey chip (`chip-unknown`). The text differs, but the same look
  for two meanings invites misreading; consider an outlined chip for "Own".
- **T1. Task page empty notes.** With no notes the page shows an empty-state sentence but no action. Add a link to the edit
  screen ("Add notes").
- **CT1. Copy tasks.** The success toast is the generic "Saved". Use "N tasks copied".

## Refactor candidates found while reading

- `useWide` exists in `components.tsx` and is copied in `Workshop.tsx` (with its own `WIDE` constant). Import the shared one;
  consider reading the breakpoint from a single place, because `1000px` is also hard-coded in `styles.css`.
- `useSubmit` and `Submit` live in `SetupForms.tsx` but are imported by `Documents.tsx`, `Catalogue.tsx` and `Workshop.tsx`.
  Pages importing from another page is a smell; move them to `components.tsx` (or a small `forms.tsx`).
- `InlineEditor`, `AddButton` and `useEditor` are private to `Workshop.tsx`. If a second screen needs list plus side editor,
  move them to `components.tsx`.
- `styles.css` defines `.heading-row` twice in a row (and `.card-head,` is followed by a comment before `.heading-row`, which
  makes the grouping unclear). Merge into one rule.

## How to check

360px and 1280px, light / dark / true-black dark, empty / error / offline states, French and English, tap sizes, keyboard
only for the new toggles (C1, S1 filters). Say plainly if the S25 over `adb` was not tried.
