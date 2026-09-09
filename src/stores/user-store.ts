import { create } from "zustand";

export interface User {
  name: string;
  email?: string;
  avatar?: string;
}

interface UserState {
  user: User | null;
  onboardingComplete: boolean;
  setUser: (user: User | null) => void;
  setOnboardingComplete: (complete: boolean) => void;
}

export const useUserStore = create<UserState>((set) => ({
  user: null,
  onboardingComplete: false,
  setUser: (user) => set({ user }),
  setOnboardingComplete: (complete) => set({ onboardingComplete: complete }),
}));
