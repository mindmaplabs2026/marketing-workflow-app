# QA Test Report — Marketing Workflow App

**App URL:** https://marketing-workflow-app-ht3l.vercel.app
**Date:** 2026-05-22
**Tester:** Automated (Playwright MCP)
**Branch:** `main` (commit `63a566e`)

> **Stale — auth flow changed on 2026-06-02.** Sections 1 (Login Page — Magic Link) and 2 (Team Login Page — Password) describe the pre-`a833090` magic-link + dual-login-route world. Production now has a single `/login` password form; the magic-link flow and all `/auth/*` callbacks were deleted. Re-run QA before relying on those sections. Sections 3+ are unaffected by the auth change.

---

## Test Environment

| Parameter | Value |
|---|---|
| Desktop viewport | 1280 x 800 |
| Mobile viewport | 375 x 812 (iPhone SE/13 mini) |
| Browser | Chromium (Playwright) |
| Auth state | Unauthenticated + Authenticated (all 5 roles: school_admin, teacher, designer, decision_maker, super_admin) |

---

## 1. Login Page — Magic Link (`/login`)

### 1.1 UI & Layout

| Check | Desktop | Mobile | Notes |
|---|---|---|---|
| Page loads without crash | PASS | PASS | |
| Heading "Sign in" visible | PASS | PASS | |
| Subtitle text visible | PASS | PASS | "We'll email you a one-tap sign-in link..." |
| Email input with placeholder | PASS | PASS | Placeholder: `you@school.edu` |
| "Send me a sign-in link" button | PASS | PASS | |
| "Internal team? Sign in with password" link | PASS | PASS | Links to `/login/team` |
| Responsive layout (no overflow/clipping) | PASS | PASS | Centered card, scales well |

### 1.2 Form Validation

| Test | Result | Details |
|---|---|---|
| Submit with empty email | PASS | Blocked by HTML5 `required` validation |
| Submit with invalid email (`notavalidemail`) | PASS | Blocked by HTML5 email type validation |
| Submit with unknown valid email (`unknown-user-test@example.com`) | PASS | Shows inline error: *"We couldn't find an account for that email. Ask a super admin to invite you."* |

### 1.3 Navigation

| Test | Result | Details |
|---|---|---|
| "Sign in with password" link works | PASS | Navigates to `/login/team` |
| Redirect preserves `?next=` param | PASS | e.g. `/login?next=%2Frequests` |

---

## 2. Team Login Page — Password (`/login/team`)

### 2.1 UI & Layout

| Check | Desktop | Mobile | Notes |
|---|---|---|---|
| Page loads without crash | PASS | PASS | |
| "Internal team" label visible | PASS | PASS | |
| Heading "Sign in" visible | PASS | PASS | |
| Email input | PASS | PASS | |
| Password input | PASS | PASS | |
| "Sign in" button | PASS | PASS | |
| "School user? Use the magic-link login" link | PASS | PASS | Links to `/login` |
| Responsive layout | PASS | PASS | |

### 2.2 Form Validation

| Test | Result | Details |
|---|---|---|
| Submit with empty fields | PASS | Blocked by HTML5 validation |
| Submit with wrong credentials | PASS | Shows inline error: *"Invalid login credentials"* |

### 2.3 Navigation

| Test | Result | Details |
|---|---|---|
| "Use the magic-link login" link works | PASS | Navigates to `/login` |

---

## 3. Auth Callback (`/auth/callback`)

| Test | Result | Details |
|---|---|---|
| Hit callback with no params | PASS | Redirects to `/login?error=missing_code` |
| Hit callback with fake code | PASS | Redirects to `/login?error=invalid flow state, no valid flow state found` |

---

## 4. Setup Password (`/setup-password`)

| Test | Result | Details |
|---|---|---|
| Access while unauthenticated | PASS | Redirects to `/login?next=%2Fsetup-password` |

---

## 5. Protected Route Redirects

All protected routes must redirect unauthenticated users to `/login?next=<original_path>`.

| Route | Result | Redirected To |
|---|---|---|
| `/` | PASS | `/login?next=%2F` |
| `/requests` | PASS | `/login?next=%2Frequests` |
| `/requests/new` | PASS | `/login?next=%2Frequests%2Fnew` |
| `/calendar` | PASS | `/login?next=%2Fcalendar` |
| `/feed` | PASS | `/login?next=%2Ffeed` |
| `/notifications` | PASS | `/login?next=%2Fnotifications` |
| `/admin` | PASS | `/login?next=%2Fadmin` |
| `/admin/pipeline` | PASS | `/login?next=%2Fadmin%2Fpipeline` |
| `/admin/users` | PASS | `/login?next=%2Fadmin%2Fusers` |
| `/setup-password` | PASS | `/login?next=%2Fsetup-password` |

---

## 6. API Endpoint Security

| Endpoint | Method | Test | Result | Response |
|---|---|---|---|---|
| `/api/quick-approve` | GET (no params) | Unauthenticated, no params | PASS | `405 Method Not Allowed` |
| `/api/quick-approve` | GET (fake params) | Unauthenticated, fake token + request_id | PASS | `405 Method Not Allowed` |
| `/api/email/digest` | GET (no header) | No `CRON_SECRET` header | PASS | `401 Unauthorized` — `{"error":"Unauthorized"}` |
| `/api/email/digest` | GET (fake header) | Fake `Authorization: Bearer fake-secret` | PASS | `401 Unauthorized` — `{"error":"Unauthorized"}` |

---

## 7. PWA Assets

### 7.1 Meta Tags (in HTML `<head>`)

| Tag | Result | Value |
|---|---|---|
| `<meta name="theme-color">` | PASS | `#18181b` |
| `<link rel="manifest">` | PASS | `/manifest.webmanifest` |
| `<link rel="icon">` | PASS | `/favicon.ico` |

### 7.2 Static Asset Loading

| Asset | Expected | Actual | Result |
|---|---|---|---|
| `/manifest.webmanifest` | JSON (application/manifest+json) | HTML login page (text/html) | **FAIL** |
| `/sw.js` | JavaScript (application/javascript) | HTML login page (text/html) | **FAIL** |
| `/icon.svg` | SVG image | SVG image | PASS |
| `/favicon.ico` | Icon | Icon | PASS |

---

## 8. `.well-known` Path Bypass

| Path | Result | Details |
|---|---|---|
| `/.well-known/assetlinks.json` | PASS | Returns correct JSON (200), proper `application/json` content-type. Auth proxy bypass working. |

---

## 9. Console Errors

| Error | Frequency | Severity | Root Cause |
|---|---|---|---|
| `Manifest: Line: 1, column: 1, Syntax error` for `/manifest.webmanifest` | Every page load | Critical | Auth proxy serves HTML login page instead of manifest JSON |
| No other application-level JS errors | — | — | Clean |

---

## 10. 404 / Unknown Route Handling

| Test | Result | Details |
|---|---|---|
| `/nonexistent-page-xyz` (unauthenticated) | MINOR ISSUE | Returns `200` with redirect to login instead of `404`. User sees login page with no indication the route doesn't exist. |

---

## Bugs Found

### BUG-001: `manifest.webmanifest` blocked by auth proxy [CRITICAL]

- **Page:** Every page
- **Symptom:** Console error `Manifest: Line: 1, column: 1, Syntax error` on every page load
- **Root cause:** The proxy matcher in `src/proxy.ts` does not exclude `.webmanifest` files. Requests to `/manifest.webmanifest` pass through the auth proxy, which returns the HTML login page instead of the JSON manifest.
- **Impact:** PWA "Add to Home Screen" install prompt is completely broken. The browser cannot parse the manifest, so the app cannot be installed as a standalone PWA on any device.
- **File:** `src/proxy.ts:10`
- **Current matcher:**
  ```
  /((?!_next/static|_next/image|favicon.ico|\.well-known/|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)/
  ```
