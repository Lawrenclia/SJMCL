import {
  chatSystemPrompt as chatEn,
  gameErrorSystemPrompt as gameErrorEn,
} from "./en";
import {
  chatSystemPrompt as chatZhHans,
  gameErrorSystemPrompt as gameErrorZhHans,
} from "./zh-Hans";

const chatPrompts: Record<string, string> = {
  "zh-Hans": chatZhHans,
  en: chatEn,
  // Add other languages here as needed, defaulting to zh-Hans for now
};

const gameErrorPrompts: Record<
  string,
  (os: string, javaVersion: string, mcVersion: string, log: string) => string
> = {
  "zh-Hans": gameErrorZhHans,
  en: gameErrorEn,
};

export const getChatSystemPrompt = (locale: string) => {
  return chatPrompts[locale] || chatPrompts["en"];
};

export const getGameErrorSystemPrompt = (locale: string) => {
  return gameErrorPrompts[locale] || gameErrorPrompts["en"];
};
