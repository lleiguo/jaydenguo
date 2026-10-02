import { calendarTool } from "./calendar";
import { costsTool } from "./costs";
import { memoryForgetTool, memorySaveTool, memorySearchTool } from "./memory";
import { schoolTool } from "./school";
import { swimmingTool } from "./swimming";
import { tennisTool } from "./tennis";
import { todayTool } from "./today";
import type { Tool } from "./types";
import { videosTool } from "./videos";

// Cookie's tools, in the order the prompt gives them (TOOL-17): the hub
// first, then her memory. The web joins in plan K4.
export const HUB_TOOLS = [
  todayTool,
  calendarTool,
  tennisTool,
  swimmingTool,
  schoolTool,
  videosTool,
  costsTool,
] as Tool[];

export const MEMORY_TOOLS = [memorySearchTool, memorySaveTool, memoryForgetTool] as Tool[];

export const ALL_TOOLS = [...HUB_TOOLS, ...MEMORY_TOOLS];

export { newTurn } from "./types";
export type { Tool, ToolContext, TurnState } from "./types";
