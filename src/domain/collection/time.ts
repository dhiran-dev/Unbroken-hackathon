const PACIFIC_TIME_ZONE = "America/Los_Angeles";

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function zonedParts(date: Date) {
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
    second: values.second!,
  };
}

function pacificLocalToDate(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}) {
  const desired = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  let candidate = desired;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = zonedParts(new Date(candidate));
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    candidate += desired - actualAsUtc;
  }

  const result = new Date(candidate);
  const verified = zonedParts(result);
  if (
    verified.year !== parts.year ||
    verified.month !== parts.month ||
    verified.day !== parts.day ||
    verified.hour !== parts.hour ||
    verified.minute !== parts.minute
  ) {
    return null;
  }

  return result;
}

export function parseSfmtaTimestamp(value: string | null) {
  if (!value) return null;

  const sourceMatch = value.match(
    /Status valid as of\s+(\d{1,2}):(\d{2})\s*([ap]m)\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i,
  );
  const changedMatch = value.match(
    /Last Changed\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})\s*([ap]m)/i,
  );
  if (!sourceMatch && !changedMatch) return null;

  const hourText = sourceMatch?.[1] ?? changedMatch?.[4];
  const minuteText = sourceMatch?.[2] ?? changedMatch?.[5];
  const meridiem = sourceMatch?.[3] ?? changedMatch?.[6];
  const monthText = sourceMatch?.[4] ?? changedMatch?.[1];
  const dayText = sourceMatch?.[5] ?? changedMatch?.[2];
  const yearText = sourceMatch?.[6] ?? changedMatch?.[3];
  if (!hourText || !minuteText || !meridiem || !monthText || !dayText || !yearText) {
    return null;
  }
  let hour = Number(hourText);
  if (meridiem) {
    hour %= 12;
    if (meridiem.toLowerCase() === "pm") hour += 12;
  }

  const shortYear = Number(yearText);
  const year = yearText.length === 2 ? 2000 + shortYear : shortYear;

  return pacificLocalToDate({
    year,
    month: Number(monthText),
    day: Number(dayText),
    hour,
    minute: Number(minuteText),
  });
}
