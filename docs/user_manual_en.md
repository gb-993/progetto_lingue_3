# PCM-Hub — User manual

Practical guide to using the **PCM-Hub** website (`hub.parametricomparison.unimore.it`). This manual is for daily users: linguists who compile their assigned languages, and administrators who manage parameters, questions, accounts and cross-language analyses.

> **You'll find what you need faster** if you know your role:
> - **Linguist (User)** → read sections 1-7 and jump straight to §7 (Compiling a language).
> - **Administrator (Admin)** → read everything: admins see all User functionality plus a dozen extra tools (sections 8-15).

---

## Table of contents

1. [What is PCM-Hub](#1-what-is-pcm-hub)
2. [Logging in](#2-logging-in)
3. [Getting around: sidebar, topbar, breadcrumb](#3-getting-around-sidebar-topbar-breadcrumb)
4. [The Dashboard](#4-the-dashboard)
5. [Shared pages: Glossary, Instructions, How to cite, My Account](#5-shared-pages)
6. [The Languages page](#6-the-languages-page)
7. [Compiling a language (linguist or admin)](#7-compiling-a-language)
8. [ADMIN ONLY — Parameters](#8-admin-only--parameters)
9. [ADMIN ONLY — Questions](#9-admin-only--questions)
10. [ADMIN ONLY — Motivations](#10-admin-only--motivations)
11. [ADMIN ONLY — Taxonomy](#11-admin-only--taxonomy)
12. [ADMIN ONLY — Accounts](#12-admin-only--accounts)
13. [ADMIN ONLY — Table A](#13-admin-only--table-a)
14. [ADMIN ONLY — Filters (Queries Q1–Q10)](#14-admin-only--filters-queries-q1q10)
15. [ADMIN ONLY — History & Backups, Migration, Backup Restore, Import Excel, Recompute](#15-admin-only--history-backups-import-recompute)
16. [Common errors and what to do](#16-common-errors-and-what-to-do)
17. [Quick interface glossary](#17-quick-interface-glossary)

---

## 1. What is PCM-Hub

The **Parametric Comparison Method** (PCM, Longobardi & Guardiano 2009) compares different languages using a set of **universal syntactic parameters**. Every language is "compiled" by a linguist who, for each parameter, answers a set of questions (mostly yes/no) and provides linguistic examples to support the answers.

From the data collected, the website automatically produces:

- consolidated parameter values for each language (`+`, `−`, `0`, `?`);
- comparative matrices across languages;
- Hamming, Jaccard and geographic distances;
- dendrograms and cluster maps;
- PCA analyses, Mantel tests.

This makes it possible to study phylogenetic relationships, divergences and convergences across languages from different families.

### The three roles

| Role | What they can do |
|---|---|
| **Public** (visitor, not logged in) | sees only the home page with the interactive map and the How to cite page |
| **User** (assigned linguist) | compiles their assigned languages, accesses glossary, instructions, language list, personal dashboard |
| **Admin** | everything a User does, plus: parameters/questions/motivations/taxonomy management, account creation, TableA, queries Q1-Q10, history/backup, migration, recompute |

---

## 2. Logging in

### First access

The administrator who created your account will give you:

- the **email** of your account;
- a **temporary password** (at least 8 characters).

Go to the site URL → click **Login** from the home page (or go straight to `/login`) → enter the credentials → **Log in**.

On your first login **we recommend changing your password**: top-right click **MyAccount** → **Change password**.

### Changing the password

From the **My Account** page you have two blocks:

- **Profile**: name, surname, email (if you change the email it becomes the new login credential).
- **Change password**: requires the current password + the new one twice. Minimum 8 characters.

### Forgot the password?

For now **email reset is not yet active** (it requires the SMTP integration from Unimore IT services). In the meantime: contact an administrator, who can reassign you a temporary password by creating a new account or intervening from the panel.

### Session expired

The access token lasts **30 minutes of inactivity**. After that, protected pages will automatically send you back to the login. Nothing is broken, just log in again.

### Failed-login limit

For security: **after 5 failed login attempts from the same connection within 1 minute**, the system replies with a "Too Many Requests" error for a few seconds. Wait a moment and retry.

---

## 3. Getting around: sidebar, topbar, breadcrumb

Once logged in, the interface has 3 fixed elements:

### Sidebar (left)

All the main pages. The visible items depend on your role:

| Item | User | Admin |
|---|---|---|
| Dashboard | ✓ | ✓ |
| Citation Guidelines | ✓ | ✓ |
| Languages | ✓ | ✓ |
| Parameters | — | ✓ |
| Parameters Graph | — | ✓ |
| Questions | — | ✓ |
| Motivations | — | ✓ |
| Taxonomy | — | ✓ |
| Table A | — | ✓ |
| Filters | — | ✓ |
| Accounts | — | ✓ |
| History & Backups | — | ✓ |
| Migration Import | — | ✓ (red = dangerous) |
| Backup Restore | — | ✓ |
| Instructions | ✓ | ✓ |
| Glossary | ✓ | ✓ |

The **button at the top of the sidebar** collapses/expands it (useful to gain horizontal space, especially in TableA). The preference is remembered.

### Topbar (top)

- **Breadcrumb** on the left: shows the page path (e.g. `Dashboard / Languages / Italian / Data`). Items in **blue** are clickable; items in **grey** are informational only (e.g. dynamic IDs).
- **MyAccount** on the right: shortcut to the profile page.
- **Theme toggle (Light/Dark)**: switches the visual theme. The preference is remembered too.
- **Logout**: ends the session and brings you back to the public home.

### Footer

At the bottom of every page:

- PCM-Hub citation (CC BY 4.0);
- links to Privacy Policy, Disclaimer, lab contact email (`pcm_lab@unimore.it`);
- link to the institutional PCM Unimore project website;
- **Role badge** (bottom right): tells you whether you are "Admin Access", "User Access" or "Public View".

---

## 4. The Dashboard

It's the first page you see after login.

### User dashboard

Shows **the languages assigned to you**. For each language:

- ID and full name (e.g. `ITA — Italian`);
- **status** (`Pending`, `Waiting`, `Approved`, `Rejected`);
- **progress bar** (number of answers given / total questions, percentage);
- **Fill in** button (or **View rejection and reopen** if the language was rejected) leading to the compilation page.

If the language is `Rejected`, below you'll also see the **admin's note** explaining why it was rejected.

### Admin dashboard

3+1 card layout:

- **Waiting for Approval**: count of languages awaiting review + quick links to open them.
- **Languages by Status**: clickable counters `Pending / Waiting / Approved / Rejected`. Clicking a counter expands a panel listing the languages in that status.
- **Flagged/Unsure Parameters**: count of "red" parameters (partial compilation or marked Unsure) grouped by language, with totals.
- **Latest Changes** (right): table with the most recent parameter changes (who, when, what, note).

From here an admin can quickly open languages that need attention.

---

## 5. Shared pages

### Glossary (`/glossary`)

Alphabetical list of technical terms used in the project, with descriptions.

- All users can **search** (search field at the top).
- Admin only: **Add term**, **Edit** and **Delete** buttons on rows.

### Instructions (`/instructions`)

Editable HTML document (powered by TinyMCE) with the compilation guidelines. The default version includes:

- general rules (read → identify → answer YES/NO → save → submit);
- specific instructions for **linguistic glosses** with a symbol table (ACC, NOM, GEN, etc.);
- glossing examples.

Admin only: **Edit** button at top right → WYSIWYG editor with formatting, tables, raw HTML. **Save** persists the document for everyone.

### How to cite (`/how-to-cite`)

Two cards:

- **Parameters & Manifestations**: how to cite the PCM Hub parameters/questions (recommended for User and Admin).
- **Database** (linguistic data): how to cite the linguistic data collected.

Below each card there is a **Copy** button that copies the full citation to the system clipboard.

Admin only: **Edit** button opens the TinyMCE editor for the citation text.

### My Account (`/me`)

- **Profile**: name, surname, email. **Save** writes directly to your profile.
- **Change password**: old password + new one twice. Minimum 8 characters. If the two new copies don't match, the system rejects.

⚠ If you change the email, the **new email becomes your login credential**. Memorize it well (or use a password manager).

---

## 6. The Languages page

The list of all the languages in the project. **Above** the table there is an **interactive map** (OpenStreetMap) with a pin for each georeferenced language.

### Filters (sticky at the top)

- **Search** global text (ID, name, family, top family, group, status, rejection note).
- **Top Family / Subfamily / Group**: hierarchical multi-select. Choosing a top-family narrows the available subfamilies, and so on.
- **Historical**: all / only historical / only non-historical.
- **Status**: any / Pending / Waiting / Approved / Rejected.

To the right of the filters: counter "X of Y languages", and the buttons:

- **Reset**: clears filters.
- **Clear exclusions** (appears if you've manually excluded languages).
- **Download Data ▾** (admin): opens a menu to export data for the **currently filtered, non-excluded** languages:
    - **Export language metadata (.xlsx)** — ID, name, family, coordinates, etc.
    - **Export backup (.zip)** — full bundle with all answers and examples for the selected languages (async job: a toast at the bottom-right shows progress).
    - **Map (.png)** — the current map as an image.
    - **Geographic distances (.txt)** — GCD km matrix between the selected languages.
- **+ Full Languages Backup** (admin): creates a DB-side snapshot of **all** languages (asks for an optional note). You'll find it later under History & Backups → Full backups.
- **Recompute final values** (admin): re-runs the implicational DAG for **all** languages. Async job with progress bar. Use after important changes to implicational conditions, or after an import.
- **Import from Excel** (admin): structured import page.
- **Add Language** (admin): create a new language manually.

### The table

- **Left checkbox**: toggle "include / exclude" of the language from the effective set (map, distances, exports). Ticking the header excludes/includes all visible languages.
- **ID, Name, Status, Top family, Subfamily, Group**.
- **Actions**:
    - **Data**: opens the compilation page (regular users and admins).
    - **Duplicate** (admin): duplicates the language with all answers and examples (useful as a template).
    - **Debug** (admin): opens a page showing `init`/`final` values of every parameter for the language, with the option to **Apply implicational condition(s)** (re-runs the DAG on this single language).
    - **Edit** (admin): edits the language metadata (name, coordinates, family, etc.).

### Notes on the map

Markers are colored by **top-family**. The legend below the map lists every top-family with its color: hovering a label dims the others (useful to visually isolate a family).

---

## 7. Compiling a language

This is the **heart of the site**: where a linguist enters and answers the questions for a language. You get here from:

- Dashboard → click on an assigned language;
- Languages → row → **Data** button.

The URL is `/languages/<id>/data`.

### Language header

At the top you see:

- **Name and ID** of the language;
- **Export parametric data (.xlsx)** button (admin) or **Export examples (.xlsx)** (user) to download an Excel with the data you've entered;
- a grid with the language **metadata** (top-family, family, group, ISO/Glottocode, coordinates, supervisor, informant, source, etc.). Only admins also see the assigned user.

### Status banner (below the header)

Shows the current status of the language, a short description and the available workflow buttons. The 4 possible statuses:

| Status | Meaning | What you can do (assigned User) |
|---|---|---|
| **Pending** | Being compiled, editable | write/edit freely; when done click **Submit for approval** |
| **Waiting for approval** | Submitted, awaiting admin review | the form is **locked**, you have to wait. The admin will receive the language in their Dashboard widget |
| **Approved** | Approved, frozen | the form is **locked** read-only. The language joins the official dataset. |
| **Rejected** | Rejected, needs revision | read the admin's note, click **Reopen** to put the language back into `Pending` and resume editing |

⚠ **Admins instead** can always edit regardless of status (they see a purple "Admin override" banner indicating this). Admins also have a **Change Status ▾** dropdown that lets them force the language to any status (Approve/Reject/Pending/Waiting), bypassing the normal workflow.

### Parameter wizard (the squares)

Below the status banner there is a **row of small squares**, one per active parameter. Clicking a square jumps to **that parameter's question block**.

Squares are colored by progress:

- **Grey (empty)** — no answers yet.
- **Yellow (in progress)** — some questions answered but not all, or parameter marked as "Unsure".
- **Green (complete)** — every question has a valid answer (`yes` or `no`; `unsure` does not count as completed).

Tip: use the colors as a visual to-do list. All green = ready to submit.

### A parameter's block

When you click a square you see:

- header with **ID and name** of the parameter, plus a `short_description`;
- (admin only) collapsible **Admin notes** area where the admin can write a free-text note for this (language, parameter) pair. The note is not visible to Users and is not exported.
- **one card per question** in the parameter;
- at the bottom-right a **floating ("sticky") toolbar** with two save buttons: **Confident → Next** (green) and **Unsure → Next** (red). See below.

### Questions

Each question shows:

- a header with the **ID and text** of the question;
- a **More info** button (if there is help text, expandable);
- **Instructions**: general instruction, always visible;
- **Example YES**: an illustrative example, always visible (decorative only, you don't fill it);
- **Instructions (YES)** or **Instructions (NO)**: specific instructions, shown only after you select the corresponding answer;
- **Answer** (dropdown): `— select —`, `YES`, `NO`, `UNSURE`. This is your answer.

Depending on the chosen answer, the card expands differently:

#### You selected **NO**

The **Motivations** section appears: a list of checkboxes with predefined reasons why this question is "No" for this language (e.g. "no corresponding structure", "marginal phenomenon"). Tick one or more. If the question has no associated motivations, you'll see an italic message.

#### You selected **YES** or **UNSURE**

The **Examples** block appears: here you must enter **at least 2 linguistic examples** illustrating the answer. For each example:

- **Example text**: the sentence in the language (e.g. *Mario ha letto il libro nuovo che gli ho consigliato*);
- **Transliteration**: transliteration if needed (e.g. for non-Latin alphabets);
- **Gloss**: morpheme-by-morpheme gloss (e.g. *book.M.SG.NOM*);
- **English Translation**: English translation;
- **Reference**: source (e.g. *Hauser, M. 1992. p. 12*).

Useful buttons:

- **+ Add another example**: adds a fresh empty card for a new example.
- **Remove**: deletes an example.
- **Copy**: copies the example to the **internal clipboard** (see below).
- **+ Import example from another answer...**: server-side search through examples already written for other questions/languages. Find the example (by text / translation / gloss), click it, and it gets **copied as a new example** in this question. **The imported example is an independent copy**: you can edit it freely without affecting the original.

⚠ **Important rule**: if you answer YES or UNSURE, you **must** provide **at least 2 non-empty examples**. If you try to save with fewer than 2, the system blocks the save with a warning and **highlights** the offending card in red. Same constraint applies to UNSURE.

#### Comments

At the bottom of each card there is a **Comments** field (free text) for unstructured notes/explanations/doubts.

### Example clipboard

Handy utility to avoid retyping the same example in multiple questions of the same language:

1. In any example card, click **Copy** at the top-right → the example goes into the internal clipboard (a red dashed banner appears below your current examples).
2. Move to another question of the same language → you'll see the same banner.
3. Click **Paste here** → the example is added as a **new** example in this question. The clipboard stays full so you can paste into more questions in a row.
4. **Clear** on the banner empties the clipboard.

⚠ The clipboard is **language-specific**. If you switch to a different language, the clipboard is automatically cleared to avoid carrying around an "orphan" example.

### Saving a parameter block

At the bottom-right of the current block you see a **floating (sticky) toolbar** with two buttons:

| Button | When to use it |
|---|---|
| **Confident → Next** (green) | Data is complete and verified. The parameter square turns green. |
| **Unsure → Next** (red) | You have doubts and want to save for later review. The parameter square stays yellow (flagged). |

Both buttons **save all data of the current block** (answers + examples + motivations + comments + admin note if you're an admin) and then **automatically advance to the next parameter**.

If the save succeeds: no special feedback, you find yourself on the next parameter.

If the save fails, it can be one of these reasons:

- **400 missing examples**: you put YES or UNSURE on a question with fewer than 2 examples → an alert pops up and the offending card flashes red for a few seconds.
- **409 stale block**: meanwhile someone else (usually an admin) modified the same block. The system warns you and automatically reloads the page so you can review the other person's changes before retrying.
- **Network error**: generic alert, retry later.

### Switching parameter without saving

If you've changed something and click another square without saving, the site **asks for confirmation** before discarding the current block's changes. Same if you close the tab or navigate away via breadcrumb: automatic protection.

### Submit / Reopen / workflow

Once all the parameters you cared about are compiled, **and** the status is `Pending` or `Rejected`:

- **Submit for approval**: the language goes to `Waiting for approval`. The form **locks** and the admin receives the language in their dashboard.

When the status is `Rejected`:

- **Reopen**: the language goes back to `Pending` (after reading the rejection note). You can resume editing.

Remember: an admin can force the language status at any time and in any direction (see §9 of [documentation_en.md](docs/documentation_en.md) for the full workflow).

### What an admin sees in addition

Beyond the purple "Admin override" banner and the **Change Status ▾** dropdown, an admin opening a language has:

- **Apply implicational condition(s)** (link at the top): opens the **Debug** page showing all init/final parameter values for the language, with the option to re-run the DAG just for this language.
- **Admin notes** inside each parameter block: free-text note for (language, parameter). It is not exported and not visible to Users.

---

## 8. ADMIN ONLY — Parameters

Page: **Sidebar > Parameters** (`/admin/parameters`).

### Parameter list

Table with: ID, name, position, schema, type, level of comparison, counters `questions_count` (regular questions) and `stop_count` (stop questions), active/inactive status.

At the top: search field, **Add parameter** button, **Export PDF (all)** (generates a PDF with all parameters).

Drag & drop to reorder parameters (`position` is saved automatically).

### Edit parameter

Click a row → edit page with:

- ID (read-only, cannot be changed after creation);
- Name, position, schema, type, level of comparison;
- **Short description** (shown during compilation);
- **Long description** (shown in PDFs);
- **Implicational condition**: string with syntax like `+SPK & -DEM` (see §8.1);
- **Description of the implicational condition**: textual description;
- **Active**: active/inactive toggle (an inactive parameter is not offered for compilation and does not show in TableA);
- **Change note** (mandatory): why are you making this change. Goes to History.

To the left of the form you also see:

- the list of the parameter's **questions** with reorder drag & drop, and the option to open the question edit drawer directly from here;
- the history of **change notes** (ParameterChangeLog) with author and date.

### Deactivating a parameter

**Deactivate** button: asks for confirmation + the **current admin's password** (safeguard). Once deactivated, the parameter is no longer offered for compilation and doesn't contribute to TableA / DAG / exports. Historical answers remain in the DB.

### Implicational condition (notes)

The target parameter is "comparable" only if its `implicational_condition` is satisfied by the cited "ref" parameters.

- `+P` means: parameter `P` has value `+` for the language;
- `-P`: value `-`;
- `0P`: value `0` (neutralized);
- `&` = AND, `|` = OR, `~` = NOT, `( )` = grouping.

Example: `+SPK & -DEM` means "parameter SPK is `+` AND parameter DEM is `-`". If false, the target parameter is forced to `0` (with warning).

The condition is **syntactically validated** at save time: if malformed, the system rejects with an error message. If it cites non-existent or inactive parameters, it is **silently ignored** by the DAG (but the save goes through).

### Parameters Graph (`/admin/parameters/graph`)

Visualization of the **implicational DAG graph** in an interactive diagram. Useful to understand which parameters depend on which. Each node is a parameter, edges go from `ref → target`.

---

## 9. ADMIN ONLY — Questions

Page: **Sidebar > Questions** (`/admin/questions`).

### Question list

All questions in the system (across all parameters). Filters by parameter, template_type, active/inactive, stop question. "Stop" questions are those that close a parameter's block.

### Edit/Add question

To create a question, you must first choose its **parent parameter** (ID).

Main fields:

- **ID** (e.g. `FGM_01`, convention `<param_id>_<NN>`);
- **Text**: the question text shown to the linguist;
- **Template type**: classifies the question (useful for statistical filters);
- **Instruction** (always visible during compilation);
- **Instruction YES** (visible only if the answer is YES or UNSURE);
- **Instruction NO** (visible only if the answer is NO);
- **Example YES**: an illustrative example always visible to the linguist as reference;
- **Help info**: long text shown behind a "More info" button;
- **Is stop question**: tick if it closes the parameter;
- **Active**: tick to make it available for compilation;
- **Allowed motivations**: list of motivations selectable by the linguist when answering NO. Only the motivations ticked here appear in the compilation checkbox.

### Destructive changes: the archive

⚠ Modifying a question can **invalidate** answers already given. Typical examples:

- changing `template_type` from `boolean` to something else;
- deleting the question;
- removing motivations from the "allowed" list.

In these cases, the system **does not lose** the data: it automatically moves the related `Answer`/`Example`/`AnswerMotivation` to the **question archive** ([History → Old questions archive](#15-admin-only--history-backups-import-recompute)). They remain readable read-only there, with a snapshot of the question as it was before the change.

---

## 10. ADMIN ONLY — Motivations

Page: **Sidebar > Motivations** (`/admin/motivations`).

The **motivations** are the predefined reasons a linguist can tick when answering NO to a question. Example: "no corresponding structure", "marginal phenomenon", "phonetically reduced".

### List

Each motivation has:

- **Code**: unique identifier (e.g. `NO_STRUCT`);
- **Label**: the text shown to the linguist (can be long, multiline).

### Edits

Standard CRUD. Motivations are never fully "deleted": if used by some answer, their snapshot stays in the archive.

Motivations are **linked to questions** from the [Questions](#9-admin-only--questions) page (field **Allowed motivations**), not from here.

---

## 11. ADMIN ONLY — Taxonomy

Page: **Sidebar > Taxonomy** (`/admin/taxonomy`).

Editor of the **language family hierarchy**:

```
Top Family (e.g. Indo-European)
└── Family / Subfamily (e.g. Romance)
    └── Group (e.g. Italian-Romance)
```

Drag & drop across levels to reorder. Click a name to edit, "+" to add a child, trash to delete.

⚠ The three strings `top_level_family`, `family`, `grp` on Languages are **denormalized**: they're copied from the taxonomy at language save time. Editing the taxonomy **does not** automatically rename the strings on existing languages — you have to reopen and re-save the language to propagate the change.

---

## 12. ADMIN ONLY — Accounts

Page: **Sidebar > Accounts** (`/admin/accounts`).

### Account list

Table with: email, name, surname, role (`admin/user/public`), number of assigned languages.

Buttons:

- **Add account** (`/admin/accounts/add`): create a new account.
- **Assign languages** on the row: opens a panel to select the language pool to assign to a user (multi-select).
- **Delete** on the row.

### Add account

Form with: name, surname, email, temporary password (min 8 chars), **role** (dropdown: User / Admin / Public).

After creation, share the credentials with the user; on first login they should change the password.

⚠ Email validation: the system rejects with "Invalid email format" if the email is malformed (e.g. missing `.it`, double `@`, spaces). This prevents creating accounts that then can't log in.

### Safeguards

- **You cannot delete yourself** (have another admin do it).
- **You cannot delete the last admin** (the site would be left without an administrator).

### Reassigning languages

The **Assign languages** action **replaces** the current pool: if a user had 3 languages assigned and you tick only the other 2 keeping them in the new 5, the original 3 go back to "unassigned" (assignable to another user).

---

## 13. ADMIN ONLY — Table A

Page: **Sidebar > Table A** (`/tablea`).

**TableA** is the project's flagship matrix: **one language per column, one parameter (or question) per row**, with the consolidated value in each cell (`+`, `−`, `0`, `?`).

### Modes

- **Params** (default): rows = parameters.
- **Questions**: rows = individual questions.

Toggle at the top.

### Filters

- **Languages**: top family / family / group / historical / specific (per-language checkboxes in the lower section);
- **Parameters**: schema, type, level of comparison;
- **Questions**: template, stop question (visible only in Questions mode).

After choosing filters, click **Apply** (or equivalent) to recompute the matrix.

### Manual selection

Beyond filters, **each table row** has a checkbox: lets you further restrict the analysis to a subset of parameters/questions.

### Exports and analyses

**Download / Analysis ▾** dropdown at the top:

- **XLSX (parameters)** — Excel with citation header.
- **CSV (transposed)** — standard analytical format.
- **Distance matrices (.txt)** — Hamming and Jaccard matrices.
- **Geographic distances (.zip)** — GCD km matrix.
- **Dendrograms (.png)** — UPGMA dendrograms.
- **Cluster map (.html)** — interactive HTML map of geographic clusters.
- **PCA (.png)** — principal components analysis.
- **Mantel test (.zip)** — modal with three checkboxes (GCD, Hamming, Jaccard) to choose which matrices to correlate. Output: correlation tables + plots.

⚠ Distances and clusters are meaningful only on sufficiently large and homogeneous sets. Languages without coordinates are excluded from geographic distances and the export's `X-Skipped-Languages` header lists them.

---

## 14. ADMIN ONLY — Filters (Queries Q1–Q10)

Page: **Sidebar > Filters** (`/queries`).

10 predefined views to query the database in a focused way. Menu on the left (collapsible), main area on the right.

| Query | Question |
|---|---|
| **Q1** | Show implicational condition(s) (per parameter) |
| **Q2** | Show parameter values for all languages (per parameter) |
| **Q3** | Show **why** a parameter is neutralized (per language) ⭐ |
| **Q4** | Parameters with value `+` (per language) |
| **Q5** | Parameters with value `−` (per language) |
| **Q6** | Parameters with value `0` (per language) |
| **Q7** | Comparable parameters (per pair of languages) |
| **Q8** | Questions with answer YES (per language) |
| **Q9** | Questions with answer NO (per language) |
| **Q10** | Show answers and examples (per question) |

### Q3 — the richest

It's the **DAG debug view**: pick a language and a neutralized parameter, and you get:

- the parameter's implicational condition;
- for each `ref` cited in the condition, what its value is (`value_eval` if present, else `value_orig`);
- whether the condition is satisfied or not;
- the list of linguist Answers that contributed to each ref's `value_orig`.

Useful to understand **why** a particular parameter is not being compared in a particular language.

### Q10 — answers and examples

Q10 has 2 optional filters (language + parameter) to **restrict the dropdown of available questions**. Leaving them empty, the dropdown shows all the ~N hundreds of system questions.

---

## 15. ADMIN ONLY — History, Backups, Migration, Backup Restore, Import Excel, Recompute

Everything related to **audit, snapshots, mass import/export**.

### History & Backups (`/admin/history`)

4 tabs:

- **Change history** — table of **all changes** to system entities (parameter, question, motivation, language). Filters by: type, ID, operation (create/update/delete), source (manual / excel_import / system), user, date, free text. Each row opens a drawer with the **before/after diff**.
- **Answer changes** — same format, focused on `Answer` modifications (every save of a parameter block produces an entry here).
- **Full backups (languages & parameters)** — list of **complete snapshots** grouped by timestamp:
    - "languages" backups are created from [Languages → + Full Languages Backup](#6-the-languages-page);
    - "parameters" backups are created from [Parameters → Backup current state](#8-admin-only--parameters);
    - clicking a row opens the snapshot detail (language by language, parameter by parameter) with the option to download an Excel with all the data.
- **Old questions archive** — archived questions (see §9). For each archived question: snapshot of the text, allowed motivations at the time, and all historical answers per language.

### Migration Import (`/admin/migration-import`) — dangerous

⚠ Item shown in **red** in the sidebar because it can **wipe the database**.

Used to import the **legacy site's ZIP bundle** (Django legacy) during go-live. Typical procedure (see `DEPLOY_PROCEDURA.txt`):

1. Download the bundle from the legacy site.
2. Go to Migration Import.
3. Select the ZIP file.
4. Tick **wipe = true** to clean the DB before importing.
5. Click **Import**.
6. Wait (can take minutes, there are progress indicators).

After import the admin password is **reset to `ADMIN_PASSWORD`** from the Portainer env vars (change the password **after** the import, not before).

Validation: 200MB cap on the ZIP, anti-zip-bomb, path-traversal checks on file names.

### Backup Restore (`/admin/backup-restore`)

Restore of a **ZIP bundle exported** from [Languages → Download Data → Export backup (.zip)](#6-the-languages-page). Lets you restore a specific set of languages from a previous snapshot, without wiping the DB.

### Import from Excel (`/admin/import-excel`)

Structured Excel import. 50 MB cap on the file. The sheet must follow the round-trip format ([documentation_en.md](docs/documentation_en.md) §10.4).

### Recompute final values

⚠ Reached **from Languages → Recompute final values**, no dedicated page.

Re-runs the **implicational DAG** for **all** languages in the system. Use:

- after important changes to implicational conditions;
- after a bulk import;
- if you suspect some `value_eval` is stale.

It's an async job (can take minutes on large datasets). Toast at the bottom-right shows progress. When done: "Recompute complete" message, or "Recompute completed with N error(s) over M language(s). See server logs for details" if some language has problems.

---

## 16. Common errors and what to do

### "Form locked by the current language status"

The language status is `Waiting for approval` or `Approved`, and you are not an admin. Wait for the decision, or (if you are the assigned user and the language is `Rejected`) click **Reopen**.

### "Question X needs at least 2 valid examples when answering YES or UNSURE"

You picked YES or UNSURE on a question with fewer than 2 non-empty examples. Add/complete the examples and retry.

### "This block has been modified by another session..."

Another user (usually an admin) modified the same block while you were working on it. The page automatically reloads: review the other person's changes before retrying your save.

### "Wrong email or password"

Wrong credentials. If you don't remember: contact an admin (email reset is not yet active).

### "Too Many Requests" at login

You typed the wrong password 5 times within a minute. Wait 1 minute and retry.

### "Invalid email format"

You're creating an account or changing email with an invalid value (e.g. missing `.it`, space, double `@`). Fix it.

### "You cannot delete your own account"

Have another admin do it.

### "You cannot delete the last remaining administrator"

Create a second admin **before** deleting the existing one.

### The "Submit for approval" button is missing

- Language status is already `Waiting for approval` or `Approved`: nothing to do.
- Status is `Rejected`: see **Reopen**, not Submit.
- You're not the assigned user for this language: only the assigned user can Submit.
- You're an admin: admins don't submit (they go directly through approve/reject).

### The site logged me out unexpectedly

Token expired (30 min of inactivity). Log in again.

### I changed the taxonomy but languages still show the old names

The `top_family`/`family`/`group` strings on languages are denormalized. Reopen each affected language and Save (even without changing anything) to propagate the new names. To do this in bulk: use Excel export/import.

---

## 17. Quick interface glossary

| Term | Meaning |
|---|---|
| **Wizard / squares** | the row of small buttons at the top of the compilation page, one per parameter |
| **Block / parameter block** | the set of all questions of a parameter for one language |
| **Confident / Unsure** | the two save buttons of the block. Confident = everything verified; Unsure = I have doubts, will recheck |
| **Stale block (409)** | a block that was modified by another session while you were editing |
| **Submit for approval** | sending the language to the admin for review |
| **Reopen** | bringing a `Rejected` language back to `Pending` |
| **Approved / Rejected / Pending / Waiting** | the 4 states of a language |
| **Admin override** | the purple banner reminding the admin they're editing a locked language |
| **Force status** | the admin dropdown to override a language's status bypassing the workflow |
| **Implicational DAG** | the parameter dependency graph (`+SPK & -DEM`) deciding whether a value should be neutralized |
| **value_orig vs value_eval** | `orig` = aggregated from the linguist's answers; `eval` = `orig` post-DAG (can be `0` if neutralized) |
| **Comparable** | a parameter is "comparable" between two languages if both have a non-null `value_eval` |
| **Implicational condition** | the string like `+SPK & -DEM` that triggers neutralization |
| **Neutralized** | a parameter forced to `0` because its implicational condition is not satisfied |
| **Flagged / Unsure parameter** | parameter marked "uncertain" by the linguist (yellow square) |
| **Red parameter** | in the Admin Dashboard, "red" parameters = unsure or incomplete |
| **Hamming / Jaccard distance** | distance metrics between languages based on parameter values |
| **GCD** | Geographic Distance, kilometric distance computed from lat/lng |
| **Mantel test** | statistical test measuring correlation between distance matrices |
| **Top family / Family / Group** | the 3 levels of the linguistic taxonomy |
| **Glossary** | dictionary of technical terms |
| **Instructions** | the page with compilation guidelines |
| **How to cite** | the page with the PCM Hub bibliographic citations |
| **ZIP bundle** | the compressed archive used for migration / backup-restore |
| **Recompute** | the job that re-runs the DAG over all languages |

---

*For doubts, suggestions or bug reports: write to `pcm_lab@unimore.it` (link at the bottom of every page on the site).*
