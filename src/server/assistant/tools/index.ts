import { calendarTool } from "./calendar";
import { costsTool } from "./costs";
import { schoolTool } from "./school";
import { swimmingTool } from "./swimming";
import { tennisTool } from "./tennis";
import { todayTool } from "./today";
import type { Tool } from "./types";
import { videosTool } from "./videos";

// Cookie's tools, in the order the prompt gives them (TOOL-17): the hub
// first. Memory and the web join this list in plan K3 and K4.
export const HUB_TOOLS = [
  todayTool,
  calendarTool,
  tennisTool,
  swimmingTool,
  schoolTool,
  videosTool,
  costsTool,
] as Tool[];

export type { Tool, ToolContext } from "./types";
