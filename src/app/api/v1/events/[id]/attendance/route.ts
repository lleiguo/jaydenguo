import { z } from "zod";
import { attendanceInput, setAttendance } from "@/server/calendar/mutations";
import { api, readJson } from "@/server/http";

// Required or optional (CON-1): {"attendance": "optional"}.
export const POST = api<{ id: string }>(async ({ db, session, params, request }) => {
  const { attendance } = await readJson(request, attendanceInput);
  const undo = await setAttendance(db, session.email, z.uuid().parse(params.id), attendance);
  return Response.json({ undo });
});
