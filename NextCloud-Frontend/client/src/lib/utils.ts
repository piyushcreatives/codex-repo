import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getAvatarColor(name: string): string {
  const colors = [
    "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300",
    "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300",
    "bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300",
    "bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300",
    "bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300",
    "bg-cyan-100 text-cyan-600 dark:bg-cyan-900/40 dark:text-cyan-300",
    "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300",
  ];
  const index = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length;
  return colors[index];
}

export function getInitials(name: string): string {
  return (name || "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
