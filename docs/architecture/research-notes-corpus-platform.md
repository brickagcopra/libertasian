# Research Notes: Corpus, Digest Structure, Competitor Landscape, and Philippine Bar Exam

> Prepared for the LIBERTASIAN target architecture effort. Research conducted 2026-04-10. Every non-trivial factual claim below is tagged with the URL that supplied it. Where a fetch failed, the failure is documented in place rather than silently omitted.

---

## 1. Competitor 1 — Quimbee (quimbee.com)

### Product surface

Quimbee's homepage positions it as a study-aid and bar-prep platform for U.S. law students. Its catalogue advertises [47,300+ case briefs keyed to 1,000 law school casebooks, along with 1,295 video lessons, 7,000+ practice questions, flashcards, and 210+ issue-spotter essay exams](https://www.quimbee.com/). The same landing page lists [Quimbee SideBar Videos (270+ short 5–7 minute videos), MCQ banks, strategy content, and integrations with BARBRI and AdaptiBar for bar review](https://www.quimbee.com/).

### Case brief structure

Quimbee's own "How to Write a Case Brief" guide lays out the section schema they use across their library. A Quimbee brief is built around these headings: [Rule of Law, Facts (with procedural history), Issue (phrased as a yes/no question), Holding and Reasoning (structured via the CREAC method), Concurrence, and Dissent](https://www.quimbee.com/resources/how-to-write-a-case-brief). Their case-briefs overview page re-states the schema and adds that briefs also include a procedural disposition and "summaries of concurring and dissenting opinions when applicable"; the same page documents that [briefs are written under a "closed universe" policy — authors only use the text included in the specific casebook excerpt](https://www.quimbee.com/case-briefs-overview).

