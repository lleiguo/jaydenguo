import { api } from "@/server/http";

export const GET = api(async ({ session }) => Response.json({ email: session.email }));
