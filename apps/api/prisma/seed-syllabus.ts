/**
 * Seed script for Bar Exam Syllabus data.
 *
 * Usage: npx ts-node prisma/seed-syllabus.ts
 * Idempotent — uses upserts keyed on barSubjectCode and syllabusId+slug.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface TopicSeed {
  slug: string;
  title: string;
  description?: string;
  children?: TopicSeed[];
}

interface SyllabusSeed {
  barSubjectCode: string;
  title: string;
  description: string;
  examYear: number;
  ordering: number;
  topics: TopicSeed[];
}

const SYLLABI: SyllabusSeed[] = [
  {
    barSubjectCode: 'political_law',
    title: 'Political Law and Public International Law',
    description: 'Constitutional law, administrative law, election law, local government, and public international law principles.',
    examYear: 2025,
    ordering: 0,
    topics: [
      {
        slug: 'constitutional-law',
        title: 'Constitutional Law',
        children: [
          { slug: 'general-considerations', title: 'General Considerations' },
          { slug: 'national-territory', title: 'National Territory' },
          { slug: 'declaration-of-principles', title: 'Declaration of Principles and State Policies' },
          { slug: 'bill-of-rights', title: 'Bill of Rights' },
          { slug: 'citizenship', title: 'Citizenship' },
          { slug: 'suffrage', title: 'Suffrage' },
          { slug: 'legislative-department', title: 'Legislative Department' },
          { slug: 'executive-department', title: 'Executive Department' },
          { slug: 'judicial-department', title: 'Judicial Department' },
          { slug: 'constitutional-commissions', title: 'Constitutional Commissions' },
          { slug: 'local-government', title: 'Local Government' },
          { slug: 'accountability-public-officers', title: 'Accountability of Public Officers' },
          { slug: 'national-economy-patrimony', title: 'National Economy and Patrimony' },
          { slug: 'social-justice', title: 'Social Justice and Human Rights' },
          { slug: 'amendment-revision', title: 'Amendments or Revisions' },
        ],
      },
      {
        slug: 'administrative-law',
        title: 'Administrative Law',
        children: [
          { slug: 'admin-general-principles', title: 'General Principles' },
          { slug: 'admin-agencies', title: 'Administrative Agencies' },
          { slug: 'powers-admin-agencies', title: 'Powers of Administrative Agencies' },
          { slug: 'admin-due-process', title: 'Due Process in Administrative Proceedings' },
          { slug: 'admin-judicial-review', title: 'Judicial Review of Administrative Decisions' },
          { slug: 'govt-contracts', title: 'Government Contracts' },
        ],
      },
      {
        slug: 'election-law',
        title: 'Election Law',
        children: [
          { slug: 'election-suffrage', title: 'Suffrage and Qualification of Voters' },
          { slug: 'election-registration', title: 'Registration of Voters' },
          { slug: 'election-candidacy', title: 'Candidacy and Campaign' },
          { slug: 'election-contests', title: 'Election Contests' },
        ],
      },
      {
        slug: 'public-intl-law',
        title: 'Public International Law',
        children: [
          { slug: 'intl-law-general', title: 'General Principles' },
          { slug: 'intl-law-sources', title: 'Sources of International Law' },
          { slug: 'intl-law-subjects', title: 'Subjects of International Law' },
          { slug: 'intl-law-treaties', title: 'Treaty Law' },
          { slug: 'intl-law-state-responsibility', title: 'State Responsibility' },
          { slug: 'intl-law-dispute-settlement', title: 'Dispute Settlement' },
          { slug: 'intl-humanitarian-law', title: 'International Humanitarian Law' },
        ],
      },
    ],
  },
  {
    barSubjectCode: 'labor_law',
    title: 'Labor Law and Social Legislation',
    description: 'Labor standards, labor relations, social legislation, and related special laws.',
    examYear: 2025,
    ordering: 1,
    topics: [
      {
        slug: 'labor-standards',
        title: 'Labor Standards',
        children: [
          { slug: 'conditions-of-employment', title: 'Conditions of Employment' },
          { slug: 'wages', title: 'Wages' },
          { slug: 'hours-of-work', title: 'Hours of Work' },
          { slug: 'rest-periods-holidays', title: 'Rest Periods and Holidays' },
          { slug: 'employment-of-women-minors', title: 'Employment of Women and Minors' },
          { slug: 'occupational-safety', title: 'Occupational Safety and Health' },
          { slug: 'termination-of-employment', title: 'Termination of Employment' },
          { slug: 'retirement', title: 'Retirement' },
        ],
      },
      {
        slug: 'labor-relations',
        title: 'Labor Relations',
        children: [
          { slug: 'right-to-self-organization', title: 'Right to Self-Organization' },
          { slug: 'collective-bargaining', title: 'Collective Bargaining' },
          { slug: 'unfair-labor-practices', title: 'Unfair Labor Practices' },
          { slug: 'strikes-lockouts', title: 'Strikes and Lockouts' },
          { slug: 'grievance-machinery', title: 'Grievance Machinery and Voluntary Arbitration' },
          { slug: 'jurisdiction-labor', title: 'Jurisdiction in Labor Disputes' },
        ],
      },
      {
        slug: 'social-legislation',
        title: 'Social Legislation',
        children: [
          { slug: 'sss-law', title: 'Social Security System (SSS)' },
          { slug: 'gsis-law', title: 'Government Service Insurance System (GSIS)' },
          { slug: 'philhealth', title: 'PhilHealth' },
          { slug: 'pagibig', title: 'Pag-IBIG Fund' },
          { slug: 'employees-compensation', title: "Employees' Compensation" },
        ],
      },
    ],
  },
  {
    barSubjectCode: 'civil_law',
    title: 'Civil Law',
    description: 'Persons and family relations, property, succession, obligations and contracts.',
    examYear: 2025,
    ordering: 2,
    topics: [
      {
        slug: 'persons-family-relations',
        title: 'Persons and Family Relations',
        children: [
          { slug: 'civil-personality', title: 'Civil Personality' },
          { slug: 'marriage', title: 'Marriage' },
          { slug: 'legal-separation', title: 'Legal Separation' },
          { slug: 'property-relations-spouses', title: 'Property Relations Between Spouses' },
          { slug: 'family-code', title: 'The Family' },
          { slug: 'paternity-filiation', title: 'Paternity and Filiation' },
          { slug: 'adoption', title: 'Adoption' },
          { slug: 'support', title: 'Support' },
          { slug: 'parental-authority', title: 'Parental Authority' },
          { slug: 'emancipation-age-majority', title: 'Emancipation and Age of Majority' },
          { slug: 'funerals', title: 'Funerals' },
        ],
      },
      {
        slug: 'property',
        title: 'Property, Ownership, and Its Modifications',
        children: [
          { slug: 'classification-of-property', title: 'Classification of Property' },
          { slug: 'ownership', title: 'Ownership' },
          { slug: 'co-ownership', title: 'Co-Ownership' },
          { slug: 'possession', title: 'Possession' },
          { slug: 'usufruct', title: 'Usufruct' },
          { slug: 'easements', title: 'Easements and Servitudes' },
          { slug: 'nuisance', title: 'Nuisance' },
          { slug: 'land-registration', title: 'Land Registration and Titles' },
        ],
      },
      {
        slug: 'succession',
        title: 'Succession',
        children: [
          { slug: 'general-provisions-succession', title: 'General Provisions on Succession' },
          { slug: 'testamentary-succession', title: 'Testamentary Succession' },
          { slug: 'legal-intestate-succession', title: 'Legal or Intestate Succession' },
          { slug: 'provisions-common-succession', title: 'Provisions Common to Testate and Intestate Succession' },
          { slug: 'partition-distribution', title: 'Partition and Distribution of the Estate' },
        ],
      },
      {
        slug: 'obligations-contracts',
        title: 'Obligations and Contracts',
        children: [
          { slug: 'obligations-general', title: 'Obligations — General Provisions' },
          { slug: 'nature-effect-obligations', title: 'Nature and Effect of Obligations' },
          { slug: 'extinguishment-obligations', title: 'Extinguishment of Obligations' },
          { slug: 'contracts-general', title: 'Contracts — General Provisions' },
          { slug: 'consent', title: 'Consent' },
          { slug: 'object-of-contracts', title: 'Object of Contracts' },
          { slug: 'cause-of-contracts', title: 'Cause of Contracts' },
          { slug: 'defective-contracts', title: 'Defective Contracts' },
          { slug: 'sales', title: 'Sales' },
          { slug: 'lease', title: 'Lease' },
          { slug: 'agency', title: 'Agency' },
          { slug: 'loan', title: 'Loan' },
          { slug: 'deposit', title: 'Deposit' },
          { slug: 'guaranty-suretyship', title: 'Guaranty and Suretyship' },
          { slug: 'pledge-mortgage', title: 'Pledge and Mortgage' },
          { slug: 'quasi-contracts', title: 'Quasi-Contracts' },
          { slug: 'quasi-delicts', title: 'Quasi-Delicts' },
          { slug: 'damages', title: 'Damages' },
        ],
      },
    ],
  },
  {
    barSubjectCode: 'taxation_law',
    title: 'Taxation Law',
    description: 'General principles, income taxation, transfer taxes, VAT, local taxation, and tax remedies.',
    examYear: 2025,
    ordering: 3,
    topics: [
      {
        slug: 'general-principles-taxation',
        title: 'General Principles of Taxation',
        children: [
          { slug: 'taxation-definition-nature', title: 'Definition and Nature of Taxation' },
          { slug: 'taxation-theory-basis', title: 'Theory and Basis of Taxation' },
          { slug: 'inherent-limitations', title: 'Inherent Limitations on Taxation' },
          { slug: 'constitutional-limitations', title: 'Constitutional Limitations on Taxation' },
          { slug: 'situs-of-taxation', title: 'Situs of Taxation' },
          { slug: 'double-taxation', title: 'Double Taxation' },
          { slug: 'tax-exemptions', title: 'Tax Exemptions' },
        ],
      },
      {
        slug: 'income-taxation',
        title: 'Income Taxation',
        children: [
          { slug: 'income-tax-general', title: 'General Principles of Income Taxation' },
          { slug: 'gross-income', title: 'Gross Income' },
          { slug: 'deductions', title: 'Deductions from Gross Income' },
          { slug: 'individual-income-tax', title: 'Income Tax on Individuals' },
          { slug: 'corporate-income-tax', title: 'Income Tax on Corporations' },
          { slug: 'partnerships-taxation', title: 'Taxation of Partnerships' },
          { slug: 'withholding-taxes', title: 'Withholding Taxes' },
        ],
      },
      {
        slug: 'transfer-taxes',
        title: 'Transfer Taxes',
        children: [
          { slug: 'estate-tax', title: 'Estate Tax' },
          { slug: 'donors-tax', title: "Donor's Tax" },
        ],
      },
      {
        slug: 'vat-percentage-taxes',
        title: 'VAT and Percentage Taxes',
        children: [
          { slug: 'vat', title: 'Value-Added Tax' },
          { slug: 'other-percentage-taxes', title: 'Other Percentage Taxes' },
          { slug: 'excise-taxes', title: 'Excise Taxes' },
          { slug: 'documentary-stamp-tax', title: 'Documentary Stamp Tax' },
        ],
      },
      {
        slug: 'tax-remedies',
        title: 'Tax Remedies',
        children: [
          { slug: 'govt-remedies', title: 'Government Remedies' },
          { slug: 'taxpayer-remedies', title: 'Taxpayer Remedies' },
          { slug: 'court-of-tax-appeals', title: 'Court of Tax Appeals' },
        ],
      },
      {
        slug: 'local-taxation',
        title: 'Local Taxation',
        children: [
          { slug: 'local-govt-taxation-power', title: 'Local Government Taxation Power' },
          { slug: 'real-property-tax', title: 'Real Property Tax' },
        ],
      },
    ],
  },
  {
    barSubjectCode: 'commercial_law',
    title: 'Commercial Law (Mercantile Law)',
    description: 'Corporation law, negotiable instruments, insurance, transportation, banking, intellectual property, and special commercial laws.',
    examYear: 2025,
    ordering: 4,
    topics: [
      {
        slug: 'corporation-law',
        title: 'Corporation Law',
        children: [
          { slug: 'corp-general-provisions', title: 'General Provisions and Definitions' },
          { slug: 'incorporation-organization', title: 'Incorporation and Organization' },
          { slug: 'board-directors-trustees', title: 'Board of Directors/Trustees and Officers' },
          { slug: 'powers-of-corporations', title: 'Powers of Corporations' },
          { slug: 'bylaws', title: 'By-Laws' },
          { slug: 'stockholders-members', title: 'Stockholders and Members' },
          { slug: 'corporate-stocks', title: 'Corporate Stocks and Stockholders' },
          { slug: 'merger-consolidation', title: 'Merger and Consolidation' },
          { slug: 'dissolution-liquidation', title: 'Dissolution and Liquidation' },
          { slug: 'special-corporations', title: 'Special Corporations' },
          { slug: 'foreign-corporations', title: 'Foreign Corporations' },
        ],
      },
      {
        slug: 'negotiable-instruments',
        title: 'Negotiable Instruments Law',
        children: [
          { slug: 'nil-form-interpretation', title: 'Form and Interpretation' },
          { slug: 'nil-consideration', title: 'Consideration' },
          { slug: 'nil-negotiation', title: 'Negotiation' },
          { slug: 'nil-holder-due-course', title: 'Holder in Due Course' },
          { slug: 'nil-presentment-dishonor', title: 'Presentment and Dishonor' },
          { slug: 'nil-discharge', title: 'Discharge' },
        ],
      },
      {
        slug: 'insurance-law',
        title: 'Insurance Law',
        children: [
          { slug: 'insurance-general', title: 'General Provisions' },
          { slug: 'insurable-interest', title: 'Insurable Interest' },
          { slug: 'insurance-concealment-representation', title: 'Concealment and Representation' },
          { slug: 'insurance-policy', title: 'The Policy' },
          { slug: 'insurance-claims', title: 'Claims Settlement' },
        ],
      },
      {
        slug: 'transportation-law',
        title: 'Transportation Law',
        children: [
          { slug: 'common-carriers', title: 'Common Carriers' },
          { slug: 'maritime-commerce', title: 'Maritime Commerce' },
          { slug: 'carriage-of-goods-by-sea', title: 'Carriage of Goods by Sea' },
        ],
      },
      {
        slug: 'banking-laws',
        title: 'Banking Laws',
        children: [
          { slug: 'general-banking-law', title: 'General Banking Law' },
          { slug: 'bsp-charter', title: 'BSP Charter' },
          { slug: 'secrecy-bank-deposits', title: 'Secrecy of Bank Deposits' },
          { slug: 'anti-money-laundering', title: 'Anti-Money Laundering Act' },
        ],
      },
      {
        slug: 'intellectual-property',
        title: 'Intellectual Property Law',
        children: [
          { slug: 'ip-patents', title: 'Patents' },
          { slug: 'ip-trademarks', title: 'Trademarks' },
          { slug: 'ip-copyrights', title: 'Copyrights' },
        ],
      },
    ],
  },
  {
    barSubjectCode: 'criminal_law',
    title: 'Criminal Law',
    description: 'Revised Penal Code (Books I and II) and special penal laws.',
    examYear: 2025,
    ordering: 5,
    topics: [
      {
        slug: 'rpc-book-one',
        title: 'Revised Penal Code — Book One',
        children: [
          { slug: 'felonies-general', title: 'Felonies and Circumstances Affecting Criminal Liability' },
          { slug: 'justifying-circumstances', title: 'Justifying Circumstances' },
          { slug: 'exempting-circumstances', title: 'Exempting Circumstances' },
          { slug: 'mitigating-circumstances', title: 'Mitigating Circumstances' },
          { slug: 'aggravating-circumstances', title: 'Aggravating Circumstances' },
          { slug: 'alternative-circumstances', title: 'Alternative Circumstances' },
          { slug: 'persons-criminally-liable', title: 'Persons Criminally Liable' },
          { slug: 'penalties-general', title: 'Penalties — General Provisions' },
          { slug: 'extinction-criminal-liability', title: 'Extinction of Criminal Liability' },
          { slug: 'civil-liability-crime', title: 'Civil Liability Arising from Crime' },
        ],
      },
      {
        slug: 'rpc-book-two',
        title: 'Revised Penal Code — Book Two',
        children: [
          { slug: 'crimes-against-national-security', title: 'Crimes Against National Security' },
          { slug: 'crimes-against-public-order', title: 'Crimes Against Public Order' },
          { slug: 'crimes-against-public-interest', title: 'Crimes Against Public Interest' },
          { slug: 'crimes-against-public-morals', title: 'Crimes Against Public Morals' },
          { slug: 'crimes-against-persons', title: 'Crimes Against Persons' },
          { slug: 'crimes-against-personal-liberty', title: 'Crimes Against Personal Liberty and Security' },
          { slug: 'crimes-against-property', title: 'Crimes Against Property' },
          { slug: 'crimes-against-chastity', title: 'Crimes Against Chastity' },
          { slug: 'crimes-against-civil-status', title: 'Crimes Against Civil Status' },
          { slug: 'crimes-public-officers', title: 'Crimes Committed by Public Officers' },
        ],
      },
      {
        slug: 'special-penal-laws',
        title: 'Special Penal Laws',
        children: [
          { slug: 'ra-9165-dangerous-drugs', title: 'Comprehensive Dangerous Drugs Act (RA 9165)' },
          { slug: 'ra-10591-firearms', title: 'Firearms and Ammunition Law (RA 10591)' },
          { slug: 'ra-9262-vawc', title: 'Anti-Violence Against Women and Children Act (RA 9262)' },
          { slug: 'ra-7610-child-abuse', title: 'Special Protection of Children Against Abuse (RA 7610)' },
          { slug: 'ra-9208-trafficking', title: 'Anti-Trafficking in Persons Act (RA 9208)' },
          { slug: 'ra-10175-cybercrime', title: 'Cybercrime Prevention Act (RA 10175)' },
          { slug: 'ra-3019-anti-graft', title: 'Anti-Graft and Corrupt Practices Act (RA 3019)' },
          { slug: 'bouncing-checks-law', title: 'Bouncing Checks Law (BP 22)' },
          { slug: 'plunder-law', title: 'Plunder Law (RA 7080)' },
        ],
      },
    ],
  },
  {
    barSubjectCode: 'remedial_law',
    title: 'Remedial Law',
    description: 'Civil procedure, criminal procedure, evidence, special proceedings, and special civil actions.',
    examYear: 2025,
    ordering: 6,
    topics: [
      {
        slug: 'civil-procedure',
        title: 'Civil Procedure',
        children: [
          { slug: 'jurisdiction', title: 'Jurisdiction' },
          { slug: 'actions-general', title: 'Actions — General Principles' },
          { slug: 'parties-to-civil-actions', title: 'Parties to Civil Actions' },
          { slug: 'pleadings', title: 'Pleadings' },
          { slug: 'motions', title: 'Motions' },
          { slug: 'dismissal-of-actions', title: 'Dismissal of Actions' },
          { slug: 'pre-trial', title: 'Pre-Trial' },
          { slug: 'trial', title: 'Trial' },
          { slug: 'judgments-final-orders', title: 'Judgments and Final Orders' },
          { slug: 'post-judgment-remedies', title: 'Post-Judgment Remedies' },
          { slug: 'execution-satisfaction', title: 'Execution, Satisfaction, and Effect of Judgments' },
          { slug: 'provisional-remedies', title: 'Provisional Remedies' },
        ],
      },
      {
        slug: 'criminal-procedure',
        title: 'Criminal Procedure',
        children: [
          { slug: 'prosecution-offenses', title: 'Prosecution of Offenses' },
          { slug: 'arrest', title: 'Arrest' },
          { slug: 'bail', title: 'Bail' },
          { slug: 'rights-of-accused', title: 'Rights of the Accused' },
          { slug: 'arraignment-plea', title: 'Arraignment and Plea' },
          { slug: 'criminal-trial', title: 'Trial in Criminal Cases' },
          { slug: 'judgment-criminal', title: 'Judgment in Criminal Cases' },
          { slug: 'appeal-criminal', title: 'Appeal in Criminal Cases' },
          { slug: 'search-warrant-seizure', title: 'Search Warrants and Seizure' },
        ],
      },
      {
        slug: 'evidence',
        title: 'Evidence',
        children: [
          { slug: 'evidence-general', title: 'General Principles of Evidence' },
          { slug: 'judicial-notice-admissions', title: 'Judicial Notice and Judicial Admissions' },
          { slug: 'object-evidence', title: 'Object (Real) Evidence' },
          { slug: 'documentary-evidence', title: 'Documentary Evidence' },
          { slug: 'testimonial-evidence', title: 'Testimonial Evidence' },
          { slug: 'burden-proof-presumptions', title: 'Burden of Proof and Presumptions' },
          { slug: 'hearsay-rule', title: 'Hearsay Rule and Exceptions' },
          { slug: 'opinion-rule', title: 'Opinion Rule' },
          { slug: 'authentication-proof', title: 'Authentication and Proof of Documents' },
        ],
      },
      {
        slug: 'special-proceedings',
        title: 'Special Proceedings',
        children: [
          { slug: 'settlement-estates', title: 'Settlement of Estates' },
          { slug: 'guardianship', title: 'Guardianship' },
          { slug: 'habeas-corpus', title: 'Habeas Corpus' },
          { slug: 'change-of-name', title: 'Change of Name' },
          { slug: 'absentees', title: 'Absentees' },
          { slug: 'adoption-special', title: 'Adoption' },
          { slug: 'writ-amparo', title: 'Writ of Amparo' },
          { slug: 'writ-habeas-data', title: 'Writ of Habeas Data' },
          { slug: 'writ-kalikasan', title: 'Writ of Kalikasan' },
        ],
      },
    ],
  },
  {
    barSubjectCode: 'legal_ethics',
    title: 'Legal Ethics and Practical Exercises',
    description: 'Code of Professional Responsibility, duties of attorneys, judicial ethics, and law practice.',
    examYear: 2025,
    ordering: 7,
    topics: [
      {
        slug: 'cpra',
        title: 'Code of Professional Responsibility and Accountability',
        children: [
          { slug: 'canons-lawyer-state', title: 'Duties of a Lawyer to the State' },
          { slug: 'canons-lawyer-legal-profession', title: 'Duties of a Lawyer to the Legal Profession' },
          { slug: 'canons-lawyer-courts', title: 'Duties of a Lawyer to the Courts' },
          { slug: 'canons-lawyer-client', title: 'Duties of a Lawyer to the Client' },
          { slug: 'lawyer-client-relationship', title: 'Lawyer-Client Relationship' },
          { slug: 'legal-fees', title: 'Legal Fees' },
          { slug: 'conflict-of-interest', title: 'Conflict of Interest' },
          { slug: 'confidentiality', title: 'Confidentiality of Information' },
        ],
      },
      {
        slug: 'admission-practice',
        title: 'Admission to the Practice of Law',
        children: [
          { slug: 'bar-admission', title: 'Requirements for Bar Admission' },
          { slug: 'unauthorized-practice', title: 'Unauthorized Practice of Law' },
          { slug: 'ibp-membership', title: 'IBP Membership and MCLE' },
        ],
      },
      {
        slug: 'judicial-ethics',
        title: 'Judicial Ethics',
        children: [
          { slug: 'new-code-judicial-conduct', title: 'New Code of Judicial Conduct' },
          { slug: 'disqualification-inhibition', title: 'Disqualification and Inhibition' },
          { slug: 'discipline-judges', title: 'Discipline of Judges' },
        ],
      },
      {
        slug: 'disciplinary-proceedings',
        title: 'Disciplinary Proceedings',
        children: [
          { slug: 'disbarment', title: 'Disbarment and Suspension' },
          { slug: 'grounds-discipline', title: 'Grounds for Discipline' },
          { slug: 'reinstatement', title: 'Reinstatement' },
        ],
      },
    ],
  },
  {
    barSubjectCode: 'public_international_law',
    title: 'Public International Law (Extended)',
    description: 'Detailed coverage of international law topics as a standalone bar subject.',
    examYear: 2025,
    ordering: 8,
    topics: [
      {
        slug: 'foundations-intl-law',
        title: 'Foundations of International Law',
        children: [
          { slug: 'intl-law-nature-scope', title: 'Nature and Scope' },
          { slug: 'intl-law-sources-detailed', title: 'Sources — Treaties, Custom, General Principles' },
          { slug: 'intl-law-relationship-municipal', title: 'Relationship with Municipal Law' },
        ],
      },
      {
        slug: 'subjects-intl-law',
        title: 'Subjects of International Law',
        children: [
          { slug: 'states-recognition', title: 'States — Recognition and Succession' },
          { slug: 'international-organizations', title: 'International Organizations' },
          { slug: 'individuals-intl-law', title: 'Individuals in International Law' },
        ],
      },
      {
        slug: 'territory-jurisdiction',
        title: 'Territory and Jurisdiction',
        children: [
          { slug: 'territory-land-sea-air', title: 'Land, Sea, and Airspace' },
          { slug: 'law-of-the-sea', title: 'Law of the Sea (UNCLOS)' },
          { slug: 'nationality-jurisdiction', title: 'Nationality and Jurisdiction' },
        ],
      },
      {
        slug: 'international-human-rights',
        title: 'International Human Rights Law',
        children: [
          { slug: 'udhr-covenants', title: 'UDHR, ICCPR, ICESCR' },
          { slug: 'regional-human-rights', title: 'Regional Human Rights Systems' },
          { slug: 'refugee-law', title: 'Refugee Law' },
        ],
      },
      {
        slug: 'intl-dispute-settlement',
        title: 'International Dispute Settlement',
        children: [
          { slug: 'pacific-settlement', title: 'Pacific Settlement of Disputes' },
          { slug: 'icj-jurisdiction', title: 'International Court of Justice' },
          { slug: 'arbitration-intl', title: 'International Arbitration' },
        ],
      },
    ],
  },
];

async function seedSyllabi() {
  console.log('Seeding bar exam syllabi...');

  for (const syllabusSeed of SYLLABI) {
    // Upsert the syllabus
    const syllabus = await prisma.barSyllabus.upsert({
      where: { barSubjectCode: syllabusSeed.barSubjectCode },
      create: {
        barSubjectCode: syllabusSeed.barSubjectCode,
        title: syllabusSeed.title,
        description: syllabusSeed.description,
        examYear: syllabusSeed.examYear,
        ordering: syllabusSeed.ordering,
        topicCount: 0,
        isActive: true,
      },
      update: {
        title: syllabusSeed.title,
        description: syllabusSeed.description,
        examYear: syllabusSeed.examYear,
        ordering: syllabusSeed.ordering,
        isActive: true,
      },
    });

    let topicCount = 0;

    // Seed top-level topics
    for (const [i, topLevel] of syllabusSeed.topics.entries()) {
      const parentTopic = await prisma.syllabusTopic.upsert({
        where: {
          syllabusId_slug: { syllabusId: syllabus.id, slug: topLevel.slug },
        },
        create: {
          syllabusId: syllabus.id,
          slug: topLevel.slug,
          title: topLevel.title,
          description: topLevel.description,
          depth: 0,
          ordering: i,
        },
        update: {
          title: topLevel.title,
          description: topLevel.description,
          ordering: i,
        },
      });
      topicCount++;

      // Seed child topics
      if (topLevel.children) {
        for (const [j, child] of topLevel.children.entries()) {
          await prisma.syllabusTopic.upsert({
            where: {
              syllabusId_slug: { syllabusId: syllabus.id, slug: child.slug },
            },
            create: {
              syllabusId: syllabus.id,
              parentTopicId: parentTopic.id,
              slug: child.slug,
              title: child.title,
              description: child.description,
              depth: 1,
              ordering: j,
            },
            update: {
              parentTopicId: parentTopic.id,
              title: child.title,
              description: child.description,
              ordering: j,
            },
          });
          topicCount++;
        }
      }
    }

    // Update topic count
    await prisma.barSyllabus.update({
      where: { id: syllabus.id },
      data: { topicCount },
    });

    console.log(`  ${syllabusSeed.barSubjectCode}: ${topicCount} topics`);
  }

  console.log('Syllabus seed complete.');
}

seedSyllabi()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
