import {
  TOOL_DEFINITIONS,
  ToolDefinition,
  renderParamsSignature,
} from "@/services/tool-definitions";
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

type Locale = "zh-Hans" | "en";

function generateToolLine(def: ToolDefinition, locale: Locale): string {
  const desc = def.description[locale];
  const params = renderParamsSignature(def);
  const notes = def.usageNotes?.[locale];

  let line = `- \`${def.name}\`: ${desc} (params: \`${params}\`)`;

  if (notes && notes.length > 0) {
    const separator = locale === "zh-Hans" ? "，" : ", ";
    const joiner = locale === "zh-Hans" ? "。" : ". ";
    const noteText = notes.join(joiner);
    const needsEnding = !/[.。…]$/.test(noteText);
    const ending = locale === "zh-Hans" ? "。" : ".";
    line += `${separator}${noteText}${needsEnding ? ending : ""}`;
  } else {
    line += locale === "zh-Hans" ? "。" : ".";
  }

  return line;
}

function generateToolSection(locale: string): string {
  const loc: Locale = locale === "zh-Hans" ? "zh-Hans" : "en";

  const header = loc === "zh-Hans" ? "\n\n可用咒语:" : "\n\nAvailable Spells:";
  const footer =
    loc === "zh-Hans"
      ? "\n请在回答的同时附带咒语，让魔法生效吧！"
      : "\nPlease include the spell in your response to make the magic happen!";

  // Only include non-deferred tools in the default prompt (deferred loading)
  const activeTools = TOOL_DEFINITIONS.filter((def) => !def.shouldDefer);
  const lines = activeTools.map((def) => generateToolLine(def, loc));

  const deferredCount = TOOL_DEFINITIONS.filter(
    (def) => def.shouldDefer
  ).length;
  const deferHint =
    loc === "zh-Hans"
      ? `\n（另有 ${deferredCount} 个专用工具可通过 \`search_tools\` 按需查找）`
      : `\n(${deferredCount} more specialized tools available via \`search_tools\`)`;

  return header + "\n" + lines.join("\n") + deferHint + footer;
}

export const getChatSystemPrompt = (locale: string) => {
  const base = chatPrompts[locale] || chatPrompts["en"];
  return base + generateToolSection(locale);
};

export const getGameErrorSystemPrompt = (locale: string) => {
  return gameErrorPrompts[locale] || gameErrorPrompts["en"];
};
