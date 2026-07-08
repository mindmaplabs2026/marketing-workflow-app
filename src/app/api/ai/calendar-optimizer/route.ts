import { NextResponse } from "next/server";
import { getModelClient } from "@/lib/ai/model-client";
import { createClient } from "@/lib/supabase/server";

type CalendarOptimizerItem = {
  id?: string;
  title: string;
  planned_date: string;
  status: string;
  channel: string;
};

type CalendarOptimizerSuggestion = {
  title: string;
  date: string;
  channel: string;
  priority: "high" | "medium" | "low";
  reason: string;
  brief: string;
};

type CalendarOptimizerResult = {
  summary: string;
  risks: string[];
  suggestions: CalendarOptimizerSuggestion[];
  source: "ai" | "fallback";
};

const CHANNELS = ["Instagram", "Facebook", "Email", "All channels", "Event"];

function isItem(value: unknown): value is CalendarOptimizerItem {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.title === "string" &&
    typeof row.planned_date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.planned_date) &&
    typeof row.status === "string" &&
    typeof row.channel === "string"
  );
}

function parseMonthStart(monthParam: string): Date {
  if (/^\d{4}-\d{2}$/.test(monthParam)) {
    return new Date(`${monthParam}-01T00:00:00`);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function toYMD(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthDays(monthParam: string): string[] {
  const start = parseMonthStart(monthParam);
  const days: string[] = [];
  const cursor = new Date(start);
  while (cursor.getMonth() === start.getMonth()) {
    if (cursor.getDay() !== 0) days.push(toYMD(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function fallbackIdeas({
  schoolName,
  monthLabel,
  monthParam,
  items,
}: {
  schoolName: string;
  monthLabel: string;
  monthParam: string;
  items: CalendarOptimizerItem[];
}): CalendarOptimizerResult {
  const planned = new Set(items.map((item) => item.planned_date));
  const openDays = monthDays(monthParam).filter((date) => !planned.has(date));
  const pending = items.filter((item) => item.status === "drafted").length;
  const channelCounts = CHANNELS.map((channel) => ({
    channel,
    count: items.filter((item) => item.channel === channel).length,
  }));
  const lowChannels = channelCounts
    .filter((entry) => entry.count === 0)
    .map((entry) => entry.channel);

  const [first, second, third] = [
    openDays[2] ?? openDays[0] ?? `${monthParam}-10`,
    openDays[5] ?? openDays[1] ?? `${monthParam}-17`,
    openDays[8] ?? openDays[2] ?? `${monthParam}-24`,
  ];

  return {
    summary: `${schoolName} has ${items.length} planned item${items.length === 1 ? "" : "s"} in ${monthLabel}. Add lightweight posts on quiet days and keep approvals moving before publish week.`,
    risks: [
      openDays.length > 8
        ? "Several weekdays are empty, so the month may feel quiet to parents."
        : "The month has a reasonable content rhythm, but a few dates can still be improved.",
      pending > 0
        ? `${pending} drafted item${pending === 1 ? "" : "s"} may need approval follow-up.`
        : "No drafted approval risk is visible in this month.",
      lowChannels.length > 0
        ? `${lowChannels.slice(0, 2).join(" and ")} need more coverage.`
        : "Channel coverage is balanced enough for this month.",
    ],
    suggestions: [
      {
        title: "Admissions reminder reel",
        date: first,
        channel: "Instagram",
        priority: "high",
        reason: "A short reel keeps the calendar active and gives parents a quick visual update.",
        brief: "Create a 15-second reel with campus visuals, admissions deadline, and a clear enquiry call-to-action.",
      },
      {
        title: "Parent newsletter",
        date: second,
        channel: "Email",
        priority: "medium",
        reason: "Email balances social posts with a direct parent communication touchpoint.",
        brief: "Send a concise update with upcoming dates, one student highlight, and links parents may need.",
      },
      {
        title: "Assembly recap post",
        date: third,
        channel: "Facebook",
        priority: "medium",
        reason: "A recap is easy to approve and fills a quiet slot with school-life content.",
        brief: "Use 3-4 photos, a short recap, and a note about the value or theme of the assembly.",
      },
    ],
    source: "fallback",
  };
}

function normalizeResult(value: unknown): CalendarOptimizerResult | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.summary !== "string") return null;
  if (!Array.isArray(row.risks)) return null;
  if (!Array.isArray(row.suggestions)) return null;

  const suggestions = row.suggestions.filter((item): item is CalendarOptimizerSuggestion => {
    if (!item || typeof item !== "object") return false;
    const suggestion = item as Record<string, unknown>;
    return (
      typeof suggestion.title === "string" &&
      typeof suggestion.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(suggestion.date) &&
      typeof suggestion.channel === "string" &&
      typeof suggestion.reason === "string" &&
      typeof suggestion.brief === "string" &&
      ["high", "medium", "low"].includes(String(suggestion.priority))
    );
  });

  if (suggestions.length === 0) return null;

  return {
    summary: row.summary,
    risks: row.risks.filter((risk): risk is string => typeof risk === "string").slice(0, 3),
    suggestions: suggestions.slice(0, 5),
    source: "ai",
  };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const schoolName = typeof body.schoolName === "string" ? body.schoolName.slice(0, 120) : "this school";
  const monthLabel = typeof body.monthLabel === "string" ? body.monthLabel.slice(0, 40) : "this month";
  const monthParam = typeof body.monthParam === "string" ? body.monthParam : "";
  const items = Array.isArray(body.items) ? body.items.filter(isItem).slice(0, 80) : [];
  const fallback = fallbackIdeas({ schoolName, monthLabel, monthParam, items });

  try {
    const client = await getModelClient();
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a senior school marketing strategist inside a SaaS calendar planning app. Return only valid JSON.",
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Generate practical calendar optimization ideas.",
            rules: [
              "Return JSON with summary, risks, suggestions.",
              "suggestions must contain 3 to 5 items.",
              "Each suggestion needs title, date in YYYY-MM-DD, channel, priority, reason, brief.",
              "priority must be high, medium, or low.",
              "Channels should be Instagram, Facebook, Email, All channels, or Event.",
              "Use dates inside the provided month and avoid dates already occupied when possible.",
              "The brief should be one practical production note or short content direction.",
              "Keep copy concise and suitable for a school marketing workflow.",
            ],
            schoolName,
            monthLabel,
            monthParam,
            existingItems: items,
          }),
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return NextResponse.json(fallback);

    const parsed = normalizeResult(JSON.parse(content));
    return NextResponse.json(parsed ?? fallback);
  } catch (error) {
    console.warn("[calendar-optimizer] falling back to local suggestions", error);
    return NextResponse.json(fallback);
  }
}
