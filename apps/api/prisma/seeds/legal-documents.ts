/**
 * Legal Documents Seed Data — 5 Philippine legal documents with sections,
 * versions, tag maps, and cross-document citations.
 *
 * Documents:
 *   1. People v. Santos (case, criminal_law, SC)
 *   2. Agabon v. NLRC (case, labor_law, SC)
 *   3. RA 10173 — Data Privacy Act (statute, political_law)
 *   4. Civil Code — Obligations (codal, civil_law)
 *   5. Rules of Court — Rule 16 (codal, remedial_law)
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocumentSeed {
  title: string;
  shortTitle: string;
  documentType: string;
  grNo?: string;
  docketNo?: string;
  citationText: string;
  court?: string;
  agency?: string;
  ponente?: string;
  decisionDate?: string;
  promulgationDate?: string;
  publicationDate?: string;
  barSubjectCode: string;
  sections: SectionSeed[];
}

interface SectionSeed {
  sectionType: string;
  sectionLabel: string;
  plainText: string;
  ordering: number;
  pageStart?: number;
  pageEnd?: number;
  children?: SectionSeed[];
}

export interface SeededDocuments {
  peopleVSantos: { id: string; sectionIds: Record<string, string> };
  agabonVNlrc: { id: string; sectionIds: Record<string, string> };
  ra10173: { id: string; sectionIds: Record<string, string> };
  civilCodeObligations: { id: string; sectionIds: Record<string, string> };
  rulesOfCourtRule16: { id: string; sectionIds: Record<string, string> };
}

// ---------------------------------------------------------------------------
// Document Data
// ---------------------------------------------------------------------------

const DOCUMENTS: DocumentSeed[] = [
  // =========================================================================
  // 1. People v. Santos — Criminal Law Case
  // =========================================================================
  {
    title: 'People of the Philippines v. Roberto Santos y Dela Cruz',
    shortTitle: 'People v. Santos',
    documentType: 'case',
    grNo: 'G.R. No. 147678',
    citationText: 'People v. Santos, G.R. No. 147678, March 15, 2005',
    court: 'Supreme Court — Second Division',
    ponente: 'Tinga, J.',
    decisionDate: '2005-03-15',
    barSubjectCode: 'criminal_law',
    sections: [
      {
        sectionType: 'syllabus',
        sectionLabel: 'Syllabus',
        ordering: 0,
        pageStart: 1,
        pageEnd: 1,
        plainText:
          'CRIMINAL LAW; MURDER; TREACHERY. — Treachery exists when the offender commits any of the crimes against the person, employing means, methods, or forms in the execution thereof which tend directly and specially to insure its execution, without risk to himself arising from the defense which the offended party might make. The essence of treachery is the sudden and unexpected attack on an unsuspecting victim, depriving the latter of any chance to defend himself, thereby ensuring the commission of the crime without risk to the aggressor. EVIDENCE; CREDIBILITY OF WITNESSES. — The assessment of the credibility of witnesses is a function primarily lodged in the trial court. Factual findings of the trial court, especially on the credibility of witnesses, are binding on the appellate court and command respect, absent any arbitrariness or oversight of material facts or circumstances.',
      },
      {
        sectionType: 'facts',
        sectionLabel: 'Facts',
        ordering: 1,
        pageStart: 2,
        pageEnd: 4,
        plainText:
          'On the evening of June 15, 2001, at approximately 9:30 p.m., in Barangay San Lorenzo, Quezon City, the accused Roberto Santos y Dela Cruz approached the victim, Juan Reyes, from behind while the latter was walking home from a neighborhood store. Without any provocation or warning, the accused stabbed the victim on the back using a kitchen knife, hitting him on the left posterior thoracic region. The victim fell to the ground, and the accused stabbed him two more times on the chest before fleeing the scene.\n\nWitness Maria Clara testified that she saw the entire incident from her window approximately five meters away. She positively identified the accused as the person who attacked the victim. The accused and the victim were neighbors and had a prior altercation over a property boundary dispute two weeks before the incident.\n\nThe victim was rushed to East Avenue Medical Center where he was pronounced dead on arrival. The medico-legal report prepared by Dr. Elena Cruz indicated that the cause of death was hemorrhagic shock secondary to multiple stab wounds.\n\nThe accused was arrested the following day at his residence. Upon arrest, he claimed self-defense, alleging that the victim had attacked him first with a bolo. However, no bolo or any other weapon was recovered at the crime scene.',
      },
      {
        sectionType: 'issues',
        sectionLabel: 'Issues',
        ordering: 2,
        pageStart: 4,
        pageEnd: 5,
        plainText:
          'I. Whether the qualifying circumstance of treachery was sufficiently proven by the prosecution.\n\nII. Whether the trial court erred in giving full credence to the testimony of prosecution witness Maria Clara.\n\nIII. Whether the accused successfully established the justifying circumstance of self-defense.',
      },
      {
        sectionType: 'ruling',
        sectionLabel: 'Ruling',
        ordering: 3,
        pageStart: 5,
        pageEnd: 8,
        plainText:
          'The appeal is DENIED. The conviction of the accused for murder qualified by treachery is AFFIRMED with MODIFICATION.\n\nOn the first issue, the Court finds that treachery was sufficiently established. The evidence shows that the accused attacked the victim from behind without any warning or provocation. The victim was merely walking home and had no opportunity to defend himself or flee. The sudden and unexpected nature of the attack, coupled with the position of the initial wound on the victim\'s back, clearly demonstrates that the accused employed means to ensure the execution of the crime without risk to himself. The Court has consistently held that an attack from behind is treacherous when it is sudden and the victim was not in a position to defend himself (People v. Cagoco, G.R. No. 148853, April 11, 2002).\n\nOn the second issue, the trial court\'s assessment of the credibility of Maria Clara deserves full respect. Her testimony was clear, consistent, and straightforward. She positively identified the accused and narrated the sequence of events in a manner consistent with the physical evidence. The well-settled rule is that the trial court\'s assessment of the credibility of witnesses is entitled to great weight and respect and will not be disturbed on appeal absent any arbitrariness or oversight of material facts (People v. Mateo, G.R. No. 147678-87, July 7, 2004).\n\nOn the third issue, the plea of self-defense must fail. When the accused invokes self-defense, the burden of evidence shifts to him. He must prove by clear and convincing evidence the elements of self-defense under Article 11(1) of the Revised Penal Code: (1) unlawful aggression on the part of the victim; (2) reasonable necessity of the means employed to prevent or repel it; and (3) lack of sufficient provocation on the part of the person defending himself. The accused failed to establish unlawful aggression. No weapon was recovered from the victim, and the nature and location of the wounds belie the claim of self-defense. The three stab wounds — one on the back and two on the chest — are inconsistent with a defensive posture.',
      },
      {
        sectionType: 'doctrine',
        sectionLabel: 'Doctrine',
        ordering: 4,
        pageStart: 8,
        pageEnd: 9,
        plainText:
          'Treachery as a qualifying circumstance for murder requires proof that: (1) the means of execution employed gave the person attacked no opportunity to defend himself or retaliate; and (2) the means of execution were deliberately or consciously adopted. An attack from behind, sudden and unexpected, on an unarmed and unsuspecting victim constitutes treachery. The invocation of self-defense is an affirmative allegation that shifts the burden of proof to the accused, who must establish by clear and convincing evidence the concurrence of all three requisites under Article 11(1) of the Revised Penal Code.',
      },
      {
        sectionType: 'dispositive',
        sectionLabel: 'Dispositive Portion',
        ordering: 5,
        pageStart: 9,
        pageEnd: 9,
        plainText:
          'WHEREFORE, premises considered, the Decision of the Court of Appeals in CA-G.R. CR-H.C. No. 00123 dated September 10, 2004, affirming the conviction of accused-appellant Roberto Santos y Dela Cruz for the crime of Murder, is hereby AFFIRMED with MODIFICATION. The accused-appellant is sentenced to suffer the penalty of reclusion perpetua without eligibility for parole. He is further ordered to pay the heirs of the victim Juan Reyes the amounts of Php 75,000.00 as civil indemnity, Php 50,000.00 as moral damages, Php 25,000.00 as temperate damages, and Php 30,000.00 as exemplary damages. All damages awarded shall earn interest at the rate of 6% per annum from the date of finality of this Decision until fully paid.\n\nSO ORDERED.',
      },
    ],
  },

  // =========================================================================
  // 2. Agabon v. NLRC — Labor Law Case
  // =========================================================================
  {
    title: 'Virgilio Agabon and Jenny Agabon v. National Labor Relations Commission and Riviera Home Improvements, Inc.',
    shortTitle: 'Agabon v. NLRC',
    documentType: 'case',
    grNo: 'G.R. No. 158693',
    citationText: 'Agabon v. NLRC, G.R. No. 158693, November 17, 2004',
    court: 'Supreme Court — En Banc',
    ponente: 'Ynares-Santiago, J.',
    decisionDate: '2004-11-17',
    barSubjectCode: 'labor_law',
    sections: [
      {
        sectionType: 'syllabus',
        sectionLabel: 'Syllabus',
        ordering: 0,
        pageStart: 1,
        pageEnd: 2,
        plainText:
          'LABOR LAW; TERMINATION OF EMPLOYMENT; DUE PROCESS; TWIN NOTICE REQUIREMENT. — The employer is required to furnish the employee with two written notices before termination of employment can be effected: (1) a first notice apprising the employee of the particular acts or omissions for which his dismissal is sought, and (2) a second notice informing the employee of the employer\'s decision to dismiss him. The requirement of notice is not a mere formality; it serves the purpose of affording the employee an opportunity to be heard before he is dismissed. LABOR LAW; DISMISSAL; EFFECT OF NON-COMPLIANCE WITH DUE PROCESS. — Where the dismissal is for a just cause, the non-compliance with the procedural requirement of due process does not render the termination illegal or ineffectual. The dismissal remains valid, but the employer must indemnify the employee in the form of nominal damages for violation of his right to procedural due process.',
      },
      {
        sectionType: 'facts',
        sectionLabel: 'Facts',
        ordering: 1,
        pageStart: 2,
        pageEnd: 5,
        plainText:
          'Private respondent Riviera Home Improvements, Inc. is engaged in the business of selling and installing ornamental and construction materials. Petitioners Virgilio and Jenny Agabon were employed by Riviera as gypsum board and cornice installers from January 1992 until February 23, 1999, when they were dismissed.\n\nThe petitioners filed a complaint for illegal dismissal with the Labor Arbiter. They alleged that they were dismissed without just cause and without due process. Riviera, for its part, contended that the petitioners were validly dismissed for abandonment of work. It claimed that the petitioners failed to report for work beginning February 23, 1999, despite verbal and written notices to return.\n\nThe Labor Arbiter found that the petitioners were illegally dismissed, ruling that Riviera failed to prove abandonment. The NLRC reversed the Labor Arbiter, finding that the dismissal was for just cause (abandonment) but that Riviera failed to comply with the twin notice requirement. The Court of Appeals affirmed the NLRC ruling.\n\nThe case was elevated to the Supreme Court en banc to re-examine the doctrine laid down in Serrano v. National Labor Relations Commission (G.R. No. 117040, January 27, 2000) regarding the consequences of non-compliance with procedural due process in dismissals for just or authorized causes.',
      },
      {
        sectionType: 'issues',
        sectionLabel: 'Issues',
        ordering: 2,
        pageStart: 5,
        pageEnd: 5,
        plainText:
          'I. Whether the petitioners were dismissed for just cause.\n\nII. Whether the employer complied with the procedural due process requirements for termination.\n\nIII. What is the effect of the employer\'s failure to comply with procedural due process when the dismissal is for a just cause.',
      },
      {
        sectionType: 'ruling',
        sectionLabel: 'Ruling',
        ordering: 3,
        pageStart: 5,
        pageEnd: 10,
        plainText:
          'The Court finds that the petitioners were validly dismissed for abandonment of work, a just cause for termination under Article 297 (formerly Article 282) of the Labor Code. The elements of abandonment are: (1) the employee must have failed to report for work or must have been absent without valid or justifiable reason; and (2) there must have been a clear intention to sever the employer-employee relationship, manifested by some overt act. Both elements are present in this case.\n\nHowever, the Court also finds that Riviera failed to comply with the twin notice requirement under Article 292(b) (formerly Article 277(b)) of the Labor Code and Section 2, Rule XXIII, Book V of the Omnibus Rules Implementing the Labor Code. No written notices were served upon the petitioners prior to their termination.\n\nOn the crucial third issue, the Court ABANDONS the doctrine in Serrano v. NLRC that non-compliance with the notice requirement renders the dismissal ineffectual and entitles the employee to full backwages. The Court now holds:\n\nWhere the dismissal is for a just cause under Article 297 of the Labor Code, the non-compliance with the procedural requirement of the twin notice rule does NOT make the dismissal illegal or void. The dismissal remains valid because the just cause has been established. However, the employer must pay nominal damages to the employee for violating his statutory right to due process.\n\nThe rationale is that the right to due process is a personal right of the employee, the violation of which entitles him to damages but does not affect the validity of the dismissal itself. The substantive and procedural aspects of a dismissal are separate and distinct. A just cause for dismissal satisfies the substantive requirement, while compliance with the notice procedure satisfies the procedural requirement.\n\nThe Court fixes the nominal damages at Php 30,000.00 for dismissals based on just causes under Article 297, and Php 50,000.00 for dismissals based on authorized causes under Article 298.',
      },
      {
        sectionType: 'doctrine',
        sectionLabel: 'Doctrine',
        ordering: 4,
        pageStart: 10,
        pageEnd: 11,
        plainText:
          'The Agabon doctrine holds that where the dismissal is for a just or authorized cause but the employer failed to comply with the procedural due process requirement (twin notice rule), the dismissal is not rendered illegal. The termination remains valid because the substantive ground exists. However, the employer is liable for nominal damages for violation of the employee\'s right to procedural due process. This doctrine abandoned the Serrano v. NLRC ruling that equated procedural deficiency with illegality of dismissal. The distinction between substantive and procedural due process in termination cases is now firmly established: the former concerns the validity of the ground for dismissal, while the latter concerns the manner of effecting the dismissal.',
      },
      {
        sectionType: 'dispositive',
        sectionLabel: 'Dispositive Portion',
        ordering: 5,
        pageStart: 11,
        pageEnd: 11,
        plainText:
          'WHEREFORE, premises considered, the petition is DENIED. The Decision of the Court of Appeals dated January 23, 2003, finding that petitioners were validly dismissed for abandonment of work, is AFFIRMED. However, private respondent Riviera Home Improvements, Inc. is ORDERED to pay each of the petitioners the amount of Php 30,000.00 as nominal damages for non-compliance with statutory due process.\n\nThe Serrano doctrine is hereby ABANDONED insofar as it declares a dismissal for just or authorized cause but without due process as ineffectual.\n\nSO ORDERED.',
      },
    ],
  },

  // =========================================================================
  // 3. RA 10173 — Data Privacy Act of 2012
  // =========================================================================
  {
    title: 'Republic Act No. 10173 — Data Privacy Act of 2012',
    shortTitle: 'Data Privacy Act of 2012',
    documentType: 'statute',
    citationText: 'Republic Act No. 10173 (2012)',
    agency: 'Congress of the Philippines',
    publicationDate: '2012-08-15',
    promulgationDate: '2012-08-15',
    barSubjectCode: 'political_law',
    sections: [
      {
        sectionType: 'title',
        sectionLabel: 'Short Title',
        ordering: 0,
        plainText:
          'SECTION 1. Short Title. — This Act shall be known as the "Data Privacy Act of 2012."',
      },
      {
        sectionType: 'declaration_of_policy',
        sectionLabel: 'Section 2 — Declaration of Policy',
        ordering: 1,
        plainText:
          'SECTION 2. Declaration of Policy. — It is the policy of the State to protect the fundamental human right of privacy of communication while ensuring free flow of information to promote innovation and growth. The State recognizes the vital role of information and communications technology in nation-building and its inherent obligation to ensure that personal information in information and communications systems in the government and in the private sector are secured and protected.',
      },
      {
        sectionType: 'definition',
        sectionLabel: 'Section 3 — Definition of Terms',
        ordering: 2,
        plainText:
          'SECTION 3. Definition of Terms. — Whenever used in this Act, the following terms shall have the respective meanings hereafter set forth:\n\n(a) Commission shall refer to the National Privacy Commission created by virtue of this Act.\n(b) Consent of the data subject refers to any freely given, specific, informed indication of will, whereby the data subject agrees to the collection and processing of personal information about and/or relating to him or her.\n(c) Data subject refers to an individual whose personal information is processed.\n(d) Personal information refers to any information whether recorded in a material form or not, from which the identity of an individual is apparent or can be reasonably and directly ascertained by the entity holding the information, or when put together with other information would directly and certainly identify an individual.\n(e) Personal information controller refers to a person or organization who controls the collection, holding, processing or use of personal information.\n(f) Personal information processor refers to any natural or juridical person qualified to act as such under this Act to whom a personal information controller may outsource the processing of personal data.\n(g) Processing refers to any operation or any set of operations performed upon personal information.\n(h) Privileged information refers to any and all forms of data which under the Rules of Court and other pertinent laws constitute privileged communication.\n(i) Sensitive personal information refers to personal information: (1) about an individual\'s race, ethnic origin, marital status, age, color, and religious, philosophical or political affiliations; (2) about an individual\'s health, education, genetic or sexual life; (3) about any proceeding for any offense committed or alleged to have been committed by such person; (4) issued by government agencies peculiar to an individual which includes, but not limited to, social security numbers, previous or current health records, licenses or permits, tax returns, and other government-issued identification.',
      },
      {
        sectionType: 'scope',
        sectionLabel: 'Section 4 — Scope',
        ordering: 3,
        plainText:
          'SECTION 4. Scope. — This Act applies to the processing of all types of personal information and to any natural and juridical person involved in personal information processing including those personal information controllers and processors who, although not found or established in the Philippines, use equipment that are located in the Philippines, or those who maintain an office, branch or agency in the Philippines subject to the immediately succeeding paragraph: Provided, That the requirements of Section 5 are complied with.',
      },
      {
        sectionType: 'provision',
        sectionLabel: 'Section 11 — General Data Privacy Principles',
        ordering: 4,
        plainText:
          'SECTION 11. General Data Privacy Principles. — The processing of personal information shall be allowed, subject to compliance with the requirements of this Act and other laws allowing disclosure of information to the public and adherence to the principles of transparency, legitimate purpose, and proportionality.\n\nPersonal information must be:\n(a) Collected for specified and legitimate purposes determined and declared before, or as soon as reasonably practicable after collection, and later processed in a way compatible with such declared, specified and legitimate purposes only;\n(b) Processed fairly and lawfully;\n(c) Accurate, relevant and, where necessary for purposes for which it is to be used the processing of personal information, kept up to date;\n(d) Adequate and not excessive in relation to the purposes for which they are collected and processed;\n(e) Retained only for as long as necessary for the fulfillment of the purposes for which the data was obtained.',
      },
      {
        sectionType: 'provision',
        sectionLabel: 'Section 12 — Criteria for Lawful Processing',
        ordering: 5,
        plainText:
          'SECTION 12. Criteria for Lawful Processing of Personal Information. — The processing of personal information shall be permitted only if not otherwise prohibited by law, and when at least one of the following conditions exists:\n\n(a) The data subject has given his or her consent;\n(b) The processing of personal information is necessary and is related to the fulfillment of a contract with the data subject;\n(c) The processing is necessary for compliance with a legal obligation to which the personal information controller is subject;\n(d) The processing is necessary to protect vitally important interests of the data subject, including life and health;\n(e) The processing is necessary in order to respond to national emergency;\n(f) The processing is necessary for the purposes of the legitimate interests pursued by the personal information controller or by a third party.',
      },
      {
        sectionType: 'provision',
        sectionLabel: 'Section 13 — Sensitive Personal Information',
        ordering: 6,
        plainText:
          'SECTION 13. Sensitive Personal Information and Privileged Information. — The processing of sensitive personal information and privileged information shall be prohibited, except in the following cases:\n\n(a) The data subject has given his or her consent, specific to the purpose prior to the processing, or in the case of privileged information, all parties to the exchange have given their consent prior to processing;\n(b) The processing is provided for by existing laws and regulations;\n(c) The processing is necessary to protect the life and health of the data subject or another person, and the data subject is not legally or physically able to express his or her consent prior to the processing;\n(d) The processing is necessary for purposes of medical treatment, is carried out by a medical practitioner or a medical treatment institution, and an adequate level of protection of personal information is ensured;\n(e) The processing concerns personal information that is necessary for the protection of lawful rights and interests of natural or legal persons in court proceedings.',
      },
      {
        sectionType: 'provision',
        sectionLabel: 'Section 16 — Rights of the Data Subject',
        ordering: 7,
        plainText:
          'SECTION 16. Rights of the Data Subject. — The data subject is entitled to:\n\n(a) Be informed whether personal information pertaining to him or her shall be, are being or have been processed;\n(b) Be furnished the information indicated hereunder before the entry of his or her personal information into the processing system;\n(c) Reasonable access to, upon demand, the following:\n  (1) Contents of his or her personal information that were processed;\n  (2) Sources from which personal information were obtained;\n  (3) Names and addresses of recipients of the personal information;\n  (4) Manner by which such data were processed;\n  (5) Reasons for the disclosure to recipients;\n  (6) Information on automated processes where the data will or likely to be made as the sole basis for any decision significantly affecting or will affect the data subject;\n  (7) Date when his or her personal information concerning the data subject were last accessed and modified;\n  (8) The designation, or name or identity and address of the personal information controller.',
      },
      {
        sectionType: 'provision',
        sectionLabel: 'Section 20 — Security of Personal Information',
        ordering: 8,
        plainText:
          'SECTION 20. Security of Personal Information. — (a) The personal information controller must implement reasonable and appropriate organizational, physical and technical measures intended for the protection of personal information against any accidental or unlawful destruction, alteration and disclosure, as well as against any other unlawful processing.\n\n(b) The personal information controller shall implement reasonable and appropriate measures to protect personal information against natural dangers such as accidental loss or destruction, and human dangers such as unlawful access, fraudulent misuse, unlawful destruction, alteration and contamination.\n\n(c) The determination of the appropriate level of security under this section must take into account the nature of the personal information to be protected, the risks represented by the processing, the size of the organization and complexity of its operations, current data privacy best practices and the cost of security implementation.',
      },
      {
        sectionType: 'provision',
        sectionLabel: 'Section 25 — Unauthorized Processing',
        ordering: 9,
        plainText:
          'SECTION 25. Unauthorized Processing of Personal Information and Sensitive Personal Information. — (a) The unauthorized processing of personal information shall be penalized by imprisonment ranging from one (1) year to three (3) years and a fine of not less than Five hundred thousand pesos (Php500,000.00) but not more than Two million pesos (Php2,000,000.00) shall be imposed on persons who process personal information without the consent of the data subject, or without being authorized under this Act or any existing law.\n\n(b) The unauthorized processing of personal sensitive information shall be penalized by imprisonment ranging from three (3) years to six (6) years and a fine of not less than Five hundred thousand pesos (Php500,000.00) but not more than Four million pesos (Php4,000,000.00) shall be imposed on persons who process personal information without the consent of the data subject, or without being authorized under this Act or any existing law.',
      },
      {
        sectionType: 'provision',
        sectionLabel: 'Section 26 — Accessing Personal Information',
        ordering: 10,
        plainText:
          'SECTION 26. Accessing Personal Information and Sensitive Personal Information Due to Negligence. — (a) Accessing personal information due to negligence shall be penalized by imprisonment ranging from one (1) year to three (3) years and a fine of not less than Five hundred thousand pesos (Php500,000.00) but not more than Two million pesos (Php2,000,000.00) shall be imposed on persons who, due to negligence, provided access to personal information without being authorized under this Act or any existing law.\n\n(b) Accessing sensitive personal information due to negligence shall be penalized by imprisonment ranging from three (3) years to six (6) years and a fine of not less than Five hundred thousand pesos (Php500,000.00) but not more than Four million pesos (Php4,000,000.00) shall be imposed on persons who, due to negligence, provided access to personal information without being authorized under this Act or any existing law.',
      },
      {
        sectionType: 'provision',
        sectionLabel: 'Section 28 — Intentional Breach',
        ordering: 11,
        plainText:
          'SECTION 28. Intentional Breach. — (a) The penalty of imprisonment ranging from one (1) year to three (3) years and a fine of not less than Five hundred thousand pesos (Php500,000.00) but not more than Two million pesos (Php2,000,000.00) shall be imposed on persons who knowingly and unlawfully, or violating data confidentiality and security data systems, breaks in any way into any system where personal and sensitive personal information is stored.\n\n(b) The penalty of imprisonment ranging from three (3) years to six (6) years and a fine of not less than Five hundred thousand pesos (Php500,000.00) but not more than Four million pesos (Php4,000,000.00) shall be imposed on persons who knowingly and unlawfully, or violating data confidentiality and security data systems, breaks in any way into any system where personal and sensitive personal information are stored and said data are for the purpose of transmitting it to a third party.',
      },
      {
        sectionType: 'provision',
        sectionLabel: 'Section 7 — National Privacy Commission',
        ordering: 12,
        plainText:
          'SECTION 7. Functions of the National Privacy Commission. — To administer and implement the provisions of this Act, and to monitor and ensure compliance of the country with international standards set for data protection, there is hereby created an independent body to be known as the National Privacy Commission, winch shall have the following functions:\n\n(a) Ensure compliance of personal information controllers with the provisions of this Act;\n(b) Receive complaints, institute investigations, facilitate or enable settlement of complaints through the use of alternative dispute resolution processes;\n(c) Prepare, publish and review and update a plan of action for application of the provisions of this Act;\n(d) Monitor compliance and advise government agencies or private entities regarding the data privacy implications of certain programs, laws, regulations and rulings;\n(e) Coordinate with data privacy regulators in other countries and private accountability agents.',
      },
      {
        sectionType: 'provision',
        sectionLabel: 'Section 36 — Effectivity',
        ordering: 13,
        plainText:
          'SECTION 36. Effectivity. — This Act shall take effect fifteen (15) days after its complete publication in at least two (2) newspapers of general circulation.',
      },
      {
        sectionType: 'provision',
        sectionLabel: 'Section 6 — Extraterritorial Application',
        ordering: 14,
        plainText:
          'SECTION 6. Extraterritorial Application. — This Act applies to an act done or practice engaged in and outside of the Philippines by an entity if:\n\n(a) The act, practice or processing relates to personal information about a Philippine citizen or a resident;\n(b) The entity has a link with the Philippines, and the entity is processing personal information in the Philippines or even if the processing is outside the Philippines as long as it is about Philippine citizens or residents such as, but not limited to, the following:\n  (1) A contract is entered in the Philippines;\n  (2) A juridical entity unincorporated in the Philippines but has central management and control in the country; and\n  (3) An entity that has a branch, agency, office or subsidiary in the Philippines and the parent or affiliate of the Philippine entity has access to personal information.',
      },
    ],
  },

  // =========================================================================
  // 4. Civil Code — Obligations (Articles 1156-1304, representative)
  // =========================================================================
  {
    title: 'Civil Code of the Philippines — Book IV, Title I: Obligations',
    shortTitle: 'Civil Code — Obligations',
    documentType: 'codal',
    citationText: 'Civil Code, Articles 1156-1304',
    agency: 'Congress of the Philippines',
    promulgationDate: '1950-08-30',
    barSubjectCode: 'civil_law',
    sections: [
      {
        sectionType: 'article',
        sectionLabel: 'Article 1156',
        ordering: 0,
        plainText:
          'Art. 1156. An obligation is a juridical necessity to give, to do or not to do. (n)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1157',
        ordering: 1,
        plainText:
          'Art. 1157. Obligations arise from:\n(1) Law;\n(2) Contracts;\n(3) Quasi-contracts;\n(4) Acts or omissions punished by law; and\n(5) Quasi-delicts. (1089a)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1159',
        ordering: 2,
        plainText:
          'Art. 1159. Obligations arising from contracts have the force of law between the contracting parties and should be complied with in good faith. (1091a)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1163',
        ordering: 3,
        plainText:
          'Art. 1163. Every person obliged to give something is also obliged to take care of it with the proper diligence of a good father of a family, unless the law or the stipulation of the parties requires another standard of care. (1094a)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1170',
        ordering: 4,
        plainText:
          'Art. 1170. Those who in the performance of their obligations are guilty of fraud, negligence, or delay, and those who in any manner contravene the tenor thereof, are liable for damages. (1101)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1174',
        ordering: 5,
        plainText:
          'Art. 1174. Except in cases expressly specified by the law, or when it is otherwise declared by stipulation, or when the nature of the obligation requires the assumption of risk, no person shall be responsible for those events which could not be foreseen, or which, though foreseen, were inevitable. (1105a)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1191',
        ordering: 6,
        plainText:
          'Art. 1191. The power to rescind obligations is implied in reciprocal ones, in case one of the obligors should not comply with what is incumbent upon him.\n\nThe injured party may choose between the fulfillment and the rescission of the obligation, with the payment of damages in either case. He may also seek rescission, even after he has chosen fulfillment, if the latter should become impossible.\n\nThe court shall decree the rescission claimed, unless there be just cause authorizing the fixing of a period. (1124)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1193',
        ordering: 7,
        plainText:
          'Art. 1193. Obligations for whose fulfillment a day certain has been fixed, shall be demandable only when that day comes.\n\nObligations with a resolutory period take effect at once, but terminate upon arrival of the day certain.\n\nA day certain is understood to be that which must necessarily come, although it may not be known when.\n\nIf the uncertainty consists in whether the day will come or not, the obligation is conditional, and it shall be regulated by the rules of the preceding Section. (1125a)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1199',
        ordering: 8,
        plainText:
          'Art. 1199. A person alternatively bound by different prestations shall completely perform one of them.\n\nThe creditor cannot be compelled to receive part of one and part of the other undertaking. (1131)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1207',
        ordering: 9,
        plainText:
          'Art. 1207. The concurrence of two or more creditors or of two or more debtors in one and the same obligation does not imply that each one of the former has a right to demand, or that each one of the latter is bound to render, entire compliance with the prestation. There is a solidary liability only when the obligation expressly so states, or when the law or the nature of the obligation requires solidarity. (1137a)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1216',
        ordering: 10,
        plainText:
          'Art. 1216. The creditor may proceed against any one of the solidary debtors or some or all of them simultaneously. The demand made against one of them shall not be an obstacle to those which may subsequently be directed against the others, so long as the debt has not been fully collected. (1144a)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1231',
        ordering: 11,
        plainText:
          'Art. 1231. Obligations are extinguished:\n(1) By payment or performance;\n(2) By the loss of the thing due;\n(3) By the condonation or remission of the debt;\n(4) By the confusion or merger of the rights of creditor and debtor;\n(5) By compensation;\n(6) By novation.\n\nOther causes of extinguishment of obligations, such as annulment, rescission, fulfillment of a resolutory condition, and prescription, are governed elsewhere in this Code. (1156a)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1232',
        ordering: 12,
        plainText:
          'Art. 1232. Payment means not only the delivery of money but also the performance, in any other manner, of an obligation. (1157)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1233',
        ordering: 13,
        plainText:
          'Art. 1233. A debt shall not be understood to have been paid unless the thing or service in which the obligation consists has been completely delivered or rendered, as the case may be. (1157)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1244',
        ordering: 14,
        plainText:
          'Art. 1244. The debtor of a thing cannot compel the creditor to receive a different one, although the latter may be of the same value as, or more valuable than that which is due.\n\nIn obligations to do or not to do, an act or forbearance cannot be substituted by another act or forbearance against the obligee\'s will. (1166a)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1256',
        ordering: 15,
        plainText:
          'Art. 1256. If the creditor to whom tender of payment has been made refuses without just cause to accept it, the debtor shall be released from responsibility by the consignation of the thing or sum due.\n\nConsignation alone shall produce the same effect in the following cases:\n(1) When the creditor is absent or unknown, or does not appear at the place of payment;\n(2) When he is incapacitated to receive the payment at the time it is due;\n(3) When, without just cause, he refuses to give a receipt;\n(4) When two or more persons claim the same right to collect;\n(5) When the title of the obligation has been lost. (1176a)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1278',
        ordering: 16,
        plainText:
          'Art. 1278. Compensation shall take place when two persons, in their own right, are creditors and debtors of each other. (1195)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1291',
        ordering: 17,
        plainText:
          'Art. 1291. Obligations may be modified by:\n(1) Changing their object or principal conditions;\n(2) Substituting the person of the debtor;\n(3) Subrogating a third person in the rights of the creditor. (1203)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1293',
        ordering: 18,
        plainText:
          'Art. 1293. Novation which consists in substituting a new debtor in the place of the original one, may be made even without the knowledge or against the will of the latter, but not without the consent of the creditor. Payment by the new debtor gives him the rights mentioned in articles 1236 and 1237. (1205a)',
      },
      {
        sectionType: 'article',
        sectionLabel: 'Article 1304',
        ordering: 19,
        plainText:
          'Art. 1304. A creditor, to whom partial payment has been made, may exercise his right for the remainder, and he shall be preferred to the person who has been subrogated in his place in virtue of the partial payment of the same credit. (1213)',
      },
    ],
  },

  // =========================================================================
  // 5. Rules of Court — Rule 16: Motion to Dismiss
  // =========================================================================
  {
    title: 'Rules of Court — Rule 16: Motion to Dismiss',
    shortTitle: 'Rules of Court — Rule 16',
    documentType: 'codal',
    citationText: 'Rules of Court, Rule 16, §§1-6',
    court: 'Supreme Court',
    promulgationDate: '1997-07-01',
    barSubjectCode: 'remedial_law',
    sections: [
      {
        sectionType: 'section',
        sectionLabel: 'Section 1 — Grounds',
        ordering: 0,
        plainText:
          'Section 1. Grounds. — Within the time for but before filing the answer to the complaint or pleading asserting a claim, a motion to dismiss may be made on any of the following grounds:\n\n(a) That the court has no jurisdiction over the person of the defending party;\n(b) That the court has no jurisdiction over the subject matter of the claim;\n(c) That venue is improperly laid;\n(d) That the plaintiff has no legal capacity to sue;\n(e) That there is another action pending between the same parties for the same cause;\n(f) That the cause of action is barred by a prior judgment or by the statute of limitations;\n(g) That the pleading asserting the claim states no cause of action;\n(h) That the claim or demand set forth in the plaintiff\'s pleading has been paid, waived, abandoned, or otherwise extinguished;\n(i) That the claim on which the action is founded is unenforceable under the provisions of the statute of frauds; and\n(j) That a condition precedent for filing the claim has not been complied with.',
      },
      {
        sectionType: 'section',
        sectionLabel: 'Section 2 — Hearing of Motion',
        ordering: 1,
        plainText:
          'Section 2. Hearing of motion. — At the hearing of the motion, the parties shall submit their arguments on the questions of law and their evidence on the questions of fact involved except those not available at that time. Should the case go to trial, the evidence presented during the hearing shall automatically be part of the evidence of the party presenting the same.',
      },
      {
        sectionType: 'section',
        sectionLabel: 'Section 3 — Resolution of Motion',
        ordering: 2,
        plainText:
          'Section 3. Resolution of motion. — After the hearing, the court may dismiss the action or claim, deny the motion, or order the amendment of the pleading.\n\nThe court shall not defer the resolution of the motion for the reason that the ground relied upon is not indubitable.\n\nIn every case, the resolution shall state clearly and distinctly the reasons therefor.',
      },
      {
        sectionType: 'section',
        sectionLabel: 'Section 4 — Time to Plead',
        ordering: 3,
        plainText:
          'Section 4. Time to plead. — If the motion is denied, the movant shall file his answer within the balance of the period prescribed by Rule 11 to which he was entitled at the time of serving his motion, but not less than five (5) days in any event, computed from his receipt of the notice of the denial. If the pleading is ordered to be amended, he shall file his answer within the period prescribed by Rule 11 counted from service of the amended pleading, unless the court provides a longer period.',
      },
      {
        sectionType: 'section',
        sectionLabel: 'Section 5 — Effect of Dismissal',
        ordering: 4,
        plainText:
          'Section 5. Effect of dismissal. — Subject to the right of appeal, an order granting a motion to dismiss based on paragraphs (f), (h), and (i) of section 1 hereof shall bar the refiling of the same action or claim.\n\nDismissal based on paragraphs (a), (b), (c), (d), and (e) shall not bar the refiling of the same action.',
      },
      {
        sectionType: 'section',
        sectionLabel: 'Section 6 — Pleading Grounds as Affirmative Defenses',
        ordering: 5,
        plainText:
          'Section 6. Pleading grounds as affirmative defenses. — If no motion to dismiss has been filed, any of the grounds for dismissal provided for in this Rule may be pleaded as an affirmative defense in the answer and, in the discretion of the court, a preliminary hearing may be had thereon as if a motion to dismiss had been filed.\n\nThe dismissal of the complaint under this section shall be without prejudice to the prosecution in the same or separate action of a counterclaim pleaded in the answer.',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Seed Function
// ---------------------------------------------------------------------------

export async function seedLegalDocuments(prisma: PrismaClient): Promise<SeededDocuments> {
  console.log('\n--- Seeding legal documents ---');

  // Fetch a source to link documents to (use SC E-Library for cases, Congress for statutes/codals)
  const scSource = await prisma.source.findFirst({ where: { domain: 'elibrary.judiciary.gov.ph' } });
  const congressSource = await prisma.source.findFirst({ where: { domain: 'congress.gov.ph' } });

  const result = {} as SeededDocuments;
  const docKeys = [
    'peopleVSantos',
    'agabonVNlrc',
    'ra10173',
    'civilCodeObligations',
    'rulesOfCourtRule16',
  ];

  for (let i = 0; i < DOCUMENTS.length; i++) {
    const doc = DOCUMENTS[i]!;
    const key = docKeys[i]!;
    const sourceId =
      doc.documentType === 'case'
        ? scSource?.id ?? null
        : congressSource?.id ?? null;

    // Upsert document: cases by grNo, statutes/codals by title+type
    let legalDoc;
    if (doc.grNo) {
      const existing = await prisma.legalDocument.findFirst({ where: { grNo: doc.grNo } });
      if (existing) {
        legalDoc = await prisma.legalDocument.update({
          where: { id: existing.id },
          data: {
            title: doc.title,
            shortTitle: doc.shortTitle,
            citationText: doc.citationText,
            court: doc.court ?? null,
            agency: doc.agency ?? null,
            ponente: doc.ponente ?? null,
            decisionDate: doc.decisionDate ? new Date(doc.decisionDate) : null,
            promulgationDate: doc.promulgationDate ? new Date(doc.promulgationDate) : null,
            publicationDate: doc.publicationDate ? new Date(doc.publicationDate) : null,
            sourceId,
            status: 'published',
            isOfficial: true,
            isPublished: true,
            truthfulnessStatus: 'verified',
          },
        });
      } else {
        legalDoc = await prisma.legalDocument.create({
          data: {
            title: doc.title,
            shortTitle: doc.shortTitle,
            documentType: doc.documentType,
            grNo: doc.grNo,
            docketNo: doc.docketNo ?? null,
            citationText: doc.citationText,
            court: doc.court ?? null,
            agency: doc.agency ?? null,
            ponente: doc.ponente ?? null,
            decisionDate: doc.decisionDate ? new Date(doc.decisionDate) : null,
            promulgationDate: doc.promulgationDate ? new Date(doc.promulgationDate) : null,
            publicationDate: doc.publicationDate ? new Date(doc.publicationDate) : null,
            sourceId,
            jurisdiction: 'PH',
            status: 'published',
            isOfficial: true,
            isPublished: true,
            truthfulnessStatus: 'verified',
          },
        });
      }
    } else {
      const existing = await prisma.legalDocument.findFirst({
        where: { title: doc.title, documentType: doc.documentType },
      });
      if (existing) {
        legalDoc = await prisma.legalDocument.update({
          where: { id: existing.id },
          data: {
            shortTitle: doc.shortTitle,
            citationText: doc.citationText,
            court: doc.court ?? null,
            agency: doc.agency ?? null,
            promulgationDate: doc.promulgationDate ? new Date(doc.promulgationDate) : null,
            publicationDate: doc.publicationDate ? new Date(doc.publicationDate) : null,
            sourceId,
            status: 'published',
            isOfficial: true,
            isPublished: true,
            truthfulnessStatus: 'verified',
          },
        });
      } else {
        legalDoc = await prisma.legalDocument.create({
          data: {
            title: doc.title,
            shortTitle: doc.shortTitle,
            documentType: doc.documentType,
            citationText: doc.citationText,
            court: doc.court ?? null,
            agency: doc.agency ?? null,
            promulgationDate: doc.promulgationDate ? new Date(doc.promulgationDate) : null,
            publicationDate: doc.publicationDate ? new Date(doc.publicationDate) : null,
            sourceId,
            jurisdiction: 'PH',
            status: 'published',
            isOfficial: true,
            isPublished: true,
            truthfulnessStatus: 'verified',
          },
        });
      }
    }

    // Delete existing sections (simpler than per-section upsert)
    await prisma.legalDocumentSection.deleteMany({ where: { legalDocumentId: legalDoc.id } });

    // Create sections
    const sectionIds: Record<string, string> = {};
    for (const section of doc.sections) {
      const created = await prisma.legalDocumentSection.create({
        data: {
          legalDocumentId: legalDoc.id,
          sectionType: section.sectionType,
          sectionLabel: section.sectionLabel,
          ordering: section.ordering,
          plainText: section.plainText,
          pageStart: section.pageStart ?? null,
          pageEnd: section.pageEnd ?? null,
          tokenCount: Math.ceil(section.plainText.split(/\s+/).length * 1.3),
        },
      });
      sectionIds[section.sectionType + '_' + section.ordering] = created.id;
      // Also store by sectionLabel for easier reference
      sectionIds[section.sectionLabel] = created.id;
    }

    // Create version record
    const snapshotHash = crypto
      .createHash('sha256')
      .update(doc.sections.map((s) => s.plainText).join('\n'))
      .digest('hex');

    await prisma.legalDocumentVersion.deleteMany({ where: { legalDocumentId: legalDoc.id } });
    await prisma.legalDocumentVersion.create({
      data: {
        legalDocumentId: legalDoc.id,
        snapshotHash,
        parserVersion: 'seed-v1.0',
      },
    });

    // Tag map: link to bar subject
    const tag = await prisma.legalMetadataTag.findUnique({ where: { code: doc.barSubjectCode } });
    if (tag) {
      await prisma.legalDocumentTagMap.deleteMany({ where: { legalDocumentId: legalDoc.id } });
      await prisma.legalDocumentTagMap.create({
        data: { legalDocumentId: legalDoc.id, tagId: tag.id },
      });
    }

    result[key as keyof SeededDocuments] = { id: legalDoc.id, sectionIds };
    console.log(
      `  Document: ${doc.shortTitle} (${doc.documentType}) → ${legalDoc.id} [${doc.sections.length} sections]`,
    );
  }

  // -------------------------------------------------------------------------
  // Cross-document citations (~8)
  // -------------------------------------------------------------------------
  console.log('  Seeding citations...');

  // Delete existing seed citations for these documents
  const docIds = Object.values(result).map((d) => d.id);
  await prisma.citation.deleteMany({ where: { fromDocumentId: { in: docIds } } });

  const citations = [
    // People v. Santos cites People v. Cagoco
    {
      fromDocumentId: result['peopleVSantos']!.id,
      fromSectionId: result['peopleVSantos']!.sectionIds['Ruling'],
      toDocumentId: null, // external case not in our corpus
      citationText: 'People v. Cagoco, G.R. No. 148853, April 11, 2002',
      citationType: 'case_citation',
      normalizedCitation: 'G.R. No. 148853',
      confidence: 0.95,
    },
    // People v. Santos cites People v. Mateo
    {
      fromDocumentId: result['peopleVSantos']!.id,
      fromSectionId: result['peopleVSantos']!.sectionIds['Ruling'],
      toDocumentId: null,
      citationText: 'People v. Mateo, G.R. No. 147678-87, July 7, 2004',
      citationType: 'case_citation',
      normalizedCitation: 'G.R. No. 147678-87',
      confidence: 0.92,
    },
    // People v. Santos cites RPC Art. 11(1)
    {
      fromDocumentId: result['peopleVSantos']!.id,
      fromSectionId: result['peopleVSantos']!.sectionIds['Ruling'],
      toDocumentId: null,
      citationText: 'Article 11(1) of the Revised Penal Code',
      citationType: 'statute_citation',
      normalizedCitation: 'RPC Art. 11(1)',
      confidence: 0.98,
    },
    // Agabon cites Serrano v. NLRC
    {
      fromDocumentId: result['agabonVNlrc']!.id,
      fromSectionId: result['agabonVNlrc']!.sectionIds['Facts'],
      toDocumentId: null,
      citationText: 'Serrano v. National Labor Relations Commission, G.R. No. 117040, January 27, 2000',
      citationType: 'case_citation',
      normalizedCitation: 'G.R. No. 117040',
      confidence: 0.97,
    },
    // Agabon cites Labor Code Art. 297
    {
      fromDocumentId: result['agabonVNlrc']!.id,
      fromSectionId: result['agabonVNlrc']!.sectionIds['Ruling'],
      toDocumentId: null,
      citationText: 'Article 297 (formerly Article 282) of the Labor Code',
      citationType: 'statute_citation',
      normalizedCitation: 'Labor Code Art. 297',
      confidence: 0.99,
    },
    // Agabon cites Labor Code Art. 292(b)
    {
      fromDocumentId: result['agabonVNlrc']!.id,
      fromSectionId: result['agabonVNlrc']!.sectionIds['Ruling'],
      toDocumentId: null,
      citationText: 'Article 292(b) (formerly Article 277(b)) of the Labor Code',
      citationType: 'statute_citation',
      normalizedCitation: 'Labor Code Art. 292(b)',
      confidence: 0.99,
    },
    // Civil Code Art. 1170 cites Civil Code Art. 1174 (cross-reference)
    {
      fromDocumentId: result['civilCodeObligations']!.id,
      fromSectionId: result['civilCodeObligations']!.sectionIds['Article 1170'],
      toDocumentId: result['civilCodeObligations']!.id,
      citationText: 'Article 1174, Civil Code',
      citationType: 'codal_citation',
      normalizedCitation: 'CC Art. 1174',
      confidence: 0.99,
    },
    // Rules of Court Rule 16 cites Rules of Court Rule 11
    {
      fromDocumentId: result['rulesOfCourtRule16']!.id,
      fromSectionId: result['rulesOfCourtRule16']!.sectionIds['Section 4 — Time to Plead'],
      toDocumentId: null,
      citationText: 'Rule 11 of the Rules of Court',
      citationType: 'codal_citation',
      normalizedCitation: 'Rules of Court, Rule 11',
      confidence: 0.98,
    },
  ];

  for (const cite of citations) {
    await prisma.citation.create({
      data: {
        fromDocumentId: cite.fromDocumentId,
        fromSectionId: cite.fromSectionId ?? null,
        toDocumentId: cite.toDocumentId,
        citationText: cite.citationText,
        citationType: cite.citationType,
        normalizedCitation: cite.normalizedCitation,
        confidence: cite.confidence,
        resolvedAt: cite.toDocumentId ? new Date() : null,
        resolverMethod: cite.toDocumentId ? 'seed' : null,
      },
    });
  }

  console.log(`  ${citations.length} citations created.`);

  const totalSections = DOCUMENTS.reduce((acc, d) => acc + d.sections.length, 0);
  console.log(`  ${DOCUMENTS.length} documents, ${totalSections} sections seeded.`);

  return result;
}
