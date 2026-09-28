import { z } from "zod";
import { attendanceInput, setAttendance } from "@/server/calendar/mutations";
import { api, readJson } from "@/server/http";

// Whose event it is (CON-1): {"attendance": "parent_only"} and the like.
export const POST = api<{ id: string }>(async ({ db, session, params, request }) => {
  const { attendance } = await readJson(request, attendanceInput);
  const undo = await setAttendance(db, session.email, z.uuid().parse(params.id), attendance);
  return Response.json({ undo });
});