Key implication for LIBERTASIAN: Quimbee is explicitly *per-casebook* rather than per-jurisdiction. Their "categorisation" is primarily the casebook-and-chapter the case appears in, supplemented by key-term cross-linking. Their guide tells students to [derive the rule of law from the chapter and section headings of the casebook where the case appears](https://www.quimbee.com/resources/how-to-write-a-case-brief). We should not copy this model directly — the Philippine domain has no "casebook" equivalent — but the section schema (Rule / Facts / Issue / Holding / Reasoning / Concurrence / Dissent) is a usable baseline for our own digest structure, with room to add a dedicated Dispositive field and Doctrine tagging.

### Bar prep offerings

Quimbee's bar review page advertises [SideBar Videos (270+ short videos across bar subjects), 800+ multiple-choice questions tied to the videos, a 3-question quiz at the end of each video, essay practice exams, flashcards, outlines, and key-term vocabulary support](https://www.quimbee.com/bar-review). They explicitly position SideBar as a supplement to (not a replacement for) a primary bar-review course, and recommend pairing it with AdaptiBar for real past MBE questions.

### Pricing / paywall

Quimbee's pricing page shows a [Study Aids Yearly plan at $23/month billed annually ($276/year), including 1,290+ video lessons, 7,900+ flashcards, 210+ issue spotters, 7,000+ MCQs, and access to outlines and the BARBRI 1L Exam Success course, with a 7-day free trial](https://www.quimbee.com/pricing). The page does not describe a permanent free tier — access beyond the trial requires a subscription, meaning Quimbee is effectively paywalled behind a 7-day window.

---

## 2. Competitor 2 — Anycase.ai

Anycase positions itself as "a legal research tool and legal library that knows Philippine Laws and Jurisprudence," serving lawyers, law students, and legal professionals, per [their homepage](https://anycase.ai/). According to the same page, Anycase organises legal analysis into [clear, scannable headers], returns answers [backed by specific citations you can open, read, and cite within the platform], and surfaces fields including constitutional provisions, statutes, jurisprudence, legal explanations and reasoning, case illustrations, and citations to controlling authorities. The homepage shows [citations formatted as case name, year, and category, e.g. "People v. Mulingbayan (2022), Jurisprudence"](https://anycase.ai/).

Implications: Anycase's user-visible citation primitives are (case name, year, category). That is shallower than what LIBERTASIAN should offer — we should carry G.R. number, promulgation date, division/en banc, SCRA/OG reporter cite where available, and the paragraph or section within the decision. Anycase uses a conversational "analysis with inline cites" format rather than a structured digest schema.

---

## 3. Competitor 3 — Digest.ph (Philippine)

Digest.ph's homepage advertises [AI-powered legal research and case digest search with over 83,000 decisions and 8,400+ laws](https://digest.ph/). The homepage lists an AI tool called [Digest AI with sub-actions "Find," "Explain," "Ask," "Draft," and "Style," plus both "Non AI" and "AI" search modes, and output styles "Comprehensive," "Concise," "Bar Exam," and "Free Form"](https://digest.ph/). Materials are grouped by broad practice areas — Decisions, Laws (statutes, constitutions, executive issuances, rules), Taxation, Corporate (banking, securities, stock exchange), and Labor (employment, overseas workers, compensation) — per the same page.

What the homepage does **not** disclose (verified by fetch): a documented IRAC or Facts/Issue/Holding structure for the digests, a model/version disclosure, a confidence/abstention pattern, or any accuracy disclaimer. This is a gap in their public documentation, not a claim that such things are absent — but it means there is no public schema we can copy directly from Digest.ph.

---

## 4. Competitor 4 — Jurischat

The canonical domain `jurischat.com` failed to resolve (DNS `ENOTFOUND`) as of 2026-04-10. The working domain is `jurischat.net`. Their product page states that JurisChat brings [proper citations and references to relevant legal documents in every response, grounded in a database of over 120,000 Philippine laws, jurisprudence, legal opinions, and administrative issuances, with "context-aware responses"](https://www.jurischat.net/juris-chat).

The product page does **not** document the specific citation format (e.g. whether it uses SCRA cites, G.R. numbers, paragraph anchors), nor does it publish an abstention/refusal pattern, a confidence threshold, or a model-version disclosure. That is a documentation gap on their side. For LIBERTASIAN this means there is no public counter-example we can benchmark against directly — our spec should establish citation format and abstention rules independently.

---

## 5. Competitor 5 — eCodal+ (Philippine codal app)

eCodal+'s [ecodals landing page](https://www.ecodalplus.com/ecodals) lists eight primary subject categories with sub-category counts: Civil Law (6 subcategories), Commercial Law (9), Criminal Law (5), Labor and Agrarian Law (7), Legal and Judicial Ethics (4), Political and Public International Law (10), Remedial Law (8), and Taxation Law and Environmental Law. The same site promotes [mobile apps for Android and iOS and references a subscription service called eCodal+Pro](https://www.ecodalplus.com/ecodals).

The [Apple App Store listing](https://apps.apple.com/ph/app/ecodal/id6448870557) describes eCodal as a compilation of codals "frequently used in law school and in practice," organised into nine practice areas (adding Public International Law as a separate bucket), with in-app search and a text-size toggle. The App Store page does not explicitly confirm whether content is fully offline; it does list a 71.5 MB app bundle, which is consistent with a large bundled corpus but is not an explicit offline guarantee.

Gaps from the public marketing surface that we could not resolve:

- The precise segmentation granularity (per-Article vs per-Section vs per-paragraph) is not disclosed on either the marketing site or the App Store listing.
- Offline behaviour (full vs cached vs online-only for certain codals) is not explicitly documented.

Implication for LIBERTASIAN: eCodal+'s subject taxonomy is a useful sanity check — they carry essentially the pre-2025 eight-subject Philippine taxonomy, not the new six-subject exam grouping. Our reader model should target per-Section (or per-Article for codes that use Articles, like the Civil Code and RPC) segmentation so that we can build a superset of what eCodal+ displays and can anchor citations at that granularity.

---

## 6. Philippine Bar Examinations — current authoritative structure

### Key finding: the SC has moved from 8 subjects to 6 "core subjects"

The older, traditional list — Political Law, Labor Law, Civil Law, Taxation, Mercantile Law, Criminal Law, Remedial Law, and Legal Ethics — has been **consolidated** into six core subjects for the recent digitalised bar examinations. This is confirmed by current SC-issued Bar Bulletins and by multiple secondary sources that quote those bulletins.

### 2026 Bar Examinations — the most recent official schedule

The Office of the 2026 Bar Chairperson (Associate Justice Samuel H. Gaerlan) issued Bar Bulletin No. 1, Series of 2026, dated October 16, 2025. The [official PDF is hosted by the Supreme Court](https://sc.judiciary.gov.ph/wp-content/uploads/2025/10/2026-BAR-Bar-Bulletin-No.-1-October-16-2025.pdf), though direct fetches to `sc.judiciary.gov.ph` returned HTTP 403 (bot-blocked) for this research session as of 2026-04-10. The contents were confirmed via mainstream Philippine press coverage that explicitly attributes the bulletin.

Per PhilSTAR Life's reporting on Bar Bulletin No. 1, Series of 2026, the six core subjects and their weights for the 2026 bar are:

1. [Political and Public International Law — 15% (Day 1 AM)](https://philstarlife.com/news-and-views/386662-schedule-subject-coverage-2026-bar-exams)
2. [Commercial and Taxation Laws — 20% (Day 1 PM)](https://philstarlife.com/news-and-views/386662-schedule-subject-coverage-2026-bar-exams)
3. [Civil Law and Land Titles and Deeds — 20% (Day 2 AM)](https://philstarlife.com/news-and-views/386662-schedule-subject-coverage-2026-bar-exams)
4. [Labor Law and Social Legislation — 10% (Day 2 PM)](https://philstarlife.com/news-and-views/386662-schedule-subject-coverage-2026-bar-exams)
5. [Criminal Law — 10% (Day 3 AM)](https://philstarlife.com/news-and-views/386662-schedule-subject-coverage-2026-bar-exams)
6. [Remedial Law, Legal and Judicial Ethics — 25% (Day 3 PM)](https://philstarlife.com/news-and-views/386662-schedule-subject-coverage-2026-bar-exams)

The [PhilSTAR Life article](https://philstarlife.com/news-and-views/386662-schedule-subject-coverage-2026-bar-exams) also documents the schedule — Day 1 on September 6, Day 2 on September 9, Day 3 on September 13, 2026 — with morning sessions 8 a.m.–12 noon and afternoons 2 p.m.–6 p.m., and attributes the schedule to Bar Bulletin No. 1, Series of 2026.

### 2025 Bar Examinations — weights were already at six core subjects

The 2025 bar (Justice Gaerlan chairing) used the same six-subject grouping. According to [Atty. Bryan Villarosa's LexRex bar exam information page](https://lexrex.ph/bar-exam-information/), the 2025 weights were:

- Political and Public International Law — 15%
- Mercantile and Taxation Laws — 20%
- Civil Law — 20%
- Labor Law and Social Legislation — 10%
- Criminal Law — 10%
- Remedial Law, Legal Ethics, and Legal Forms — 25%

Respicio & Co.'s article on the [2025 bar syllabus](https://www.respicio.ph/bar/2025/syllabus-for-the-2025-bar-examinations) independently confirms the same six subjects and identical weights.

### What changed for 2026 vs 2025

Comparing the two:

- The 2025 subject "Civil Law" becomes, in 2026, [Civil Law and Land Titles and Deeds](https://philstarlife.com/news-and-views/386662-schedule-subject-coverage-2026-bar-exams) — i.e., property / land registration material that was implicitly subsumed is now explicitly named.
- The 2025 subject "Mercantile and Taxation Laws" becomes [Commercial and Taxation Laws](https://philstarlife.com/news-and-views/386662-schedule-subject-coverage-2026-bar-exams) in 2026 — a naming normalisation, not a scope change.
- The 2025 subject "Remedial Law, Legal Ethics, and Legal Forms" becomes [Remedial Law, Legal and Judicial Ethics with Practical Exercises](https://philstarlife.com/news-and-views/386662-schedule-subject-coverage-2026-bar-exams) in 2026.
- Weights are unchanged between 2025 and 2026.

### Direct fetches to sc.judiciary.gov.ph

The following pages were attempted but returned HTTP 403 (bot block) for this research session as of 2026-04-10, so their contents could not be verified directly:

- `https://sc.judiciary.gov.ph/bar-exams/` — unreachable (403)
- `https://sc.judiciary.gov.ph/bar-2025/` — unreachable (403)
- `https://sc.judiciary.gov.ph/category/bar-matters/` — unreachable (403)
- `https://sc.judiciary.gov.ph/wp-content/uploads/2024/09/Bar-Bulletin-No.-1-on-Modality-Schedule-Coverage-and-Syllabi-September-16-2024-.pdf` — unreachable (403)
- `https://sc.judiciary.gov.ph/wp-content/uploads/2025/10/2026-BAR-Bar-Bulletin-No.-1-October-16-2025.pdf` — unreachable (403)

Operationally, LIBERTASIAN's ingestion layer will need a crawler that can authenticate/identify correctly for `sc.judiciary.gov.ph` — either via a residential-grade egress, a polite User-Agent + robots.txt compliance policy, or (cleanest) a formal data-access request to the SC PIO. The bulletins themselves are public, but programmatic fetch from cloud IPs is being blocked.

### Publication of past bar exam questions and suggested answers

The Supreme Court itself does not publish a machine-addressable archive of bar questions that we could verify for this research round (direct fetches of SC pages were blocked, per above).

The de facto machine-addressable archive for past bar exam questions is LawPhil (Arellano Law Foundation). [LawPhil's bar questions index](https://lawphil.net/courts/bm/barQ/barQs.html) is organised chronologically by year and then by examination date, with subjects listed under each date, covering exams from 2006 through 2022. The URL convention is `[year]/[subject]_Q.html` for HTML (with mirrored PDFs under `[year]/pdf/[subject]_Q.pdf`), e.g. `2022/remedial-I_Q.html`. LawPhil's archive contains **only the questions** — we confirmed by fetching [the 2022 Remedial Law I exam page](https://lawphil.net/courts/bm/barQ/2022/remedial-I_Q.html), which contains 15 numbered questions, examination instructions, and date/time metadata, but **no suggested-answer file**. Suggested answers are therefore not available from LawPhil; they would need to be sourced from bar review centres or the UP Law Center, which is out of scope for this research round.

### LawPhil Supreme Court decisions — URL structure and depth

LawPhil's jurisprudence archive is the other key ingestion target. [The top-level jurisprudence index](https://lawphil.net/judjuris/judjuris.html) is organised year-by-year with the URL convention `juri[YEAR]/juri[YEAR].html`, and the archive extends back to 1901, spanning 120+ years of Philippine jurisprudence. We verified the depth by fetching [the 1901 page](https://lawphil.net/judjuris/juri1901/juri1901.html), which does exist and is organised by month.

Within each year, decisions are grouped by month using three-letter month abbreviations. We verified the pattern by fetching [the 2024 year index](https://lawphil.net/judjuris/juri2024/juri2024.html), which shows month links with URLs like `jul2024/jul2024.html` and `oct2024/oct2024.html`. Some months (e.g., March and December 2024 as of the fetch) did not yet have active links, indicating the archive is progressively populated.

Individual decisions within a month follow a consistent filename convention. We verified this by fetching [the January 2024 index](https://lawphil.net/judjuris/juri2024/jan2024/jan2024.html), which exposes:

- `gr_[NUMBER]_2024.html` for regular G.R. decisions, with mirrored PDFs under `pdf/gr_[NUMBER]_2024.pdf`
- `am_[PREFIX]_2024.html` for Administrative Matters
- `ac_[NUMBER]_2024.html` for A.C. (Attorney Conduct / bar discipline) cases

Example verified URLs from that January 2024 page:

- `gr_262600_2024.html` → People of the Philippines vs. AAA
- `am_ca-23-001-p_2024.html` → Court of Appeals vs. Garry U. Caliwan

The identifier prefixes map cleanly to the underlying SC case categories: G.R. (regular appellate), A.M. (administrative matter), and A.C. (attorney/bar discipline). All of the above was confirmed by direct fetch against lawphil.net pages.

**Crawler design implications for LIBERTASIAN:**

1. We can deterministically enumerate the full LawPhil SC decisions corpus with three nested loops: year (1901–current), month (jan–dec), decision-file (gr/am/ac prefix + number + year). No search is required.
2. The year- and month-index pages are small HTML files — we can fetch them, parse links, and fan out per-decision fetches at controlled concurrency without hammering LawPhil.
3. Year-to-year the set of months that have live links is not uniform; our crawler must tolerate 404s or blank indexes on historical gaps.
4. Bar questions are a separate subtree under `/courts/bm/barQ/[year]/` and need a separate crawler entry point. They stop at 2022 per LawPhil's own index, so post-2022 bar questions have no LawPhil source — they will need a different provider or direct sourcing.

---

## 7. Bar subject sub-topics (coverage / syllabus detail)

Because direct fetches to the SC website were blocked, the detailed official syllabus text was not retrievable for this research round. The best open-web summary we could verify is [Respicio & Co.'s article on the 2025 syllabus](https://www.respicio.ph/bar/2025/syllabus-for-the-2025-bar-examinations), which summarises Bar Bulletin No. 1 and lists sub-topic groupings per subject. The relevant extracts, each attributable to that URL:

- **Political and Public International Law (15%)** — [fundamental constitutional doctrines, powers and functions of governmental branches, state sovereignty, constitutional rights, and public international law covering treaties, international organizations, human rights, humanitarian law, and maritime law](https://www.respicio.ph/bar/2025/syllabus-for-the-2025-bar-examinations).
- **Mercantile and Taxation Laws (20%)** — [mercantile covers corporations, securities, transportation, insurance, intellectual property, and banking; taxation covers general principles, national taxes, and tax remedies, with emphasis on the NIRC of 1997 (as amended) and the Ease of Paying Taxes Act](https://www.respicio.ph/bar/2025/syllabus-for-the-2025-bar-examinations).
- **Civil Law (20%)** — [persons, family relations, obligations and contracts, succession, property, special contracts, quasi-contracts, quasi-delicts, and damages, grounded in the Family Code and Civil Code](https://www.respicio.ph/bar/2025/syllabus-for-the-2025-bar-examinations). For 2026, the Supreme Court added Land Titles and Deeds explicitly into this cluster per [Bar Bulletin No. 1, Series of 2026](https://philstarlife.com/news-and-views/386662-schedule-subject-coverage-2026-bar-exams).
- **Labor Law and Social Legislation (10%)** — [labor standards, labor relations, and social legislation including the Labor Code, Social Security Law, Government Service Insurance System Law, and POEA Regulations](https://www.respicio.ph/bar/2025/syllabus-for-the-2025-bar-examinations).
- **Criminal Law (10%)** — [the Revised Penal Code and other special penal laws including the Comprehensive Dangerous Drugs Act, Anti-Hazing Law, and Anti-Violence Against Women and Children Act](https://www.respicio.ph/bar/2025/syllabus-for-the-2025-bar-examinations).
- **Remedial Law, Legal Ethics, and Legal Forms (25%)** — [civil procedure, special proceedings, evidence, criminal procedure, legal ethics, judicial conduct, and practical exercises in drafting pleadings and notarial acts](https://www.respicio.ph/bar/2025/syllabus-for-the-2025-bar-examinations).

The above is the Respicio-summarised sub-topic list. It is **not** the full line-by-line SC syllabus. A fully faithful sub-topic taxonomy at the level the SC publishes (which goes down to, e.g., "Article III, Bill of Rights → due process → substantive vs procedural") would require retrieving the bar bulletin PDFs directly and is a documented gap below.

---

## 8. Gaps and unknowns

These are the questions we could not answer from public, fetchable sources in this research round. They should feed the architecture doc's Open Questions sections.

1. **Full 2026 SC syllabus PDF contents.** `sc.judiciary.gov.ph` blocks programmatic fetches (HTTP 403) from this environment. The detailed line-item sub-topic list per subject — the thing we would want to drive our subject/sub-topic taxonomy and content tagging — has not been verified against the primary source. Next step: re-fetch from a non-blocked egress, or file a PIO request.
2. **Official SC archive of past bar questions.** It is unclear whether the SC itself publishes a canonical archive of bar questions (as opposed to LawPhil's third-party archive, which stops at 2022). Unverified in this round.
3. **Suggested answers to bar questions.** LawPhil does not publish suggested answers ([verified](https://lawphil.net/courts/bm/barQ/2022/remedial-I_Q.html)). The UP Law Center has historically produced such materials, but their availability, licensing, and a machine-addressable source were not established in this round.
4. **Digest.ph digest schema.** Digest.ph's homepage does not publicly document the field structure of its case digests, its AI model, its confidence/abstention policy, or its accuracy disclaimer. We cannot say whether their digests follow IRAC or some other schema without access to the product behind its paywall.
5. **Jurischat citation and abstention patterns.** Jurischat's product page does not publicly document its citation format or refusal pattern.
6. **eCodal+ segmentation granularity and offline behaviour.** Neither the marketing site nor the App Store listing explicitly specifies whether statutes are stored per-Article vs per-Section or whether content is fully offline.
7. **When exactly the SC consolidated from 8 to 6 subjects.** Multiple sources describe the 2025 and 2026 bar exams as using a six-subject structure, but we did not find a single primary-source SC issuance in this research round that names the effective date of the consolidation. It was clearly in place by the 2025 bar cycle.
8. **LawPhil coverage gaps.** LawPhil organises decisions back to 1901 by month, but we observed individual months in recent years without active links (e.g., March and December 2024 at time of fetch). Completeness of historical coverage — including whether all G.R. decisions are present or only selected ones — was not measured.
9. **SC decisions before online publication.** The SC PDF portal's behaviour for decisions pre-dating the modern E-Library (roughly pre-1990s) was not measured. LawPhil appears to be the best current source for old decisions, but their provenance chain back to the Official Gazette / SCRA reporters was not verified.
10. **Official Gazette / SCRA machine access.** Not researched in this round. These would be important secondary authoritative sources for older decisions, statutes, and administrative issuances.
11. **Quimbee's tagging ontology.** Quimbee cross-links briefs via "key terms" but does not publish the full taxonomy of those terms. The depth and structure of their topical tagging beyond casebook-chapter is not visible without a paid account.

---

## 9. Raw source list (successfully fetched)

Every URL below returned content that was actually used in this document. URLs that returned 403 or DNS failures are called out in-line in Section 6 and Section 8 above and are **not** repeated here.

- https://www.quimbee.com/
- https://www.quimbee.com/resources/how-to-write-a-case-brief
- https://www.quimbee.com/case-briefs-overview
- https://www.quimbee.com/bar-review
- https://www.quimbee.com/pricing
- https://anycase.ai/
- https://digest.ph/
- https://www.jurischat.net/juris-chat
- https://www.ecodalplus.com/ecodals
- https://apps.apple.com/ph/app/ecodal/id6448870557
- https://lexrex.ph/bar-exam-information/
- https://www.respicio.ph/bar/2025/syllabus-for-the-2025-bar-examinations
- https://philstarlife.com/news-and-views/386662-schedule-subject-coverage-2026-bar-exams
- https://lawphil.net/courts/bm/barQ/barQs.html
- https://lawphil.net/courts/bm/barQ/2022/remedial-I_Q.html
- https://lawphil.net/judjuris/judjuris.html
- https://lawphil.net/judjuris/juri2024/juri2024.html
- https://lawphil.net/judjuris/juri2024/jan2024/jan2024.html
- https://lawphil.net/judjuris/juri1901/juri1901.html

Sources reached via WebSearch that informed claims but were not directly fetched as primary evidence are cited inline in their respective sections. Where a secondary source was the only way to confirm a claim that the primary SC source blocked, the inline citation is to the secondary source and the SC blockage is explicitly documented.
