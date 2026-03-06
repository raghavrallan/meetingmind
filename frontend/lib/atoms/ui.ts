import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export type Theme = "dark" | "light";

export const themeAtom = atomWithStorage<Theme>("theme", "dark");

export const searchQueryAtom = atom<string>("");

export const selectedProjectFilterAtom = atom<string | null>(null);

export const selectedPriorityFilterAtom = atom<string | null>(null);

export const selectedAssigneeFilterAtom = atom<string | null>(null);

export const notificationCountAtom = atom<number>(0);
