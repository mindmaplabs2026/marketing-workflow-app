import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dispatchPendingPushes } from "@/lib/push/dispatch";
import type { RequestStatus, UserRole } from "@/lib/supabase/types";

// One-tap approve/send-back endpoint hit by the service worker when the
// user clicks an "Approve" / "Send back" button right in the OS push
// notification banner. Auth comes from cookies (SW sends credentials).
//
// Body: { request_id: string, action: ApproveAction }
type ApproveAction =
  | "approve_request"
  | "send_back_request"
  | "approve_design"
  | "request_design_changes";

const VALID_ACTIONS: ReadonlyArray<ApproveAction> = [
  "approve_request",
  "send_back_request",
  "approve_design",
  "request_design_changes",
];

type RequestRow = {
  id: string;
  status: RequestStatus;
};

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  let body: { request_id?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON body.");
  }

  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  const actionRaw = typeof body.action === "string" ? body.action : "";
  if (!requestId) return bad("Missing request_id.");
  if (!(VALID_ACTIONS as readonly string[]).includes(actionRaw)) {
    return bad("Invalid action.");
  }
  const action = actionRaw as ApproveAction;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return bad("Not signed in.", 401);

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: UserRole }>();
  if (profileErr || !profile) return bad("Profile not found.", 403);
  if (profile.role !== "school_admin" && profile.role !== "super_admin") {
    return bad("Only a school admin can do that.", 403);
  }

  const { data: req, error: reqErr } = await supabase
    .from("requests")
    .select("id, status")
    .eq("id", requestId)
    .single<RequestRow>();
  if (reqErr || !req) return bad("Request not found.", 404);

  // Map action -> required current status + resulting status. If the request
  // already moved past the actionable state (someone else got there first),
  // return ok with applied=false so the SW can show a gentle message instead
  // of an error.
  let requiredStatus: RequestStatus;
  let nextStatus: RequestStatus;
  let setApprovedBy = false;
  switch (action) {
    case "approve_request":
      requiredStatus = "pending_admin_approval";
      nextStatus = "approved";
      setApprovedBy = true;
      break;
    case "send_back_request":
      requiredStatus = "pending_admin_approval";
      nextStatus = "draft";
      break;
    case "approve_design":
      requiredStatus = "design_pending_approval";
      nextStatus = "in_design";
      break;
    case "request_design_changes":
      requiredStatus = "design_pending_approval";
      nextStatus = "changes_requested";
      break;
  }

  if (req.status !== requiredStatus) {
    return NextResponse.json({
      ok: true,
      applied: false,
      message: `Already ${req.status.replace(/_/g, " ")}.`,
    });
  }

  const update: { status: RequestStatus; approved_by?: string } = {
    status: nextStatus,
  };
  if (setApprovedBy) update.approved_by = user.id;

  const { error: updErr } = await supabase
    .from("requests")
    .update(update)
    .eq("id", requestId);
  if (updErr) return bad(updErr.message, 500);

  // Best-effort: drain the new fan-out (e.g. designer notified of approval).
  // Don't fail the response if dispatch itself errors.
  try {
    await dispatchPendingPushes();
  } catch {}

  return NextResponse.json({ ok: true, applied: true, status: nextStatus });
}
