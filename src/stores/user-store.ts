import { create } from "zustand";

interface UserPreferences {
  specialty: string;
  role: string;
  interests: string[];
  literatureHabits: string;
}

interface User {
  name: string;
  email: string;
  avatar?: string;
}

interface UserState {
  user: User | null;
  onboardingComplete: boolean;
  preferences: UserPreferences;
  setUser: (user: User) => void;
  setOnboardingComplete: (complete: boolean) => void;
  setPreferences: (prefs: Partial<UserPreferences>) => void;
}

export const useUserStore = create<UserState>((set) => ({
  user: {
    name: "Tong",
    email: "tong@scispark.ai",
  },
  onboardingComplete: false,
  preferences: {
    specialty: "Psychiatry",
    role: "Researcher",
    interests: ["Psychedelic therapy", "Neuromodulation"],
    literatureHabits: "PubMed alerts",
  },
  setUser: (user) => set({ user }),
  setOnboardingComplete: (complete) => set({ onboardingComplete: complete }),
  setPreferences: (prefs) =>
    set((s) => ({ preferences: { ...s.preferences, ...prefs } })),
}));