- **Fix:** Add `manifest\\.webmanifest` to the exclusion list in the matcher regex.

---

### BUG-002: `sw.js` blocked by auth proxy [CRITICAL]

- **Page:** Every page
- **Symptom:** `/sw.js` returns `text/html` (the login page) instead of JavaScript
- **Root cause:** Same as BUG-001. The `.js` extension is not in the proxy matcher exclusion list.
- **Impact:** Service worker cannot register. Web push notifications will not work for new visitors. Offline/caching capabilities are broken.
- **File:** `src/proxy.ts:10`
- **Fix:** Add `sw\\.js` to the exclusion list in the matcher regex.

---

### BUG-003: No 404 page for unknown routes [MINOR]

- **Page:** Any non-existent path (e.g. `/nonexistent-page-xyz`)
- **Symptom:** Unknown routes return `200` and redirect to `/login` (for unauthenticated users) instead of returning a `404` status.
- **Impact:** Low. Unauthenticated users just see the login page. Authenticated users hitting a bad URL likely see a blank or error page with no "page not found" message. Search engines may index non-existent URLs.
- **Fix:** Add a custom `not-found.tsx` page in `src/app/` to handle 404s properly.

## Fix Checklist

> Developer: check off each item once resolved and verified in production.

- [ ] **BUG-001** — Add `manifest.webmanifest` to proxy matcher exclusion so the PWA manifest loads correctly
- [ ] **BUG-002** — Add `sw.js` to proxy matcher exclusion so the service worker registers correctly
- [ ] **BUG-003** — Add a custom `not-found.tsx` in `src/app/` for proper 404 handling
- [ ] **Verify** — After deploying fixes, confirm `/manifest.webmanifest` returns valid JSON with `application/manifest+json` content-type
- [ ] **Verify** — After deploying fixes, confirm `/sw.js` returns valid JavaScript with `application/javascript` content-type
- [ ] **Verify** — After deploying fixes, confirm browser console has zero manifest errors
- [ ] **Verify** — After deploying fixes, test "Add to Home Screen" on Android Chrome and iOS Safari

---

## Authenticated Testing — School Admin (`school_admin`)

**User:** Sam Principal (`abhishek@mindmaplabs.in`)
**Role:** `school_admin` at Test School
**Login method:** Password via `/login/team`

---

### 11. Login Flow (School Admin)

| Test | Result | Details |
|---|---|---|
| Login via `/login/team` with valid credentials | PASS | Redirected to `/` after successful login |
| Session persists across navigation | PASS | User stays authenticated across all pages |

---

### 12. Home Page (Authenticated)

| Check | Result | Notes |
|---|---|---|
| User name displayed | PASS | "Sam Principal" |
| Email displayed | PASS | `abhishek@mindmaplabs.in` |
| Role displayed | PASS | "School admin" |
| Notification bell with unread count | PASS | Shows badge with "6" |
| Role-appropriate action cards | PASS | "Open requests" and "Monthly calendar" — no admin links |
| Sign out button present | PASS | |

---

### 13. Requests Section (`/requests`)

#### 13.1 Request List

| Check | Result | Notes |
|---|---|---|
| Page loads with heading + subtitle | PASS | "Requests — Everything in flight for your school." |
| "+ Raise" button visible | PASS | Links to `/requests/new` |
| Stats cards displayed | PASS | Published (30d): 3, Avg days to publish: 0, Waiting on you: 1 |
| "Needs you" section | PASS | Shows 1 request awaiting design review |
| "In flight" section | PASS | Shows 7 requests in various statuses (Approved, Draft, Changes requested) |
| "Published" section | PASS | Shows 3 published requests |
| Status badges display correctly | PASS | Draft, Approved, Changes requested, Design review, Published all render |

#### 13.2 Request Detail (`/requests/[id]`)

| Check | Result | Notes |
|---|---|---|
| Back link "← All requests" | PASS | Returns to `/requests` |
| Title and status badge | PASS | "Teacher orientation" — "Design ready for review" |
| Metadata line (creator, school, date, designer) | PASS | "Tara Teacher · Test School · May 22, 8:48 AM · Designer: Dev Designer" |
| "From the school" uploads section | PASS | Shows 4 uploaded images with file sizes |
| "Designs" section with versions | PASS | Shows v1, v2, v3 with timestamps |
| Activity timeline | PASS | 5 events in chronological order |
| Action buttons (Approve design / Request changes / Archive) | PASS | Appropriate actions for "design review" status |

#### 13.3 Create Request (`/requests/new`)

| Check | Result | Notes |
|---|---|---|
| Form loads with correct fields | PASS | Title (required), Notes (optional), File upload (optional) |
| Empty submit blocked | PASS | HTML5 validation prevents empty title — but no visible error message |
| Valid submission creates request | PASS | Created "QA Test Request - Automated Testing" |
| Auto-approval for school admin | PASS | Request skips `pending_admin_approval` → goes straight to `approved` |
| Redirects to new request detail | PASS | Shows new request with "APPROVED — WITH DESIGN TEAM" status |
| Activity log records auto-approval | PASS | "Sam Principal approved the request" |

#### 13.4 Edit Request

| Test | Result | Notes |
|---|---|---|
| Edit page for approved request | PASS | Redirects back to detail — editing disabled after approval (correct behavior) |

#### 13.5 Archive Request

| Test | Result | Notes |
|---|---|---|
| Archive button works | PASS | Request moves to "Archived" section, redirects to `/requests` |
| Archived request visible in list | PASS | Shows under "Archived (1)" with "Archived" badge |

---

### 14. Calendar Section (`/calendar`)

| Check | Result | Notes |
|---|---|---|
| Monthly calendar grid renders | PASS | Full month view with Sun–Sat headers |
| Current month heading | PASS | "May 2026" |
| Today highlighted | PASS | May 22 has visual indicator |
| Navigation arrows (← →) | PASS | Previous/next month links work |
| "Today" button | PASS | Returns to current month |
| Calendar events display | PASS | "Founder's day annou..." on May 20 |
| Color legend | PASS | Drafted / Approved / Published |
| Month navigation works | PASS | Navigated to April 2026 successfully |

#### 14.1 Calendar Item Detail (`/calendar/[id]`)

| Check | Result | Notes |
|---|---|---|
| Back link "← Back to calendar" | PASS | Returns to calendar with school context |
| Title and status badge | PASS | "Founder's day announcment" — "Published" |
| Date and metadata | PASS | "Wednesday, May 20, 2026 · Test School · drafted by Dev Designer" |
| Description displayed | PASS | "it was good" |
| Linked pipeline request | PASS | Shows "Founder's day announcment — Published" with link to request |

---

### 15. Published Feed (`/feed`)

| Check | Result | Notes |
|---|---|---|
| Page loads with heading | PASS | "Published — Latest 3 published." |
| Published items listed | PASS | Festival, Founder's day announcment, Anual sports day reports |
| Each item shows school + date | PASS | "Test School · May 21, 2026" |
| Description displayed | PASS | |
| Platform links (Instagram) | PASS | "View on Instagram →" links to Google Drive assets |
| "Open request →" link | PASS | Links back to original request |
| Design thumbnails shown where available | PASS | Third item shows design image |

---

