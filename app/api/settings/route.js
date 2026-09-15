import { NextResponse } from "next/server";
import { getSetting, setSetting } from "../../../lib/sheets";

export async function GET() {
  try {
    const gemini_parse_model = await getSetting(
      "gemini_parse_model",
      process.env.GEMINI_PARSE_MODEL || "gemini-3.5-flash-lite"
    );
    const gemini_analysis_model = await getSetting(
      "gemini_analysis_model",
      process.env.GEMINI_ANALYSIS_MODEL || "gemini-3.8-flash"
    );
    return NextResponse.json({ gemini_parse_model, gemini_analysis_model });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  try {
    if (body.gemini_parse_model) await setSetting("gemini_parse_model", body.gemini_parse_model);
    if (body.gemini_analysis_model) await setSetting("gemini_analysis_model", body.gemini_analysis_model);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
