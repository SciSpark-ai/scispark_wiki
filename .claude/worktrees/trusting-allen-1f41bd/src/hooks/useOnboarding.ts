"use client";

import { useState, useCallback } from "react";
import { onboardingQuestions } from "@/lib/onboarding-questions";
import { useUserStore } from "@/stores/user-store";
import { useRouter } from "next/navigation";

interface ChatMessage {
  type: "ai" | "user";
  text: string;
}

export function useOnboarding() {
  const [currentStep, setCurrentStep] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { type: "ai", text: onboardingQuestions[0].message },
  ]);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [completed, setCompleted] = useState(false);

  const setPreferences = useUserStore((s) => s.setPreferences);
  const setOnboardingComplete = useUserStore((s) => s.setOnboardingComplete);
  const router = useRouter();

  const currentQuestion = currentStep < onboardingQuestions.length ? onboardingQuestions[currentStep] : null;

  const submitAnswer = useCallback((answer: string | string[]) => {
    if (!currentQuestion) return;

    const displayText = Array.isArray(answer) ? answer.join(", ") : answer;

    // Save answer
    const newAnswers = { ...answers, [currentQuestion.storeField]: answer };
    setAnswers(newAnswers);

    // Add user message
    const newMessages: ChatMessage[] = [
      ...messages,
      { type: "user", text: displayText },
    ];

    const nextStep = currentStep + 1;

    if (nextStep < onboardingQuestions.length) {
      // Add next AI question
      newMessages.push({ type: "ai", text: onboardingQuestions[nextStep].message });
      setMessages(newMessages);
      setCurrentStep(nextStep);
    } else {
      // Onboarding complete
      newMessages.push({
        type: "ai",
        text: "Great! I've set up your feed based on your interests. Let's get started.",
      });
      setMessages(newMessages);
      setCompleted(true);

      // Save to store
      setPreferences({
        specialty: newAnswers.specialty as string,
        role: newAnswers.role as string,
        interests: newAnswers.interests as string[],
        literatureHabits: newAnswers.literatureHabits as string,
      });
    }
  }, [currentStep, currentQuestion, messages, answers, setPreferences]);

  const finishOnboarding = useCallback(() => {
    setOnboardingComplete(true);
    router.push("/");
  }, [setOnboardingComplete, router]);

  return {
    messages,
    currentQuestion,
    currentStep,
    completed,
    submitAnswer,
    finishOnboarding,
  };
}