### 16. Notifications (`/notifications`)

| Check | Result | Notes |
|---|---|---|
| Page loads with heading + unread count | PASS | "Notifications — 6 unread" |
| "Mark all read" button | PASS | Present in top-right |
| Push toggle ("Enable" button) | PASS | "Push on this device" section with description |
| Email preference radio buttons | PASS | Daily digest / Immediate / Off — "Immediate" currently selected |
| Email preference Save button | PASS | |
| "Pending your approval" section | PASS | 2 items with checkboxes, pre-selected |
| Bulk actions (Approve selected / Send back selected) | PASS | Both buttons present with helper text |
| "Unread" section with count | PASS | 6 unread notifications with orange dot indicators |
| "Earlier" section | PASS | 6 older notifications |
| Relative timestamps | PASS | "41m ago", "51m ago", "1h ago", "1d ago" |
| Notification types differentiated | PASS | "Request needs approval", "Design ready to review", "Published" with star icon |

---

### 17. Role-Based Access Control — Admin Routes

| Route | Expected | Actual | Result |
|---|---|---|---|
| `/admin` | Reject (not super_admin) | Redirected to `/` | PASS |
| `/admin/users` | Reject | Redirected to `/` | PASS |
| `/admin/pipeline` | Reject | Redirected to `/` | PASS |
| `/admin/schools` | Reject | Redirected to `/` | PASS |

**Note:** Redirect is silent — no "Access denied" message. User lands on home page without explanation.

---

## Authenticated Testing — Teacher (`teacher`)

**User:** Tara Teacher (`teacher@test.local`)
**Role:** `teacher` at Test School
**Login method:** Password via `/login/team`

---

### 18. Login Flow (Teacher)

| Test | Result | Details |
|---|---|---|
| Login via `/login/team` with valid credentials | PASS | Redirected to `/` after successful login |
| Sign out from previous session (school admin) | PASS | Redirected to `/login` cleanly |

---

### 19. Home Page (Teacher)

| Check | Result | Notes |
|---|---|---|
| User name displayed | PASS | "Tara Teacher" |
| Email displayed | PASS | `teacher@test.local` |
| Role displayed | PASS | "Teacher" |
| Notification bell with unread count | PASS | Shows badge with "1" |
| Role-appropriate messaging | PASS | "Raise a request — your school admin gives the OK." |
| Action card | PASS | "Open requests → Raise a new one or check your drafts." |
| No calendar card on home page | PASS | Only "Open requests" shown (differs from school admin who also sees calendar) |
| Sign out button present | PASS | |

---

### 20. Requests Section — Teacher View (`/requests`)

#### 20.1 Request List

| Check | Result | Notes |
|---|---|---|
| Page loads | PASS | |
| "+ Raise" button visible | PASS | |
| "My drafts" section visible | PASS | Shows 2 drafts — this section is not shown for school_admin |
| "In flight" section | PASS | Shows all school requests regardless of creator |
| "Published" section | PASS | Shows 3 published requests |
| "Archived" section | PASS | Shows archived requests |
| Can see requests created by other users (school admin) | PASS | School admin's requests visible in the list |

#### 20.2 Create Request (Teacher Draft Flow)

