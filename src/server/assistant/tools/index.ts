import { calendarTool } from "./calendar";
import { CHANGE_TOOLS } from "./changes";
import { costsTool } from "./costs";
import { EMAIL_TOOLS } from "./email";
import { memoryForgetTool, memorySaveTool, memorySearchTool } from "./memory";
import { schoolTool } from "./school";
import { swimmingTool } from "./swimming";
import { tennisTool } from "./tennis";
import { todayTool } from "./today";
import type { Tool } from "./types";
import { videosTool } from "./videos";
import { webFetchTool, webSearchTool } from "./web";

// Cookie's tools, in the order the prompt gives them (TOOL-17): the hub
// first, then her memory, then the web.
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

// Offered only while "Use the web" is on (TOOL-17).
export const WEB_TOOLS = [webSearchTool, webFetchTool] as Tool[];

// Offered only when she is able to add to the family calendar (intent
// 0008, GCW-8).
export { CHANGE_TOOLS };

// Offered only when there is an email source to have suggestions from
// (intent 0008, EMS-2).
export { EMAIL_TOOLS };

export const ALL_TOOLS = [...HUB_TOOLS, ...CHANGE_TOOLS, ...EMAIL_TOOLS, ...MEMORY_TOOLS, ...WEB_TOOLS];

export { newTurn } from "./types";
export type { Tool, ToolContext, TurnState } from "./types";
