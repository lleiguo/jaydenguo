// Liveness probe for Cloud Run. Reveals nothing but "ok".
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" });
}
