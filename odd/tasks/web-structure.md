# Web client structure: features and a thin dashboard

Objective: reorganise `apps/web/src` by feature with an enforced dependency rule, and split `Dashboard.tsx` (898 lines, 32 hooks) into a thin container plus hooks, with no change in behaviour.
Branch: `refactor/web-features`, stacked on `feat/month-range` (PR #50, still open). Test runner: `npm test`, `npm run lint`, `npm run build`, plus the headless browser checks used for #48–#50.

## Specs

- S1. Behaviour does not change: the same tests pass, and the browser checks for the custom area, at-a-glance summary, downloads, month range and phone layout give the same results as before the refactor.
- S2. Folders say what the product does: `features/{area,range,calendar,map,method,tour,exports}`, `shared/` for code with no product knowledge, `dashboard/` for the page that composes them.
- S3. Dependency rule, enforced by lint: `shared/` imports nothing from `features/` or `dashboard/`; `features/` never import `dashboard/`.
- S4. `Dashboard.tsx` becomes a container: data loading, URL state, playback and calendar exports live in their own hooks.
- S5. Pure modules (`aoi.ts`, `range.ts`, `insights.ts`) keep no runtime imports, so `node --test` still runs them as plain TypeScript.

## Tasks

- [x] T1 (S1, S2, S3, S5) inline, commit 1432e12 — move files by feature, move `downloadDetections` out of `shared/api.ts`, lint rule.
- [x] T2 (S1, S4) inline — split `Dashboard.tsx` into hooks.

## Log

- L1 (2026-11-21, user): asked whether the project's organisation and architecture are correct and how an expert would organise it; after the review: "Dale" to the Dashboard refactor plus the feature-based web structure.
- L2: Correction: PR #50 is still open, so this branch is stacked on `feat/month-range` instead of `develop`.
- L3: T1 done. Files moved with `git mv`; `downloadDetections` moved to `features/exports/`, `Series`/`ViewMode` to `features/calendar/view.ts`, so `shared/` imports no feature. Lint rule proven: a probe import from `shared/` into `features/`, and one from `features/` into `dashboard/`, both fail lint. `npm test` 27/27, lint, tsc and build clean. All three browser check scripts give the same results as on `feat/month-range`.
- L4: T2 done. `Dashboard.tsx` 898 → 413 lines, mostly layout; logic in `hooks.ts` (useRegions, useRegionData, useUrlSync, usePlayback, useDetectionsDownload, useNotice), `useCalendarExports.ts`, `useTour.tsx`, `calendarView.ts`; presentation in `ControlsBar.tsx` and `CalendarToolbar.tsx`. New tour/playback browser check run on the build before T2 (stash) and after: identical output. The three earlier batteries give the same results. `npm test` 27/27, lint, tsc, build clean.
