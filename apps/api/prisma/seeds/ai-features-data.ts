/**
 * AI Features Seed Data — Legal memos, case comparisons, pleadings,
 * timelines, and hearing prep packs.
 *
 * AI Features:
 *   1. Legal Memo — Treachery analysis (member, completed)
 *   2. Legal Memo — Due process advisory (member, completed)
 *   3. Case Comparison — Santos vs Agabon (member, completed)
 *   4. Pleading — Motion to Dismiss (member, completed)
 *   5. Pleading — Motion for Reconsideration (member, completed)
 *   6. Case Timeline — Santos case (member, completed)
 *   7. Hearing Prep — Treachery defense (member, completed)
 */

import { PrismaClient } from '@prisma/client';
import { SeededUsers } from './dev-users';
import { SeededDocuments } from './legal-documents';
import { SeededWorkspace } from './workspace-data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeededAiFeatures {
  treacheryMemo: { id: string };
  dueProcessMemo: { id: string };
  santosAgabonComparison: { id: string };
  mtdPleading: { id: string };
  mrPleading: { id: string };
  santosTimeline: { id: string };
  treacheryHearingPrep: { id: string };
}

// ---------------------------------------------------------------------------
// Seed Function
// ---------------------------------------------------------------------------

export async function seedAiFeatures(
  prisma: PrismaClient,
  users: SeededUsers,
  docs: SeededDocuments,
  workspace: SeededWorkspace,
): Promise<SeededAiFeatures> {
  console.log('\n--- Seeding AI features ---');

  const result = {} as SeededAiFeatures;

  // =========================================================================
  // LEGAL MEMOS
  // =========================================================================
  console.log('  Seeding legal memos...');

  const memos = [
    {
      key: 'treacheryMemo',
      userId: users.member.id,
      matterId: workspace.santosMatter.id,
      query: 'Analyze the elements of treachery as a qualifying circumstance in the context of People v. Santos. What are the strongest grounds for challenging the finding of treachery on appeal?',
      memoType: 'case_analysis',
      status: 'completed',
      confidenceScore: 0.88,
      structuredOutput: {
        title: 'Case Analysis: Treachery in People v. Santos',
        sections: [
          {
            heading: 'Issue',
            content: 'Whether the qualifying circumstance of treachery was correctly appreciated in People v. Santos (G.R. No. 147678).',
          },
          {
            heading: 'Analysis',
            content: 'The Supreme Court applied the two-element test for treachery: (1) the means of execution gave the victim no opportunity to defend or retaliate; (2) the means were deliberately adopted. The finding rests primarily on the testimony of Maria Clara and the location of the initial wound (posterior thoracic region). Potential challenge: if the defense can establish that the altercation was preceded by a verbal confrontation (reducing the "sudden and unexpected" character), the treachery finding may be revisited. However, the Court has consistently held that a frontal confrontation followed by a surprise attack from behind still constitutes treachery (see People v. Escote, G.R. No. 140756).',
          },
          {
            heading: 'Recommendation',
            content: 'The strongest ground for appeal would be to challenge the witness credibility by presenting contradicting physical evidence (wound trajectory inconsistent with the narrated sequence). The self-defense argument is unlikely to succeed given the absence of any recovered weapon from the victim.',
          },
        ],
      },
      citationsJson: [
        { citation: 'People v. Santos, G.R. No. 147678 (2005)', documentId: docs.peopleVSantos.id },
        { citation: 'People v. Cagoco, G.R. No. 148853 (2002)', documentId: null },
        { citation: 'Article 11(1), Revised Penal Code', documentId: null },
      ],
    },
    {
      key: 'dueProcessMemo',
      userId: users.member.id,
      matterId: workspace.agabonMatter.id,
      query: 'What are the procedural due process requirements for termination of employment, and what is the employer\'s liability for non-compliance under the Agabon doctrine?',
      memoType: 'legal_opinion',
      status: 'completed',
      confidenceScore: 0.93,
      structuredOutput: {
        title: 'Legal Opinion: Procedural Due Process in Employment Termination',
        sections: [
          {
            heading: 'Background',
            content: 'Client has terminated three employees for abandonment of work without serving the required twin notices. The question is the extent of employer liability.',
          },
          {
            heading: 'Applicable Law',
            content: 'Article 297 (just causes) and Article 292(b) (twin notice requirement) of the Labor Code, as interpreted in Agabon v. NLRC (G.R. No. 158693, 2004).',
          },
          {
            heading: 'Analysis',
            content: 'Under the Agabon doctrine, a dismissal for just cause (such as abandonment) without procedural due process compliance does not render the termination illegal. The dismissal remains valid because the substantive ground exists. However, the employer is liable for nominal damages of Php 30,000 per employee for violation of the right to procedural due process. Total exposure: 3 employees × Php 30,000 = Php 90,000.',
          },
          {
            heading: 'Recommendation',
            content: '(1) Set aside Php 90,000 for potential nominal damages liability. (2) Immediately implement twin notice procedures for all future terminations. (3) Draft template first and second notices for HR department use.',
          },
        ],
      },
      citationsJson: [
        { citation: 'Agabon v. NLRC, G.R. No. 158693 (2004)', documentId: docs.agabonVNlrc.id },
        { citation: 'Article 297, Labor Code', documentId: null },
        { citation: 'Article 292(b), Labor Code', documentId: null },
      ],
    },
  ];

  for (const memo of memos) {
    const m = await prisma.legalMemo.create({
      data: {
        organizationId: users.orgId,
        userId: memo.userId,
        matterId: memo.matterId,
        query: memo.query,
        memoType: memo.memoType,
        status: memo.status,
        confidenceScore: memo.confidenceScore,
        structuredOutput: memo.structuredOutput,
        citationsJson: memo.citationsJson,
      },
    });
    result[memo.key as keyof SeededAiFeatures] = { id: m.id };
    console.log(`  Memo: ${(memo.structuredOutput as { title: string }).title.substring(0, 50)}...`);
  }

  console.log(`  ${memos.length} legal memos seeded.`);

  // =========================================================================
  // CASE COMPARISON
  // =========================================================================
  console.log('  Seeding case comparisons...');

  const comparison = await prisma.caseComparison.create({
    data: {
      organizationId: users.orgId,
      userId: users.member.id,
      matterId: workspace.santosMatter.id,
      documentIds: [docs.peopleVSantos.id, docs.agabonVNlrc.id],
      comparisonType: 'full',
      status: 'completed',
      resultJson: {
        summary: 'Both are landmark SC decisions but address different areas of law. People v. Santos is a criminal law case on treachery and self-defense, while Agabon v. NLRC is a labor law case establishing the nominal damages doctrine for procedural due process violations.',
        similarities: [
          'Both are Supreme Court decisions with significant doctrinal impact',
          'Both involve analysis of procedural requirements (criminal: witness credibility rules; labor: twin notice)',
          'Both resulted in modifications to existing legal frameworks',
        ],
        differences: [
          { aspect: 'Area of Law', docA: 'Criminal Law — Murder, Treachery', docB: 'Labor Law — Termination, Due Process' },
          { aspect: 'Key Doctrine', docA: 'Two-element treachery test; burden-shifting in self-defense', docB: 'Agabon doctrine: valid dismissal + nominal damages for procedural non-compliance' },
          { aspect: 'Outcome', docA: 'Conviction affirmed, damages modified', docB: 'Dismissal valid, Serrano doctrine abandoned, nominal damages awarded' },
          { aspect: 'Court Division', docA: 'Second Division', docB: 'En Banc' },
        ],
      },
    },
  });

  result.santosAgabonComparison = { id: comparison.id };
  console.log(`  1 case comparison seeded (Santos vs Agabon).`);

  // =========================================================================
  // PLEADINGS
  // =========================================================================
  console.log('  Seeding pleadings...');

  // Find pleading templates
  const mtdTemplate = await prisma.pleadingTemplate.findFirst({
    where: { slug: 'motion-to-dismiss' },
  });
  const mrTemplate = await prisma.pleadingTemplate.findFirst({
    where: { slug: 'motion-for-reconsideration' },
  });

  // Fallback: use first available template if specific ones don't exist
  const fallbackTemplate = await prisma.pleadingTemplate.findFirst();

  const pleadingSeeds = [
    {
      key: 'mtdPleading',
      templateId: mtdTemplate?.id ?? fallbackTemplate?.id,
      matterId: workspace.santosMatter.id,
      inputData: {
        caseTitle: 'People of the Philippines v. Roberto Santos y Dela Cruz',
        court: 'Supreme Court — Second Division',
        grNo: 'G.R. No. 147678',
        grounds: ['The lower court erred in appreciating the qualifying circumstance of treachery'],
        supportingArguments: 'The evidence shows that the victim and accused had a prior altercation, negating the element of surprise essential to treachery.',
      },
      generatedOutput: {
        title: 'MOTION TO DISMISS',
        body: 'COMES NOW the accused-appellant, by and through the undersigned counsel, and respectfully moves for the dismissal of the above-entitled case on the following grounds:\n\nI. THE LOWER COURT ERRED IN APPRECIATING TREACHERY\n\nThe prosecution failed to establish the second element of treachery — that the means of execution were deliberately adopted. The prior altercation between the accused and the victim two weeks before the incident negates the element of deliberate adoption of treacherous means...',
        prayer: 'WHEREFORE, premises considered, it is respectfully prayed that the instant Motion to Dismiss be granted and the case be DISMISSED.',
      },
      citationsJson: [
        { citation: 'People v. Santos, G.R. No. 147678', documentId: docs.peopleVSantos.id },
        { citation: 'Rules of Court, Rule 16, Section 1', documentId: docs.rulesOfCourtRule16.id },
      ],
    },
    {
      key: 'mrPleading',
      templateId: mrTemplate?.id ?? fallbackTemplate?.id,
      matterId: workspace.agabonMatter.id,
      inputData: {
        caseTitle: 'Agabon v. NLRC and Riviera Home Improvements, Inc.',
        court: 'National Labor Relations Commission',
        grounds: ['The NLRC erred in finding abandonment as a just cause for dismissal'],
        supportingArguments: 'The petitioners did not manifest a clear intention to sever the employment relationship. Mere absence is not equivalent to abandonment.',
      },
      generatedOutput: {
        title: 'MOTION FOR RECONSIDERATION',
        body: 'COMES NOW the petitioners, and respectfully move for reconsideration of the Decision dated [date] on the following grounds:\n\nI. ABSENCE DOES NOT EQUATE TO ABANDONMENT\n\nThe two elements of abandonment require: (1) failure to report without valid reason; AND (2) clear intention to sever the relationship. The second element was not established...',
        prayer: 'WHEREFORE, it is respectfully prayed that the assailed Decision be RECONSIDERED and SET ASIDE, and a new one be issued declaring the petitioners illegally dismissed.',
      },
      citationsJson: [
        { citation: 'Agabon v. NLRC, G.R. No. 158693', documentId: docs.agabonVNlrc.id },
        { citation: 'Article 297, Labor Code', documentId: null },
      ],
    },
  ];

  for (const seed of pleadingSeeds) {
    if (!seed.templateId) {
      console.log(`  Skipping pleading "${seed.key}" — no template found.`);
      continue;
    }

    const p = await prisma.pleading.create({
      data: {
        organizationId: users.orgId,
        userId: users.member.id,
        matterId: seed.matterId,
        templateId: seed.templateId,
        inputData: seed.inputData,
        generatedOutput: seed.generatedOutput,
        citationsJson: seed.citationsJson,
        status: 'completed',
      },
    });
    result[seed.key as keyof SeededAiFeatures] = { id: p.id };
    console.log(`  Pleading: ${(seed.generatedOutput as { title: string }).title}`);
  }

  console.log(`  ${pleadingSeeds.filter((s) => s.templateId).length} pleadings seeded.`);

  // =========================================================================
  // CASE TIMELINE
  // =========================================================================
  console.log('  Seeding case timelines...');

  const timeline = await prisma.caseTimeline.create({
    data: {
      organizationId: users.orgId,
      userId: users.member.id,
      matterId: workspace.santosMatter.id,
      title: 'People v. Santos — Case Timeline',
      documentIds: [docs.peopleVSantos.id],
      status: 'completed',
      timelineJson: {
        events: [
          { date: '2001-06-01', title: 'Property boundary dispute', description: 'Altercation between accused Santos and victim Reyes over property boundary.', type: 'background' },
          { date: '2001-06-15', title: 'Stabbing incident', description: 'At approximately 9:30 PM, Santos stabbed Reyes from behind in Barangay San Lorenzo, Quezon City.', type: 'incident' },
          { date: '2001-06-15', title: 'Victim pronounced dead', description: 'Juan Reyes pronounced dead on arrival at East Avenue Medical Center. Cause: hemorrhagic shock from multiple stab wounds.', type: 'incident' },
          { date: '2001-06-16', title: 'Arrest of accused', description: 'Santos arrested at his residence. Claims self-defense.', type: 'procedural' },
          { date: '2003-01-15', title: 'RTC Conviction', description: 'Regional Trial Court convicts Santos of Murder qualified by treachery.', type: 'procedural' },
          { date: '2004-09-10', title: 'CA Affirms', description: 'Court of Appeals affirms conviction in CA-G.R. CR-H.C. No. 00123.', type: 'procedural' },
          { date: '2005-03-15', title: 'SC Decision', description: 'Supreme Court affirms with modification. Reclusion perpetua without parole. Damages adjusted.', type: 'decision' },
        ],
      },
    },
  });

  result.santosTimeline = { id: timeline.id };
  console.log(`  1 case timeline seeded (People v. Santos).`);

  // =========================================================================
  // HEARING PREP PACK
  // =========================================================================
  console.log('  Seeding hearing prep packs...');

  const hearingPrep = await prisma.hearingPrepPack.create({
    data: {
      organizationId: users.orgId,
      userId: users.member.id,
      matterId: workspace.santosMatter.id,
      topic: 'Challenging Treachery Finding on Appeal',
      issue: 'Whether the qualifying circumstance of treachery was correctly appreciated given the prior altercation between accused and victim.',
      documentIds: [docs.peopleVSantos.id],
      status: 'completed',
      inputContext: {
        caseTitle: 'People v. Santos',
        grNo: 'G.R. No. 147678',
        priorRuling: 'Conviction for Murder qualified by treachery — SC affirmed.',
      },
      packJson: {
        cases: [
          { citation: 'People v. Santos, G.R. No. 147678 (2005)', relevance: 'Subject case — treachery found based on attack from behind.' },
          { citation: 'People v. Cagoco, G.R. No. 148853 (2002)', relevance: 'Cited in Santos — attack from behind is treacherous when sudden and on unsuspecting victim.' },
        ],
        provisions: [
          { citation: 'Article 248, Revised Penal Code', text: 'Murder — qualified by treachery, among others.' },
          { citation: 'Article 11(1), Revised Penal Code', text: 'Self-defense requires: unlawful aggression, reasonable necessity, lack of provocation.' },
        ],
        arguments: [
          'The prior altercation two weeks before the incident suggests the victim was aware of potential hostility, negating the "unexpected" element of treachery.',
          'The medico-legal evidence (wound locations) should be re-examined for consistency with the prosecution narrative.',
        ],
        counterArguments: [
          'The Court has consistently held that prior knowledge of an accused\'s hostility does not negate treachery if the actual attack was sudden and unexpected.',
          'The temporal distance (2 weeks) between the altercation and the attack supports the finding that treachery was deliberately adopted.',
        ],
        questions: [
          'Can the defense present new medical evidence on the wound trajectory to contradict the prosecution narrative?',
          'Is there precedent for overturning a treachery finding based on prior hostility between the parties?',
          'What is the standard for newly discovered evidence in murder appeals?',
        ],
      },
    },
  });

  result.treacheryHearingPrep = { id: hearingPrep.id };
  console.log(`  1 hearing prep pack seeded.`);

  console.log(`  AI features seed complete.`);

  return result;
}
