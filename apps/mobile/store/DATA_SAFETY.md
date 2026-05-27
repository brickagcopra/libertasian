# LIBERTASIAN — Apple App Privacy + Play Data Safety Mapping

Source of truth for the data-collection answers you give to Apple (App Store Connect → App Privacy) and Google (Play Console → App content → Data safety). Both stores require the answers to match what the app actually does — keep this file in sync with `/CLAUDE.md` § Security and the Privacy Policy at https://libertasian.com/privacy.

**Cross-cutting claims (apply to every category below):**

- We do **not** sell personal information to third parties (per Privacy Policy § 7).
- Camera scans, document uploads, and notes are **never** used to train or fine-tune our AI models (per `/CLAUDE.md` § Security → "No user data in training" and Privacy Policy § 5).
- PII fields (email, phone, full name) are encrypted at the application level with AES-256-GCM. Uploaded files and camera scans live in encrypted object storage, isolated per organization and user.
- Refresh tokens are SHA-256 hashed before storage; passwords are bcrypt at cost factor ≥ 12.
- Data is processed primarily in the Philippines; international transfers (cloud providers) carry contractual safeguards consistent with NPC requirements.
- App is **not** directed to users under 18 (Privacy Policy § 11). On Play, declare target audience as 18+.

---

## 1. What the app actually collects

| # | Category | Examples | Why we need it | Linked to user identity? | Optional? |
|---|---|---|---|---|---|
| 1 | Account info | Email (required), full name, phone (optional) | Sign-in, account recovery, support correspondence | Yes | No (required to create account) |
| 2 | User content — uploaded documents | PDFs, images uploaded for OCR/digest generation | Core product feature: OCR → searchable digest, scoped to your organization | Yes | Yes (only collected when user uploads) |
| 3 | User content — camera scans | Photos taken in-app of pleadings / case printouts | Core product feature: scan-to-digest | Yes | Yes (only collected when user scans) |
| 4 | User content — notes, annotations, bookmarks, search queries, AI prompts | Free-text notes; saved bookmarks; search history; chat with AI assistant | Workspace persistence; AI assistant context | Yes | Yes (only when user creates them) |
| 5 | Usage / diagnostics | Crash logs, performance metrics, screen views, button taps | Stability and product analytics; redacted of PII before storage | Yes (associated with account but not sold) | Partial — essential analytics on; product analytics user-toggleable |
| 6 | Device / log data | IP prefix only (for session binding), user-agent, timestamps | Refresh-token reuse detection, rate limiting, audit log | Yes | No (required for security) |
| 7 | Billing info | Last-4 / token only; full card data handled by Xendit (PCI) | Subscription billing | Yes | Yes (only paid plans) |

The app does **not** collect: precise location, contacts, calendar, health, fitness, audio recordings, sensors, financial info beyond billing token, browsing history outside the app, advertising identifiers.

---

## 2. Apple App Privacy labels — App Store Connect

App Store Connect → App Privacy → Edit. For each category, choose **Data Used to Track You** (= shared with data brokers for cross-app advertising), **Data Linked to You** (= tied to user identity), or **Data Not Linked to You**.

### Data Used to Track You

**None.** We do not use any data for tracking across apps and websites owned by other companies.

### Data Linked to You

| Apple category | Apple data type | Purpose to declare | Source row above |
|---|---|---|---|
| Contact Info | Email Address | App Functionality, Account Management, Customer Support | 1 |
| Contact Info | Name | App Functionality, Account Management | 1 |
| Contact Info | Phone Number | App Functionality (optional account field) | 1 |
| User Content | Photos or Videos | App Functionality (camera scans → OCR) | 3 |
| User Content | Other User Content | App Functionality (uploaded documents, notes, annotations, AI prompts) | 2, 4 |
| Search History | Search History | App Functionality, Product Personalization (in-app search) | 4 |
| Identifiers | User ID | App Functionality, Account Management | 1 |
| Usage Data | Product Interaction | Analytics, App Functionality | 5 |
| Diagnostics | Crash Data | App Functionality | 5 |
| Diagnostics | Performance Data | App Functionality | 5 |
| Diagnostics | Other Diagnostic Data | App Functionality | 5 |
| Purchases | Purchase History | App Functionality (subscription state) | 7 |
| Financial Info | Payment Info | App Functionality (Xendit token only; we never see full card data) | 7 |

