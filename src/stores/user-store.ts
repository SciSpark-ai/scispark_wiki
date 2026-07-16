import { create } from "zustand";

interface User {
  name: string;
  email?: string;
  avatar?: string;
}

interface UserState {
  user: User | null;
  onboardingComplete: boolean;
  setUser: (user: User) => void;
  setOnboardingComplete: (complete: boolean) => void;
}

// v1 is a single-user local runtime with no account system, so there is no real
// name/email to show. Keep a neutral identity rather than the fork's hardcoded
// "Tong / tong@scispark.ai" mock. The real research identity lives in the
// user-model pages (profile.md), surfaced read-only on /profile.
export const useUserStore = create<UserState>((set) => ({
  user: { name: "Researcher" },
  onboardingComplete: false,
  setUser: (user) => set({ user }),
  setOnboardingComplete: (complete) => set({ onboardingComplete: complete }),
}));
