export interface BarExamAnswerModelRun {
  modelName: string;
  promptTemplateVersion: string | null;
}

export interface BarExamAnswerQuestionRef {
  id: string;
  questionNumber: number;
  sittingId: string;
}

export interface BarExamAnswerStructured {
  answer: string;
  law: string;
  analysis: string;
  conclusion: string;
}

export interface BarExamAnswer {
  id: string;
  answerText: string;
  structuredAnswerJson: BarExamAnswerStructured | null;
  modelRun: BarExamAnswerModelRun | null;
  reviewedAt: string | null;
  question: BarExamAnswerQuestionRef;
}
