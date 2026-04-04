/**
 * Pleading Template Seed Data — Common Philippine Legal Pleading Templates.
 *
 * Each template follows the PleadingTemplateJson interface:
 * { sections: PleadingTemplateSection[], outputFormat: string }
 *
 * Section inputType values: text, textarea, select, date, party_list
 */

export interface PleadingTemplateSeed {
  name: string;
  slug: string;
  category: string;
  court?: string;
  description: string;
  templateJson: {
    sections: {
      key: string;
      label: string;
      description: string;
      required: boolean;
      inputType: string;
      options?: string[];
    }[];
    outputFormat: string;
  };
}

export const pleadingTemplates: PleadingTemplateSeed[] = [
  {
    name: 'Motion to Dismiss',
    slug: 'motion-to-dismiss',
    category: 'motion',
    description:
      'A motion filed by the defendant seeking dismissal of the complaint on grounds enumerated under the Rules of Court (e.g., lack of jurisdiction, failure to state a cause of action, prescription).',
    templateJson: {
      sections: [
        {
          key: 'court',
          label: 'Court',
          description: 'The court where the case is pending',
          required: true,
          inputType: 'text',
        },
        {
          key: 'case_number',
          label: 'Case Number',
          description: 'The docket/case number assigned by the court',
          required: true,
          inputType: 'text',
        },
        {
          key: 'parties_plaintiff',
          label: 'Plaintiff(s)',
          description: 'Names and descriptions of all plaintiffs',
          required: true,
          inputType: 'party_list',
        },
        {
          key: 'parties_defendant',
          label: 'Defendant(s)',
          description: 'Names and descriptions of all defendants',
          required: true,
          inputType: 'party_list',
        },
        {
          key: 'grounds',
          label: 'Grounds for Dismissal',
          description: 'Select the grounds for the motion to dismiss',
          required: true,
          inputType: 'select',
          options: [
            'Lack of jurisdiction over the subject matter',
            'Lack of jurisdiction over the person of the defendant',
            'Improper venue',
            'Failure to state a cause of action',
            'Litis pendentia',
            'Res judicata',
            'Prescription',
            'Failure to comply with a condition precedent',
          ],
        },
        {
          key: 'factual_basis',
          label: 'Factual Basis',
          description: 'Narrate the facts supporting the ground for dismissal',
          required: true,
          inputType: 'textarea',
        },
        {
          key: 'legal_basis',
          label: 'Legal Basis',
          description: 'Cite the applicable rules, statutes, or jurisprudence',
          required: false,
          inputType: 'textarea',
        },
      ],
      outputFormat: 'motion',
    },
  },
  {
    name: 'Motion for Reconsideration',
    slug: 'motion-for-reconsideration',
    category: 'motion',
    description:
      'A motion seeking reconsideration of a court order or decision, arguing that the court erred in fact or in law.',
    templateJson: {
      sections: [
        {
          key: 'court',
          label: 'Court',
          description: 'The court that issued the order/decision',
          required: true,
          inputType: 'text',
        },
        {
          key: 'case_number',
          label: 'Case Number',
          description: 'The docket/case number',
          required: true,
          inputType: 'text',
        },
        {
          key: 'parties_movant',
          label: 'Movant',
          description: 'Name of the party filing the motion',
          required: true,
          inputType: 'text',
        },
        {
          key: 'order_date',
          label: 'Date of Order/Decision',
          description: 'Date of the order or decision being reconsidered',
          required: true,
          inputType: 'date',
        },
        {
          key: 'order_summary',
          label: 'Summary of Order/Decision',
          description: 'Brief summary of what the court ordered/decided',
          required: true,
          inputType: 'textarea',
        },
        {
          key: 'grounds',
          label: 'Grounds for Reconsideration',
          description: 'Explain the errors of fact or law in the order/decision',
          required: true,
          inputType: 'textarea',
        },
        {
          key: 'relief_sought',
          label: 'Relief Sought',
          description: 'State the specific relief or modification being requested',
          required: true,
          inputType: 'textarea',
        },
      ],
      outputFormat: 'motion',
    },
  },
  {
    name: 'Complaint for Sum of Money',
    slug: 'complaint-sum-of-money',
    category: 'complaint',
    description:
      'A complaint for collection of a sum of money, typically for unpaid debts, loans, or obligations.',
    templateJson: {
      sections: [
        {
          key: 'court',
          label: 'Court',
          description: 'The court where the complaint will be filed',
          required: true,
          inputType: 'text',
        },
        {
          key: 'parties_plaintiff',
          label: 'Plaintiff(s)',
          description: 'Names, addresses, and details of all plaintiffs',
          required: true,
          inputType: 'party_list',
        },
        {
          key: 'parties_defendant',
          label: 'Defendant(s)',
          description: 'Names, addresses, and details of all defendants',
          required: true,
          inputType: 'party_list',
        },
        {
          key: 'amount_claimed',
          label: 'Amount Claimed',
          description: 'The principal amount being claimed',
          required: true,
          inputType: 'text',
        },
        {
          key: 'cause_of_action',
          label: 'Cause of Action',
          description: 'Describe the nature of the obligation (loan, contract, services, etc.)',
          required: true,
          inputType: 'textarea',
        },
        {
          key: 'factual_allegations',
          label: 'Factual Allegations',
          description: 'Narrate the material facts giving rise to the claim',
          required: true,
          inputType: 'textarea',
        },
        {
          key: 'demand_details',
          label: 'Prior Demand',
          description: 'Describe any prior demand made on the defendant',
          required: false,
          inputType: 'textarea',
        },
        {
          key: 'interest_damages',
          label: 'Interest and Damages',
          description: 'Specify interest rate, damages, and other amounts sought',
          required: false,
          inputType: 'textarea',
        },
      ],
      outputFormat: 'complaint',
    },
  },
  {
    name: 'Petition for Certiorari',
    slug: 'petition-for-certiorari',
    category: 'petition',
    court: 'Court of Appeals / Supreme Court',
    description:
      'A special civil action under Rule 65 of the Rules of Court to annul or modify proceedings of a tribunal, board, or officer exercising judicial or quasi-judicial functions with grave abuse of discretion.',
    templateJson: {
      sections: [
        {
          key: 'respondent_tribunal',
          label: 'Respondent Tribunal/Court',
          description: 'The tribunal, court, or officer that issued the questioned act',
          required: true,
          inputType: 'text',
        },
        {
          key: 'parties_petitioner',
          label: 'Petitioner(s)',
          description: 'Names and details of all petitioners',
          required: true,
          inputType: 'party_list',
        },
        {
          key: 'parties_respondent',
          label: 'Respondent(s)',
          description: 'Names and details of all respondents',
          required: true,
          inputType: 'party_list',
        },
        {
          key: 'case_number_below',
          label: 'Case Number Below',
          description: 'Case number in the lower court/tribunal',
          required: true,
          inputType: 'text',
        },
        {
          key: 'questioned_act',
          label: 'Questioned Act/Order',
          description: 'Describe the act, order, or resolution being questioned',
          required: true,
          inputType: 'textarea',
        },
        {
          key: 'grave_abuse',
          label: 'Grave Abuse of Discretion',
          description: 'Explain how the respondent committed grave abuse of discretion amounting to lack or excess of jurisdiction',
          required: true,
          inputType: 'textarea',
        },
        {
          key: 'no_plain_speedy_remedy',
          label: 'No Other Plain, Speedy, and Adequate Remedy',
          description: 'Explain why there is no other plain, speedy, and adequate remedy in the ordinary course of law',
          required: true,
          inputType: 'textarea',
        },
        {
          key: 'material_dates',
          label: 'Material Dates',
          description: 'State the material dates: receipt of order, filing of MR, receipt of denial',
          required: true,
          inputType: 'textarea',
        },
      ],
      outputFormat: 'petition',
    },
  },
  {
    name: 'Answer with Affirmative Defenses',
    slug: 'answer-with-affirmative-defenses',
    category: 'answer',
    description:
      'An answer to a complaint that includes specific denials and affirmative defenses under the Rules of Court.',
    templateJson: {
      sections: [
        {
          key: 'court',
          label: 'Court',
          description: 'The court where the case is pending',
          required: true,
          inputType: 'text',
        },
        {
          key: 'case_number',
          label: 'Case Number',
          description: 'The docket/case number',
          required: true,
          inputType: 'text',
        },
        {
          key: 'parties_defendant',
          label: 'Defendant(s) / Answering Party',
          description: 'Names and details of the answering party',
          required: true,
          inputType: 'party_list',
        },
        {
          key: 'parties_plaintiff',
          label: 'Plaintiff(s)',
          description: 'Names of the plaintiffs',
          required: true,
          inputType: 'party_list',
        },
        {
          key: 'specific_denials',
          label: 'Specific Denials',
          description: 'For each paragraph of the complaint, state whether you admit, deny, or have insufficient knowledge. List paragraph numbers and your response.',
          required: true,
          inputType: 'textarea',
        },
        {
          key: 'affirmative_defenses',
          label: 'Affirmative Defenses',
          description: 'State your affirmative defenses (e.g., payment, prescription, estoppel, waiver, illegality)',
          required: true,
          inputType: 'textarea',
        },
        {
          key: 'counterclaim',
          label: 'Counterclaim (if any)',
          description: 'State any counterclaim against the plaintiff with factual and legal basis',
          required: false,
          inputType: 'textarea',
        },
      ],
      outputFormat: 'answer',
    },
  },
  {
    name: 'Memorandum of Authorities',
    slug: 'memorandum-of-authorities',
    category: 'memorandum',
    description:
      'A written argument submitted to the court citing legal authorities (cases, statutes, rules) in support of a party\'s position on a legal issue.',
    templateJson: {
      sections: [
        {
          key: 'court',
          label: 'Court',
          description: 'The court where the memorandum will be filed',
          required: true,
          inputType: 'text',
        },
        {
          key: 'case_number',
          label: 'Case Number',
          description: 'The docket/case number',
          required: true,
          inputType: 'text',
        },
        {
          key: 'filing_party',
          label: 'Filing Party',
          description: 'Name and role of the party filing the memorandum',
          required: true,
          inputType: 'text',
        },
        {
          key: 'issues',
          label: 'Issues to be Resolved',
          description: 'List the legal issues that the memorandum addresses',
          required: true,
          inputType: 'textarea',
        },
        {
          key: 'subject_matter',
          label: 'Subject Matter / Background',
          description: 'Brief background of the case relevant to the issues',
          required: true,
          inputType: 'textarea',
        },
        {
          key: 'arguments',
          label: 'Arguments',
          description: 'State your key arguments with supporting authorities',
          required: true,
          inputType: 'textarea',
        },
      ],
      outputFormat: 'memorandum',
    },
  },
  {
    name: 'Notice of Appeal',
    slug: 'notice-of-appeal',
    category: 'appeal',
    description:
      'A notice filed with the trial court indicating the intent to appeal the judgment or final order to a higher court.',
    templateJson: {
      sections: [
        {
          key: 'court_of_origin',
          label: 'Court of Origin',
          description: 'The trial court that rendered the judgment',
          required: true,
          inputType: 'text',
        },
        {
          key: 'appellate_court',
          label: 'Appellate Court',
          description: 'The court where the appeal is directed',
          required: true,
          inputType: 'select',
          options: [
            'Court of Appeals',
            'Supreme Court',
            'Regional Trial Court',
          ],
        },
        {
          key: 'case_number',
          label: 'Case Number',
          description: 'The docket/case number in the court of origin',
          required: true,
          inputType: 'text',
        },
        {
          key: 'parties_appellant',
          label: 'Appellant(s)',
          description: 'Names and details of the party filing the appeal',
          required: true,
          inputType: 'party_list',
        },
        {
          key: 'parties_appellee',
          label: 'Appellee(s)',
          description: 'Names of the opposing party',
          required: true,
          inputType: 'party_list',
        },
        {
          key: 'judgment_date',
          label: 'Date of Judgment/Order',
          description: 'Date of the judgment or final order being appealed',
          required: true,
          inputType: 'date',
        },
        {
          key: 'date_of_receipt',
          label: 'Date of Receipt',
          description: 'Date when the appellant received the judgment/order',
          required: true,
          inputType: 'date',
        },
        {
          key: 'judgment_summary',
          label: 'Summary of Judgment',
          description: 'Brief summary of the judgment or order being appealed',
          required: true,
          inputType: 'textarea',
        },
      ],
      outputFormat: 'appeal',
    },
  },
];
