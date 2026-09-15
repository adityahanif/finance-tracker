import { NextResponse } from "next/server";
import { getCategories } from "../../../lib/sheets";

export async function GET() {
  try {
    const data = await getCategories();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
