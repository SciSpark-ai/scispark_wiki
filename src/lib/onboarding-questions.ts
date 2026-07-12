export interface OnboardingQuestion {
  key: string;
  storeField: "specialty" | "role" | "interests" | "literatureHabits";
  message: string;
  options: string[];
  multiSelect?: boolean;
}

export const onboardingQuestions: OnboardingQuestion[] = [
  {
    key: "specialty",
    storeField: "specialty",
    message: "Welcome to SciSpark! I'm your clinical evidence assistant. Let me personalize your experience.\n\nWhat's your primary clinical specialty?",
    options: ["Cardiology", "Oncology", "Psychiatry", "Neurology", "Pediatrics", "Internal Medicine"],
  },
  {
    key: "role",
    storeField: "role",
    message: "Great choice! And what's your role?",
    options: ["Attending Physician", "Researcher", "Resident", "Fellow", "NP / PA"],
  },
  {
    key: "interests",
    storeField: "interests",
    message: "What topics are you most interested in? You can select multiple.",
    options: ["Evidence-based guidelines", "Drug trials", "Surgical techniques", "AI in medicine", "Public health", "Rare diseases"],
    multiSelect: true,
  },
  {
    key: "habits",
    storeField: "literatureHabits",
    message: "How do you currently keep up with literature?",
    options: ["PubMed alerts", "Journal subscriptions", "Colleague recommendations", "Twitter/X", "I don't (that's why I'm here)"],
  },
];
