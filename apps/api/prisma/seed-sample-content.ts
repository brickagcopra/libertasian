/**
 * Seed script for production-safe sample content.
 *
 * Populates the otherwise-empty /blog and /study/flashcards +
 * /community/flashcard-sets surfaces with evergreen Philippine-law content.
 *
 * Distinct from seed-dev-data.ts (which is dev-only demo data). This script
 * is intended to run once against a fresh production-like database to give
 * new users something to read and study on day one.
 *
 * Idempotent:
 *   - Blog posts upserted by unique `slug`.
 *   - Flashcard sets keyed on (userId, title); existing sets are left in place
 *     to avoid duplicating cards on re-runs.
 *
 * Usage: ts-node prisma/seed-sample-content.ts
 *
 * Prerequisites: at least one User with at least one OrganizationMember.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Blog content
// ---------------------------------------------------------------------------

interface BlogPostSeed {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  readTimeMinutes: number;
  metaTitle: string;
  metaDescription: string;
  featured: boolean;
}

const BLOG_POSTS: readonly BlogPostSeed[] = [
  {
    slug: 'how-to-read-a-supreme-court-decision',
    title: 'How to Read a Supreme Court Decision',
    excerpt:
      'A practical, section-by-section guide to navigating Philippine Supreme Court decisions — from the case title down to the dispositive portion — so you can extract the doctrine quickly and cite it accurately.',
    content: `Reading a Supreme Court decision can feel intimidating the first time. Most rulings run dozens of pages, weave together facts, procedure, and doctrine, and rely on case names and citations that you may not yet recognize. The good news is that every decision follows a predictable structure. Once you know what each section is doing, you can extract the holding in minutes.

Start with the **case title and citation**. The title (for example, "People v. Dela Cruz, G.R. No. 246332") tells you who the parties are and gives you a unique handle for citing later. The G.R. number is the docket number — useful for retrieving the full text from the Supreme Court E-Library. The date of promulgation matters because doctrine can shift; an older case may have been clarified or overturned.

Next, identify the **ponente and the division**. The ponente is the Justice who wrote the opinion. The division (First, Second, Third, or En Banc) tells you the weight of the decision. En Banc rulings are needed to reverse prior En Banc doctrine and for cases involving constitutional questions or the discipline of judges.

The **facts** section sets up everything that follows. Read it slowly. Note the relevant dates, the procedural posture (was this a Rule 45 petition? a Rule 65 certiorari?), and the lower-court rulings. The Supreme Court's holding only makes sense against the specific facts it decided.

After the facts come the **issues**. These are the legal questions the Court agreed to resolve, usually phrased as "Whether or not...". Each issue maps to a section in the ruling. Then comes the **ruling and discussion** — the Court's reasoning. This is the longest part. Focus on the *ratio decidendi* (the reasoning essential to the holding) and distinguish it from *obiter dicta* (asides that are not binding precedent).

Finally, read the **dispositive portion** ("WHEREFORE..."). This is the actual order — what the Court grants, denies, affirms, or remands. When you cite the case in a brief, you are usually citing the doctrine articulated in the ruling, but the dispositive tells you the practical outcome. A decision can contain great language for your argument and still grant the opposite relief, so always check the dispositive before you rely on it.`,
    readTimeMinutes: 6,
    metaTitle: 'How to Read a Philippine Supreme Court Decision | LIBERTASIAN',
    metaDescription:
      'A practical guide for law students and lawyers on how to read and extract doctrine from Philippine Supreme Court decisions — case title, ponente, facts, issues, ruling, and dispositive.',
    featured: true,
  },
  {
    slug: 'bill-of-rights-1987-constitution',
    title: 'The Bill of Rights Under the 1987 Constitution',
    excerpt:
      'A high-level tour of Article III of the 1987 Philippine Constitution — what each section protects, how it operates against the State, and the doctrines that bar examinees are expected to know.',
    content: `Article III of the 1987 Constitution — the Bill of Rights — is the most heavily-tested portion of Political Law on the Bar. Its twenty-two sections enumerate the rights the State cannot lawfully infringe, and Philippine jurisprudence has spent four decades fleshing out what each clause means in practice.

The threshold concept is **state action**. The Bill of Rights restrains *government* conduct, not private actors. Evidence illegally seized by a private individual, for example, is generally admissible (with narrow exceptions), while the same seizure by a police officer would trigger Section 2 and the exclusionary rule in Section 3(2). When you spot a Bill-of-Rights issue, always ask first: who is acting, and were they acting under color of state authority?

Sections 1 and 2 form the procedural-due-process spine. **Section 1** guarantees due process and equal protection — the twin pillars covering both the fairness of the procedure used against a person and the substantive reasonableness of any classification the State draws. **Section 2** protects against unreasonable searches and seizures, requiring a warrant supported by probable cause personally determined by a judge after examination under oath of the complainant and the witnesses.

Sections 3 through 9 cover the **personal liberties** most frequently litigated: privacy of communication, freedom of speech and the press, religious freedom and the non-establishment clause, liberty of abode and travel, the right to information on matters of public concern, and the right to peaceable assembly. Memorize the standards of review — strict scrutiny for content-based speech restrictions and suspect classifications; intermediate scrutiny for gender and content-neutral speech regulations; rational basis for ordinary economic regulation.

Sections 11 through 22 protect persons accused or convicted of crimes: free access to courts, custodial-investigation rights (the famous *Miranda*-style warnings codified in Section 12), bail, the right to be informed of the nature and cause of the accusation, speedy trial, confrontation, compulsory process, the privilege against self-incrimination, the prohibition on excessive fines and cruel punishments, and the bar against double jeopardy and ex post facto laws.

When you study these provisions for the Bar, do not stop at the text. For each section, learn (1) the leading cases that define its scope, (2) the recognized exceptions, and (3) the remedies for violation. The exam rarely asks you to recite the provision — it asks you to apply it to a fact pattern and explain whether the State's conduct survives.`,
    readTimeMinutes: 6,
    metaTitle: 'The Bill of Rights Under the 1987 Constitution | LIBERTASIAN',
    metaDescription:
      'An overview of Article III of the 1987 Philippine Constitution covering state action, due process, search and seizure, free speech, and the rights of the accused.',
    featured: false,
  },
  {
    slug: 'building-a-bar-exam-study-schedule',
    title: 'Building a Bar Exam Study Schedule',
    excerpt:
      'How to design a realistic Bar review calendar that covers all eight subjects without burning out — from a six-month pre-review through the final cram week.',
    content: `Most examinees fail not because they lack intelligence but because they run out of time. A well-built study schedule is the single highest-leverage decision you make in the months before the Bar. The goal is straightforward: cover every syllabus topic at least twice, with enough recent practice to keep the doctrine alive in your memory on exam day.

Start with the **calendar in reverse**. Mark the four Bar Sundays. Work backward: the final two weeks should be reserved for last-minute review and mock exams — do not schedule new material there. The eight weeks before that are for your second pass through the syllabus, with heavy emphasis on weak areas. Everything earlier is your first pass.

For a six-month timeline, a sustainable weekly rhythm looks like this. **Monday through Friday**, spend three to four focused hours on one major subject, alternating across the eight Bar subjects. **Saturday** is for review of the week's material plus one timed essay drill. **Sunday** is partial rest — light reading, no new material. Adjust the daily hours up only after you've sustained the current load for two weeks; jumping straight to eight-hour days almost always ends in early burnout.

Within each subject, **do not read every commentary cover to cover**. Use the Supreme Court's official syllabus as your checklist. For each topic, read one trustworthy outline, then immediately work through three or four past Bar questions on that topic. The act of writing the answer is what cements the doctrine. Passive reading creates an illusion of mastery that the exam will mercilessly expose.

Build **spaced repetition** into the plan. The forgetting curve is real. A topic you read once in January will be largely gone by July unless you revisit it. The simplest solution: keep a single flashcard deck per subject (digital or paper), add 5 to 10 cards after each study block, and review yesterday's, last week's, and last month's cards every morning before you start fresh material.

Finally, protect sleep and exercise. Examinees who sacrifice both in the last month underperform their preparation. Seven to eight hours of sleep keeps your working memory and retrieval speed where they need to be. A thirty-minute walk a day is enough to manage the stress. The Bar rewards endurance as much as knowledge — design the schedule so you can still think clearly on the final Sunday.`,
    readTimeMinutes: 5,
    metaTitle: 'Building a Philippine Bar Exam Study Schedule | LIBERTASIAN',
    metaDescription:
      'A practical guide to designing a six-month Bar review calendar — pacing, weekly rhythm, spaced repetition, and how to avoid burnout before the four Bar Sundays.',
    featured: false,
  },
  {
    slug: 'civil-vs-criminal-cases-in-the-philippines',
    title: 'Civil vs. Criminal Cases in the Philippines',
    excerpt:
      'The core differences between civil and criminal proceedings under Philippine law — parties, burden of proof, remedies, and how a single act can give rise to both kinds of liability.',
    content: `One of the first distinctions every law student learns is between civil and criminal cases. The two systems share courtrooms and even some procedural rules, but their purposes, parties, and standards of proof are fundamentally different. Confusing them is one of the most common mistakes non-lawyers make when they first encounter the legal system.

A **criminal case** is a proceeding by which the State punishes conduct it has defined as a crime. The complainant in the case caption is "People of the Philippines" — the offended party is technically a witness, not a litigant. The prosecution is conducted by the public prosecutor, and the standard of proof is **proof beyond reasonable doubt**, the highest standard in our legal system. If the accused is found guilty, the consequences are penal: imprisonment, fines payable to the State, and ancillary penalties like disqualification from public office.

A **civil case**, by contrast, exists to enforce rights or obtain relief between private parties. The plaintiff is the injured party in their own name, suing the defendant for damages, specific performance, an injunction, recovery of property, or some other private remedy. The standard of proof in an ordinary civil action is **preponderance of evidence** — significantly easier to satisfy than proof beyond reasonable doubt. Wins in civil cases produce money judgments and equitable orders, not jail time.

The most important nuance is that **a single act can give rise to both criminal and civil liability**. Article 100 of the Revised Penal Code provides that every person criminally liable is also civilly liable. When a prosecutor files an Information for, say, reckless imprudence resulting in homicide, the civil action for damages arising from the same act is deemed instituted with the criminal case unless the offended party expressly waives it, reserves the right to file separately, or has already filed a separate civil action before the criminal one. This avoids duplicative litigation while preserving the victim's right to compensation.

The rules diverge sharply on **prescription, jurisdiction, and procedure**. Criminal prescription periods are governed by Article 90 of the Revised Penal Code (or the special law involved). Civil prescription is governed by the Civil Code, primarily Articles 1139 to 1155. Trial-court jurisdiction depends in criminal cases on the imposable penalty and in civil cases on the amount of the claim or the nature of the action. The Rules of Court treat civil procedure (Rules 1 to 71) and criminal procedure (Rules 110 to 127) as parallel but distinct systems with different rules on parties, pleadings, evidence, and appeals.

Practically, this means that when a client tells you "I want to sue someone," your first question is whether they want the defendant punished, compensated, or both — and from there, whether you're filing a complaint-affidavit with the prosecutor's office, a complaint in court, or both in parallel.`,
    readTimeMinutes: 5,
    metaTitle: 'Civil vs. Criminal Cases in the Philippines | LIBERTASIAN',
    metaDescription:
      'A clear explanation of the difference between civil and criminal cases under Philippine law — parties, burden of proof, remedies, and how one act can trigger both.',
    featured: false,
  },
];

// ---------------------------------------------------------------------------
// Flashcard content
// ---------------------------------------------------------------------------

interface FlashcardSeed {
  front: string;
  back: string;
}

interface FlashcardSetSeed {
  title: string;
  description: string;
  barSubject: string;
  topic: string;
  cards: readonly FlashcardSeed[];
}

const FLASHCARD_SETS: readonly FlashcardSetSeed[] = [
  {
    title: 'Constitutional Law Essentials',
    description:
      'Core doctrines from the 1987 Constitution — separation of powers, bill of rights, judicial review, and the standards of scrutiny most frequently tested on the Bar.',
    barSubject: 'political_law',
    topic: 'Constitutional Law',
    cards: [
      {
        front: 'What are the three inherent powers of the State?',
        back: 'Police power, the power of eminent domain, and the power of taxation. All three are inherent in sovereignty, legislative in nature, and subject to constitutional limitations such as due process and equal protection.',
      },
      {
        front: 'State the doctrine of separation of powers under the 1987 Constitution.',
        back: 'Legislative power is vested in Congress (Art. VI), executive power in the President (Art. VII), and judicial power in the Supreme Court and lower courts (Art. VIII). Each branch is supreme within its own sphere; one branch cannot encroach on the constitutionally-assigned powers of another, subject to the system of checks and balances.',
      },
      {
        front: 'What are the requisites of judicial review?',
        back: '(1) Actual case or controversy; (2) the party raising the constitutional question has standing (locus standi); (3) the question is raised at the earliest possible opportunity; and (4) the resolution of the constitutional question is the very lis mota of the case.',
      },
      {
        front: 'What level of scrutiny applies to content-based restrictions on speech?',
        back: 'Strict scrutiny. The government must show that the restriction serves a compelling state interest and is narrowly tailored — the least restrictive means — to achieve that interest. Content-based restrictions are presumptively unconstitutional.',
      },
      {
        front: 'State the requisites of a valid warrantless search incident to a lawful arrest.',
        back: 'There must first be a lawful arrest; the search must be contemporaneous with the arrest; and its scope is limited to the person of the arrestee and the area within their immediate control (the "wingspan" area) from which they could grab a weapon or destroy evidence.',
      },
      {
        front: 'What is the equal protection clause and when is a classification valid?',
        back: 'Section 1, Article III provides that no person shall be denied the equal protection of the laws. A classification is valid if it (1) rests on substantial distinctions, (2) is germane to the purpose of the law, (3) is not limited to existing conditions only, and (4) applies equally to all members of the same class.',
      },
      {
        front: 'When may the writ of habeas corpus be suspended under the 1987 Constitution?',
        back: 'Only in cases of invasion or rebellion, when the public safety requires it. The President may suspend it for a period not exceeding sixty days. Within 48 hours, the President must report to Congress, which may revoke or extend the suspension by majority vote of all its Members voting jointly.',
      },
      {
        front: 'What is the doctrine of operative fact?',
        back: 'An unconstitutional law or executive issuance is generally void from inception, but the doctrine of operative fact recognizes that prior to its declaration of nullity, the law was an operative fact whose effects (e.g., contracts entered into in reliance on it) may, in the interest of equity, be left undisturbed.',
      },
    ],
  },
  {
    title: 'Obligations and Contracts Basics',
    description:
      'Fundamental concepts from Book IV of the Civil Code on obligations and contracts — sources, kinds, requisites, defective contracts, and modes of extinguishment.',
    barSubject: 'civil_law',
    topic: 'Obligations and Contracts',
    cards: [
      {
        front: 'What are the sources of obligations under Article 1157 of the Civil Code?',
        back: 'Law, contracts, quasi-contracts, acts or omissions punished by law (delicts), and quasi-delicts.',
      },
      {
        front: 'What are the essential requisites of a valid contract under Article 1318?',
        back: 'Consent of the contracting parties, object certain which is the subject matter of the contract, and cause of the obligation which is established. Absence of any of these results in a contract that is void ab initio.',
      },
      {
        front: 'Distinguish a void contract from a voidable contract.',
        back: 'A void contract produces no legal effect from the beginning; it cannot be ratified, and the action to declare its nullity does not prescribe. A voidable contract is valid and binding until annulled; it may be ratified, and the action to annul prescribes within four years from the time the defect ceases.',
      },
      {
        front: 'What are the requisites of compensation as a mode of extinguishing obligations?',
        back: '(1) Each obligor is bound principally and is at the same time a principal creditor of the other; (2) both debts consist of money, or if of consumable things, of the same kind and quality; (3) both debts are due; (4) both are liquidated and demandable; and (5) there is no retention or controversy commenced by third persons over either debt.',
      },
      {
        front: 'What is the principle of mutuality of contracts?',
        back: 'Under Article 1308, the contract must bind both contracting parties; its validity or compliance cannot be left to the will of one of them. A stipulation that allows one party alone to determine performance violates this principle and is void.',
      },
      {
        front: 'When does delay (mora) arise in the performance of obligations?',
        back: 'Generally, demand (judicial or extrajudicial) is required for delay to arise. Article 1169 enumerates three exceptions: (1) when the law or the obligation expressly so declares; (2) when from the nature and circumstances of the obligation it appears that the designation of time was a controlling motive; and (3) when demand would be useless, as when the obligor has rendered it beyond their power to perform.',
      },
      {
        front: 'What is a contract of adhesion and how is it construed?',
        back: 'A contract of adhesion is one in which one party prepares the stipulations in printed form and the other party merely adheres or signs without the ability to modify its terms (e.g., insurance policies, transport tickets). It is generally valid but, when ambiguous, its provisions are construed strictly against the party who drafted it under Article 1377.',
      },
      {
        front: 'What is the doctrine of laches, and how does it differ from prescription?',
        back: 'Laches is the failure or neglect, for an unreasonable and unexplained length of time, to do that which by exercising due diligence could or should have been done earlier; it warrants a presumption that the party has abandoned the right. Prescription is concerned with fixed statutory periods; laches with the equity of the delay. Laches may bar recovery even where prescription has not yet run.',
      },
    ],
  },
  {
    title: 'Criminal Law Book I',
    description:
      'Core principles from Book One of the Revised Penal Code — felonies, criminal liability, circumstances affecting liability, stages of execution, and the application of penalties.',
    barSubject: 'criminal_law',
    topic: 'Revised Penal Code Book I',
    cards: [
      {
        front: 'Distinguish dolo from culpa under the Revised Penal Code.',
        back: 'Dolo (intentional felony) requires malice — the offender acts with deliberate intent. Its elements are freedom, intelligence, and intent. Culpa (culpable felony) requires no malice; the wrongful act results from imprudence, negligence, lack of foresight, or lack of skill. Its elements are freedom, intelligence, and negligence.',
      },
      {
        front: 'What are the elements of self-defense as a justifying circumstance?',
        back: 'Under Article 11(1): (1) unlawful aggression on the part of the victim; (2) reasonable necessity of the means employed to prevent or repel it; and (3) lack of sufficient provocation on the part of the person defending himself. Unlawful aggression is the indispensable element — without it, no self-defense, whether complete or incomplete, can be considered.',
      },
      {
        front: 'What are the three stages of execution of a felony?',
        back: 'Consummated — all elements necessary for its execution and accomplishment are present. Frustrated — the offender performs all the acts of execution that would produce the felony, but it is not produced by reason of causes independent of the offender\'s will. Attempted — the offender commences the commission of the felony directly by overt acts, but does not perform all the acts of execution by reason of some cause or accident other than spontaneous desistance.',
      },
      {
        front: 'Who are the persons criminally liable for grave and less grave felonies?',
        back: 'Article 16 lists: (1) principals — by direct participation, by induction, or by indispensable cooperation; (2) accomplices — those who cooperate in the execution of the offense by previous or simultaneous acts not falling under the principal category; and (3) accessories — those who, with knowledge of the commission of the crime and without having participated as principals or accomplices, take part subsequent to its commission in the modes specified by law.',
      },
      {
        front: 'What is the difference between recidivism and habitual delinquency?',
        back: 'Recidivism (Art. 14, par. 9) is an aggravating circumstance — the offender, at the time of trial for one crime, has been previously convicted by final judgment of another crime embraced in the same title of the RPC. Habitual delinquency (Art. 62, par. 5) imposes an additional penalty — within ten years from last release or last conviction, the offender is found guilty a third time or oftener of serious or less serious physical injuries, robbery, theft, estafa, or falsification.',
      },
      {
        front: 'State the indeterminate sentence law in brief.',
        back: 'For offenses punished under the RPC, the court must impose an indeterminate sentence with a maximum that is the proper imposable penalty considering modifying circumstances, and a minimum within the range of the penalty next lower in degree. For special laws, the maximum must not exceed the maximum fixed by the law and the minimum must not be less than the minimum prescribed by the same. The law does not apply to certain offenses (e.g., treason, those punished by death or life imprisonment, escape, habitual delinquents).',
      },
      {
        front: 'How is criminal liability extinguished totally under Article 89?',
        back: 'By: (1) death of the convict, as to personal penalties; pecuniary penalties are extinguished only when death occurs before final judgment; (2) service of the sentence; (3) amnesty; (4) absolute pardon; (5) prescription of the crime; (6) prescription of the penalty; and (7) marriage of the offended woman, in cases provided by law (largely repealed by RA 8353 for rape).',
      },
      {
        front: 'What is the doctrine of pro reo and when does it apply?',
        back: 'In dubio pro reo — when in doubt, decide for the accused. Where there is doubt as to the interpretation of a penal statute, or the existence of a fact essential to conviction, the doubt must be resolved in favor of the accused. This is rooted in the constitutional presumption of innocence and the requirement of proof beyond reasonable doubt.',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Seeders
// ---------------------------------------------------------------------------

async function resolveAuthorAndOrg(): Promise<{ authorId: string; orgId: string }> {
  const author = await prisma.user.findFirst({
    orderBy: { createdAt: 'asc' },
    include: { memberships: true },
  });

  if (!author) {
    throw new Error('seed-sample-content: no user found in database');
  }

  const firstMembership = author.memberships[0];
  if (!firstMembership) {
    throw new Error(
      `seed-sample-content: user ${author.email} has no organization membership`,
    );
  }

  return { authorId: author.id, orgId: firstMembership.organizationId };
}

async function seedBlogPosts(authorId: string): Promise<void> {
  console.log('Seeding blog posts...');

  const publishedAt = new Date();

  for (const post of BLOG_POSTS) {
    await prisma.blogPost.upsert({
      where: { slug: post.slug },
      create: {
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        content: post.content,
        authorId,
        status: 'published',
        publishedAt,
        readTimeMinutes: post.readTimeMinutes,
        metaTitle: post.metaTitle,
        metaDescription: post.metaDescription,
        viewCount: 0,
        featured: post.featured,
      },
      update: {
        title: post.title,
        excerpt: post.excerpt,
        content: post.content,
        status: 'published',
        readTimeMinutes: post.readTimeMinutes,
        metaTitle: post.metaTitle,
        metaDescription: post.metaDescription,
        featured: post.featured,
      },
    });
    console.log(`  Blog post: ${post.slug}${post.featured ? ' (featured)' : ''}`);
  }

  console.log(`  ${BLOG_POSTS.length} blog posts upserted.`);
}

async function seedFlashcardSets(authorId: string, orgId: string): Promise<void> {
  console.log('Seeding flashcard sets...');

  let createdSets = 0;
  let skippedSets = 0;

  for (const set of FLASHCARD_SETS) {
    const existing = await prisma.flashcardSet.findFirst({
      where: { userId: authorId, title: set.title },
    });

    if (existing) {
      console.log(`  Flashcard set already exists, skipping: ${set.title}`);
      skippedSets++;
      continue;
    }

    const createdSet = await prisma.flashcardSet.create({
      data: {
        organizationId: orgId,
        userId: authorId,
        title: set.title,
        description: set.description,
        barSubject: set.barSubject,
        topic: set.topic,
        visibility: 'public',
        cardCount: set.cards.length,
        ratingCount: 0,
      },
    });

    for (let i = 0; i < set.cards.length; i++) {
      const card = set.cards[i];
      if (!card) continue;
      await prisma.flashcard.create({
        data: {
          flashcardSetId: createdSet.id,
          front: card.front,
          back: card.back,
          sourceType: 'manual',
          ordering: i,
        },
      });
    }

    createdSets++;
    console.log(`  Flashcard set: ${set.title} (${set.cards.length} cards)`);
  }

  console.log(
    `  ${createdSets} flashcard set(s) created, ${skippedSets} already existed.`,
  );
}

async function main(): Promise<void> {
  console.log('=== Sample content seed ===');
  const { authorId, orgId } = await resolveAuthorAndOrg();
  console.log(`  Author user:  ${authorId}`);
  console.log(`  Organization: ${orgId}\n`);

  await seedBlogPosts(authorId);
  console.log('');
  await seedFlashcardSets(authorId, orgId);

  console.log('\nSample content seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