| Step | Result | Notes |
|---|---|---|
| Form subtitle differs from admin | PASS | "Saves as a draft. Submit when ready — your school admin gives the OK." (vs admin's "Goes straight to the design team.") |
| Create request with title + notes | PASS | Created "QA Teacher Test Request" |
| Request starts as DRAFT | PASS | Status badge: "DRAFT" — correct (unlike admin's auto-approved) |
| Actions on draft: Edit, Submit for approval, Archive | PASS | All three buttons present |
| No activity log on fresh draft | PASS | Activity section empty — nothing happened yet |

#### 20.3 Edit Draft

| Test | Result | Notes |
|---|---|---|
| Edit page loads with pre-filled data | PASS | Title and notes pre-populated |
| Attachments section visible | PASS | "Attachments (0)" with file upload |
| Update title and save | PASS | Title changed to "QA Teacher Test Request (Edited)" |
| Redirects to detail after save | PASS | Shows updated title, still in Draft status |

#### 20.4 Submit for Approval

| Test | Result | Notes |
|---|---|---|
| "Submit for approval" button works | PASS | Status changes from "DRAFT" → "AWAITING YOUR APPROVAL" |
| Activity log updated | PASS | "Tara Teacher submitted for approval — May 22, 10:11 AM" |
| Edit button removed after submit | PASS | Can no longer edit once submitted |
| Archive still available | PASS | Teacher can still archive their own submitted request |

#### 20.5 View Other Users' Requests

| Test | Result | Notes |
|---|---|---|
| Can view school admin's request detail | PASS | Shows "Test" by Sam Principal with full details |
| No action buttons on others' requests | PASS | No Edit, Approve, or Archive — view-only (correct) |

---

### 21. Access Control — Teacher Boundaries

| Test | Result | Notes |
|---|---|---|
| `/admin` | PASS | Redirected to `/` |
| `/admin/users` | PASS | Redirected to `/` |
| No approve/reject buttons on design review requests | PASS | Teacher can view "Teacher orientation" (design review) but has no Approve/Request changes buttons |
| Can archive own requests | PASS | Archive button present on own requests |
| Cannot archive others' requests | PASS | No Archive button on Sam Principal's requests |
| "Remove" buttons visible on own uploads | OBSERVED | Teacher sees "Remove" on their own uploads — needs verification if this works correctly on non-draft requests |

---

### 22. Calendar, Feed, Notifications (Teacher)

#### Calendar

| Check | Result | Notes |
|---|---|---|
| Calendar loads | PASS | Same monthly view as school admin |
| Same events visible | PASS | School-scoped — sees same school's calendar |

#### Feed

| Check | Result | Notes |
|---|---|---|
| Feed loads | PASS | Same 3 published items as school admin |

#### Notifications

| Check | Result | Notes |
|---|---|---|
| Page loads with correct unread count | PASS | "1 unread" |
| Push toggle available | PASS | "Enable" button present |
| Email preference | PASS | Set to "Daily digest" (different from school admin's "Immediate") |
| No "Pending your approval" section | PASS | Teachers can't approve — section correctly hidden |
| Unread notification | PASS | "Your draft was sent back: random" — Sam Principal · 1h ago |
| Earlier notifications | PASS | "Your draft was sent back: Test push" + "Your request is live: Festival" |
| Notification types appropriate for role | PASS | Teacher sees draft-sent-back and published notifications, not approval requests |

---

## Authenticated Testing — Designer (`designer`)

**User:** Dev Designer (`designer@test.local`)
**Role:** `designer` at Test School
**Login method:** Password via `/login/team`

---

### 23. Login Flow (Designer)

| Test | Result | Details |
|---|---|---|
| Login via `/login/team` with valid credentials | PASS | Redirected to `/` after successful login |
| Sign out from previous session (teacher) | PASS | Redirected to `/login` cleanly |

---

### 24. Home Page (Designer)

| Check | Result | Notes |
|---|---|---|
| User name displayed | PASS | "Dev Designer" |
| Email displayed | PASS | `designer@test.local` |
| Role displayed | PASS | "Designer" |
| Notification bell with unread count | PASS | Shows badge with "9" |
| Role-appropriate messaging | PASS | "Pick up approved requests, design, publish — all from the queue." |
| Action cards | PASS | "Open requests" + "Monthly calendar" (same as school admin, different from teacher) |
| No "+ Raise" on home page | PASS | Designers don't create requests |
| Sign out button present | PASS | |

---

### 25. Requests Section — Designer View (`/requests`)

#### 25.1 Request List

| Check | Result | Notes |
|---|---|---|
| Page loads | PASS | |
| No "+ Raise" button | PASS | Designers can't create requests |
| No stats cards | PASS | Unlike school admin's dashboard-style view |
| "Needs you (6)" section | PASS | Shows approved requests ready to pick up + changes-requested ones |
| "In flight (1)" section | PASS | Shows "Teacher orientation" in Design review |
| "Published (3)" section | PASS | |
| "Archived (2)" section | PASS | Shows test requests archived during earlier testing |

#### 25.2 Pick Up Request

| Step | Result | Notes |
|---|---|---|
| "Pick this up" button on approved request | PASS | Visible on "test 1" (approved) detail page |
| Pick up action works | PASS | Status changes from "Approved" → "IN DESIGN" |
| Metadata updated | PASS | Shows "Designer: Dev Designer" after pick up |
| Upload design form appears | PASS | Notes field + file chooser + "Upload design" button |
| Activity log preserved | PASS | Original approval event still visible |

#### 25.3 Design Review View (Designer Perspective)

| Check | Result | Notes |
|---|---|---|
| Can view request in "Design ready for review" | PASS | "Teacher orientation" with full details |
| School uploads visible | PASS | 4 photos with file sizes |
| Own design versions visible | PASS | v1, v2, v3 with timestamps |
| "Remove" buttons on own designs | PASS | Can manage uploaded designs |
| No "Approve" or "Request changes" buttons | PASS | Waiting for school admin — correct |
| No school upload "Remove" buttons | PASS | Designer can't remove school's uploads (unlike teacher who saw Remove on own uploads) |

#### 25.4 Create Request (Designer)

| Test | Result | Notes |
|---|---|---|
| Navigate to `/requests/new` | PASS | Redirected to `/requests` — designers can't create requests |

---

### 26. Access Control — Designer Boundaries

| Test | Result | Notes |
|---|---|---|
| `/admin` | PASS | Redirected to `/` |
| `/requests/new` | PASS | Redirected to `/requests` |
| No approve/reject buttons on any request | PASS | Designer never sees approval actions |
| "Pick this up" only on approved requests | PASS | Not shown on drafts, design review, or published |

---

### 27. Calendar, Feed, Notifications (Designer)

#### Calendar

| Check | Result | Notes |
|---|---|---|
| Calendar loads | PASS | Same monthly view |
| "+ Plan an item" button visible | PASS | Designers can plan calendar items (different from teacher/school admin views) |

#### Feed

| Check | Result | Notes |
|---|---|---|
| Feed accessible | PASS | Via nav bar "Published" link |

#### Notifications

| Check | Result | Notes |
|---|---|---|
| Page loads with correct unread count | PASS | "9 unread" |
| Push toggle available | PASS | "Enable" button present |
| Email preference | PASS | Set to "Daily digest" |
| No "Pending your approval" section | PASS | Designers can't approve — section correctly hidden |
| Notification types appropriate for role | PASS | "New request to design", "Changes requested on", "Design approved, ready to publish" |
| No school-side notifications | PASS | No "Request needs approval" or "Your draft was sent back" types |

---

## Authenticated Testing — Decision Maker (`decision_maker`)

**User:** Vince Viewer (`viewer@test.local`)
**Role:** `decision_maker` at Test School
**Login method:** Password via `/login/team`

---

### 28. Login & Home Page (Decision Maker)

| Check | Result | Notes |
|---|---|---|
| Login via `/login/team` | PASS | Redirected to `/` |
| User name displayed | PASS | "Vince Viewer" |
| Role displayed | PASS | "Decision maker" |
| Notification bell | PASS | Present, no unread badge (0 notifications) |
| Role-appropriate messaging | PASS | "See the month's plan and every post that's gone live for your school." |
| Action cards | PASS | "Monthly calendar" + "Published posts" — **no requests link** |
| No requests-related actions | PASS | Decision makers only review published output |

---

### 29. Access Control — Decision Maker Boundaries

| Route | Expected | Actual | Result |
|---|---|---|---|
| `/requests` | Reject | Redirected to `/feed` | PASS |
| `/requests/new` | Reject | Redirected to `/feed` | PASS |
| `/requests/[id]` (specific request) | Reject | Redirected to `/feed` | PASS |
| `/admin` | Reject | Redirected to `/` | PASS |
| `/calendar` | Allow | Calendar loads | PASS |
| `/feed` | Allow | Feed loads | PASS |
| `/notifications` | Allow | Notifications load | PASS |

---

### 30. Calendar (Decision Maker)

| Check | Result | Notes |
|---|---|---|
| Calendar loads | PASS | Same monthly view |
| No "+ Plan an item" button | PASS | Only designers can plan items |
| Calendar legend | PASS | Only "Approved" and "Published" — no "Drafted" (decision makers don't see drafts) |

---

### 31. Feed (Decision Maker)

| Check | Result | Notes |
|---|---|---|
| Feed loads | PASS | Shows 3 published items |
| Role-specific subtitle | PASS | "Everything that's gone out for your school." (vs "Latest 3 published." for other roles) |

---

### 32. Notifications (Decision Maker)

| Check | Result | Notes |
|---|---|---|
| "You are all caught up" message | PASS | Clean empty state when no unread |
| Push toggle | PASS | "Enable" button present |
| Email preference | PASS | "Daily digest" selected |
| No "Pending your approval" section | PASS | Decision makers don't approve |
| "← Back" links to `/feed` | PASS | Not `/requests` — appropriate for this role |
| Earlier notifications | PASS | 1 notification: "Published: Festival" — only sees publish events |

---

## Authenticated Testing — Super Admin (`super_admin`)

**User:** abhi2004rise@gmail.com
**Role:** `super_admin`
**Login method:** Password via `/login/team`

---

### 33. Login & Home Page (Super Admin)

| Check | Result | Notes |
|---|---|---|
| Login via `/login/team` | PASS | Redirected to `/` |
| Name displayed | PASS | Shows email as name (no `full_name` set in profile) |
| Role displayed | PASS | "Super admin" |
| Notification bell | PASS | Present, no unread |
| Role-appropriate messaging | PASS | "Manage schools and users, or jump into the request board." |
| Action cards | PASS | "Open requests" (cross-client), "Monthly calendar" (cross-school), **"Manage agency"** (unique to super_admin) |

**Minor UX note:** Name displays as email (`abhi2004rise@gmail.com`) because `full_name` is not set in this user's profile. Should set a proper name.

---

### 34. Admin Section — Agency Dashboard (`/admin`)

| Check | Result | Notes |
|---|---|---|
| Dashboard loads | PASS | "Agency dashboard" heading with subtitle |
| Pipeline action card | PASS | "Every school's work, grouped by where it's stuck." |
| Stats cards | PASS | 1 Schools, 8 Users — clickable links |
| Sidebar navigation | PASS | Pipeline / Schools / Users links with active state |
| "← Back to app" link | PASS | Returns to home page |

#### 34.1 Pipeline (`/admin/pipeline`)

| Check | Result | Notes |
|---|---|---|
| Kanban board renders | PASS | 5 columns: Pending approval (0), Queued for designer (4), In design (2), Awaiting design review (1), Published (3) |
| Stats cards | PASS | 7 In flight, 3 Published (30d), 0 Avg days to publish |
| School filter dropdown | PASS | "All schools" / "Test School" options with Filter button |
| Requests clickable | PASS | Each card links to the request detail |
| Status badges and timestamps | PASS | Correct status labels with relative dates |

#### 34.2 Schools (`/admin/schools`)

| Check | Result | Notes |
|---|---|---|
| School list loads | PASS | "1 client." with Test School listed |
| "Add school" form | PASS | Text input + "Add school" button |
| "Manage →" link | PASS | Links to school detail page |

#### 34.3 School Detail (`/admin/schools/[id]`)

| Check | Result | Notes |
|---|---|---|
| School name + rename form | PASS | Pre-filled text input with Save button |
| Members list (6) | PASS | Shows name, email, role for each member |
| Remove buttons on members | PASS | Each member has a Remove button |
| Add member dropdown | PASS | Shows unassigned users with "Add member" button |
| Danger zone | PASS | "Delete school" button with FK restriction warning |

#### 34.4 Users (`/admin/users`)

| Check | Result | Notes |
|---|---|---|
| User table (8 users) | PASS | Name, email, role dropdown for each |
| Role dropdowns editable | PASS | Can change roles for all users except self |
| Own role disabled | PASS | Super admin's dropdown is disabled with "(you)" label |
| Invite form | PASS | Full name, email, role radio buttons (5 roles), "Send invite" button |
| All 5 roles available | PASS | Designer, Super admin, School admin, Teacher, Decision maker |

---

### 35. Requests — Super Admin View

| Check | Result | Notes |
|---|---|---|
| Request list loads | PASS | Shows all requests across schools |
| "Needs you (5)" section | PASS | Sees both approved (can pick up) and design review (can approve) |
| No "+ Raise" button visible | OBSERVED | Not visible on list — but super_admin can create requests per code |
| "Approve design" + "Request changes" on design review | PASS | Full school admin powers on design review requests |
| "Pick this up" on approved requests | PASS | Full designer powers on approved requests |
| "Archive" on all requests | PASS | Can archive any request |
| Cross-school visibility | PASS | Sees requests from all schools (only Test School exists currently) |

---

### 36. Calendar, Feed, Notifications (Super Admin)

#### Calendar

| Check | Result | Notes |
|---|---|---|
| Calendar loads | PASS | Same monthly view |
| "+ Plan an item" button | PASS | Like designer — can plan calendar items |
| Full legend | PASS | Drafted / Approved / Published (not restricted like decision maker) |

#### Feed

| Check | Result | Notes |
|---|---|---|
| Feed accessible | PASS | Via nav bar "Published" link |

#### Notifications

| Check | Result | Notes |
|---|---|---|
| Page loads | PASS | "You are all caught up" — no notifications yet for this user |
| Empty state | PASS | "Nothing yet. When something needs your attention you will see it here." |
| "← Back" links to `/requests` | PASS | Appropriate for admin role |
| Push toggle + email prefs | PASS | Available |

---

## Cross-Role End-to-End Test — Full Request Lifecycle (EKAM School)

This test validates the complete request lifecycle across multiple roles and a freshly created school.

### E2E Setup: School + Members

| Step | Action | Result | Notes |
|---|---|---|---|
| Create school | Super admin creates "EKAM" at `/admin/schools` | PASS | School appears in list, count updates to "2 clients" |
| Invite school admin | Super admin invites "EKAM Principal" (ekam-admin@test.local) as School admin for EKAM | PARTIAL | User created in Supabase, but invite email blocked by Resend sandbox. Error: *"You can only send testing emails to your own email address"* |
| Add teacher to EKAM | Super admin adds Tara Teacher as member via school detail | PASS | Members count: 2 |
| Add designer to EKAM | Super admin adds Dev Designer as member via school detail | PASS | Members count: 3 |

### E2E Step 1: Teacher Creates Request

| Step | Action | Result | Notes |
|---|---|---|---|
| Login as teacher | `teacher@test.local` via `/login/team` | PASS | |
| School picker on form | Form shows dropdown since teacher belongs to 2 schools | PASS | EKAM pre-selected, Test School also available |
| Create request | "EKAM Annual Day Poster" with description | PASS | Status: DRAFT, School: EKAM |
| Submit for approval | Click "Submit for approval" | PASS | Status: AWAITING YOUR APPROVAL |
| Activity log | "Tara Teacher submitted for approval" | PASS | Timestamped |

### E2E Step 2: Super Admin Approves Request

| Step | Action | Result | Notes |
|---|---|---|---|
| Login as super_admin | `abhi2004rise@gmail.com` via `/login/team` | PASS | |
| View EKAM request | Navigate to request detail | PASS | Shows Approve / Send back / Archive buttons |
| Approve request | Click "Approve" | PASS | Status: APPROVED — WITH DESIGN TEAM |
| Activity log | "Someone approved the request" | PASS | Shows "Someone" — see BUG-007 below |

### E2E Step 3: Designer Picks Up + Uploads Design

| Step | Action | Result | Notes |
|---|---|---|---|
| Login as designer | `designer@test.local` via `/login/team` | PASS | Notification count increased to 10 |
| View EKAM request | "EKAM Annual Day Poster" — Approved status | PASS | "Pick this up" button visible |
| Pick up request | Click "Pick this up" | PASS | Status: IN DESIGN, Designer: Dev Designer |
| Upload form appears | Notes field + file chooser + Upload design button | PASS | |
| Upload design file | Set test PNG via file input | PASS | File uploaded, status auto-advances to DESIGN READY FOR REVIEW |
| Design version | Shows v1 with timestamp and notes | PASS | "First draft of EKAM Annual Day poster - QA test upload" |
| Activity log | "Dev Designer uploaded a design" | PASS | |

### E2E Step 4: Super Admin Approves Design

| Step | Action | Result | Notes |
|---|---|---|---|
| Login as super_admin | `abhi2004rise@gmail.com` | PASS | |
| View request | Status: Design ready for review | PASS | Shows Approve design / Request changes / Archive |
| Approve design | Click "Approve design" | PASS | Status: IN DESIGN (ready for publish) |
| Activity log | "Someone approved the design" | PASS | 4 events now in timeline |

### E2E Step 5: Designer Publishes

| Step | Action | Result | Notes |
|---|---|---|---|
| Login as designer | `designer@test.local` | PASS | Notification count: 11 |
| View request | Status: In design, publish form visible | PASS | Platform dropdown + URL input + "Mark published" |
| Select platform | Instagram | PASS | 6 options: Facebook, Instagram, LinkedIn, Twitter/X, YouTube, Other |
| Enter URL | `https://www.instagram.com/p/ekam-annual-day-2026` | PASS | |
| Publish | Click "Mark published" | PASS | Status: PUBLISHED |
| Live links section | Instagram link displayed with timestamp | PASS | Clickable link |
| Activity log | 5 events: submitted → approved → design uploaded → design approved → published | PASS | Complete audit trail |

### E2E Step 6: Verify in Feed

| Check | Result | Notes |
|---|---|---|
| Published feed shows EKAM request | PASS | First item: "EKAM · May 22, 2026 — EKAM Annual Day Poster" |
| Description visible | PASS | Full description text |
| Instagram link | PASS | "View on Instagram →" with correct URL |
| "Open request →" link | PASS | Links back to request detail |
| Feed count updated | PASS | "Latest 4 published." (was 3 before) |

### E2E Bugs Found During Lifecycle Test

See BUG-007 in the bugs section below.

---

## Status Label Audit

All status labels are defined as static strings in `src/app/requests/status.ts` and rendered identically regardless of which role is viewing. This causes confusion when the label uses words like "your" or implies the viewer is the actor.

### Full label matrix (detail page view)

| Status | Current Label | Viewer: Teacher | Viewer: School Admin | Viewer: Designer | Problem? |
|---|---|---|---|---|---|
| `draft` | "Draft" | Correct | Correct | N/A | No |
| `pending_admin_approval` | **"Awaiting your approval"** | **WRONG** — teacher can't approve | Correct for admin | N/A | **YES — BUG-008** |
| `approved` | **"Approved — with design team"** | OK | **Misleading** when admin self-created | OK | **YES — BUG-003** (already logged) |
| `in_design` | "In design" | OK | OK | OK | No |
| `design_pending_approval` | "Design ready for review" | OK | OK | OK | No |
| `changes_requested` | "Changes requested" | OK | OK | OK (but no details — **BUG-009**) | No label issue |
| `published` | "Published" | OK | OK | OK | No |
| `archived` | "Archived" | OK | OK | OK | No |

### List view labels (`STATUS_SHORT`)

| Status | Short Label | Problem? |
|---|---|---|
| `pending_admin_approval` | "Pending approval" | OK — neutral wording, fine for all roles |
| All others | Same as or shortened from full label | OK |

**Key finding:** The **detail page** labels are the problem (not list view). Only `pending_admin_approval` and `approved` have misleading full labels.

---

## Bugs Found (Updated)

### BUG-001: `manifest.webmanifest` blocked by auth proxy [CRITICAL]

- **Page:** Every page
- **Symptom:** Console error `Manifest: Line: 1, column: 1, Syntax error` on every page load
- **Root cause:** The proxy matcher in `src/proxy.ts` does not exclude `.webmanifest` files. Requests to `/manifest.webmanifest` pass through the auth proxy, which returns the HTML login page instead of the JSON manifest.
- **Impact:** PWA "Add to Home Screen" install prompt is completely broken. The browser cannot parse the manifest, so the app cannot be installed as a standalone PWA on any device.
- **File:** `src/proxy.ts:10`
- **Fix:** Add `manifest\\.webmanifest` to the exclusion list in the matcher regex.

---

### BUG-002: `sw.js` blocked by auth proxy [CRITICAL]

- **Page:** Every page
- **Symptom:** `/sw.js` returns `text/html` (the login page) instead of JavaScript
- **Root cause:** Same as BUG-001. The `.js` extension is not in the proxy matcher exclusion list.
- **Impact:** Service worker cannot register. Web push notifications will not work for new visitors. Offline/caching capabilities are broken.
- **File:** `src/proxy.ts:10`
- **Fix:** Add `sw\\.js` to the exclusion list in the matcher regex.

---

### BUG-003: Confusing status label for admin-created requests [MINOR/UX]

- **Page:** `/requests/[id]` (for requests created by `school_admin` or `super_admin`)
- **Symptom:** When a school admin creates a request, the status badge shows **"APPROVED — WITH DESIGN TEAM"** and the activity log says **"Sam Principal approved the request"**. Since admin/super_admin requests don't require approval (by design), this label is misleading — it implies an approval step happened when none did. The admin simply raised a request.
- **Root cause:** The request is inserted with `status: "approved"` (correct behavior), but the UI label for the `approved` status doesn't distinguish between "explicitly approved by admin" vs "created directly by admin". The same label is shown in both cases.
- **Impact:** UX confusion. School admins may wonder why their request shows "Approved" when they never approved anything. Other stakeholders reviewing the activity log may think an explicit approval took place.
- **Recommendation:** When a request is created directly by a school_admin/super_admin (i.e. `created_by === approved_by` and both timestamps are identical), show a more appropriate label such as:
  - "Forwarded to design team"
  - "Awaiting design team"
  - "Sent to design team"
  
  And update the activity log entry from "Sam Principal approved the request" to something like "Sam Principal raised the request" or "Sam Principal sent to design team".

---

### BUG-004: No 404 page for unknown routes [MINOR]

- **Page:** Any non-existent path (e.g. `/nonexistent-page-xyz`)
- **Symptom:** Unknown routes return `200` and redirect to `/login` (for unauthenticated users) instead of returning a `404` status.
- **Impact:** Low. Unauthenticated users just see the login page. Authenticated users hitting a bad URL likely see a blank or error page with no "page not found" message. Search engines may index non-existent URLs.
- **Fix:** Add a custom `not-found.tsx` page in `src/app/` to handle 404s properly.

---

### BUG-005: No visible error on empty request form submission [MINOR]

- **Page:** `/requests/new`
- **Symptom:** Clicking "Save" with an empty title field does not show a visible error. The browser's HTML5 validation fires (focus moves to the field), but there is no styled inline error message.
- **Impact:** Low. The form is technically blocked from submitting, but users on some mobile browsers may not see the native validation tooltip.
- **Fix:** Add a visible inline error message below the title field when validation fails (e.g., "Title is required").

---

### BUG-006: Admin route rejection has no feedback [MINOR]

- **Page:** `/admin`, `/admin/users`, `/admin/pipeline`, `/admin/schools`
- **Symptom:** Non-admin users (e.g., school_admin) are silently redirected to `/` with no "Access denied" or "Unauthorized" message.
- **Impact:** Low. Users may be confused about why they landed on the home page. Not a security issue — access is correctly blocked.
- **Fix:** Either show a brief toast/flash message ("You don't have access to that page"), or return a 403 page.

---

### BUG-007: Activity log shows "Someone" when actor has no full_name [MINOR/UX]

- **Page:** Any request detail where super_admin performed an action
- **Symptom:** Activity log entries show **"Someone approved the request"** and **"Someone approved the design"** instead of the actor's name or email.
- **Root cause:** The super_admin user (`abhi2004rise@gmail.com`) has no `full_name` set in their profile. The activity log rendering falls back to "Someone" when the name is missing.
- **Impact:** Confusing audit trail — stakeholders can't tell who performed the action.
- **Fix:** Fall back to the user's email address instead of "Someone" when `full_name` is null/empty.

---

### BUG-008: "Awaiting your approval" shown to non-approvers [MEDIUM/UX]

- **Page:** `/requests/[id]` when status is `pending_admin_approval`
- **Symptom:** When a teacher submits a request and then views it, the status badge reads **"AWAITING YOUR APPROVAL"**. The teacher cannot approve — only school admins can. The word "your" implies the viewer is the one who needs to act, which is wrong for teachers, designers, and decision makers.
- **Root cause:** `STATUS_LABELS` in `src/app/requests/status.ts:5` uses a static string `"Awaiting your approval"` for all viewers. The label is not role-aware.
- **Impact:** Medium. Teachers see a confusing call-to-action that they can't fulfill.
- **Recommendation:** Make the label role-aware:
  - For `school_admin` / `super_admin`: keep "Awaiting your approval"
  - For `teacher` (the creator): "Submitted — awaiting admin approval"
  - For `designer`: "Pending approval" (neutral)

---

### BUG-009: "Request changes" and "Send back" have no feedback text field [MEDIUM/UX]

- **Page:** `/requests/[id]` — "Request changes" button (design review) and "Send back for changes" button (request approval)
- **Symptom:** When a school admin clicks **"Request changes"** on a design, or **"Send back for changes"** on a pending request, the action fires immediately with **no way to explain what needs changing**. The designer/teacher receives a notification saying "changes requested" but has zero context about what was wrong.
- **Verified live:** On the "Teacher orientation" request, the activity log shows **"Sam Principal requested design changes"** appearing twice (9:07 AM and 10:56 AM) — both entries have no feedback text. The designer only sees the status change to "CHANGES REQUESTED" and an upload form for a revision, but has no information about what specifically needs to be fixed.
- **Root cause:** Both action forms in `src/app/requests/[id]/page.tsx` (lines 580-589 and 613-622) only pass a hidden `id` field. There is no textarea for feedback. The server actions `requestDesignChanges` and `sendBackForChanges` in `src/app/requests/actions.ts` only update the status — they don't accept or store any feedback text.
- **Impact:** Medium. Designers must guess what needs changing, or resort to WhatsApp/external channels — which is exactly the untracked communication this app was built to replace. This breaks the core value proposition of the app.
- **Recommendation:** 
  1. Add a required textarea before each "send back" action with a placeholder like "What should be changed?"
  2. Store the feedback text as a comment/note attached to the activity log entry (may require a `notes` or `comment` column on a notifications/activity table)
  3. Display the feedback inline in the activity timeline: *"Sam Principal requested design changes: 'Please use the correct school logo and fix the event date'"*
  4. Include the feedback text in the push/email notification sent to the designer/teacher

---

### BUG-010: All destructive actions fire without confirmation [MEDIUM/UX]

- **Pages:** Multiple
- **Symptom:** The following destructive actions execute immediately on button click with no confirmation dialog or undo:
  - **Archive request** (`/requests/[id]`) — single click archives, redirects to list. File: `page.tsx:624-634`
  - **Delete school** (`/admin/schools/[id]`) — single click deletes school and all member assignments. File: `page.tsx:176-184`
  - **Remove member** (`/admin/schools/[id]`) — single click removes member from school. File: `page.tsx:147-156`
  - **Remove upload** (`/requests/[id]`) — single click deletes uploaded file from Supabase Storage permanently. File: `page.tsx:358-374`
  - **Remove design** (`/requests/[id]`) — single click deletes design version from storage permanently. File: `page.tsx:410-426`
- **Impact:** Medium. Accidental clicks cause data loss. "Delete school" is particularly dangerous. Files deleted from Supabase Storage are unrecoverable.
- **Recommendation:** Add `window.confirm("Are you sure?")` as a minimum, or a proper confirmation modal. "Delete school" should require typing the school name to confirm.

---

### BUG-011: Stale notifications persist after request state changes [MINOR/UX]

- **Page:** `/notifications`
- **Symptom:** When a request is archived (or its status changes), old notifications about that request remain in the inbox unchanged. Example: a notification reads "Request needs approval: QA Teacher Test Request" but clicking it navigates to an **Archived** request — the notification is outdated and misleading.
- **Verified live:** Clicked "Request needs approval: QA Teacher Test Request (Edited)" notification as school admin — navigated to the request which was already Archived. The notification gave no hint that the request was no longer actionable.
- **Impact:** Low. Users may click stale notifications expecting to take action, only to find the request in a different state.
- **Recommendation:** Either (a) mark related notifications as read/dismissed when a request is archived, or (b) show the current request status badge on the notification item.

---

## Suggested Fix for BUG-001 + BUG-002

In `src/proxy.ts`, update line 10:

```typescript
// Before
"/((?!_next/static|_next/image|favicon.ico|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"

// After
"/((?!_next/static|_next/image|favicon.ico|\\.well-known/|manifest\\.webmanifest|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
```

---

## Fix Checklist

> Developer: check off each item once resolved and verified in production.

### Critical

- [ ] **BUG-001** — Add `manifest.webmanifest` to proxy matcher exclusion so the PWA manifest loads correctly
- [ ] **BUG-002** — Add `sw.js` to proxy matcher exclusion so the service worker registers correctly

### Medium

- [ ] **BUG-008** — Make `pending_admin_approval` status label role-aware ("Awaiting your approval" only for admins, "Submitted — awaiting admin approval" for teacher)
- [ ] **BUG-009** — Add feedback text field to "Request changes" and "Send back for changes" actions, show feedback in activity log and notifications
- [ ] **BUG-010** — Add confirmation dialogs for all destructive actions (archive, delete school, remove member, remove upload, remove design)

### Minor

- [ ] **BUG-003** — Show a distinct status label (e.g. "Sent to design team") for admin-created requests instead of "Approved — with design team"
- [ ] **BUG-004** — Add a custom `not-found.tsx` in `src/app/` for proper 404 handling
- [ ] **BUG-005** — Add visible inline validation error on empty request title at `/requests/new`
- [ ] **BUG-006** — Show feedback (toast or 403 page) when non-admin users hit admin routes
- [ ] **BUG-007** — Activity log shows "Someone" when actor has no `full_name` — fall back to email instead
- [ ] **BUG-011** — Stale notifications persist after request state changes — mark as read or show current status

### Post-Fix Verification

- [ ] Confirm `/manifest.webmanifest` returns valid JSON with `application/manifest+json` content-type
- [ ] Confirm `/sw.js` returns valid JavaScript with `application/javascript` content-type
- [ ] Confirm browser console has zero manifest errors on all pages
- [ ] Test "Add to Home Screen" on Android Chrome and iOS Safari
- [ ] Confirm push notification toggle works after service worker fix

---

## UX Suggestions — Role-by-Role Review

These are not bugs — they are improvement suggestions based on walking through the app as each real user would. Organized by who benefits most.

---

### Teacher Perspective

*"I'm a teacher. I need to send a poster request to the design team. This should be easier than sending a WhatsApp message."*

| # | Suggestion | Why it matters | Priority |
|---|---|---|---|
| S-01 | **Show a progress tracker / timeline visualization on each request** | The teacher submits a request and then has no visual sense of where it is in the pipeline. A simple step indicator (Submitted → Approved → In Design → Review → Published) would replace the need to decode status badges. | High |
| S-02 | **Teacher can't see what changes were requested on their request** | When status shows "Changes requested", the teacher sees the label but has zero context about *what* the admin didn't like (ties to BUG-009). The teacher created the request — they should know what's going on. | High |
| S-03 | **No way to comment / reply on a request** | The entire app replaces WhatsApp, but there's no threaded conversation. If the admin sends back a request, the teacher can't respond "I'll fix the photo tomorrow" without going back to WhatsApp. A simple comment thread per request would close this loop. | High |
| S-04 | **Teacher's home page has no quick summary** | Home page says "Raise a request" but doesn't show counts like "2 drafts, 1 awaiting approval, 3 published". The school admin gets stats cards — the teacher should too. | Medium |
| S-05 | **No notification when request is approved** | When the school admin approves a teacher's request, the teacher doesn't appear to get a notification. They only find out by checking the request list. "Your request was approved: [title]" would be helpful. | Medium |
| S-06 | **No way to see the published link from the request list** | The teacher has to click into a published request to find the live Instagram/social link. A small link icon on the list card would save taps. | Low |
| S-07 | **Teacher sees other users' requests they can't act on** | In the "In flight" section, the teacher sees admin-created requests (like "Test", "hj") with no actions available. This is informational but may be confusing — consider grouping "My requests" vs "Other school requests". | Low |

---

### School Admin Perspective

*"I'm the school principal. I need to approve requests quickly and see what's published for my school. Every tap counts."*

| # | Suggestion | Why it matters | Priority |
|---|---|---|---|
| S-08 | **Bulk approve requests from the request list** | The admin has to click into each request individually to approve it. When 5 requests are pending, that's 5 click-in + 5 approve + 5 back navigations. The notification page has bulk approve for designs — extend this to the request list. | High |
| S-09 | **No count of "pending your approval" on request list** | The admin sees "Needs you (1)" in the request list but no separate count for "pending admin approval" vs "design review". Splitting these would help prioritize. The notifications page does split them — the request list should too. | Medium |
| S-10 | **Quick approve from notification without opening request** | The notification page had a "Pending your approval" section with checkboxes for batch design approvals during earlier testing. This should also support request approvals (pending_admin_approval), not just design reviews. | Medium |
| S-11 | **No dashboard / analytics for the school admin** | The school admin gets 3 stats cards (Published 30d, Avg days to publish, Waiting on you) which is good, but no trend view. A simple "This week vs last week" or "Monthly output" chart would help justify the tool to the principal. | Low |

---

### Designer Perspective

*"I'm a designer. I need to see my queue, pick up work, upload designs, and publish — fast."*

| # | Suggestion | Why it matters | Priority |
|---|---|---|---|
| S-13 | **No filter or sort on the request queue** | The designer sees "Needs you (6)" as a flat list. When there are 20+ approved requests across multiple schools, they need to filter by school, sort by date, or see oldest-first to prioritize. | High |
| S-14 | **No way to see only "my assigned" requests** | Once a designer picks up a request, it moves to "In flight". But if they're working on 5 requests across 2 schools, there's no "My work" view — they have to scan the whole list. | High |
| S-15 | **"Changes requested" gives no context (ties to BUG-009)** | The designer sees "Changes requested" status and gets the upload form, but has NO idea what to change. The activity log says "Sam Principal requested design changes" with no detail. This is the single biggest workflow friction point. | Critical |
| S-16 | **No drag-and-drop for design uploads** | The upload form requires clicking "Choose File" which opens the OS file picker. Drag-and-drop onto the request card would be much faster for designers who work from Finder/Explorer. | Medium |
| S-17 | **Can't preview design before uploading** | After selecting a file, there's no preview — it uploads immediately. If the designer picks the wrong file, they have to upload and then remove + re-upload. A preview + confirm step would prevent mistakes. | Medium |
| S-18 | **No way to see the school's brief inline while uploading** | When uploading a design, the designer has to scroll up to see the school's photos and description. On mobile, the brief and upload form are far apart. Keeping the brief visible (or collapsible) near the upload form would help. | Low |

---

### Decision Maker Perspective

*"I'm the principal. I just want to see what content went out for my school. Keep it simple."*

| # | Suggestion | Why it matters | Priority |
|---|---|---|---|
| S-19 | **No way to see the design before it was published** | The decision maker sees the published links (Instagram, etc.) but can't see the actual design image that was posted. The design versions are only visible on the request detail page, which decision makers can't access. The feed should show the final design thumbnail. | Medium |
| S-20 | **No way to give feedback on published content** | The decision maker's whole purpose is to review output, but there's no way to say "this looks great" or "the logo was wrong". A simple thumbs up/down or comment on published posts would make their role meaningful beyond passive viewing. | Medium |

---

### Super Admin Perspective

*"I manage the agency. I need to see bottlenecks, manage client relationships, and keep things moving."*

| # | Suggestion | Why it matters | Priority |
|---|---|---|---|
| S-21 | **Pipeline has no aging / SLA indicators** | The pipeline board shows requests by status but doesn't flag requests that have been stuck too long. A red highlight for "approved but unclaimed for 3+ days" or "design review pending for 2+ days" would surface bottlenecks. | High |
| S-22 | **No way to reassign a request to a different designer** | If a designer is overloaded or leaves, there's no way to reassign their in-progress work to another designer. The only option would be manual database intervention. | Medium |
| S-23 | **User invite fails silently when Resend is in sandbox** | During E2E testing, inviting a user showed the Resend sandbox error *after* clicking send. The user was created in Supabase but can't sign in because the invite email never arrived. The error message is confusing — it should clearly say "User created but email not sent — configure Resend domain to enable invites." | Medium |
| S-24 | **No school-level activity log or analytics** | The admin can see the pipeline, but there's no per-school view of "how fast are we serving this client" or "which school has the most pending work". This would help in client conversations. | Low |

---

### Cross-Role Suggestions

| # | Suggestion | Why it matters | Priority |
|---|---|---|---|
| S-25 | **Add a comment/chat thread to each request** | This is the #1 missing feature. The entire app replaces WhatsApp, but when someone needs to say "Can you use the blue version of the logo?" or "I'll upload the photo tomorrow", they have no channel inside the app. They go back to WhatsApp. A per-request comment thread visible to all stakeholders would close this gap entirely. | Critical |
| S-26 | **Add a request type / category field** | Requests are just "title + description". Adding a type (Social post, Poster, Newsletter, Video) would help designers prioritize and help admins filter the pipeline. | Medium |
| S-27 | **Add a due date / deadline field to requests** | There's no urgency indicator. A teacher can't say "I need this by Friday". Adding a due date would enable pipeline sorting by deadline and overdue alerts. | Medium |
| S-28 | **Show a visual progress bar on the request list cards** | Each card in the list shows a status badge, but a thin colored progress bar (like GitHub PR checks) would give an at-a-glance sense of how far along each request is. | Low |
| S-29 | **Search / filter across requests** | No search functionality exists. When there are 50+ requests, finding a specific one requires scrolling through the entire list. Add a search bar and status filter dropdown. | Medium |
| S-30 | **Dark mode toggle** | The app has dark mode CSS classes in the codebase but no user-facing toggle. Users on dark-mode devices would benefit. | Low |

---

## Tests Not Yet Covered

The following areas need testing in future sessions with other user roles:

### ~~Requires `designer` login~~ — COMPLETED (see sections 23-27)
- [x] Designer home page and role-specific actions
- [x] Designer request queue — claim a request
- [ ] Upload design flow (`/requests/[id]` upload form) — form visible but file upload not tested (requires real file)
- [ ] Publish request with URL — not tested (requires request in `in_design` status with approved design)
- [x] Designer access to admin routes (should be blocked)

### ~~Requires `teacher` login~~ — COMPLETED (see sections 18-22)
- [x] Teacher home page and role-specific actions
- [x] Teacher request creation and draft submission
- [x] Teacher cannot approve requests (school_admin only)
- [x] Teacher access to admin routes (should be blocked)

### ~~Requires `super_admin` login~~ — COMPLETED (see sections 33-36)
- [x] Admin dashboard (`/admin`)
- [x] School management — create, view, add members (`/admin/schools`)
- [x] User management — invite, list, change roles (`/admin/users`)
- [x] Pipeline view — all requests across all schools (`/admin/pipeline`)

### ~~Cross-role flows~~ — COMPLETED (see E2E section above)
- [x] Teacher creates request → admin approves → designer claims → designer uploads → admin reviews → designer publishes
- [x] Multi-school membership (teacher in 2 schools, school picker on request form)
- [x] Super admin creates school, invites user, adds members
- [x] File upload flow (design upload via file input)
- [x] Publish flow with platform URL
- [ ] Quick-approve from email link (POST `/api/quick-approve` with valid token) — requires valid token
- [ ] Logout flow and session cleanup — tested implicitly (8 sign-out/sign-in cycles during E2E)
- [ ] Session expiry handling
- [ ] Concurrent edits / race conditions

### Mobile-specific
- [ ] Full authenticated flow on mobile viewport (375 x 812)
- [ ] PWA install flow (after BUG-001/002 are fixed)
- [ ] Push notification permission prompt and delivery

---

*Report generated by automated Playwright testing on 2026-05-22.*
*Covers: unauthenticated flows, all 5 user roles, admin CRUD, full cross-role E2E lifecycle, and status label audit.*
*11 bugs documented (2 critical, 3 medium, 6 minor). 29 UX suggestions across all roles. All core workflows verified.*