### Data Not Linked to You

None declared separately — diagnostic data is associated with account identity for support purposes, so we conservatively declare it Linked above.

### Privacy choices URL

Leave blank unless we ship a separate privacy-controls page distinct from the Privacy Policy.

---

## 3. Google Play Data Safety — Play Console

Play Console → App content → Data safety. For each Play category, you declare whether data is **Collected** and/or **Shared**, the **purposes** (App functionality, Analytics, Developer communications, Fraud prevention/security/compliance, Account management, Personalization, etc.), and whether collection is **Required** or **Optional**.

### Top-level toggles

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (TLS 1.3 — Privacy Policy § 6.2) |
| Do you provide a way for users to request that their data be deleted? | **Yes** — in-app account deletion + `dpo@libertasian.com` per Privacy Policy § 8–9 |

### Category mapping

| Play category | Play data type | Collected | Shared | Purposes | Required/Optional | Source row |
|---|---|---|---|---|---|---|
| Personal info | Name | Yes | No | Account management, App functionality | Optional | 1 |
| Personal info | Email address | Yes | No | Account management, App functionality, Developer communications | Required | 1 |
| Personal info | Phone number | Yes | No | App functionality | Optional | 1 |
| Personal info | User IDs | Yes | No | Account management, App functionality | Required | 1 |
| Financial info | Purchase history | Yes | No | App functionality (subscription state) | Optional (paid plans) | 7 |
| Financial info | Payment info | No* | No | — | — | 7 |
| Photos and videos | Photos | Yes | No | App functionality (camera scans / OCR) | Optional | 3 |
| Files and docs | Files and docs | Yes | No | App functionality (uploaded documents) | Optional | 2 |
| App activity | App interactions | Yes | No | Analytics, App functionality | Optional (essential analytics required) | 5 |
| App activity | In-app search history | Yes | No | App functionality, Personalization | Optional | 4 |
| App activity | Other user-generated content | Yes | No | App functionality (notes, annotations, AI prompts) | Optional | 4 |
| App info and performance | Crash logs | Yes | No | Analytics, App functionality | Required | 5 |
| App info and performance | Diagnostics | Yes | No | Analytics, App functionality | Required | 5 |
| App info and performance | Other app performance data | Yes | No | Analytics | Required | 5 |
| Device or other IDs | Device or other IDs | No | No | — | — | 6 (IP prefix only, no advertising ID) |
| Location | Approximate / Precise location | No | No | — | — | — |
| Contacts | Contacts | No | No | — | — | — |
| Calendar | Calendar events | No | No | — | — | — |
| Health and fitness | — | No | No | — | — | — |
| Messages | — | No | No | — | — | — |
| Audio | — | No | No | — | — | — |
| Web browsing | — | No | No | — | — | — |

\* Card numbers and CVCs are handled by Xendit's PCI-compliant payment widget; the app receives only a billing token. Declare Payment info as **not collected** by us on Play; declare Financial Info → Payment Info as **Linked** on Apple because we still hold the Xendit token tied to the user.

### Security practices

- Data encrypted in transit: **Yes**
- Users can request data deletion: **Yes**
- Committed to follow the Play Families Policy: **N/A** (app is not for children)
- Independent security review: leave blank unless and until we obtain one

---

## 4. When to update this file

Update **before** any of the following ships:

1. A new collection point (new permission, new upload type, new tracking SDK).
2. A change to retention windows or sharing partners.
3. A change to the Privacy Policy text at https://libertasian.com/privacy (keep wording aligned).
4. A change to `/CLAUDE.md` § Security — Mandatory Standards.

After updating: re-submit the App Privacy answers in App Store Connect and re-submit the Data Safety form in Play Console. Both stores re-review the form independently of the binary; mismatch can hold a release.
