import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { get, post } from "aws-amplify/api";
import {
  confirmSignIn,
  fetchAuthSession,
  getCurrentUser,
  signIn,
  signOut,
} from "aws-amplify/auth";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import QRCode from "qrcode";
import outputs from "../amplify_outputs.json";

type PageKey =
  | "calendar-dashboard"
  | "calendar-connect"
  | "calendar-month"
  | "calendar-schedule"
  | "calendar-reporting"
  | "congregation"
  | "visitation"
  | "visitation-report"
  | "visitation-calendar"
  | "visitation-calendar-schedule"
  | "parling"
  | "parking-management"
  | "parking-registration"
  | "new-member"
  | "member-details"
  | "member-details-beta"
  | "contacts-import"
  | "announcement-week"
  | "user-access"
  | "events"
  | "sunday-school"
  | "summer-camp"
  | "parking"
  | "board-meeting"
  | "announcements";

const pageContent: Record<
  PageKey,
  { eyebrow: string; description: string }
> = {
  "calendar-dashboard": {
    eyebrow: "Calendar Dashboard",
    description: "",
  },
  "calendar-connect": {
    eyebrow: "Connect Calendar",
    description: "",
  },
  "calendar-month": {
    eyebrow: "Calendar Schedule",
    description: "",
  },
  "calendar-schedule": {
    eyebrow: "Calendar Schedule",
    description: "",
  },
  "calendar-reporting": {
    eyebrow: "Calendar Reporting",
    description: "",
  },
  congregation: {
    eyebrow: "Congregation",
    description: "",
  },
  visitation: {
    eyebrow: "Visitation",
    description: "",
  },
  "visitation-report": {
    eyebrow: "Visitation Report",
    description: "",
  },
  "visitation-calendar": {
    eyebrow: "Visitation Calendar",
    description: "",
  },
  "visitation-calendar-schedule": {
    eyebrow: "Schedule Visitation",
    description: "",
  },
  parling: {
    eyebrow: "Parking",
    description: "",
  },
  "parking-management": {
    eyebrow: "Parking Management",
    description: "",
  },
  "parking-registration": {
    eyebrow: "Parking Registration",
    description: "",
  },
  "new-member": {
    eyebrow: "New Member",
    description:
      "Capture the basic details for a congregation member.",
  },
  "member-details": {
    eyebrow: "Member Details",
    description: "",
  },
  "member-details-beta": {
    eyebrow: "Member Details Beta",
    description: "",
  },
  "contacts-import": {
    eyebrow: "Contacts Import",
    description: "",
  },
  "announcement-week": {
    eyebrow: "Add Week",
    description: "",
  },
  "user-access": {
    eyebrow: "User Access",
    description: "",
  },
  events: {
    eyebrow: "Events",
    description: "",
  },
  "sunday-school": {
    eyebrow: "Sunday School",
    description: "",
  },
  "summer-camp": {
    eyebrow: "Summer Camp",
    description: "",
  },
  parking: {
    eyebrow: "Parking",
    description: "",
  },
  "board-meeting": {
    eyebrow: "Board Meeting",
    description: "",
  },
  announcements: {
    eyebrow: "Announcements",
    description: "",
  },
};

const navSections: Array<{
  label: string;
  items: Array<{ key: PageKey; label: string }>;
}> = [
  {
    label: "Calendar",
    items: [
      { key: "calendar-dashboard", label: "Dashboard" },
      { key: "calendar-connect", label: "Connect Calendar" },
      { key: "calendar-month", label: "Schedule" },
      { key: "calendar-schedule", label: "Free time" },
      { key: "calendar-reporting", label: "Reporting" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { key: "congregation", label: "Congregation" },
      { key: "visitation", label: "Visitation" },
      { key: "visitation-report", label: "Visitation Report" },
      { key: "visitation-calendar", label: "Visitation Calendar" },
      { key: "announcements", label: "Announcements" },
    ],
  },
  {
    label: "Manage",
    items: [
      { key: "user-access", label: "User Access" },
      { key: "contacts-import", label: "Contacts Import" },
    ],
  },
  {
    label: "Parking",
    items: [
      { key: "parking-registration", label: "Parking Registration" },
      { key: "parking-management", label: "Parking Management" },
    ],
  },
];

type BackendMessage = {
  message: string;
  time: string;
  items: Array<{
    pk: string;
    sk: string;
    data: string;
    photo?: string;
  }>;
};

type AnnouncementResponse = {
  message: string;
  time: string;
  items: Array<{
    pk: string;
    sk: string;
    data: string;
  }>;
};

type MemberFormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  photo: string;
  role: string;
  status: string;
  address: string;
  notes: string;
};

type StoredMemberData = Partial<MemberFormState> & {
  photoDataUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  history?: Array<{
    timestamp: string;
    action: string;
    message: string;
  }>;
  visitations?: Array<{
    id: string;
    scheduledAt?: string;
    note?: string;
    completedAt?: string;
    assignedPriestSk?: string;
    assignedPriestName?: string;
    updatedAt?: string;
  }>;
};

type VisitationModalState = {
  action: "schedule" | "note" | "complete" | "delete";
  pk: string;
  sk: string;
  memberName: string;
  visitationId?: string;
} | null;

type DeleteModalState = {
  pk: string;
  sk: string;
  memberName: string;
} | null;

type MemberContextMenuState = {
  pk: string;
  sk: string;
  memberName: string;
  memberData: StoredMemberData | null;
  memberPhoto?: string;
  x: number;
  y: number;
} | null;

type AnnouncementDeleteModalState = {
  sk: string;
  weekLabel: string;
} | null;

type AnnouncementItemDeleteModalState = {
  index: number;
  label: string;
} | null;

type ParkingHistoryModalState = {
  sk: string;
  memberName: string;
  history: Array<{
    timestamp: string;
    action: string;
    message: string;
  }>;
} | null;

type EditingMemberState = {
  pk: string;
  sk: string;
  createdAt?: string;
} | null;

type SelectedMemberState = {
  pk: string;
  sk: string;
} | null;

type VisitationFocusState = {
  pk: string;
  sk: string;
  memberName: string;
} | null;

type AnnouncementWeekData = {
  weekLabel?: string;
  items?: string[];
  createdAt?: string;
  updatedAt?: string;
};

type AnnouncementWeekFormState = {
  sk?: string;
  createdAt?: string;
  weekLabel: string;
  items: string[];
};

type AnnouncementSortOrder = "latest" | "oldest";
type MemberSortOrder = "name-asc" | "name-desc";
type UserDirectoryItem = {
  username: string;
  email: string;
  enabled: boolean;
  status: string;
  groups: string[];
};

type UserDirectoryResponse = {
  message: string;
  time: string;
  groupOptions: string[];
  items: UserDirectoryItem[];
};

type PriestOption = {
  sk: string;
  name: string;
};

type ContactsImportResponse = {
  message: string;
  time: string;
  processedCount: number;
  importedCount: number;
  skippedCount: number;
  importedMembers: string[];
  skippedMembers: string[];
};

type ParkingRegistrationFormState = {
  firstName: string;
  lastName: string;
  licensePlate: string;
  personalEmail: string;
  workEmail: string;
  placeOfWork: string;
  cellPhone: string;
  workPhone: string;
  durationFrom: string;
  durationTo: string;
};

type ParkingRegistrationResponse = {
  message: string;
  time: string;
  pk: string;
  sk: string;
};

type ParkingManagementResponse = {
  message: string;
  time: string;
  maxSpots: number;
  activeRegistrationCount: number;
  waitingListCount: number;
  updatedAt?: string;
};

type ParkingRegistrationItem = {
  pk: string;
  sk: string;
  history?: Array<{
    timestamp: string;
    action: string;
    message: string;
  }>;
  firstName: string;
  lastName: string;
  licensePlate: string;
  personalEmail: string;
  workEmail: string;
  placeOfWork: string;
  cellPhone: string;
  workPhone: string;
  durationFrom: string;
  durationTo: string;
  registeredAt: string;
  placementStatus: "waiting-list" | "assigned" | "available" | "active";
};

type ParkingRegistrationsResponse = {
  message: string;
  time: string;
  items: ParkingRegistrationItem[];
};

type GoogleCalendarConnectionResponse = {
  message: string;
  time: string;
  connected: boolean;
  hasRefreshToken: boolean;
  accessTokenExpiresAt: string | null;
  connectedAt: string | null;
  updatedAt: string | null;
  lastRefreshAt: string | null;
  tokenScope: string | null;
  lastError: string | null;
};

type GoogleCalendarConnectStartResponse = {
  message: string;
  time: string;
  authorizationUrl: string;
};

type GoogleCalendarCallbackState = {
  status: "success" | "error";
  message: string;
};

type GoogleCalendarFreeBusyResponse = {
  message: string;
  time: string;
  calendarId: string;
  timeMin: string;
  timeMax: string;
  busy: Array<{
    start: string;
    end: string;
  }>;
  errors: Array<{
    domain?: string;
    reason?: string;
  }>;
};

type GoogleCalendarListResponse = {
  message: string;
  time: string;
  items: Array<{
    id: string;
    name: string;
    primary: boolean;
    accessRole: string;
    timeZone: string;
    hidden: boolean;
    selected: boolean;
    calendarColor?: string;
    calendarColorEmoji?: string;
  }>;
};

type GoogleCalendarEventsResponse = {
  message: string;
  time: string;
  calendarId: string;
  timeMin: string;
  timeMax: string;
  syncMode?: "full" | "incremental" | "direct" | "cached";
  changedResources?: Array<
    | ({
        id: string;
        title: string;
        status: string;
        htmlLink: string;
        location: string;
        eventType: string;
        visibility: string;
        start: string;
        end: string;
        isAllDay: boolean;
        organizer: string;
      } & { changeType: "upsert" })
    | {
        id: string;
        status: string;
        changeType: "deleted";
      }
  >;
  items: Array<{
    id: string;
    title: string;
    status: string;
    htmlLink: string;
    location: string;
    description: string;
    eventType: string;
    visibility: string;
    start: string;
    end: string;
    isAllDay: boolean;
    organizer: string;
    congregationItems?: CongregationDirectoryResponse["items"];
    calendarId?: string;
    calendarName?: string;
    calendarColor?: string;
    calendarColorEmoji?: string;
  }>;
};

type GoogleCalendarEventItem = GoogleCalendarEventsResponse["items"][number];

type GoogleCalendarEventsPayload = {
  timeMin: string;
  timeMax: string;
  timeZone?: string;
  calendarId?: string;
  useSyncCache?: boolean;
  cacheOnly?: boolean;
  congregationItems?: CongregationDirectoryResponse["items"];
  selectedYearMonth?: string;
  selectedPeriodMonths?: string[];
  viewMode?: "day" | "week" | "month";
};

type GoogleCalendarCreateEventResponse = {
  message: string;
  time: string;
  calendarId: string;
  item: GoogleCalendarEventItem;
};

type GoogleCalendarUpdateEventResponse = GoogleCalendarCreateEventResponse;

type GoogleCalendarDeleteEventResponse = {
  message: string;
  time: string;
  calendarId: string;
  eventId: string;
};

type CalendarDashboardSummary = {
  day: {
    total: number;
    upcoming: number;
  };
  week: {
    total: number;
    upcoming: number;
  };
  month: {
    total: number;
    upcoming: number;
  };
  upcomingEvents: GoogleCalendarEventItem[];
};

type LoadedGoogleCalendarEventsAcrossCalendarsResult = {
  items: GoogleCalendarEventItem[];
  responseTimes: string[];
};

type GoogleCalendarReportingResponse = {
  message: string;
  time: string;
  year: number;
  eventCount: number;
  syncMode?: "full" | "incremental" | "direct" | "cached";
  syncModes?: Array<{
    calendarId: string;
    syncMode: "full" | "incremental" | "direct" | "cached";
  }>;
  rows: Array<{
    pk: string;
    sk: string;
    memberName: string;
    eventCountThisYear: number;
    lastEventDate: string | null;
  }>;
};

type CongregationDirectoryResponse = {
  message: string;
  time: string;
  items: Array<{
    pk: string;
    sk: string;
    firstName: string;
    lastName: string;
    phone: string;
  }>;
};

type CongregationDirectoryItem = CongregationDirectoryResponse["items"][number];

type CalendarTimeSlot = {
  start: string;
  end: string;
};

type CalendarEventFormState = {
  title: string;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
};

type SelectedCalendarMonthEventState = GoogleCalendarEventItem | null;
type CalendarScheduleViewMode = "day" | "week" | "month";

const getErrorMessage = async (error: unknown, fallback: string) => {
  if (error && typeof error === "object") {
    const maybeError = error as {
      message?: unknown;
      response?: {
        body?: {
          json?: () => Promise<unknown>;
          text?: () => Promise<string>;
        };
      };
    };

    const bodyJson = maybeError.response?.body?.json;

    if (typeof bodyJson === "function") {
      try {
        const payload = await bodyJson();

        if (
          payload &&
          typeof payload === "object" &&
          "message" in payload &&
          typeof (payload as { message?: unknown }).message === "string"
        ) {
          return (payload as { message: string }).message;
        }
      } catch {
        // Fall through to other error shapes.
      }
    }

    if (typeof maybeError.message === "string" && maybeError.message.trim()) {
      return maybeError.message;
    }
  }

  return fallback;
};

type AppNavigationState = {
  activePage: PageKey;
  selectedMember: SelectedMemberState | null;
  visitationFocus: VisitationFocusState | null;
  editingMember: EditingMemberState | null;
  betaMemberTab: "details" | "visitations" | "activity";
  calendarScheduleDate: string | null;
};

const manageableGroups = ["admin", "super_user", "regular_user", "parking_admin"] as const;
const groupLabelMap: Record<(typeof manageableGroups)[number], string> = {
  admin: "Admin",
  super_user: "Super User",
  regular_user: "Regular User",
  parking_admin: "Parking Admin",
};

const congregationApiName = Object.keys(outputs.custom?.API ?? {})[0];
const initialMemberForm: MemberFormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  photo: "",
  role: "",
  status: "",
  address: "",
  notes: "",
};

const parseMemberData = (value: string): StoredMemberData | null => {
  try {
    return JSON.parse(value) as StoredMemberData;
  } catch {
    return null;
  }
};

const memberDetailsViewCookieName = "shepherd_hub_member_details_view";
const memberContextMenuWidth = 240;
const memberContextMenuHeight = 248;
const memberLongPressDelayMs = 550;

const getCookieValue = (name: string) => {
  if (typeof document === "undefined") {
    return null;
  }

  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`),
  );

  return match ? decodeURIComponent(match[1]) : null;
};

const setCookieValue = (name: string, value: string, maxAgeSeconds: number) => {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
};

const formatMemberKeyLabel = (pk: string, sk: string) => `${pk} / ${sk}`;

const formatCompactMemberKey = (sk: string) => {
  return sk;
};

const formatDateInputValue = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
    value.getDate(),
  ).padStart(2, "0")}`;

const formatOrdinalDay = (day: number) => {
  const remainder = day % 10;
  const teenRemainder = day % 100;

  if (teenRemainder >= 11 && teenRemainder <= 13) {
    return `${day}th`;
  }

  if (remainder === 1) {
    return `${day}st`;
  }

  if (remainder === 2) {
    return `${day}nd`;
  }

  if (remainder === 3) {
    return `${day}rd`;
  }

  return `${day}th`;
};

const formatCompactCalendarDayLabel = (value: Date) =>
  `${value.toLocaleDateString(undefined, {
    weekday: "short",
  })} - ${value.toLocaleDateString(undefined, {
    month: "long",
  })} ${formatOrdinalDay(value.getDate())}`;

const buildLocalDateTimeIso = (dateValue: string, timeValue: string) => {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);

  return new Date(year, (month || 1) - 1, day || 1, hours || 0, minutes || 0, 0, 0)
    .toISOString();
};

const formatTimeLabel = (value: string) =>
  new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

const parseCalendarEventDateValue = (value: string, isAllDay: boolean) => {
  if (isAllDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, (month || 1) - 1, day || 1, 0, 0, 0, 0);
  }

  return new Date(value);
};

const formatDurationLabel = (start: string, end: string) => {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const totalMinutes = Math.max(0, Math.round((endMs - startMs) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h`;
  }

  return `${minutes}m`;
};

const formatEventDateTimeLabel = (start: string, end: string, isAllDay: boolean) => {
  if (isAllDay) {
    return `${parseCalendarEventDateValue(start, true).toLocaleDateString()} (All day)`;
  }

  return `${formatTimeLabel(start)} to ${formatTimeLabel(end)}`;
};

const formatLastSyncLabel = (value?: string | null) => {
  if (!value) {
    return "Loaded from cache";
  }

  const parsed = new Date(value);

  if (!Number.isNaN(parsed.getTime())) {
    return `Last sync ${parsed.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }

  return "Loaded from cache";
};

const formatTimeInputValue = (value: string) => {
  const parsedDate = new Date(value);

  if (!Number.isFinite(parsedDate.getTime())) {
    return "";
  }

  return `${String(parsedDate.getHours()).padStart(2, "0")}:${String(parsedDate.getMinutes()).padStart(2, "0")}`;
};

const addDaysToDateInputValue = (dateValue: string, daysToAdd: number) => {
  const [year, month, day] = dateValue.split("-").map(Number);
  const nextDate = new Date(year, (month || 1) - 1, day || 1, 0, 0, 0, 0);
  nextDate.setDate(nextDate.getDate() + daysToAdd);
  return formatDateInputValue(nextDate);
};

const startOfWeek = (value = new Date()) => {
  const nextDate = new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0);
  nextDate.setDate(nextDate.getDate() - nextDate.getDay());
  return nextDate;
};

const getAllDayEventSpanDays = (start: string, end: string) => {
  const startDate = parseCalendarEventDateValue(start, true).getTime();
  const endDate = parseCalendarEventDateValue(end, true).getTime();
  const daySpan = Math.round((endDate - startDate) / (24 * 60 * 60 * 1000));

  return Math.max(1, daySpan);
};

const formatCongregationDirectoryItemLabel = (item: CongregationDirectoryItem) =>
  `${item.firstName ?? ""} ${item.lastName ?? ""}`.trim();

const formatCongregationDirectoryItemSubLabel = (item: CongregationDirectoryItem) =>
  (item.phone ?? "").trim() || "No telephone";

const normalizeCongregationPhone = (value?: string) => (value ?? "").replace(/[^\d+]/g, "");

const extractCalendarEventCongregationDetails = (description: string | undefined) => {
  const lines = (description ?? "").split("\n");
  const congregationEntries: Array<{ name: string; phone: string }> = [];
  const remainingLines: string[] = [];
  let isReadingCongregationBlock = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!isReadingCongregationBlock) {
      if (trimmedLine === "Congregation:") {
        isReadingCongregationBlock = true;
        continue;
      }

      remainingLines.push(line);
      continue;
    }

    if (!trimmedLine) {
      isReadingCongregationBlock = false;
      continue;
    }

    const match = /^-\s+(.*?)(?:\s+\((.*)\))?$/.exec(trimmedLine);

    if (!match) {
      isReadingCongregationBlock = false;
      remainingLines.push(line);
      continue;
    }

    congregationEntries.push({
      name: (match[1] ?? "").trim(),
      phone: (match[2] ?? "").trim(),
    });
  }

  const cleanedDescription = remainingLines.join("\n").trim();

  return {
    congregationEntries,
    description: cleanedDescription,
  };
};

const buildCalendarEventDescription = (
  description: string | undefined,
  congregationItems: CongregationDirectoryItem[] = [],
) => {
  const trimmedDescription = (description ?? "").trim();

  if (congregationItems.length === 0) {
    return trimmedDescription;
  }

  const congregationLines = [
    "Congregation:",
    ...congregationItems.map(
      (item) =>
        `- ${formatCongregationDirectoryItemLabel(item)}${
          (item.phone ?? "").trim() ? ` (${(item.phone ?? "").trim()})` : ""
        }`,
    ),
  ];

  return trimmedDescription
    ? [...congregationLines, "", trimmedDescription].join("\n")
    : congregationLines.join("\n");
};

const buildFreeTimeSlots = ({
  timeMin,
  timeMax,
  busy,
}: {
  timeMin: string;
  timeMax: string;
  busy: CalendarTimeSlot[];
}) => {
  const windowStart = new Date(timeMin).getTime();
  const windowEnd = new Date(timeMax).getTime();

  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowStart >= windowEnd) {
    return [];
  }

  const normalizedBusy = busy
    .map((slot) => ({
      start: new Date(slot.start).getTime(),
      end: new Date(slot.end).getTime(),
    }))
    .filter(
      (slot) =>
        Number.isFinite(slot.start) &&
        Number.isFinite(slot.end) &&
        slot.end > windowStart &&
        slot.start < windowEnd,
    )
    .sort((left, right) => left.start - right.start);

  const freeSlots: CalendarTimeSlot[] = [];
  let cursor = windowStart;

  for (const slot of normalizedBusy) {
    const boundedStart = Math.max(slot.start, windowStart);
    const boundedEnd = Math.min(slot.end, windowEnd);

    if (boundedStart > cursor) {
      freeSlots.push({
        start: new Date(cursor).toISOString(),
        end: new Date(boundedStart).toISOString(),
      });
    }

    cursor = Math.max(cursor, boundedEnd);
  }

  if (cursor < windowEnd) {
    freeSlots.push({
      start: new Date(cursor).toISOString(),
      end: new Date(windowEnd).toISOString(),
    });
  }

  return freeSlots;
};

const initialCalendarEventForm: CalendarEventFormState = {
  title: "",
  startTime: "09:00",
  endTime: "10:00",
  location: "",
  description: "",
};

const googleCalendarColorPalette = [
  { color: "#6f927b", emoji: "🟢" },
  { color: "#b77a7a", emoji: "🔴" },
  { color: "#738ab3", emoji: "🔵" },
  { color: "#b9a76b", emoji: "🟡" },
  { color: "#9476ad", emoji: "🟣" },
  { color: "#9b8167", emoji: "🟤" },
] as const;

const assignGoogleCalendarPalette = (
  items: GoogleCalendarListResponse["items"],
): GoogleCalendarListResponse["items"] =>
  items.map((item, index) => {
    const paletteEntry = googleCalendarColorPalette[index % googleCalendarColorPalette.length];

    return {
      ...item,
      calendarColor: paletteEntry.color,
      calendarColorEmoji: paletteEntry.emoji,
    };
  });

const areGoogleCalendarListsEqual = (
  left: GoogleCalendarListResponse["items"],
  right: GoogleCalendarListResponse["items"],
) =>
  left.length === right.length &&
  left.every((leftItem, index) => {
    const rightItem = right[index];

    return (
      rightItem !== undefined &&
      leftItem.id === rightItem.id &&
      leftItem.name === rightItem.name &&
      leftItem.primary === rightItem.primary &&
      leftItem.accessRole === rightItem.accessRole &&
      leftItem.timeZone === rightItem.timeZone &&
      leftItem.hidden === rightItem.hidden &&
      leftItem.selected === rightItem.selected &&
      leftItem.calendarColor === rightItem.calendarColor &&
      leftItem.calendarColorEmoji === rightItem.calendarColorEmoji
    );
  });

const hexToRgba = (hexColor: string, alpha: number) => {
  const normalized = hexColor.replace("#", "");
  const safeHex =
    normalized.length === 3
      ? normalized
          .split("")
          .map((character) => `${character}${character}`)
          .join("")
      : normalized;
  const red = Number.parseInt(safeHex.slice(0, 2), 16);
  const green = Number.parseInt(safeHex.slice(2, 4), 16);
  const blue = Number.parseInt(safeHex.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const normalizePhoneForLink = (value?: string) => {
  if (!value) {
    return "";
  }

  const cleaned = value.replace(/[^\d+]/g, "");

  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  return cleaned.replace(/[^\d]/g, "");
};

const normalizeEmailValue = (value?: string) => value?.trim().toLowerCase() ?? "";

const isParkingMonthValue = (value?: string) => /^\d{4}-\d{2}$/.test(value ?? "");

const parseParkingMonthStart = (value?: string) => {
  if (isParkingMonthValue(value)) {
    const [year, month] = value!.split("-").map(Number);

    return new Date(year, month - 1, 1);
  }

  if (!value) {
    return null;
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1);
};

const formatParkingMonthLabel = (value?: string) => {
  const monthStart = parseParkingMonthStart(value);

  if (!monthStart) {
    return "Not set";
  }

  return monthStart.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
};

const formatParkingDurationLabel = (durationFrom?: string, durationTo?: string) => {
  if (!durationFrom || !durationTo) {
    return "Not set";
  }

  return `${formatParkingMonthLabel(durationFrom)} to ${formatParkingMonthLabel(durationTo)}`;
};

const getMemberInitials = (
  firstName?: string,
  lastName?: string,
  fallbackName?: string,
) => {
  const parts = [firstName, lastName]
    .filter(Boolean)
    .map((value) => value!.trim())
    .filter(Boolean);

  if (parts.length > 0) {
    return parts.slice(0, 2).map((value) => value[0]!.toUpperCase()).join("");
  }

  if (fallbackName?.trim()) {
    return fallbackName.trim()[0]!.toUpperCase();
  }

  return "?";
};

const getMemberName = (
  firstName?: string,
  lastName?: string,
  fallback = "",
) => [firstName, lastName].filter(Boolean).join(" ").trim() || fallback;

const resizeMemberPhoto = async (file: File) => {
  const imageDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Unable to read the selected image."));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const nextImage = new Image();
    nextImage.onload = () => resolve(nextImage);
    nextImage.onerror = () => reject(new Error("Unable to load the selected image."));
    nextImage.src = imageDataUrl;
  });

  const maxSize = 256;
  const scale = Math.min(maxSize / image.width, maxSize / image.height, 1);
  const targetWidth = Math.max(1, Math.round(image.width * scale));
  const targetHeight = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to prepare the selected image.");
  }

  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  return canvas.toDataURL("image/jpeg", 0.82);
};

const parseAnnouncementWeekData = (value: string): AnnouncementWeekData | null => {
  try {
    return JSON.parse(value) as AnnouncementWeekData;
  } catch {
    return null;
  }
};

const formatAnnouncementWeekLabel = (value: string | undefined) => {
  if (!value) {
    return "Unknown week";
  }

  const match = /^(\d{4})-W(\d{2})$/.exec(value);

  if (!match) {
    return value;
  }

  const [, yearText, weekText] = match;
  const year = Number(yearText);
  const week = Number(weekText);
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const januaryFourthDay = januaryFourth.getUTCDay() || 7;
  const mondayOfWeekOne = new Date(januaryFourth);
  mondayOfWeekOne.setUTCDate(januaryFourth.getUTCDate() - januaryFourthDay + 1);
  const mondayOfTargetWeek = new Date(mondayOfWeekOne);
  mondayOfTargetWeek.setUTCDate(mondayOfWeekOne.getUTCDate() + (week - 1) * 7);
  const sundayOfTargetWeek = new Date(mondayOfTargetWeek);
  sundayOfTargetWeek.setUTCDate(mondayOfTargetWeek.getUTCDate() + 6);

  const startMonth = mondayOfTargetWeek.toLocaleDateString(undefined, {
    month: "short",
    timeZone: "UTC",
  });
  const startDay = mondayOfTargetWeek.toLocaleDateString(undefined, {
    day: "numeric",
    timeZone: "UTC",
  });
  const endMonth = sundayOfTargetWeek.toLocaleDateString(undefined, {
    month: "short",
    timeZone: "UTC",
  });
  const endDay = sundayOfTargetWeek.toLocaleDateString(undefined, {
    day: "numeric",
    timeZone: "UTC",
  });
  const endYear = sundayOfTargetWeek.toLocaleDateString(undefined, {
    year: "numeric",
    timeZone: "UTC",
  });

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay} - ${endDay}, ${endYear}`;
  }

  return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${endYear}`;
};

const getCurrentIsoWeekLabel = () => {
  const today = new Date();
  const utcDate = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
  );
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const year = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((utcDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  return `${year}-W${String(week).padStart(2, "0")}`;
};

const startOfMonth = (value = new Date()) =>
  new Date(value.getFullYear(), value.getMonth(), 1);

const isSameDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const buildCalendarDays = (monthDate: Date) => {
  const firstDayOfMonth = startOfMonth(monthDate);
  const startWeekday = firstDayOfMonth.getDay();
  const gridStart = new Date(firstDayOfMonth);
  gridStart.setDate(firstDayOfMonth.getDate() - startWeekday);

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
};

const buildCalendarScheduleVisibleDays = (
  viewDate: Date,
  viewMode: CalendarScheduleViewMode,
) => {
  if (viewMode === "day") {
    return [
      new Date(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate(), 0, 0, 0, 0),
    ];
  }

  if (viewMode === "week") {
    const weekStart = startOfWeek(viewDate);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + index);
      return day;
    });
  }

  return buildCalendarDays(viewDate);
};

const getCalendarScheduleRange = (
  viewDate: Date,
  viewMode: CalendarScheduleViewMode,
) => {
  if (viewMode === "day") {
    const start = new Date(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate(), 0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }

  if (viewMode === "week") {
    const start = startOfWeek(viewDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }

  const start = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
};

const getCalendarScheduleVisibleMonths = (
  start: Date,
  end: Date,
) => {
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1, 0, 0, 0, 0);
  const monthKeys = new Set<string>();

  while (cursor.getTime() < end.getTime()) {
    monthKeys.add(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return Array.from(monthKeys.values());
};

const shiftCalendarScheduleViewDate = (
  current: Date,
  viewMode: CalendarScheduleViewMode,
  direction: -1 | 1,
) => {
  const nextDate = new Date(current);

  if (viewMode === "day") {
    nextDate.setDate(nextDate.getDate() + direction);
    return nextDate;
  }

  if (viewMode === "week") {
    nextDate.setDate(nextDate.getDate() + direction * 7);
    return nextDate;
  }

  return new Date(current.getFullYear(), current.getMonth() + direction, 1);
};

const getCalendarScheduleAnchorDateForViewMode = (viewMode: CalendarScheduleViewMode) => {
  const now = new Date();

  if (viewMode === "day") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  }

  if (viewMode === "week") {
    return startOfWeek(now);
  }

  return startOfMonth(now);
};

const formatCalendarScheduleRangeLabel = (
  viewDate: Date,
  viewMode: CalendarScheduleViewMode,
) => {
  if (viewMode === "day") {
    return viewDate.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  if (viewMode === "week") {
    const start = startOfWeek(viewDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const startMonth = start.toLocaleDateString(undefined, { month: "short" });
    const startDay = start.toLocaleDateString(undefined, { day: "numeric" });
    const endMonth = end.toLocaleDateString(undefined, { month: "short" });
    const endDay = end.toLocaleDateString(undefined, { day: "numeric" });
    const endYear = end.toLocaleDateString(undefined, { year: "numeric" });

    return startMonth === endMonth
      ? `${startMonth} ${startDay} - ${endDay}, ${endYear}`
      : `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${endYear}`;
  }

  return viewDate.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
};

const formatCalendarScheduleDayLabel = (
  value: Date,
  viewMode: CalendarScheduleViewMode,
  isCompactMobileViewport: boolean,
) => {
  if (viewMode === "month") {
    return isCompactMobileViewport ? formatCompactCalendarDayLabel(value) : value.getDate();
  }

  return value.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

const isActiveParkingPlacementStatus = (value?: string) =>
  value === "assigned" || value === "available" || value === "active";

const extractGroupsFromClaim = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map(String);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map(String);
      }
    } catch {
      const cleaned = value.replace(/^\[|\]$/g, "").trim();

      return cleaned
        .split(/[,\s]+/)
        .map((group) => group.trim())
        .filter(Boolean);
    }

    return [value];
  }

  return [];
};

const placeholderPages: PageKey[] = [
  "events",
  "sunday-school",
  "summer-camp",
  "parking",
  "board-meeting",
];

const getInitialCalendarCallbackState = (): GoogleCalendarCallbackState | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const status = params.get("calendar-google-status");
  const message = params.get("calendar-google-message") ?? "";

  if ((status === "success" || status === "error") && message) {
    return {
      status,
      message,
    };
  }

  return null;
};

const getInitialActivePage = (): PageKey => {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);

    if (params.get("calendar-google-status")) {
      return "calendar-connect";
    }
  }

  if (typeof window !== "undefined" && window.location.hash === "#parking-registration") {
    return "parking-registration";
  }

  return "congregation";
};

const initialAnnouncementWeekForm: AnnouncementWeekFormState = {
  weekLabel: "",
  items: [""],
};

const initialParkingRegistrationForm: ParkingRegistrationFormState = {
  firstName: "",
  lastName: "",
  licensePlate: "",
  personalEmail: "",
  workEmail: "",
  placeOfWork: "",
  cellPhone: "",
  workPhone: "",
  durationFrom: "",
  durationTo: "",
};

const mobileMemberDetailsBreakpoint = 640;

const getIsCompactMobileViewport = () =>
  typeof window !== "undefined" && window.innerWidth <= mobileMemberDetailsBreakpoint;

export default function App() {
  const sidePanelRef = useRef<HTMLElement | null>(null);
  const betaMemberMenuRef = useRef<HTMLDivElement | null>(null);
  const calendarBookingModalRef = useRef<HTMLDivElement | null>(null);
  const calendarDayEventsModalRef = useRef<HTMLDivElement | null>(null);
  const memberContextMenuRef = useRef<HTMLDivElement | null>(null);
  const contactsImportInputRef = useRef<HTMLInputElement | null>(null);
  const memberPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const isApplyingPopStateRef = useRef(false);
  const calendarMonthEventsRequestRef = useRef(0);
  const calendarDashboardRequestRef = useRef(0);
  const googleCalendarsRequestPromiseRef =
    useRef<Promise<GoogleCalendarListResponse["items"]> | null>(null);
  const memberLongPressTimerRef = useRef<number | null>(null);
  const suppressMemberClickRef = useRef(false);
  const initialGoogleCalendarCallbackState = getInitialCalendarCallbackState();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [pendingSignInStep, setPendingSignInStep] = useState<string | null>(null);
  const [challengeResponse, setChallengeResponse] = useState("");
  const [authStatus, setAuthStatus] = useState<"checking" | "signed-in" | "signed-out">(
    "checking",
  );
  const [authForm, setAuthForm] = useState({
    username: "",
    password: "",
  });
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [currentUserLabel, setCurrentUserLabel] = useState<string>("");
  const [currentUserGroups, setCurrentUserGroups] = useState<string[]>([]);
  const [googleCalendarConnection, setGoogleCalendarConnection] =
    useState<GoogleCalendarConnectionResponse | null>(null);
  const [googleCalendarStatus, setGoogleCalendarStatus] = useState<string | null>(
    initialGoogleCalendarCallbackState?.message ?? null,
  );
  const [googleCalendarStatusTone, setGoogleCalendarStatusTone] = useState<
    "success" | "error" | "neutral"
  >(initialGoogleCalendarCallbackState?.status ?? "neutral");
  const [isGoogleCalendarLoading, setIsGoogleCalendarLoading] = useState(false);
  const [isGoogleCalendarConnecting, setIsGoogleCalendarConnecting] = useState(false);
  const [calendarScheduleLookupDate, setCalendarScheduleLookupDate] = useState(() =>
    formatDateInputValue(new Date()),
  );
  const [calendarScheduleLookupStartTime, setCalendarScheduleLookupStartTime] =
    useState("09:00");
  const [calendarScheduleLookupEndTime, setCalendarScheduleLookupEndTime] =
    useState("17:00");
  const [calendarMonthViewDate, setCalendarMonthViewDate] = useState(() =>
    startOfMonth(new Date()),
  );
  const [calendarScheduleViewMode, setCalendarScheduleViewMode] =
    useState<CalendarScheduleViewMode>("month");
  const [calendarMonthExpandedDate, setCalendarMonthExpandedDate] = useState<string | null>(null);
  const [calendarMonthSelectedDate, setCalendarMonthSelectedDate] = useState<string | null>(
    null,
  );
  const [selectedCalendarMonthEvent, setSelectedCalendarMonthEvent] =
    useState<SelectedCalendarMonthEventState>(null);
  const [congregationDirectory, setCongregationDirectory] =
    useState<CongregationDirectoryResponse["items"]>([]);
  const [calendarCongregationQuery, setCalendarCongregationQuery] = useState("");
  const [selectedCongregationDirectoryItems, setSelectedCongregationDirectoryItems] = useState<
    CongregationDirectoryItem[]
  >([]);
  const [pendingCalendarCongregationEntries, setPendingCalendarCongregationEntries] = useState<
    Array<{ name: string; phone: string }>
  >([]);
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarListResponse["items"]>(
    [],
  );
  const [selectedGoogleCalendarId, setSelectedGoogleCalendarId] = useState("primary");
  const [calendarAvailability, setCalendarAvailability] =
    useState<GoogleCalendarFreeBusyResponse | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<GoogleCalendarEventsResponse | null>(null);
  const [calendarMonthEvents, setCalendarMonthEvents] =
    useState<GoogleCalendarEventsResponse | null>(null);
  const [calendarDashboardSummary, setCalendarDashboardSummary] =
    useState<CalendarDashboardSummary | null>(null);
  const [calendarDashboardStatus, setCalendarDashboardStatus] = useState<string | null>(null);
  const [isCalendarDashboardLoading, setIsCalendarDashboardLoading] = useState(false);
  const [calendarDashboardLastSyncAt, setCalendarDashboardLastSyncAt] = useState<string | null>(
    null,
  );
  const [calendarReportingRows, setCalendarReportingRows] = useState<
    GoogleCalendarReportingResponse["rows"]
  >([]);
  const [calendarReportingStatus, setCalendarReportingStatus] = useState<string | null>(null);
  const [isCalendarReportingLoading, setIsCalendarReportingLoading] = useState(false);
  const [isCalendarMonthLoading, setIsCalendarMonthLoading] = useState(false);
  const [calendarMonthLoadBadge, setCalendarMonthLoadBadge] = useState<{
    label: string;
    tone: "neutral" | "success";
  } | null>(null);
  const [calendarEventForm, setCalendarEventForm] =
    useState<CalendarEventFormState>(initialCalendarEventForm);
  const [calendarEventFormStatus, setCalendarEventFormStatus] = useState<string | null>(null);
  const [isCalendarEventSubmitting, setIsCalendarEventSubmitting] = useState(false);
  const [isCalendarEventDeleting, setIsCalendarEventDeleting] = useState(false);
  const [calendarAvailabilityStatus, setCalendarAvailabilityStatus] = useState<string | null>(
    null,
  );
  const [isCalendarAvailabilityLoading, setIsCalendarAvailabilityLoading] = useState(false);
  const [preferredMemberDetailsPage, setPreferredMemberDetailsPage] = useState<
    "member-details" | "member-details-beta"
  >("member-details-beta");
  const [isCompactMobileViewport, setIsCompactMobileViewport] = useState(
    getIsCompactMobileViewport,
  );
  const [activePage, setActivePage] = useState<PageKey>(getInitialActivePage);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [backendMessage, setBackendMessage] = useState<BackendMessage | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [isBackendLoading, setIsBackendLoading] = useState(false);
  const [announcements, setAnnouncements] = useState<AnnouncementResponse | null>(null);
  const [announcementsError, setAnnouncementsError] = useState<string | null>(null);
  const [isAnnouncementsLoading, setIsAnnouncementsLoading] = useState(false);
  const [announcementSortOrder, setAnnouncementSortOrder] =
    useState<AnnouncementSortOrder>("latest");
  const [announcementWeekForm, setAnnouncementWeekForm] =
    useState<AnnouncementWeekFormState>(initialAnnouncementWeekForm);
  const [announcementSubmitState, setAnnouncementSubmitState] = useState<string | null>(
    null,
  );
  const [isAnnouncementSubmitting, setIsAnnouncementSubmitting] = useState(false);
  const [deletingAnnouncementSk, setDeletingAnnouncementSk] = useState<string | null>(null);
  const [announcementDeleteModal, setAnnouncementDeleteModal] =
    useState<AnnouncementDeleteModalState>(null);
  const [announcementItemDeleteModal, setAnnouncementItemDeleteModal] =
    useState<AnnouncementItemDeleteModalState>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberSortOrder, setMemberSortOrder] = useState<MemberSortOrder>("name-asc");
  const [memberForm, setMemberForm] = useState<MemberFormState>(initialMemberForm);
  const [memberPhotoStatus, setMemberPhotoStatus] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<EditingMemberState>(null);
  const [selectedMember, setSelectedMember] = useState<SelectedMemberState>(null);
  const [visitationFocus, setVisitationFocus] = useState<VisitationFocusState>(null);
  const [calendarScheduleDate, setCalendarScheduleDate] = useState<string | null>(null);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [betaMemberTab, setBetaMemberTab] = useState<
    "details" | "visitations" | "activity"
  >("details");
  const [isBetaMemberMenuOpen, setIsBetaMemberMenuOpen] = useState(false);
  const [memberSubmitState, setMemberSubmitState] = useState<string | null>(null);
  const [isMemberSubmitting, setIsMemberSubmitting] = useState(false);
  const [deletingMemberKey, setDeletingMemberKey] = useState<string | null>(null);
  const [visitationModal, setVisitationModal] = useState<VisitationModalState>(null);
  const [visitationSchedule, setVisitationSchedule] = useState("");
  const [visitationNote, setVisitationNote] = useState("");
  const [visitationAssignedPriestSk, setVisitationAssignedPriestSk] = useState("");
  const [visitationAssignedPriestName, setVisitationAssignedPriestName] = useState("");
  const [visitationReportPriestFilter, setVisitationReportPriestFilter] = useState("all");
  const [visitationCalendarPriestFilter, setVisitationCalendarPriestFilter] = useState("all");
  const [visitationCalendarMonth, setVisitationCalendarMonth] = useState(() =>
    startOfMonth(new Date()),
  );
  const [calendarScheduleMemberSk, setCalendarScheduleMemberSk] = useState("");
  const [calendarScheduleTime, setCalendarScheduleTime] = useState("09:00");
  const [calendarScheduleAssignedPriestSk, setCalendarScheduleAssignedPriestSk] =
    useState("");
  const [calendarScheduleSubmitState, setCalendarScheduleSubmitState] = useState<
    string | null
  >(null);
  const [isCalendarScheduleSubmitting, setIsCalendarScheduleSubmitting] = useState(false);
  const [showCompletedVisitationsInReport, setShowCompletedVisitationsInReport] =
    useState(true);
  const [visitationSubmitState, setVisitationSubmitState] = useState<string | null>(
    null,
  );
  const [isVisitationSubmitting, setIsVisitationSubmitting] = useState(false);
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>(null);
  const [memberContextMenu, setMemberContextMenu] = useState<MemberContextMenuState>(null);
  const [parkingHistoryModal, setParkingHistoryModal] = useState<ParkingHistoryModalState>(null);
  const [userDirectory, setUserDirectory] = useState<UserDirectoryItem[]>([]);
  const [groupAssignments, setGroupAssignments] = useState<Record<string, string[]>>({});
  const [isUserDirectoryLoading, setIsUserDirectoryLoading] = useState(false);
  const [userDirectoryError, setUserDirectoryError] = useState<string | null>(null);
  const [savingUserGroups, setSavingUserGroups] = useState<string | null>(null);
  const [userDirectoryStatus, setUserDirectoryStatus] = useState<string | null>(null);
  const [contactsImportFile, setContactsImportFile] = useState<File | null>(null);
  const [contactsImportStatus, setContactsImportStatus] = useState<string | null>(null);
  const [contactsImportSummary, setContactsImportSummary] =
    useState<ContactsImportResponse | null>(null);
  const [isContactsImporting, setIsContactsImporting] = useState(false);
  const [parkingRegistrationForm, setParkingRegistrationForm] =
    useState<ParkingRegistrationFormState>(initialParkingRegistrationForm);
  const [parkingRegistrationStatus, setParkingRegistrationStatus] = useState<string | null>(
    null,
  );
  const [isParkingRegistrationSubmitting, setIsParkingRegistrationSubmitting] =
    useState(false);
  const [parkingManagement, setParkingManagement] =
    useState<ParkingManagementResponse | null>(null);
  const [parkingManagementStatus, setParkingManagementStatus] = useState<string | null>(null);
  const [parkingManagementError, setParkingManagementError] = useState<string | null>(null);

  const memberDetailsPageForViewport = isCompactMobileViewport
    ? "member-details-beta"
    : preferredMemberDetailsPage;
  const [parkingMaxSpotsInput, setParkingMaxSpotsInput] = useState("0");
  const [isParkingManagementLoading, setIsParkingManagementLoading] = useState(false);
  const [isParkingManagementSaving, setIsParkingManagementSaving] = useState(false);
  const [parkingRegistrations, setParkingRegistrations] = useState<ParkingRegistrationItem[]>([]);
  const [parkingRegistrationsError, setParkingRegistrationsError] = useState<string | null>(null);
  const [isParkingRegistrationsLoading, setIsParkingRegistrationsLoading] = useState(false);
  const [parkingTab, setParkingTab] = useState<"assigned" | "waiting-list">("assigned");
  const [updatingParkingRegistrationSk, setUpdatingParkingRegistrationSk] = useState<
    string | null
  >(null);
  const [printingParkingRegistrationSk, setPrintingParkingRegistrationSk] = useState<
    string | null
  >(null);
  const currentPage = pageContent[activePage];
  const isEditingMember = editingMember !== null;
  const isAdminUser = currentUserGroups.includes("admin");
  const canManageUsers =
    currentUserGroups.includes("admin") || currentUserGroups.includes("super_user");
  const canManageAnnouncements = canManageUsers;
  const currentUserEmail = normalizeEmailValue(currentUserLabel);
  const canManageParking =
    isAdminUser ||
    Boolean(
      currentUserEmail &&
        (backendMessage?.items ?? []).some((item) => {
          const memberData = parseMemberData(item.data);
          return (
            normalizeEmailValue(memberData?.email) === currentUserEmail &&
            memberData?.role === "parking-admin"
          );
        }),
    );
  const currentAnnouncementWeekLabel = getCurrentIsoWeekLabel();
  const assignedParkingRegistrations = parkingRegistrations.filter((registration) =>
    isActiveParkingPlacementStatus(registration.placementStatus),
  );
  const waitingListRegistrations = parkingRegistrations
    .filter((registration) => registration.placementStatus === "waiting-list")
    .slice()
    .sort((left, right) => left.registeredAt.localeCompare(right.registeredAt));
  const isBackendRequestInFlight =
    isBackendLoading ||
    isAnnouncementsLoading ||
    isAnnouncementSubmitting ||
    deletingAnnouncementSk !== null ||
    isMemberSubmitting ||
    deletingMemberKey !== null ||
    isVisitationSubmitting ||
    isCalendarScheduleSubmitting ||
    isUserDirectoryLoading ||
    savingUserGroups !== null ||
    isContactsImporting ||
    isGoogleCalendarLoading ||
    isGoogleCalendarConnecting ||
    isCalendarDashboardLoading ||
    isCalendarReportingLoading ||
    isCalendarAvailabilityLoading ||
    isCalendarMonthLoading ||
    isCalendarEventSubmitting ||
    isParkingRegistrationSubmitting ||
    isParkingManagementLoading ||
    isParkingManagementSaving ||
    isParkingRegistrationsLoading ||
    updatingParkingRegistrationSk !== null ||
    printingParkingRegistrationSk !== null;
  const selectedMemberItem =
    selectedMember && backendMessage
      ? backendMessage.items.find(
          (item) => item.pk === selectedMember.pk && item.sk === selectedMember.sk,
        ) ?? null
      : null;
  const selectedMemberData = selectedMemberItem
    ? parseMemberData(selectedMemberItem.data)
    : null;
  const selectedMemberName = selectedMemberData
    ? [selectedMemberData.firstName, selectedMemberData.lastName]
        .filter(Boolean)
        .join(" ") || "Unnamed member"
    : "Member";
  const selectedMemberPhone = normalizePhoneForLink(selectedMemberData?.phone);
  const selectedMemberWhatsappPhone = selectedMemberPhone.replace(/[^\d]/g, "");
  const selectedMemberEmail = selectedMemberData?.email?.trim() ?? "";
  const selectedMemberInitials = getMemberInitials(
    selectedMemberData?.firstName,
    selectedMemberData?.lastName,
    selectedMemberName,
  );
  const selectedMemberPhotoDataUrl =
    selectedMemberItem?.photo ?? selectedMemberData?.photo ?? selectedMemberData?.photoDataUrl;
  const selectedMemberHistory =
    selectedMemberData?.history && selectedMemberData.history.length > 0
      ? selectedMemberData.history
      : selectedMemberData?.createdAt
        ? [
            {
              timestamp: selectedMemberData.createdAt,
              action: "member_created",
              message: "Member entry added.",
            },
          ]
        : [];
  const normalizedMemberSearch = memberSearch.trim().toLowerCase();
  const filteredCongregationItems =
    backendMessage?.items.filter((item) => {
      if (!normalizedMemberSearch) {
        return true;
      }

      const memberData = parseMemberData(item.data);
      const haystack = [
        item.pk,
        item.sk,
        item.data,
        memberData?.firstName,
        memberData?.lastName,
        memberData?.email,
        memberData?.phone,
        memberData?.role,
        memberData?.status,
        memberData?.address,
        memberData?.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedMemberSearch);
    }) ?? [];
  const sortedCongregationItems = filteredCongregationItems.slice().sort((left, right) => {
    const leftData = parseMemberData(left.data);
    const rightData = parseMemberData(right.data);
    const leftName = getMemberName(leftData?.firstName, leftData?.lastName, `${left.pk} ${left.sk}`);
    const rightName = getMemberName(
      rightData?.firstName,
      rightData?.lastName,
      `${right.pk} ${right.sk}`,
    );

    return memberSortOrder === "name-asc"
      ? leftName.localeCompare(rightName, undefined, { sensitivity: "base" })
      : rightName.localeCompare(leftName, undefined, { sensitivity: "base" });
  });
  const congregationMemberOptions = ((backendMessage?.items ?? [])
    .map((item) => {
      const memberData = parseMemberData(item.data);

      return {
        pk: item.pk,
        sk: item.sk,
        name: getMemberName(memberData?.firstName, memberData?.lastName, item.sk),
      };
    })
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    ));
  const priestMembers = ((backendMessage?.items ?? [])
    .map((item) => {
      const memberData = parseMemberData(item.data);

      if (memberData?.role !== "Priest") {
        return null;
      }

      return {
        sk: item.sk,
        name: getMemberName(memberData.firstName, memberData.lastName, item.sk),
      };
    })
    .filter((item): item is PriestOption => item !== null)
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    ));
  const selectedVisitationPriestAvailable =
    !visitationAssignedPriestSk ||
    priestMembers.some((priest) => priest.sk === visitationAssignedPriestSk);
  const selectedCalendarScheduleMember =
    congregationMemberOptions.find((member) => member.sk === calendarScheduleMemberSk) ?? null;
  const calendarScheduleDateLabel = calendarScheduleDate
    ? new Date(`${calendarScheduleDate}T00:00`).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";
  const calendarAvailabilityFreeSlots = calendarAvailability
    ? buildFreeTimeSlots({
        timeMin: calendarAvailability.timeMin,
        timeMax: calendarAvailability.timeMax,
        busy: calendarAvailability.busy,
      })
    : [];
  const calendarScheduleVisibleDays = buildCalendarScheduleVisibleDays(
    calendarMonthViewDate,
    calendarScheduleViewMode,
  );
  const calendarMonthLabel = formatCalendarScheduleRangeLabel(
    calendarMonthViewDate,
    calendarScheduleViewMode,
  );
  const calendarMonthSelectedDateLabel = calendarMonthSelectedDate
    ? new Date(`${calendarMonthSelectedDate}T00:00`).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";
  const calendarMonthExpandedDateLabel = calendarMonthExpandedDate
    ? new Date(`${calendarMonthExpandedDate}T00:00`).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";
  const calendarMonthExpandedDayEvents = calendarMonthExpandedDate
    ? (calendarMonthEvents?.items ?? []).filter((eventItem) =>
        formatDateInputValue(
          parseCalendarEventDateValue(eventItem.start, eventItem.isAllDay),
        ) === calendarMonthExpandedDate,
      )
    : [];
  const normalizedCalendarCongregationQuery = calendarCongregationQuery.trim().toLowerCase();
  const filteredCalendarCongregationSuggestions =
    normalizedCalendarCongregationQuery
      ? congregationDirectory
          .filter((item) => {
            const fullName = formatCongregationDirectoryItemLabel(item).toLowerCase();
            const phoneLabel = formatCongregationDirectoryItemSubLabel(item).toLowerCase();
            return (
              fullName.includes(normalizedCalendarCongregationQuery) ||
              phoneLabel.includes(normalizedCalendarCongregationQuery)
            );
          })
          .filter(
            (item) =>
              !selectedCongregationDirectoryItems.some(
                (selectedItem) =>
                  selectedItem.pk === item.pk && selectedItem.sk === item.sk,
              ),
          )
          .slice(0, 5)
      : [];
  const visitationItems = visitationFocus
    ? (backendMessage?.items.filter(
        (item) => item.pk === visitationFocus.pk && item.sk === visitationFocus.sk,
      ) ?? [])
    : (backendMessage?.items ?? []);
  const visitationReportGroups = Object.values(
    (backendMessage?.items ?? []).reduce<
      Record<
        string,
        {
          priestName: string;
          priestSk?: string;
          visits: Array<{
            memberPk: string;
            memberName: string;
            memberSk: string;
            scheduledAt: string;
            completedAt?: string;
            note?: string;
          }>;
        }
      >
    >((groups, item) => {
      const memberData = parseMemberData(item.data);
      const memberName = getMemberName(memberData?.firstName, memberData?.lastName, item.sk);

      for (const visit of memberData?.visitations ?? []) {
        if (!visit.scheduledAt || !visit.assignedPriestName) {
          continue;
        }

        const groupKey = visit.assignedPriestSk || visit.assignedPriestName;

        if (!groups[groupKey]) {
          groups[groupKey] = {
            priestName: visit.assignedPriestName,
            priestSk: visit.assignedPriestSk,
            visits: [],
          };
        }

        groups[groupKey].visits.push({
          memberPk: item.pk,
          memberName,
          memberSk: item.sk,
          scheduledAt: visit.scheduledAt,
          completedAt: visit.completedAt,
          note: visit.note,
        });
      }

      return groups;
    }, {}),
  )
    .map((group) => ({
      ...group,
      visits: group.visits
        .slice()
        .sort(
          (left, right) =>
            new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime(),
        ),
    }))
    .sort((left, right) =>
      left.priestName.localeCompare(right.priestName, undefined, {
        sensitivity: "base",
      }),
    );
  const filteredVisitationReportGroups = (
    visitationReportPriestFilter === "all"
      ? visitationReportGroups
      : visitationReportGroups.filter(
          (group) => group.priestSk === visitationReportPriestFilter,
        )
  )
    .map((group) => ({
      ...group,
      visits: showCompletedVisitationsInReport
        ? group.visits
        : group.visits.filter((visit) => !visit.completedAt),
    }))
    .filter((group) => group.visits.length > 0);
  const visitationCalendarEvents = (backendMessage?.items ?? [])
    .flatMap((item) => {
      const memberData = parseMemberData(item.data);
      const memberName = getMemberName(memberData?.firstName, memberData?.lastName, item.sk);

      return (memberData?.visitations ?? [])
        .filter((visit) => visit.scheduledAt)
        .map((visit) => ({
          id: visit.id,
          memberPk: item.pk,
          memberSk: item.sk,
          memberName,
          scheduledAt: visit.scheduledAt!,
          scheduledDate: new Date(visit.scheduledAt!),
          assignedPriestSk: visit.assignedPriestSk,
          assignedPriestName: visit.assignedPriestName || "Unassigned",
          completedAt: visit.completedAt,
          note: visit.note,
        }));
    })
    .sort(
      (left, right) => left.scheduledDate.getTime() - right.scheduledDate.getTime(),
    );
  const filteredVisitationCalendarEvents =
    visitationCalendarPriestFilter === "all"
      ? visitationCalendarEvents
      : visitationCalendarEvents.filter(
          (event) => event.assignedPriestSk === visitationCalendarPriestFilter,
        );
  const visitationCalendarDays = buildCalendarDays(visitationCalendarMonth);
  const visitationCalendarMonthLabel = visitationCalendarMonth.toLocaleDateString(
    undefined,
    {
      month: "long",
      year: "numeric",
    },
  );
  const currentCalendarReportYear = new Date().getFullYear();
  const announcementWeeks =
    announcements?.items
      .slice()
      .sort((left, right) =>
        announcementSortOrder === "latest"
          ? right.sk.localeCompare(left.sk)
          : left.sk.localeCompare(right.sk),
      )
      .map((item) => ({
        ...item,
        parsed: parseAnnouncementWeekData(item.data),
      })) ?? [];

  const getAuthHeader = async () => {
    const session = await fetchAuthSession({ forceRefresh: true });
    const token =
      session.tokens?.accessToken?.toString() ?? session.tokens?.idToken?.toString();

    if (!token) {
      throw new Error("No auth token available.");
    }

    return token;
  };

  const authorizedGet = async <T,>(path: string) => {
    const authorization = await getAuthHeader();
    const restOperation = get({
      apiName: congregationApiName,
      path,
      options: {
        headers: {
          Authorization: authorization,
        },
      },
    });
    const { body } = await restOperation.response;
    return (await body.json()) as T;
  };

  const authorizedPost = async (path: string, body: unknown) => {
    const authorization = await getAuthHeader();
    const restOperation = post({
      apiName: congregationApiName,
      path,
      options: {
        headers: {
          Authorization: authorization,
        },
        body: body as never,
      },
    });

    return restOperation.response;
  };

  const publicPost = async (path: string, body: unknown) => {
    const restOperation = post({
      apiName: congregationApiName,
      path,
      options: {
        body: body as never,
      },
    });

    return restOperation.response;
  };

  const loadGoogleCalendarConnection = async () => {
    if (!congregationApiName) {
      setGoogleCalendarStatus("Backend API is not configured yet.");
      setGoogleCalendarStatusTone("error");
      return;
    }

    setIsGoogleCalendarLoading(true);

    try {
      const response = await authorizedGet<GoogleCalendarConnectionResponse>(
        "/calendar/google/connection",
      );
      setGoogleCalendarConnection(response);

      if (response.lastError) {
        setGoogleCalendarStatus(response.lastError);
        setGoogleCalendarStatusTone("error");
      } else if (!initialGoogleCalendarCallbackState) {
        setGoogleCalendarStatus(response.message);
        setGoogleCalendarStatusTone(response.connected ? "success" : "neutral");
      }
    } catch (error) {
      setGoogleCalendarStatus(
        await getErrorMessage(error, "Unable to load Google Calendar connection."),
      );
      setGoogleCalendarStatusTone("error");
    } finally {
      setIsGoogleCalendarLoading(false);
    }
  };

  const handleGoogleCalendarConnect = async () => {
    if (!congregationApiName || typeof window === "undefined") {
      return;
    }

    setIsGoogleCalendarConnecting(true);
    setGoogleCalendarStatus(null);

    try {
      const returnToUrl = new URL(window.location.href);
      returnToUrl.hash = "";
      returnToUrl.searchParams.delete("calendar-google-status");
      returnToUrl.searchParams.delete("calendar-google-message");

      const response = await authorizedPost("/calendar/google/connect/start", {
        returnTo: returnToUrl.toString(),
      });
      const payload = (await response.body.json()) as GoogleCalendarConnectStartResponse;
      if (!payload.authorizationUrl) {
        throw new Error(payload.message || "Google authorization URL was not returned.");
      }
      window.location.assign(payload.authorizationUrl);
    } catch (error) {
      setGoogleCalendarStatus(
        await getErrorMessage(error, "Unable to start Google Calendar connection."),
      );
      setGoogleCalendarStatusTone("error");
      setIsGoogleCalendarConnecting(false);
    }
  };

  const loadGoogleCalendars = async () => {
    if (!congregationApiName) {
      return [] as GoogleCalendarListResponse["items"];
    }

    if (googleCalendarsRequestPromiseRef.current) {
      return googleCalendarsRequestPromiseRef.current;
    }

    const requestPromise = (async () => {
      try {
        const response = await authorizedGet<GoogleCalendarListResponse>(
          "/calendar/google/calendars",
        );
        const calendars = assignGoogleCalendarPalette(response.items);
        setGoogleCalendars((current) =>
          areGoogleCalendarListsEqual(current, calendars) ? current : calendars,
        );
        setSelectedGoogleCalendarId((current) => {
          if (response.items.some((item) => item.id === current)) {
            return current;
          }

          return (
            response.items.find((item) => item.primary)?.id ?? response.items[0]?.id ?? "primary"
          );
        });
        return calendars;
      } catch (error) {
        setCalendarAvailabilityStatus(
          await getErrorMessage(error, "Unable to load Google calendars."),
        );
        return googleCalendars;
      } finally {
        googleCalendarsRequestPromiseRef.current = null;
      }
    })();

    googleCalendarsRequestPromiseRef.current = requestPromise;
    return requestPromise;
  };

  const loadCongregationDirectory = async () => {
    if (!congregationApiName) {
      return;
    }

    try {
      const response = await authorizedGet<CongregationDirectoryResponse>(
        "/congregation/directory",
      );
      setCongregationDirectory(response.items);
    } catch {
      setCongregationDirectory([]);
    }
  };

  const loadGoogleCalendarEventsAcrossCalendars = async ({
    timeMin,
    timeMax,
    useSyncCache = true,
    cacheOnly = false,
    calendarsOverride,
  }: {
    timeMin: string;
    timeMax: string;
    useSyncCache?: boolean;
    cacheOnly?: boolean;
    calendarsOverride?: GoogleCalendarListResponse["items"];
  }): Promise<LoadedGoogleCalendarEventsAcrossCalendarsResult> => {
    const loadedCalendars =
      calendarsOverride ??
      (googleCalendars.length > 0 ? googleCalendars : await loadGoogleCalendars());
    const calendarsToLoad =
      loadedCalendars.length > 0
        ? loadedCalendars
        : assignGoogleCalendarPalette([
            {
              id: "primary",
              name: "Primary Calendar",
              primary: true,
              accessRole: "",
              timeZone: "",
              hidden: false,
              selected: false,
            },
          ]);

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const responses = await Promise.all(
      calendarsToLoad.map(async (calendar) => {
        const response = await authorizedPost("/calendar/google/events", {
          calendarId: calendar.id,
          timeMin,
          timeMax,
          timeZone,
          useSyncCache,
          cacheOnly,
          selectedPeriodMonths: getCalendarScheduleVisibleMonths(
            new Date(timeMin),
            new Date(timeMax),
          ),
        });
        const payload = (await response.body.json()) as GoogleCalendarEventsResponse;
        return {
          calendar,
          payload,
        };
      }),
    );

    return {
      items: responses
        .flatMap(({ calendar, payload }) =>
        payload.items.map((item) => ({
          ...item,
          calendarId: calendar.id,
          calendarName: calendar.name,
          calendarColor: calendar.calendarColor,
          calendarColorEmoji: calendar.calendarColorEmoji,
        })),
      )
        .sort((left, right) => left.start.localeCompare(right.start)),
      responseTimes: responses.map(({ payload }) => payload.time).filter(Boolean),
    };
  };

  const loadCalendarDashboardSummary = async ({
    cacheOnly = false,
  }: {
    cacheOnly?: boolean;
  } = {}) => {
    if (!congregationApiName) {
      setCalendarDashboardStatus("Backend API is not configured yet.");
      return;
    }

    setIsCalendarDashboardLoading(true);
    setCalendarDashboardStatus(null);
    const requestId = calendarDashboardRequestRef.current + 1;
    calendarDashboardRequestRef.current = requestId;
    const useSyncCache = cacheOnly;

    try {
      const now = new Date();
      const loadedCalendars =
        !cacheOnly || googleCalendars.length === 0 ? await loadGoogleCalendars() : googleCalendars;
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const weekStart = startOfWeek(now);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
      const upcomingEnd = new Date(now);
      upcomingEnd.setDate(upcomingEnd.getDate() + 60);

      const [dayEvents, weekEvents, monthEvents, upcomingEvents] = await Promise.all([
        loadGoogleCalendarEventsAcrossCalendars({
          timeMin: dayStart.toISOString(),
          timeMax: dayEnd.toISOString(),
          useSyncCache,
          cacheOnly,
          calendarsOverride: loadedCalendars,
        }),
        loadGoogleCalendarEventsAcrossCalendars({
          timeMin: weekStart.toISOString(),
          timeMax: weekEnd.toISOString(),
          useSyncCache,
          cacheOnly,
          calendarsOverride: loadedCalendars,
        }),
        loadGoogleCalendarEventsAcrossCalendars({
          timeMin: monthStart.toISOString(),
          timeMax: monthEnd.toISOString(),
          useSyncCache,
          cacheOnly,
          calendarsOverride: loadedCalendars,
        }),
        loadGoogleCalendarEventsAcrossCalendars({
          timeMin: now.toISOString(),
          timeMax: upcomingEnd.toISOString(),
          useSyncCache,
          cacheOnly,
          calendarsOverride: loadedCalendars,
        }),
      ]);

      const countUpcomingEvents = (items: GoogleCalendarEventItem[]) =>
        items.filter((item) => {
          const itemEnd = Date.parse(item.end);
          return Number.isFinite(itemEnd) && itemEnd >= now.getTime();
        }).length;

      if (calendarDashboardRequestRef.current !== requestId) {
        return;
      }

      setCalendarDashboardSummary({
        day: {
          total: dayEvents.items.length,
          upcoming: countUpcomingEvents(dayEvents.items),
        },
        week: {
          total: weekEvents.items.length,
          upcoming: countUpcomingEvents(weekEvents.items),
        },
        month: {
          total: monthEvents.items.length,
          upcoming: countUpcomingEvents(monthEvents.items),
        },
        upcomingEvents: upcomingEvents.items.slice(0, 15),
      });

      if (!cacheOnly) {
        const sortedResponseTimes = [
          ...dayEvents.responseTimes,
          ...weekEvents.responseTimes,
          ...monthEvents.responseTimes,
          ...upcomingEvents.responseTimes,
        ].sort();
        const lastResponseTime =
          sortedResponseTimes[sortedResponseTimes.length - 1] ?? new Date().toISOString();
        setCalendarDashboardLastSyncAt(lastResponseTime);
      }
    } catch (error) {
      if (calendarDashboardRequestRef.current !== requestId) {
        return;
      }
      setCalendarDashboardSummary(null);
      setCalendarDashboardStatus(
        await getErrorMessage(error, "Unable to load Calendar dashboard."),
      );
    } finally {
      if (calendarDashboardRequestRef.current === requestId) {
        setIsCalendarDashboardLoading(false);
      }
    }
  };

  const loadCalendarReporting = async () => {
    if (!congregationApiName) {
      setCalendarReportingStatus("Backend API is not configured yet.");
      return;
    }

    if (!googleCalendarConnection?.connected) {
      setCalendarReportingRows([]);
      setCalendarReportingStatus("Google Calendar is not connected.");
      return;
    }

    setIsCalendarReportingLoading(true);
    setCalendarReportingStatus(null);

    try {
      const calendarIds =
        googleCalendars.length > 0 ? googleCalendars.map((calendar) => calendar.id) : ["primary"];
      const year = new Date().getFullYear();

      const cacheResponse = await authorizedPost("/calendar/google/reporting", {
        year,
        calendarIds,
        cacheOnly: true,
      });
      const cachePayload = (await cacheResponse.body.json()) as GoogleCalendarReportingResponse;
      setCalendarReportingRows(cachePayload.rows);

      try {
        const syncResponse = await authorizedPost("/calendar/google/reporting", {
          year,
          calendarIds,
        });
        const syncPayload = (await syncResponse.body.json()) as GoogleCalendarReportingResponse;
        setCalendarReportingRows(syncPayload.rows);
      } catch (error) {
        setCalendarReportingStatus(
          await getErrorMessage(
            error,
            "Showing cached reporting data because the Google refresh did not finish.",
          ),
        );
      }
    } catch (error) {
      setCalendarReportingRows([]);
      setCalendarReportingStatus(
        await getErrorMessage(error, "Unable to load calendar reporting."),
      );
    } finally {
      setIsCalendarReportingLoading(false);
    }
  };

  const loadGoogleCalendarAvailability = async () => {
    if (!congregationApiName) {
      setCalendarAvailabilityStatus("Backend API is not configured yet.");
      return;
    }

    if (!calendarScheduleLookupDate || !calendarScheduleLookupStartTime || !calendarScheduleLookupEndTime) {
      setCalendarAvailabilityStatus("Choose a date and time range first.");
      return;
    }

    if (calendarScheduleLookupStartTime >= calendarScheduleLookupEndTime) {
      setCalendarAvailabilityStatus("Start time must be earlier than end time.");
      return;
    }

    setIsCalendarAvailabilityLoading(true);
    setCalendarAvailabilityStatus(null);

    try {
      const timeMin = buildLocalDateTimeIso(
        calendarScheduleLookupDate,
        calendarScheduleLookupStartTime,
      );
      const timeMax = buildLocalDateTimeIso(
        calendarScheduleLookupDate,
        calendarScheduleLookupEndTime,
      );
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const [freeBusyResponse, eventsResponse] = await Promise.all([
        authorizedPost("/calendar/google/freebusy", {
          timeMin,
          timeMax,
          timeZone,
          calendarId: selectedGoogleCalendarId,
        }),
        authorizedPost("/calendar/google/events", {
          timeMin,
          timeMax,
          timeZone,
          calendarId: selectedGoogleCalendarId,
        }),
      ]);
      const availabilityPayload = (await freeBusyResponse.body.json()) as GoogleCalendarFreeBusyResponse;
      const eventsPayload = (await eventsResponse.body.json()) as GoogleCalendarEventsResponse;
      setCalendarAvailability(availabilityPayload);
      setCalendarEvents(eventsPayload);
      setCalendarAvailabilityStatus(availabilityPayload.message);
    } catch (error) {
      setCalendarAvailability(null);
      setCalendarEvents(null);
      setCalendarAvailabilityStatus(
        await getErrorMessage(error, "Unable to load Google Calendar availability."),
      );
    } finally {
      setIsCalendarAvailabilityLoading(false);
    }
  };

  const loadGoogleCalendarMonthEvents = async ({
    useSyncCache = true,
  }: { useSyncCache?: boolean } = {}) => {
    if (!congregationApiName) {
      return;
    }

    const requestId = calendarMonthEventsRequestRef.current + 1;
    calendarMonthEventsRequestRef.current = requestId;
    setIsCalendarMonthLoading(true);
    setCalendarEventFormStatus(null);
    const previouslyVisibleMonthEvents = calendarMonthEvents;
    const visibleRange = getCalendarScheduleRange(
      calendarMonthViewDate,
      calendarScheduleViewMode,
    );

    try {
      const selectedPeriodMonths = getCalendarScheduleVisibleMonths(
        visibleRange.start,
        visibleRange.end,
      );
      const selectedYearMonth =
        calendarScheduleViewMode === "month" && selectedPeriodMonths.length === 1
          ? selectedPeriodMonths[0]
          : undefined;
      const loadedCalendars =
        googleCalendars.length > 0 ? googleCalendars : await loadGoogleCalendars();
      const calendarsToLoad =
        loadedCalendars.length > 0
          ? loadedCalendars
          : [
              ...assignGoogleCalendarPalette([
                {
                  id: "primary",
                  name: "Primary Calendar",
                  primary: true,
                  accessRole: "",
                  timeZone: "",
                  hidden: false,
                  selected: false,
                },
              ]),
            ];
      const basePayload = {
        timeMin: visibleRange.start.toISOString(),
        timeMax: visibleRange.end.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        useSyncCache,
        selectedYearMonth,
        selectedPeriodMonths,
        viewMode: calendarScheduleViewMode,
      } satisfies Omit<GoogleCalendarEventsPayload, "calendarId">;
      const loadedCalendarResponseMap = new Map<
        string,
        {
          calendar: GoogleCalendarListResponse["items"][number];
          payload: GoogleCalendarEventsResponse;
        }
      >();
      let receivedCalendarResponseCount = 0;
      const googleCompletedCalendarIds = new Set<string>();

      calendarsToLoad.forEach((calendar) => {
        const previousItemsForCalendar = (previouslyVisibleMonthEvents?.items ?? []).filter(
          (item) => (item.calendarId ?? "primary") === calendar.id,
        );

        if (previousItemsForCalendar.length === 0) {
          return;
        }

        loadedCalendarResponseMap.set(calendar.id, {
          calendar,
          payload: {
            message: previouslyVisibleMonthEvents?.message ?? "Google Calendar events loaded.",
            time: previouslyVisibleMonthEvents?.time ?? new Date().toISOString(),
            calendarId: calendar.id,
            timeMin: previouslyVisibleMonthEvents?.timeMin ?? basePayload.timeMin,
            timeMax: previouslyVisibleMonthEvents?.timeMax ?? basePayload.timeMax,
            items: previousItemsForCalendar,
            changedResources: [],
            syncMode: previouslyVisibleMonthEvents?.syncMode,
          },
        });
      });

      const buildMergedPayload = () => {
        const loadedCalendarResponses = Array.from(loadedCalendarResponseMap.values());
        const mergedItems = loadedCalendarResponses
          .flatMap(({ calendar, payload }) =>
            payload.items.map((item) => ({
              ...item,
              calendarId: calendar.id,
              calendarName: calendar.name,
              calendarColor: calendar.calendarColor,
              calendarColorEmoji: calendar.calendarColorEmoji,
            })),
          )
          .sort((left, right) => left.start.localeCompare(right.start));

        return {
          message: "Google Calendar events loaded.",
          time: new Date().toISOString(),
          calendarId: "all",
          timeMin: basePayload.timeMin,
          timeMax: basePayload.timeMax,
          items: mergedItems,
          changedResources: loadedCalendarResponses.flatMap(
            ({ payload }) => payload.changedResources ?? [],
          ),
          syncMode:
            loadedCalendarResponses.length > 0 &&
            loadedCalendarResponses.every(
              ({ payload }) => payload.syncMode === loadedCalendarResponses[0]?.payload.syncMode,
            )
              ? loadedCalendarResponses[0]?.payload.syncMode
              : undefined,
        } satisfies GoogleCalendarEventsResponse;
      };
      const applyCalendarPayload = ({
        calendar,
        payload,
        phase,
      }: {
        calendar: GoogleCalendarListResponse["items"][number];
        payload: GoogleCalendarEventsResponse;
        phase: "cache" | "sync" | "direct";
      }) => {
        if (calendarMonthEventsRequestRef.current !== requestId) {
          return;
        }

        receivedCalendarResponseCount += 1;
        loadedCalendarResponseMap.set(calendar.id, {
          calendar,
          payload,
        });
        const mergedPayload = buildMergedPayload();

        if (phase === "sync" || phase === "direct") {
          googleCompletedCalendarIds.add(calendar.id);
          if (googleCompletedCalendarIds.size === calendarsToLoad.length) {
            const syncCompletedLabel = new Date().toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            });
            setCalendarMonthLoadBadge({
              label: `Last sync ${syncCompletedLabel}`,
              tone: "success",
            });
          }
        } else if (googleCompletedCalendarIds.size === 0) {
          setCalendarMonthLoadBadge({
            label: "Loaded from cache",
            tone: "neutral",
          });
        }
        setCalendarMonthEvents(mergedPayload);
      };

      const calendarLoadPromises = calendarsToLoad.map(async (calendar) => {
        try {
          if (useSyncCache) {
            const cacheResponse = await authorizedPost("/calendar/google/events", {
              ...basePayload,
              calendarId: calendar.id,
              cacheOnly: true,
            });
            const cachePayload = (await cacheResponse.body.json()) as GoogleCalendarEventsResponse;
            applyCalendarPayload({
              calendar,
              payload: cachePayload,
              phase: "cache",
            });

            const syncResponse = await authorizedPost("/calendar/google/events", {
              ...basePayload,
              calendarId: calendar.id,
            });
            const syncPayload = (await syncResponse.body.json()) as GoogleCalendarEventsResponse;
            applyCalendarPayload({
              calendar,
              payload: syncPayload,
              phase: "sync",
            });

            return {
              calendar,
              payload: syncPayload,
            };
          }

          const response = await authorizedPost("/calendar/google/events", {
            ...basePayload,
            calendarId: calendar.id,
          });
          const payload = (await response.body.json()) as GoogleCalendarEventsResponse;
          applyCalendarPayload({
            calendar,
            payload,
            phase: "direct",
          });

          return {
            calendar,
            payload,
          };
        } catch (error) {
          console.error("Google Calendar month events calendar load failed", {
            calendarId: calendar.id,
            calendarName: calendar.name,
            error,
          });

          throw error;
        }
      });

      await Promise.allSettled(calendarLoadPromises);

      if (calendarMonthEventsRequestRef.current !== requestId) {
        return;
      }

      if (receivedCalendarResponseCount === 0) {
        throw new Error("Unable to load month calendar events for any calendar.");
      }

      const mergedPayload = buildMergedPayload();
      setCalendarMonthEvents(mergedPayload);
    } catch (error) {
      if (calendarMonthEventsRequestRef.current !== requestId) {
        return;
      }
      if (!previouslyVisibleMonthEvents) {
        setCalendarMonthEvents(null);
      }
      setCalendarEventFormStatus(
        await getErrorMessage(error, "Unable to load month calendar events."),
      );
    } finally {
      if (calendarMonthEventsRequestRef.current === requestId) {
        setIsCalendarMonthLoading(false);
      }
    }
  };

  const closeCalendarEventModal = () => {
    setCalendarMonthSelectedDate(null);
    setSelectedCalendarMonthEvent(null);
    setCalendarCongregationQuery("");
    setSelectedCongregationDirectoryItems([]);
    setPendingCalendarCongregationEntries([]);
    setCalendarEventForm(initialCalendarEventForm);
  };

  const closeCalendarDayEventsModal = () => {
    setCalendarMonthExpandedDate(null);
  };

  const openCalendarDayEventsModal = (dateValue: string) => {
    setCalendarMonthExpandedDate(dateValue);
    setCalendarEventFormStatus(null);
  };

  const openCalendarEventCreateModal = (dateValue: string) => {
    setCalendarMonthExpandedDate(null);
    setSelectedCalendarMonthEvent(null);
    setCalendarMonthSelectedDate(dateValue);
    setCalendarCongregationQuery("");
    setSelectedCongregationDirectoryItems([]);
    setPendingCalendarCongregationEntries([]);
    setCalendarEventForm((current) => ({
      ...current,
      startTime: current.startTime || "09:00",
      endTime: current.endTime || "10:00",
    }));
    setCalendarEventFormStatus(null);
  };

  const openCalendarEventEditModal = (eventItem: GoogleCalendarEventItem) => {
    const eventDateValue = formatDateInputValue(
      parseCalendarEventDateValue(eventItem.start, eventItem.isAllDay),
    );
    const extractedDetails = extractCalendarEventCongregationDetails(eventItem.description);
    setCalendarMonthExpandedDate(null);
    setSelectedCalendarMonthEvent(eventItem);
    setCalendarMonthSelectedDate(eventDateValue);
    setCalendarCongregationQuery("");
    setSelectedCongregationDirectoryItems(eventItem.congregationItems ?? []);
    setPendingCalendarCongregationEntries(
      eventItem.congregationItems?.length
        ? []
        : extractedDetails.congregationEntries,
    );
    setCalendarEventForm({
      title: eventItem.title,
      startTime: eventItem.isAllDay ? "09:00" : formatTimeInputValue(eventItem.start),
      endTime: eventItem.isAllDay ? "10:00" : formatTimeInputValue(eventItem.end),
      location: eventItem.location,
      description: extractedDetails.description,
    });
    setCalendarEventFormStatus(null);
  };

  const handleCalendarEventSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!congregationApiName) {
      setCalendarEventFormStatus("Backend API is not configured yet.");
      return;
    }

    if (
      !calendarEventForm.title.trim() ||
      !calendarMonthSelectedDate ||
      !calendarEventForm.startTime ||
      !calendarEventForm.endTime
    ) {
      setCalendarEventFormStatus("Title, date, start time, and end time are required.");
      return;
    }

    if (calendarEventForm.startTime >= calendarEventForm.endTime) {
      setCalendarEventFormStatus("Start time must be earlier than end time.");
      return;
    }

    setIsCalendarEventSubmitting(true);
    setCalendarEventFormStatus(null);

    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const isAllDay = selectedCalendarMonthEvent?.isAllDay === true;
      const start = isAllDay
        ? calendarMonthSelectedDate
        : buildLocalDateTimeIso(calendarMonthSelectedDate, calendarEventForm.startTime);
      const end = isAllDay
        ? addDaysToDateInputValue(
            calendarMonthSelectedDate,
            getAllDayEventSpanDays(
              selectedCalendarMonthEvent.start,
              selectedCalendarMonthEvent.end,
            ),
          )
        : buildLocalDateTimeIso(calendarMonthSelectedDate, calendarEventForm.endTime);
      const response = selectedCalendarMonthEvent
        ? await authorizedPost("/calendar/google/events/update", {
            calendarId: selectedCalendarMonthEvent.calendarId || selectedGoogleCalendarId,
            eventId: selectedCalendarMonthEvent.id,
            title: calendarEventForm.title.trim(),
            start,
            end,
            timeZone,
            location: calendarEventForm.location.trim(),
            description: buildCalendarEventDescription(
              calendarEventForm.description,
              selectedCongregationDirectoryItems,
            ),
            congregationItems: selectedCongregationDirectoryItems,
            isAllDay,
          })
        : await authorizedPost("/calendar/google/events/create", {
            calendarId: selectedGoogleCalendarId,
            title: calendarEventForm.title.trim(),
            start,
            end,
            timeZone,
            location: calendarEventForm.location.trim(),
            description: buildCalendarEventDescription(
              calendarEventForm.description,
              selectedCongregationDirectoryItems,
            ),
            congregationItems: selectedCongregationDirectoryItems,
          });
      const payload = (await response.body.json()) as
        | GoogleCalendarCreateEventResponse
        | GoogleCalendarUpdateEventResponse;
      setCalendarEventFormStatus(payload.message);
      await loadGoogleCalendarMonthEvents({ useSyncCache: false });
      if (activePage === "calendar-schedule") {
        await loadGoogleCalendarAvailability();
      }
      closeCalendarEventModal();
    } catch (error) {
      setCalendarEventFormStatus(
        await getErrorMessage(
          error,
          selectedCalendarMonthEvent
            ? "Unable to update Google Calendar event."
            : "Unable to create Google Calendar event.",
        ),
      );
    } finally {
      setIsCalendarEventSubmitting(false);
    }
  };

  const handleCalendarEventDelete = async () => {
    if (!congregationApiName || !selectedCalendarMonthEvent) {
      return;
    }

    setIsCalendarEventDeleting(true);
    setCalendarEventFormStatus(null);

    try {
      const response = await authorizedPost("/calendar/google/events/delete", {
        calendarId: selectedCalendarMonthEvent.calendarId || selectedGoogleCalendarId,
        eventId: selectedCalendarMonthEvent.id,
      });
      const payload = (await response.body.json()) as GoogleCalendarDeleteEventResponse;
      setCalendarEventFormStatus(payload.message);
      await loadGoogleCalendarMonthEvents({ useSyncCache: false });
      if (activePage === "calendar-schedule") {
        await loadGoogleCalendarAvailability();
      }
      closeCalendarEventModal();
    } catch (error) {
      setCalendarEventFormStatus(
        await getErrorMessage(error, "Unable to delete Google Calendar event."),
      );
    } finally {
      setIsCalendarEventDeleting(false);
    }
  };

  const createNavigationState = (
    overrides: Partial<AppNavigationState> = {},
  ): AppNavigationState => ({
    activePage: overrides.activePage ?? activePage,
    selectedMember: overrides.selectedMember ?? selectedMember,
    visitationFocus: overrides.visitationFocus ?? visitationFocus,
    editingMember: overrides.editingMember ?? editingMember,
    betaMemberTab: overrides.betaMemberTab ?? betaMemberTab,
    calendarScheduleDate: overrides.calendarScheduleDate ?? calendarScheduleDate,
  });

  const applyNavigationState = (nextState: AppNavigationState) => {
    setActivePage(nextState.activePage);
    setSelectedMember(nextState.selectedMember);
    setVisitationFocus(nextState.visitationFocus);
    setEditingMember(nextState.editingMember);
    setBetaMemberTab(nextState.betaMemberTab);
    setCalendarScheduleDate(nextState.calendarScheduleDate);
    setIsMobileMenuOpen(false);
    setIsBetaMemberMenuOpen(false);
  };

  const navigateToState = (overrides: Partial<AppNavigationState>) => {
    const nextState = createNavigationState(overrides);

    applyNavigationState(nextState);

    if (typeof window !== "undefined") {
      window.history.pushState({ shepherdHubNav: nextState }, "", window.location.href);
    }
  };

  const checkAuthSession = async () => {
    try {
      const [user, session] = await Promise.all([
        getCurrentUser(),
        fetchAuthSession({ forceRefresh: true }),
      ]);
      const groups = Array.from(
        new Set([
          ...extractGroupsFromClaim(session.tokens?.idToken?.payload["cognito:groups"]),
          ...extractGroupsFromClaim(
            session.tokens?.accessToken?.payload["cognito:groups"],
          ),
        ]),
      );
      setCurrentUserLabel(user.signInDetails?.loginId ?? user.username);
      setCurrentUserGroups(groups);
      setAuthStatus("signed-in");
    } catch {
      setCurrentUserGroups([]);
      setAuthStatus("signed-out");
    }
  };

  const loadBackendMessage = async () => {
    if (!congregationApiName) {
      setBackendError(
        "Backend API is not configured yet. Run the Amplify sandbox and generate outputs.",
      );
      return;
    }

    setIsBackendLoading(true);
    setBackendError(null);

    try {
      const response = await authorizedGet<BackendMessage>("/congregation/message");
      setBackendMessage(response);
    } catch (error) {
      setBackendError("Unable to load the congregation backend message.");
    } finally {
      setIsBackendLoading(false);
    }
  };

  const loadAnnouncements = async () => {
    if (!congregationApiName) {
      setAnnouncementsError(
        "Backend API is not configured yet. Run the Amplify sandbox and generate outputs.",
      );
      return;
    }

    setIsAnnouncementsLoading(true);
    setAnnouncementsError(null);

    try {
      const response = await authorizedGet<AnnouncementResponse>("/announcements");
      setAnnouncements(response);
    } catch {
      setAnnouncementsError("Unable to load announcements.");
    } finally {
      setIsAnnouncementsLoading(false);
    }
  };

  const loadUserDirectory = async () => {
    if (!congregationApiName || !canManageUsers) {
      return;
    }

    setIsUserDirectoryLoading(true);
    setUserDirectoryError(null);

    try {
      const response = await authorizedGet<UserDirectoryResponse>("/admin/users");
      setUserDirectory(response.items);
      setGroupAssignments(
        Object.fromEntries(
          response.items.map((user) => [user.username, user.groups]),
        ),
      );
    } catch {
      setUserDirectoryError("Unable to load user access.");
    } finally {
      setIsUserDirectoryLoading(false);
    }
  };

  const toggleUserGroupAssignment = (username: string, groupName: (typeof manageableGroups)[number]) => {
    setGroupAssignments((current) => {
      const existingGroups = current[username] ?? [];
      const nextGroups = existingGroups.includes(groupName)
        ? existingGroups.filter((group) => group !== groupName)
        : [...existingGroups, groupName];

      return {
        ...current,
        [username]: nextGroups,
      };
    });
  };

  const handleSaveUserGroups = async (username: string) => {
    if (!canManageUsers || !congregationApiName) {
      return;
    }

    setSavingUserGroups(username);
    setUserDirectoryStatus(null);

    try {
      await authorizedPost("/admin/users/groups", {
        username,
        groups: groupAssignments[username] ?? [],
      });
      setUserDirectory((current) =>
        current.map((user) =>
          user.username === username
            ? { ...user, groups: groupAssignments[username] ?? [] }
            : user,
        ),
      );
      setUserDirectoryStatus(`Updated access for ${username}.`);
    } catch {
      setUserDirectoryStatus(`Unable to update access for ${username}.`);
    } finally {
      setSavingUserGroups(null);
    }
  };

  const handleContactsImportSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!congregationApiName) {
      setContactsImportStatus("Backend API is not configured yet.");
      return;
    }

    if (!canManageUsers) {
      setContactsImportStatus("You do not have access to import contacts.");
      return;
    }

    if (!contactsImportFile) {
      setContactsImportStatus("Choose a .vcf file to import.");
      return;
    }

    if (!contactsImportFile.name.toLowerCase().endsWith(".vcf")) {
      setContactsImportStatus("Only .vcf contact files are supported.");
      return;
    }

    setIsContactsImporting(true);
    setContactsImportStatus(null);
    setContactsImportSummary(null);

    try {
      const content = await contactsImportFile.text();
      const response = await authorizedPost("/contacts/import", {
        fileName: contactsImportFile.name,
        content,
      });
      const payload = (await response.body.json()) as ContactsImportResponse;

      setContactsImportSummary(payload);
      setContactsImportStatus(payload.message);
      setContactsImportFile(null);
      if (contactsImportInputRef.current) {
        contactsImportInputRef.current.value = "";
      }
      await loadBackendMessage();
    } catch {
      setContactsImportStatus("Unable to import contacts.");
    } finally {
      setIsContactsImporting(false);
    }
  };

  const handleParkingRegistrationSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!congregationApiName) {
      setParkingRegistrationStatus("Backend API is not configured yet.");
      return;
    }

    if (
      !parkingRegistrationForm.firstName.trim() ||
      !parkingRegistrationForm.lastName.trim() ||
      !parkingRegistrationForm.licensePlate.trim() ||
      !parkingRegistrationForm.personalEmail.trim() ||
      !parkingRegistrationForm.cellPhone.trim() ||
      !parkingRegistrationForm.durationFrom ||
      !parkingRegistrationForm.durationTo
    ) {
      setParkingRegistrationStatus(
        "Complete the required fields before submitting the registration.",
      );
      return;
    }

    if (parkingRegistrationForm.durationFrom >= parkingRegistrationForm.durationTo) {
      setParkingRegistrationStatus("Duration from must be earlier than duration to.");
      return;
    }

    setIsParkingRegistrationSubmitting(true);
    setParkingRegistrationStatus(null);

    try {
      const response = await publicPost("/parking/registration", parkingRegistrationForm);
      const payload = (await response.body.json()) as ParkingRegistrationResponse;
      setParkingRegistrationStatus(payload.message);
      setParkingRegistrationForm(initialParkingRegistrationForm);
    } catch {
      setParkingRegistrationStatus("Unable to submit parking registration.");
    } finally {
      setIsParkingRegistrationSubmitting(false);
    }
  };

  const loadParkingManagement = async () => {
    if (!congregationApiName || !canManageParking) {
      return;
    }

    setIsParkingManagementLoading(true);
    setParkingManagementError(null);

    try {
      const response = await authorizedGet<ParkingManagementResponse>("/parking/management");
      setParkingManagement(response);
      setParkingMaxSpotsInput(String(response.maxSpots));
    } catch {
      setParkingManagementError("Unable to load parking management.");
    } finally {
      setIsParkingManagementLoading(false);
    }
  };

  const handleParkingManagementSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!congregationApiName || !canManageParking) {
      return;
    }

    const maxSpots = Number(parkingMaxSpotsInput);

    if (!Number.isFinite(maxSpots) || maxSpots < 0) {
      setParkingManagementStatus("Enter a valid non-negative number of parking spots.");
      return;
    }

    setIsParkingManagementSaving(true);
    setParkingManagementStatus(null);

    try {
      const response = await authorizedPost("/parking/management", { maxSpots });
      const payload = (await response.body.json()) as { message: string };
      setParkingManagementStatus(payload.message);
      await loadParkingManagement();
    } catch {
      setParkingManagementStatus("Unable to update parking capacity.");
    } finally {
      setIsParkingManagementSaving(false);
    }
  };

  const loadParkingRegistrations = async () => {
    if (!congregationApiName || !canManageParking) {
      return;
    }

    setIsParkingRegistrationsLoading(true);
    setParkingRegistrationsError(null);

    try {
      const response =
        await authorizedGet<ParkingRegistrationsResponse>("/parking/registrations");
      setParkingRegistrations(response.items);
    } catch {
      setParkingRegistrationsError("Unable to load parking registrations.");
    } finally {
      setIsParkingRegistrationsLoading(false);
    }
  };

  const handleParkingRegistrationStatusToggle = async (
    registration: ParkingRegistrationItem,
    nextPlacementStatus: "assigned" | "waiting-list" | "available",
  ) => {
    if (!congregationApiName || !canManageParking) {
      return;
    }

    setUpdatingParkingRegistrationSk(registration.sk);

    try {
      await authorizedPost("/parking/registrations/status", {
        sk: registration.sk,
        placementStatus: nextPlacementStatus,
      });
      await loadParkingRegistrations();
      if (activePage === "parking-management") {
        await loadParkingManagement();
      }
    } finally {
      setUpdatingParkingRegistrationSk(null);
    }
  };

  const handlePrintParkingPermit = async (registration: ParkingRegistrationItem) => {
    setPrintingParkingRegistrationSk(registration.sk);
    setParkingRegistrationsError(null);
    const printWindow = window.open("", "_blank", "width=900,height=700");

    try {
      if (!printWindow) {
        throw new Error("Unable to open print window.");
      }

      printWindow.document.open();
      printWindow.document.write(`<!doctype html>
<html>
  <head>
    <title>Preparing Parking Permit</title>
    <style>
      body { margin: 0; display: grid; place-items: center; min-height: 100vh; background: #f3f4f6; color: #111827; font: 600 18px "Avenir Next", "Segoe UI", sans-serif; }
    </style>
  </head>
  <body>Preparing parking permit...</body>
</html>`);
      printWindow.document.close();

      const qrPayload = JSON.stringify({
        type: "parking-permit",
        sk: registration.sk,
        licensePlate: registration.licensePlate,
        firstName: registration.firstName,
        lastName: registration.lastName,
        durationFrom: registration.durationFrom,
        durationTo: registration.durationTo,
        registeredAt: registration.registeredAt,
      });
      const qrCodeDataUrl = await QRCode.toDataURL(qrPayload, {
        width: 320,
        margin: 1,
        color: {
          dark: "#111827",
          light: "#ffffff",
        },
      });
      const canvas = document.createElement("canvas");
      canvas.width = 1120;
      canvas.height = 760;
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Unable to prepare permit image.");
      }

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#111827";
      context.font = '700 56px "Avenir Next", "Segoe UI", sans-serif';
      context.fillText("Parking Permit", 72, 100);
      context.fillStyle = "#6b7280";
      context.font = '500 26px "Avenir Next", "Segoe UI", sans-serif';
      context.fillText("Place behind windshield", 72, 142);

      context.fillStyle = "#111827";
      context.font = '700 72px "Avenir Next", "Segoe UI", sans-serif';
      context.fillText(registration.licensePlate, 72, 260);

      context.font = '600 34px "Avenir Next", "Segoe UI", sans-serif';
      context.fillText(
        `${registration.firstName} ${registration.lastName}`,
        72,
        340,
      );

      context.fillStyle = "#4b5563";
      context.font = '500 26px "Avenir Next", "Segoe UI", sans-serif';
      context.fillText(
        `Valid from: ${formatParkingMonthLabel(registration.durationFrom)}`,
        72,
        420,
      );
      context.fillText(
        `Valid to: ${formatParkingMonthLabel(registration.durationTo)}`,
        72,
        466,
      );
      context.fillText(
        `Registered: ${new Date(registration.registeredAt).toLocaleString()}`,
        72,
        512,
      );

      const qrImage = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Unable to load QR code image."));
        image.src = qrCodeDataUrl;
      });

      context.drawImage(qrImage, 760, 116, 280, 280);

      context.strokeStyle = "#e5e7eb";
      context.lineWidth = 2;
      context.strokeRect(742, 98, 316, 316);

      context.fillStyle = "#6b7280";
      context.font = '500 22px "Avenir Next", "Segoe UI", sans-serif';
      context.fillText(`Permit ID: ${registration.sk}`, 72, 640);

      const permitImageDataUrl = canvas.toDataURL("image/png");
      printWindow.document.open();
      printWindow.document.write(`<!doctype html>
<html>
  <head>
    <title>Parking Permit</title>
    <style>
      body { margin: 0; display: grid; place-items: center; min-height: 100vh; background: #f3f4f6; }
      img { max-width: 100%; height: auto; display: block; }
      @media print {
        body { background: #fff; }
      }
    </style>
  </head>
  <body>
    <img src="${permitImageDataUrl}" alt="Parking permit" />
    <script>
      window.onload = function () {
        window.print();
      };
    </script>
  </body>
</html>`);
      printWindow.document.close();
    } catch {
      if (printWindow && !printWindow.closed) {
        printWindow.document.open();
        printWindow.document.write(`<!doctype html>
<html>
  <head><title>Parking Permit</title></head>
  <body style="font-family: sans-serif; padding: 24px;">Unable to generate the printable parking permit.</body>
</html>`);
        printWindow.document.close();
      }
      setParkingRegistrationsError("Unable to generate the printable parking permit.");
    } finally {
      setPrintingParkingRegistrationSk(null);
    }
  };

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("shepherd-hub-theme");

    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("shepherd-hub-theme", theme);
  }, [theme]);

  useEffect(() => {
    const savedView = getCookieValue(memberDetailsViewCookieName);

    if (savedView === "member-details" || savedView === "member-details-beta") {
      setPreferredMemberDetailsPage(savedView);
    }
  }, []);

  useEffect(() => {
    void checkAuthSession();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);

    if (
      !url.searchParams.has("calendar-google-status") &&
      !url.searchParams.has("calendar-google-message")
    ) {
      return;
    }

    url.searchParams.delete("calendar-google-status");
    url.searchParams.delete("calendar-google-message");
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);

  useEffect(() => {
    if (authStatus !== "signed-in") {
      return;
    }

    if (!congregationApiName) {
      setBackendError(
        "Backend API is not configured yet. Run the Amplify sandbox and generate outputs.",
      );
      return;
    }

    let isMounted = true;

    void (async () => {
      await loadBackendMessage();
      await loadAnnouncements();
      if (!isMounted) {
        return;
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [authStatus]);

  useEffect(() => {
    if (authStatus !== "signed-in" || activePage !== "user-access" || !canManageUsers) {
      return;
    }

    void loadUserDirectory();
  }, [activePage, authStatus, canManageUsers]);

  useEffect(() => {
    if (
      authStatus !== "signed-in" ||
      !["parking-management", "parling"].includes(activePage) ||
      !canManageParking
    ) {
      return;
    }

    void loadParkingManagement();
  }, [activePage, authStatus, canManageParking]);

  useEffect(() => {
    if (
      authStatus !== "signed-in" ||
      !["parking-management", "parling"].includes(activePage) ||
      !canManageParking
    ) {
      return;
    }

    void loadParkingRegistrations();
  }, [activePage, authStatus, canManageParking]);

  useEffect(() => {
    if (authStatus !== "signed-in" || activePage !== "calendar-dashboard") {
      return;
    }

    void loadGoogleCalendarConnection();
    void loadGoogleCalendars();
  }, [activePage, authStatus]);

  useEffect(() => {
    if (authStatus !== "signed-in" || activePage !== "calendar-connect") {
      return;
    }

    void loadGoogleCalendarConnection();
  }, [activePage, authStatus]);

  useEffect(() => {
    if (authStatus !== "signed-in" || activePage !== "calendar-reporting") {
      return;
    }

    void loadGoogleCalendarConnection();
    void loadGoogleCalendars();
  }, [activePage, authStatus]);

  useEffect(() => {
    if (
      authStatus !== "signed-in" ||
      activePage !== "calendar-reporting" ||
      !googleCalendarConnection?.connected
    ) {
      return;
    }

    void loadCalendarReporting();
  }, [activePage, authStatus, googleCalendarConnection?.connected, googleCalendars]);

  useEffect(() => {
    if (authStatus !== "signed-in" || activePage !== "calendar-schedule") {
      return;
    }

    void loadGoogleCalendarConnection();
    void loadGoogleCalendars();
  }, [activePage, authStatus]);

  useEffect(() => {
    if (authStatus !== "signed-in" || activePage !== "calendar-month") {
      return;
    }

    void loadGoogleCalendarConnection();
    void loadGoogleCalendars();
    void loadCongregationDirectory();
  }, [activePage, authStatus]);

  useEffect(() => {
    if (
      authStatus !== "signed-in" ||
      activePage !== "calendar-dashboard" ||
      !googleCalendarConnection?.connected
    ) {
      return;
    }

    void loadCalendarDashboardSummary({ cacheOnly: true });
  }, [activePage, authStatus, googleCalendarConnection?.connected]);

  useEffect(() => {
    if (
      authStatus !== "signed-in" ||
      activePage !== "calendar-schedule" ||
      !googleCalendarConnection?.connected
    ) {
      return;
    }

    void loadGoogleCalendarAvailability();
  }, [
    activePage,
    authStatus,
    googleCalendarConnection?.connected,
    selectedGoogleCalendarId,
    calendarScheduleLookupDate,
    calendarScheduleLookupStartTime,
    calendarScheduleLookupEndTime,
  ]);

  useEffect(() => {
    if (
      authStatus !== "signed-in" ||
      activePage !== "calendar-month" ||
      !googleCalendarConnection?.connected
    ) {
      return;
    }

    void loadGoogleCalendarMonthEvents();
  }, [
    activePage,
    authStatus,
    googleCalendarConnection?.connected,
    googleCalendars,
    calendarScheduleViewMode,
    calendarMonthViewDate,
  ]);

  useEffect(() => {
    if (pendingCalendarCongregationEntries.length === 0 || congregationDirectory.length === 0) {
      return;
    }

    const matchedItems = pendingCalendarCongregationEntries
      .map((entry) => {
        const normalizedEntryName = entry.name.trim().toLowerCase();
        const normalizedEntryPhone = normalizeCongregationPhone(entry.phone);

        return congregationDirectory.find((item) => {
          const normalizedItemName = formatCongregationDirectoryItemLabel(item)
            .trim()
            .toLowerCase();
          const normalizedItemPhone = normalizeCongregationPhone(item.phone);

          return (
            normalizedItemName === normalizedEntryName &&
            (!normalizedEntryPhone || normalizedItemPhone === normalizedEntryPhone)
          );
        });
      })
      .filter((item): item is CongregationDirectoryItem => item !== undefined);

    setSelectedCongregationDirectoryItems(matchedItems);
    setPendingCalendarCongregationEntries([]);
  }, [congregationDirectory, pendingCalendarCongregationEntries]);

  useEffect(() => {
    if (authStatus !== "signed-in" || typeof window === "undefined") {
      return;
    }

    if (isApplyingPopStateRef.current) {
      isApplyingPopStateRef.current = false;
      return;
    }

    window.history.replaceState(
      { shepherdHubNav: createNavigationState() },
      "",
      window.location.href,
    );
  }, [
    authStatus,
    activePage,
    selectedMember,
    visitationFocus,
    editingMember,
    betaMemberTab,
    calendarScheduleDate,
  ]);

  useEffect(() => {
    if (authStatus !== "signed-in" || typeof window === "undefined") {
      return;
    }

    const handlePopState = (event: PopStateEvent) => {
      const nextState = (event.state as { shepherdHubNav?: AppNavigationState } | null)
        ?.shepherdHubNav;

      if (!nextState) {
        return;
      }

      isApplyingPopStateRef.current = true;
      applyNavigationState(nextState);
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [authStatus]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncViewport = () => {
      setIsCompactMobileViewport(getIsCompactMobileViewport());
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);

    return () => {
      window.removeEventListener("resize", syncViewport);
    };
  }, []);

  useEffect(() => {
    if (!isCompactMobileViewport || activePage !== "member-details") {
      return;
    }

    const nextState = createNavigationState({
      activePage: "member-details-beta",
      betaMemberTab: "details",
    });

    applyNavigationState(nextState);

    if (typeof window !== "undefined") {
      window.history.replaceState({ shepherdHubNav: nextState }, "", window.location.href);
    }
  }, [activePage, isCompactMobileViewport]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let isActive = true;
    let removeListener: (() => Promise<void>) | null = null;

    const setupBackButton = async () => {
      const listener = await CapacitorApp.addListener("backButton", async () => {
        const handled = navigateBackInsideApp();

        if (!handled) {
          await CapacitorApp.exitApp();
        }
      });

      removeListener = () => listener.remove();

      if (!isActive) {
        await listener.remove();
      }
    };

    void setupBackButton();

    return () => {
      isActive = false;
      if (removeListener) {
        void removeListener();
      }
    };
  }, [
    activePage,
    announcementDeleteModal,
    announcementItemDeleteModal,
    authStatus,
    betaMemberTab,
    canManageParking,
    deleteModal,
    editingMember,
    isBetaMemberMenuOpen,
    isCompactMobileViewport,
    isMobileMenuOpen,
    memberDetailsPageForViewport,
    memberContextMenu,
    parkingHistoryModal,
    selectedMember,
    visitationFocus,
    visitationModal,
  ]);

  useEffect(() => {
    if (activePage === "user-access" && !canManageUsers) {
      setActivePage("congregation");
    }
  }, [activePage, canManageUsers]);

  useEffect(() => {
    if (activePage === "announcement-week" && !canManageAnnouncements) {
      setActivePage("announcements");
    }
  }, [activePage, canManageAnnouncements]);

  useEffect(() => {
    if (activePage === "contacts-import" && !canManageUsers) {
      setActivePage("congregation");
    }
  }, [activePage, canManageUsers]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextUrl =
      activePage === "parking-registration"
        ? `${window.location.pathname}${window.location.search}#parking-registration`
        : `${window.location.pathname}${window.location.search}`;

    window.history.replaceState(window.history.state, "", nextUrl);
  }, [activePage]);

  useEffect(() => {
    if ((activePage === "parling" || activePage === "parking-management") && !canManageParking) {
      setActivePage("congregation");
    }
  }, [activePage, canManageParking]);

  useEffect(() => {
    if (activePage === "parling") {
      setActivePage("parking-management");
    }
  }, [activePage]);

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!sidePanelRef.current) {
        return;
      }

      const target = event.target;

      if (target instanceof Node && !sidePanelRef.current.contains(target)) {
        setIsMobileMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isMobileMenuOpen]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousTouchAction = body.style.touchAction;

    if (isMobileMenuOpen) {
      body.style.overflow = "hidden";
      body.style.touchAction = "none";
    }

    return () => {
      body.style.overflow = previousOverflow;
      body.style.touchAction = previousTouchAction;
    };
  }, [isMobileMenuOpen]);

  useEffect(() => {
    if (!(calendarMonthSelectedDate || calendarMonthExpandedDate) || !isMobileMenuOpen) {
      return;
    }

    setIsMobileMenuOpen(false);
  }, [calendarMonthExpandedDate, calendarMonthSelectedDate, isMobileMenuOpen]);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }

    if (!(calendarMonthSelectedDate || calendarMonthExpandedDate)) {
      return;
    }

    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPosition = body.style.position;
    const previousTop = body.style.top;
    const previousWidth = body.style.width;
    const scrollY = window.scrollY;

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";

    return () => {
      body.style.overflow = previousOverflow;
      body.style.position = previousPosition;
      body.style.top = previousTop;
      body.style.width = previousWidth;
      window.scrollTo(0, scrollY);
    };
  }, [calendarMonthExpandedDate, calendarMonthSelectedDate]);

  useEffect(() => {
    if (typeof document === "undefined" || !(calendarMonthSelectedDate || calendarMonthExpandedDate)) {
      return;
    }

    const handleTouchMove = (event: TouchEvent) => {
      const bookingModalElement = calendarBookingModalRef.current;
      const dayEventsModalElement = calendarDayEventsModalRef.current;
      const target = event.target;

      if (
        target instanceof Node &&
        ((bookingModalElement && bookingModalElement.contains(target)) ||
          (dayEventsModalElement && dayEventsModalElement.contains(target)))
      ) {
        return;
      }

      event.preventDefault();
    };

    document.addEventListener("touchmove", handleTouchMove, { passive: false });

    return () => {
      document.removeEventListener("touchmove", handleTouchMove);
    };
  }, [calendarMonthExpandedDate, calendarMonthSelectedDate]);

  useEffect(() => {
    if (!isBetaMemberMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!betaMemberMenuRef.current) {
        return;
      }

      const target = event.target;

      if (target instanceof Node && !betaMemberMenuRef.current.contains(target)) {
        setIsBetaMemberMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isBetaMemberMenuOpen]);

  useEffect(() => {
    setIsHistoryExpanded(false);
  }, [selectedMember?.pk, selectedMember?.sk]);

  useEffect(() => {
    setBetaMemberTab("details");
    setIsBetaMemberMenuOpen(false);
  }, [selectedMember?.pk, selectedMember?.sk]);

  useEffect(() => {
    closeMemberContextMenu();
  }, [activePage, selectedMember?.pk, selectedMember?.sk]);

  useEffect(() => {
    if (!memberContextMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!memberContextMenuRef.current) {
        return;
      }

      const target = event.target;

      if (target instanceof Node && !memberContextMenuRef.current.contains(target)) {
        closeMemberContextMenu();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMemberContextMenu();
      }
    };

    const handleViewportChange = () => {
      closeMemberContextMenu();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [memberContextMenu]);

  useEffect(() => () => clearMemberLongPressTimer(), []);

  const updateMemberForm = (
    field: keyof MemberFormState,
    value: MemberFormState[keyof MemberFormState],
  ) => {
    setMemberForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleMemberPhotoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setMemberPhotoStatus("Choose an image file for the member photo.");
      event.target.value = "";
      return;
    }

    try {
      const resizedPhoto = await resizeMemberPhoto(file);
      updateMemberForm("photo", resizedPhoto);
      setMemberPhotoStatus("Photo ready to save.");
    } catch {
      setMemberPhotoStatus("Unable to prepare the selected photo.");
    } finally {
      event.target.value = "";
    }
  };

  const clearMemberPhoto = () => {
    updateMemberForm("photo", "");
    setMemberPhotoStatus("Photo removed.");
    if (memberPhotoInputRef.current) {
      memberPhotoInputRef.current.value = "";
    }
  };

  const setMemberDetailsViewPreference = (
    nextView: "member-details" | "member-details-beta",
  ) => {
    setPreferredMemberDetailsPage(nextView);
    setCookieValue(memberDetailsViewCookieName, nextView, 60 * 60 * 24 * 365);
  };

  const updateAnnouncementWeekField = (
    field: "weekLabel",
    value: string,
  ) => {
    setAnnouncementWeekForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateAnnouncementItem = (index: number, value: string) => {
    setAnnouncementWeekForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? value : item,
      ),
    }));
  };

  const addAnnouncementItem = () => {
    setAnnouncementWeekForm((current) => ({
      ...current,
      items: [...current.items, ""],
    }));
  };

  const removeAnnouncementItem = (index: number) => {
    setAnnouncementWeekForm((current) => {
      const nextItems = current.items.filter((_, itemIndex) => itemIndex !== index);

      return {
        ...current,
        items: nextItems.length > 0 ? nextItems : [""],
      };
    });
  };

  const openAnnouncementItemDeleteModal = (index: number, label: string) => {
    setAnnouncementItemDeleteModal({ index, label });
  };

  const closeAnnouncementItemDeleteModal = () => {
    setAnnouncementItemDeleteModal(null);
  };

  const confirmRemoveAnnouncementItem = () => {
    if (!announcementItemDeleteModal) {
      return;
    }

    removeAnnouncementItem(announcementItemDeleteModal.index);
    closeAnnouncementItemDeleteModal();
  };

  const startCreateAnnouncementWeek = () => {
    if (!canManageAnnouncements) {
      return;
    }
    setAnnouncementWeekForm(initialAnnouncementWeekForm);
    setAnnouncementSubmitState(null);
    navigateToState({ activePage: "announcement-week" });
  };

  const startEditAnnouncementWeek = (
    sk: string,
    parsed: AnnouncementWeekData | null,
  ) => {
    if (!canManageAnnouncements) {
      return;
    }
    setAnnouncementWeekForm({
      sk,
      createdAt: parsed?.createdAt,
      weekLabel: parsed?.weekLabel ?? "",
      items: parsed?.items && parsed.items.length > 0 ? parsed.items : [""],
    });
    setAnnouncementSubmitState(null);
    navigateToState({ activePage: "announcement-week" });
  };

  const handleAnnouncementWeekSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!congregationApiName) {
      setAnnouncementSubmitState("Backend API is not configured yet.");
      return;
    }

    const nextAnnouncementSk = `WEEK#${announcementWeekForm.weekLabel}`;
    const existingWeek = announcementWeeks.find((week) => week.sk === nextAnnouncementSk);

    if (existingWeek && announcementWeekForm.sk !== nextAnnouncementSk) {
      setAnnouncementSubmitState("That week already exists.");
      return;
    }

    setIsAnnouncementSubmitting(true);
    setAnnouncementSubmitState(null);

    try {
      await authorizedPost("/announcements/week", {
        ...(announcementWeekForm.sk ? { sk: announcementWeekForm.sk } : {}),
        ...(announcementWeekForm.createdAt
          ? { createdAt: announcementWeekForm.createdAt }
          : {}),
        weekLabel: announcementWeekForm.weekLabel,
        items: announcementWeekForm.items,
      });
      setAnnouncementSubmitState(
        announcementWeekForm.sk
          ? "Announcement week updated."
          : "Announcement week created.",
      );
      setAnnouncementWeekForm(initialAnnouncementWeekForm);
      await loadAnnouncements();
      setActivePage("announcements");
    } catch (error) {
      setAnnouncementSubmitState("Unable to save announcement week.");
    } finally {
      setIsAnnouncementSubmitting(false);
    }
  };

  const handleRemoveAnnouncementWeek = async (sk: string) => {
    if (!congregationApiName) {
      return;
    }

    setDeletingAnnouncementSk(sk);

    try {
      await authorizedPost("/announcements/week/remove", {
        pk: "ANNOUNCEMENT",
        sk,
      });
      await loadAnnouncements();
      if (announcementWeekForm.sk === sk) {
        setAnnouncementWeekForm(initialAnnouncementWeekForm);
        setAnnouncementSubmitState(null);
      }
    } finally {
      setDeletingAnnouncementSk(null);
    }
  };

  const openAnnouncementDeleteModal = (sk: string, weekLabel: string) => {
    setAnnouncementDeleteModal({ sk, weekLabel });
  };

  const closeAnnouncementDeleteModal = () => {
    setAnnouncementDeleteModal(null);
  };

  const confirmRemoveAnnouncementWeek = async () => {
    if (!announcementDeleteModal) {
      return;
    }

    await handleRemoveAnnouncementWeek(announcementDeleteModal.sk);
    closeAnnouncementDeleteModal();
  };

  const handleMemberSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!congregationApiName) {
      setMemberSubmitState("Backend API is not configured yet.");
      return;
    }

    setIsMemberSubmitting(true);
    setMemberSubmitState(null);

    try {
      const requestBody = editingMember
        ? {
            ...memberForm,
            pk: editingMember.pk,
            sk: editingMember.sk,
            ...(editingMember.createdAt
              ? { createdAt: editingMember.createdAt }
              : {}),
          }
        : memberForm;

      await authorizedPost(
        editingMember ? "/congregation/member/update" : "/congregation/member",
        requestBody,
      );
      setMemberSubmitState(editingMember ? "Member updated." : "Member saved.");
      setMemberPhotoStatus(null);
      setMemberForm(initialMemberForm);
      setEditingMember(null);
      if (memberPhotoInputRef.current) {
        memberPhotoInputRef.current.value = "";
      }
      await loadBackendMessage();
      setActivePage("congregation");
    } catch (error) {
      setMemberSubmitState(
        editingMember ? "Unable to update member." : "Unable to save member.",
      );
    } finally {
      setIsMemberSubmitting(false);
    }
  };

  const openNewMemberPage = () => {
    setEditingMember(null);
    setMemberForm(initialMemberForm);
    setMemberSubmitState(null);
    setMemberPhotoStatus(null);
    if (memberPhotoInputRef.current) {
      memberPhotoInputRef.current.value = "";
    }
    navigateToState({
      activePage: "new-member",
      editingMember: null,
    });
  };

  const openEditMemberPage = (
    pk: string,
    sk: string,
    memberData: StoredMemberData | null,
    memberPhoto?: string,
  ) => {
    setEditingMember({
      pk,
      sk,
      createdAt: memberData?.createdAt,
    });
    setMemberForm({
      firstName: memberData?.firstName ?? "",
      lastName: memberData?.lastName ?? "",
      email: memberData?.email ?? "",
      phone: memberData?.phone ?? "",
      photo: memberPhoto ?? memberData?.photo ?? memberData?.photoDataUrl ?? "",
      role: memberData?.role ?? "",
      status: memberData?.status ?? "",
      address: memberData?.address ?? "",
      notes: memberData?.notes ?? "",
    });
    setMemberSubmitState(null);
    setMemberPhotoStatus(null);
    if (memberPhotoInputRef.current) {
      memberPhotoInputRef.current.value = "";
    }
    navigateToState({
      activePage: "new-member",
      editingMember: {
        pk,
        sk,
        createdAt: memberData?.createdAt,
      },
    });
  };

  const handleCancelMemberForm = () => {
    setEditingMember(null);
    setMemberForm(initialMemberForm);
    setMemberSubmitState(null);
    setMemberPhotoStatus(null);
    if (memberPhotoInputRef.current) {
      memberPhotoInputRef.current.value = "";
    }
    setActivePage("congregation");
  };

  const openMemberDetailsPage = (pk: string, sk: string) => {
    navigateToState({
      activePage: memberDetailsPageForViewport,
      selectedMember: { pk, sk },
      betaMemberTab:
        memberDetailsPageForViewport === "member-details-beta" ? "details" : undefined,
    });
  };

  const openMemberVisitationPage = (pk: string, sk: string, memberName: string) => {
    navigateToState({
      activePage: "visitation",
      selectedMember: { pk, sk },
      visitationFocus: { pk, sk, memberName },
    });
  };

  const openCalendarDaySchedulePage = (day: Date) => {
    setCalendarScheduleMemberSk("");
    setCalendarScheduleTime("09:00");
    setCalendarScheduleAssignedPriestSk("");
    setCalendarScheduleSubmitState(null);
    navigateToState({
      activePage: "visitation-calendar-schedule",
      calendarScheduleDate: formatDateInputValue(day),
    });
  };

  const closeCalendarDaySchedulePage = () => {
    setCalendarScheduleSubmitState(null);
    navigateToState({
      activePage: "visitation-calendar",
      calendarScheduleDate: null,
    });
  };

  const closeMemberContextMenu = () => {
    setMemberContextMenu(null);
  };

  const clearMemberLongPressTimer = () => {
    if (memberLongPressTimerRef.current !== null) {
      window.clearTimeout(memberLongPressTimerRef.current);
      memberLongPressTimerRef.current = null;
    }
  };

  const openMemberContextMenu = (
    options: {
      pk: string;
      sk: string;
      memberName: string;
      memberData: StoredMemberData | null;
      memberPhoto?: string;
    },
    x: number,
    y: number,
  ) => {
    const menuX = Math.min(
      x,
      Math.max(16, window.innerWidth - memberContextMenuWidth - 16),
    );
    const menuY = Math.min(
      y,
      Math.max(16, window.innerHeight - memberContextMenuHeight - 16),
    );

    setMemberContextMenu({
      ...options,
      x: menuX,
      y: menuY,
    });
  };

  const handleMemberCardClick = (pk: string, sk: string) => {
    if (suppressMemberClickRef.current) {
      suppressMemberClickRef.current = false;
      return;
    }

    closeMemberContextMenu();
    openMemberDetailsPage(pk, sk);
  };

  const handleMemberContextMenuAction = (
    action: "delete" | "edit" | "details" | "schedule",
  ) => {
    if (!memberContextMenu) {
      return;
    }

    const { pk, sk, memberName, memberData, memberPhoto } = memberContextMenu;
    closeMemberContextMenu();

    if (action === "delete") {
      openDeleteModal(pk, sk, memberName);
      return;
    }

    if (action === "edit") {
      openEditMemberPage(pk, sk, memberData, memberPhoto);
      return;
    }

    if (action === "schedule") {
      openMemberVisitationPage(pk, sk, memberName);
      return;
    }

    openMemberDetailsPage(pk, sk);
  };

  const handleMemberCardContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    options: {
      pk: string;
      sk: string;
      memberName: string;
      memberData: StoredMemberData | null;
      memberPhoto?: string;
    },
  ) => {
    event.preventDefault();
    clearMemberLongPressTimer();
    suppressMemberClickRef.current = true;
    openMemberContextMenu(options, event.clientX, event.clientY);
  };

  const handleMemberCardTouchStart = (
    event: ReactTouchEvent<HTMLElement>,
    options: {
      pk: string;
      sk: string;
      memberName: string;
      memberData: StoredMemberData | null;
      memberPhoto?: string;
    },
  ) => {
    clearMemberLongPressTimer();

    const touch = event.touches[0];

    if (!touch) {
      return;
    }

    memberLongPressTimerRef.current = window.setTimeout(() => {
      suppressMemberClickRef.current = true;
      openMemberContextMenu(options, touch.clientX, touch.clientY);
      memberLongPressTimerRef.current = null;
    }, memberLongPressDelayMs);
  };

  const handleMemberCardTouchEnd = () => {
    clearMemberLongPressTimer();
  };

  const navigateBackInsideApp = () => {
    closeMemberContextMenu();

    if (isMobileMenuOpen) {
      setIsMobileMenuOpen(false);
      return true;
    }

    if (isBetaMemberMenuOpen) {
      setIsBetaMemberMenuOpen(false);
      return true;
    }

    if (parkingHistoryModal) {
      setParkingHistoryModal(null);
      return true;
    }

    if (announcementItemDeleteModal) {
      setAnnouncementItemDeleteModal(null);
      return true;
    }

    if (announcementDeleteModal) {
      setAnnouncementDeleteModal(null);
      return true;
    }

    if (deleteModal) {
      closeDeleteModal();
      return true;
    }

    if (visitationModal) {
      closeVisitationModal();
      return true;
    }

    if (authStatus !== "signed-in") {
      if (activePage === "parking-registration") {
        setActivePage("congregation");
        return true;
      }

      return false;
    }

    if (activePage === "member-details-beta") {
      if (isCompactMobileViewport) {
        setActivePage("congregation");
        return true;
      }

      setMemberDetailsViewPreference("member-details");
      setActivePage("member-details");
      return true;
    }

    if (activePage === "visitation" && visitationFocus) {
      navigateToState({
        activePage: memberDetailsPageForViewport,
        selectedMember: {
          pk: visitationFocus.pk,
          sk: visitationFocus.sk,
        },
        visitationFocus,
        betaMemberTab:
          memberDetailsPageForViewport === "member-details-beta" ? "visitations" : undefined,
      });
      return true;
    }

    if (activePage === "announcement-week") {
      navigateToState({ activePage: "announcements" });
      return true;
    }

    if (activePage === "visitation-calendar-schedule") {
      closeCalendarDaySchedulePage();
      return true;
    }

    if (activePage === "parking-registration") {
      navigateToState({
        activePage: canManageParking ? "parking-management" : "congregation",
      });
      return true;
    }

    const hasNavigationHistory =
      typeof window !== "undefined" && window.history.length > 1;

    if (hasNavigationHistory) {
      window.history.back();
      return true;
    }

    const isAtRootPage =
      activePage === "congregation" &&
      !selectedMember &&
      !visitationFocus &&
      !editingMember;

    if (!isAtRootPage) {
      navigateToState({
        activePage: "congregation",
        selectedMember: null,
        visitationFocus: null,
        editingMember: null,
        betaMemberTab: "details",
      });
      return true;
    }

    return false;
  };

  const handleDeleteMember = async (pk: string, sk: string) => {
    if (!congregationApiName) {
      return;
    }

    const memberKey = `${pk}-${sk}`;
    setDeletingMemberKey(memberKey);

    try {
      await authorizedPost("/congregation/member/remove", { pk, sk });
      await loadBackendMessage();
    } finally {
      setDeletingMemberKey(null);
    }
  };

  const openDeleteModal = (pk: string, sk: string, memberName: string) => {
    setDeleteModal({
      pk,
      sk,
      memberName,
    });
  };

  const closeDeleteModal = () => {
    setDeleteModal(null);
  };

  const confirmDeleteMember = async () => {
    if (!deleteModal) {
      return;
    }

    await handleDeleteMember(deleteModal.pk, deleteModal.sk);
    closeDeleteModal();
    setSelectedMember(null);
    setVisitationFocus(null);
    setActivePage("congregation");
  };

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSigningIn(true);
    setAuthError(null);

    try {
      const result = await signIn({
        username: authForm.username,
        password: authForm.password,
      });

      if (result.nextStep.signInStep !== "DONE") {
        setPendingSignInStep(result.nextStep.signInStep);
        return;
      }

      setPendingSignInStep(null);
      setChallengeResponse("");
      await checkAuthSession();
    } catch {
      setAuthError("Unable to sign in with those credentials.");
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleConfirmSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSigningIn(true);
    setAuthError(null);

    try {
      const result = await confirmSignIn({
        challengeResponse,
      });

      if (result.nextStep.signInStep !== "DONE") {
        setPendingSignInStep(result.nextStep.signInStep);
        setAuthError(`Another sign-in step is required: ${result.nextStep.signInStep}.`);
        return;
      }

      setPendingSignInStep(null);
      setChallengeResponse("");
      await checkAuthSession();
    } catch {
      setAuthError("Unable to complete the sign-in challenge.");
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setAuthStatus("signed-out");
    setCurrentUserLabel("");
    setCurrentUserGroups([]);
    setBackendMessage(null);
    setBackendError(null);
    setUserDirectory([]);
    setGroupAssignments({});
    setUserDirectoryError(null);
    setUserDirectoryStatus(null);
    setContactsImportFile(null);
    setContactsImportStatus(null);
    setContactsImportSummary(null);
  };

  const toggleTheme = () => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  };

  const openVisitationModal = (
    action: NonNullable<VisitationModalState>["action"],
    pk: string,
    sk: string,
    memberName: string,
    options?: {
      visitationId?: string;
      schedule?: string;
      note?: string;
      assignedPriestSk?: string;
      assignedPriestName?: string;
    },
  ) => {
    setVisitationModal({
      action,
      pk,
      sk,
      memberName,
      visitationId: options?.visitationId,
    });
    setVisitationSchedule(options?.schedule ?? "");
    setVisitationNote(options?.note ?? "");
    setVisitationAssignedPriestSk(options?.assignedPriestSk ?? "");
    setVisitationAssignedPriestName(options?.assignedPriestName ?? "");
    setVisitationSubmitState(null);
  };

  const closeVisitationModal = () => {
    setVisitationModal(null);
    setVisitationSchedule("");
    setVisitationNote("");
    setVisitationAssignedPriestSk("");
    setVisitationAssignedPriestName("");
    setVisitationSubmitState(null);
  };

  const handleVisitationModalSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!visitationModal || !congregationApiName) {
      return;
    }

    setIsVisitationSubmitting(true);
    setVisitationSubmitState(null);

    try {
      const body: Record<string, string> = {
        pk: visitationModal.pk,
        sk: visitationModal.sk,
        action: visitationModal.action,
      };

      if (visitationModal.visitationId) {
        body.visitationId = visitationModal.visitationId;
      }

      if (visitationModal.action === "schedule") {
        body.schedule = visitationSchedule;
        body.assignedPriestSk = visitationAssignedPriestSk;
      }

      if (visitationModal.action === "note") {
        body.note = visitationNote;
      }

      await authorizedPost("/congregation/member/visitation", body);
      await loadBackendMessage();
      closeVisitationModal();
    } catch {
      setVisitationSubmitState("Unable to save visitation update.");
    } finally {
      setIsVisitationSubmitting(false);
    }
  };

  const handleCalendarScheduleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!congregationApiName || !calendarScheduleDate || !selectedCalendarScheduleMember) {
      setCalendarScheduleSubmitState("Select a member and date before scheduling.");
      return;
    }

    setIsCalendarScheduleSubmitting(true);
    setCalendarScheduleSubmitState(null);

    try {
      await authorizedPost("/congregation/member/visitation", {
        pk: selectedCalendarScheduleMember.pk,
        sk: selectedCalendarScheduleMember.sk,
        action: "schedule",
        schedule: `${calendarScheduleDate}T${calendarScheduleTime}`,
        assignedPriestSk: calendarScheduleAssignedPriestSk || undefined,
      });
      await loadBackendMessage();
      closeCalendarDaySchedulePage();
    } catch {
      setCalendarScheduleSubmitState("Unable to schedule visitation from the calendar.");
    } finally {
      setIsCalendarScheduleSubmitting(false);
    }
  };

  const renderParkingRegistrationPage = ({
    showBackButton = false,
  }: {
    showBackButton?: boolean;
  }) => (
    <div className="parking-registration-page">
      <form
        className="member-form-card parking-registration-card"
        onSubmit={handleParkingRegistrationSubmit}
      >
        <div className="member-form-header parking-registration-header">
          <div>
            <p className="member-form-mode">Parking Registration</p>
            <p className="parking-registration-copy">
              Provide the contact and vehicle details needed for parking coordination.
            </p>
          </div>

          {showBackButton ? (
            <button
              type="button"
              className="member-cancel-button parking-registration-back"
              onClick={() => setActivePage("congregation")}
            >
              Back to Sign In
            </button>
          ) : null}
        </div>

        <div className="member-form-grid parking-registration-grid">
          <label className="member-field">
            <span>First name</span>
            <input
              type="text"
              required
              value={parkingRegistrationForm.firstName}
              onChange={(event) =>
                setParkingRegistrationForm((current) => ({
                  ...current,
                  firstName: event.target.value,
                }))
              }
              placeholder="Enter first name"
            />
          </label>

          <label className="member-field">
            <span>Last name</span>
            <input
              type="text"
              required
              value={parkingRegistrationForm.lastName}
              onChange={(event) =>
                setParkingRegistrationForm((current) => ({
                  ...current,
                  lastName: event.target.value,
                }))
              }
              placeholder="Enter last name"
            />
          </label>

          <label className="member-field">
            <span>License plate</span>
            <input
              type="text"
              required
              value={parkingRegistrationForm.licensePlate}
              onChange={(event) =>
                setParkingRegistrationForm((current) => ({
                  ...current,
                  licensePlate: event.target.value.toUpperCase(),
                }))
              }
              placeholder="ABC 123"
            />
          </label>

          <label className="member-field">
            <span>Personal email address</span>
            <input
              type="email"
              required
              value={parkingRegistrationForm.personalEmail}
              onChange={(event) =>
                setParkingRegistrationForm((current) => ({
                  ...current,
                  personalEmail: event.target.value,
                }))
              }
              placeholder="name@example.com"
            />
          </label>

          <label className="member-field">
            <span>Work email</span>
            <input
              type="email"
              value={parkingRegistrationForm.workEmail}
              onChange={(event) =>
                setParkingRegistrationForm((current) => ({
                  ...current,
                  workEmail: event.target.value,
                }))
              }
              placeholder="Use for work-hour notifications"
            />
          </label>

          <label className="member-field">
            <span>Place of work</span>
            <input
              type="text"
              value={parkingRegistrationForm.placeOfWork}
              onChange={(event) =>
                setParkingRegistrationForm((current) => ({
                  ...current,
                  placeOfWork: event.target.value,
                }))
              }
              placeholder="Enter place of work"
            />
          </label>

          <label className="member-field">
            <span>Telephone cell</span>
            <input
              type="tel"
              required
              value={parkingRegistrationForm.cellPhone}
              onChange={(event) =>
                setParkingRegistrationForm((current) => ({
                  ...current,
                  cellPhone: event.target.value,
                }))
              }
              placeholder="Enter cell number"
            />
          </label>

          <label className="member-field">
            <span>Work phone</span>
            <input
              type="tel"
              value={parkingRegistrationForm.workPhone}
              onChange={(event) =>
                setParkingRegistrationForm((current) => ({
                  ...current,
                  workPhone: event.target.value,
                }))
              }
              placeholder="Enter work phone"
            />
          </label>

          <label className="member-field">
            <span>Duration from</span>
            <input
              type="month"
              required
              value={parkingRegistrationForm.durationFrom}
              onChange={(event) =>
                setParkingRegistrationForm((current) => ({
                  ...current,
                  durationFrom: event.target.value,
                }))
              }
            />
          </label>

          <label className="member-field">
            <span>Duration to</span>
            <input
              type="month"
              required
              value={parkingRegistrationForm.durationTo}
              onChange={(event) =>
                setParkingRegistrationForm((current) => ({
                  ...current,
                  durationTo: event.target.value,
                }))
              }
            />
          </label>
        </div>

        <div className="member-form-actions">
          <p className="member-submit-message">{parkingRegistrationStatus}</p>
          <button
            type="button"
            className="member-cancel-button"
            onClick={() => {
              setParkingRegistrationForm(initialParkingRegistrationForm);
              setParkingRegistrationStatus(null);
            }}
          >
            Clear
          </button>
          <button
            type="submit"
            className="member-submit-button"
            disabled={isParkingRegistrationSubmitting}
          >
            {isParkingRegistrationSubmitting
              ? "Submitting..."
              : "Submit Registration"}
          </button>
        </div>
      </form>
    </div>
  );

  const renderParkingRegistrationActions = (registration: ParkingRegistrationItem) => {
    const normalizedCellPhone = normalizePhoneForLink(registration.cellPhone);
    const normalizedWhatsappPhone = normalizedCellPhone.replace(/[^\d]/g, "");
    const normalizedEmail = registration.personalEmail.trim();

    return (
      <div className="parking-registration-actions">
        <a
          className={`member-contact-button phone${normalizedCellPhone ? "" : " disabled"}`}
          href={normalizedCellPhone ? `tel:${normalizedCellPhone}` : undefined}
          aria-label={`Call ${registration.firstName} ${registration.lastName}`}
          onClick={(event) => {
            if (!normalizedCellPhone) {
              event.preventDefault();
            }
          }}
        >
          <img src="/phone-ios.png" alt="" className="member-contact-icon member-contact-icon-image" />
        </a>
        <a
          className={`member-contact-button imessage${normalizedCellPhone ? "" : " disabled"}`}
          href={normalizedCellPhone ? `sms:${normalizedCellPhone}` : undefined}
          aria-label={`Message ${registration.firstName} ${registration.lastName}`}
          onClick={(event) => {
            if (!normalizedCellPhone) {
              event.preventDefault();
            }
          }}
        >
          <img src="/imessage.png" alt="" className="member-contact-icon member-contact-icon-image" />
        </a>
        <a
          className={`member-contact-button whatsapp${
            normalizedWhatsappPhone ? "" : " disabled"
          }`}
          href={normalizedWhatsappPhone ? `https://wa.me/${normalizedWhatsappPhone}` : undefined}
          target="_blank"
          rel="noreferrer"
          aria-label={`WhatsApp ${registration.firstName} ${registration.lastName}`}
          onClick={(event) => {
            if (!normalizedWhatsappPhone) {
              event.preventDefault();
            }
          }}
        >
          <img src="/whatsapp.png" alt="" className="member-contact-icon member-contact-icon-image" />
        </a>
        <a
          className={`member-contact-button email${normalizedEmail ? "" : " disabled"}`}
          href={normalizedEmail ? `mailto:${normalizedEmail}` : undefined}
          aria-label={`Email ${registration.firstName} ${registration.lastName}`}
          onClick={(event) => {
            if (!normalizedEmail) {
              event.preventDefault();
            }
          }}
        >
          <img src="/email.png" alt="" className="member-contact-icon member-contact-icon-image" />
        </a>
        {registration.placementStatus === "waiting-list" ? (
          <button
            type="button"
            className="parking-placement-link"
            onClick={() => void handleParkingRegistrationStatusToggle(registration, "available")}
            disabled={updatingParkingRegistrationSk === registration.sk}
          >
            {updatingParkingRegistrationSk === registration.sk ? "Updating..." : "Mark Available"}
          </button>
        ) : registration.placementStatus === "available" ? (
          <>
            <button
              type="button"
              className="parking-placement-link"
              onClick={() => void handleParkingRegistrationStatusToggle(registration, "assigned")}
              disabled={updatingParkingRegistrationSk === registration.sk}
            >
              {updatingParkingRegistrationSk === registration.sk ? "Updating..." : "Assign"}
            </button>
            <button
              type="button"
              className="parking-placement-link secondary"
              onClick={() => void handleParkingRegistrationStatusToggle(registration, "waiting-list")}
              disabled={updatingParkingRegistrationSk === registration.sk}
            >
              {updatingParkingRegistrationSk === registration.sk
                ? "Updating..."
                : "Move to Waiting List"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="parking-placement-link secondary"
            onClick={() => void handleParkingRegistrationStatusToggle(registration, "waiting-list")}
            disabled={updatingParkingRegistrationSk === registration.sk}
          >
            {updatingParkingRegistrationSk === registration.sk
              ? "Updating..."
              : "Move to Waiting List"}
          </button>
        )}
        <button
          type="button"
          className="parking-history-link"
          onClick={() =>
            setParkingHistoryModal({
              sk: registration.sk,
              memberName: `${registration.firstName} ${registration.lastName}`,
              history: registration.history ?? [],
            })
          }
        >
          History
        </button>
        {parkingTab === "assigned" ? (
          <button
            type="button"
            className="parking-print-link"
            aria-label={`Print parking permit for ${registration.firstName} ${registration.lastName}`}
            onClick={() => void handlePrintParkingPermit(registration)}
            disabled={printingParkingRegistrationSk === registration.sk}
          >
            {printingParkingRegistrationSk === registration.sk ? "Preparing..." : "Print QR"}
          </button>
        ) : null}
      </div>
    );
  };

  const renderParkingRegistrationsTable = (registrations: ParkingRegistrationItem[]) => (
    <div className="parking-table-wrap">
      <table className="parking-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>License Plate</th>
            <th>Duration</th>
            <th>Registered</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {registrations.map((registration) => (
            <tr key={registration.sk}>
              <td data-label="Name">
                <div className="parking-table-primary">
                  <span className="parking-table-name">
                    {registration.firstName} {registration.lastName}
                  </span>
                  <span className="parking-table-meta">{registration.sk}</span>
                </div>
              </td>
              <td data-label="License Plate">{registration.licensePlate}</td>
              <td data-label="Duration">
                {formatParkingDurationLabel(registration.durationFrom, registration.durationTo)}
              </td>
              <td data-label="Registered">
                {new Date(registration.registeredAt).toLocaleDateString()}
              </td>
              <td data-label="Status">
                <span
                  className={`parking-registration-status${
                    registration.placementStatus === "waiting-list"
                      ? " waiting"
                      : registration.placementStatus === "available"
                        ? " available"
                        : " assigned"
                  }`}
                >
                  {registration.placementStatus === "waiting-list"
                    ? "Waiting List"
                    : registration.placementStatus === "available"
                      ? "Available"
                      : "Assigned"}
                </span>
              </td>
              <td data-label="Actions">{renderParkingRegistrationActions(registration)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (authStatus !== "signed-in") {
    const challengeLabel =
      pendingSignInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"
        ? "New password"
        : pendingSignInStep === "CONFIRM_SIGN_IN_WITH_EMAIL_CODE"
          ? "Email verification code"
          : pendingSignInStep === "CONFIRM_SIGN_IN_WITH_SMS_CODE"
            ? "SMS verification code"
            : pendingSignInStep === "CONFIRM_SIGN_IN_WITH_TOTP_CODE"
              ? "Authenticator code"
              : "Challenge response";

    return (
      <div className="auth-shell" data-theme={theme}>
        {activePage === "parking-registration" ? (
          renderParkingRegistrationPage({ showBackButton: true })
        ) : (
          <form
            className="auth-card"
            onSubmit={pendingSignInStep ? handleConfirmSignIn : handleSignIn}
          >
            <div className="auth-brand">
              <img className="auth-logo" src="/logo.png" alt="Shepherd Hub logo" />
              <p className="auth-brand-name">Shepherd Hub</p>
            </div>
            <h1 className="auth-title">Sign in to continue</h1>
            <p className="auth-copy">
              Use your Cognito username and password to access Shephed Hub.
            </p>

            <button
              type="button"
              className="hero-inline-link auth-inline-link"
              onClick={() => setActivePage("parking-registration")}
            >
              Open Parking Registration
            </button>

            {!pendingSignInStep ? (
              <>
                <label className="auth-field">
                  <span>Username</span>
                  <input
                    type="text"
                    value={authForm.username}
                    onChange={(event) =>
                      setAuthForm((current) => ({
                        ...current,
                        username: event.target.value,
                      }))
                    }
                    placeholder="Enter your username"
                  />
                </label>

                <label className="auth-field">
                  <span>Password</span>
                  <input
                    type="password"
                    value={authForm.password}
                    onChange={(event) =>
                      setAuthForm((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    placeholder="Enter your password"
                  />
                </label>
              </>
            ) : (
              <label className="auth-field">
                <span>{challengeLabel}</span>
                <input
                  type={
                    pendingSignInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"
                      ? "password"
                      : "text"
                  }
                  value={challengeResponse}
                  onChange={(event) => setChallengeResponse(event.target.value)}
                  placeholder={`Enter ${challengeLabel.toLowerCase()}`}
                />
              </label>
            )}

            {authError ? <p className="auth-error">{authError}</p> : null}

            <button
              type="submit"
              className="auth-submit-button"
              disabled={isSigningIn || authStatus === "checking"}
            >
              {authStatus === "checking" || isSigningIn
                ? "Signing in..."
                : pendingSignInStep
                  ? "Continue Sign In"
                  : "Sign In"}
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className="side-panel" ref={sidePanelRef}>
        <div className="side-panel-header">
          <button
            type="button"
            className={`menu-toggle${isMobileMenuOpen ? " open" : ""}`}
            aria-expanded={isMobileMenuOpen}
            aria-controls="home-sections-nav"
            aria-label="Toggle navigation menu"
            onClick={() => setIsMobileMenuOpen((current) => !current)}
          >
            <span />
            <span />
            <span />
          </button>

          <div className="side-panel-brand">
            <p className="brand-kicker">Shepherd Hub</p>
            <p className="signed-in-user">{currentUserLabel}</p>
          </div>

          <img className="side-panel-logo" src="/logo.png" alt="Shepherd Hub logo" />
        </div>

        <nav
          id="home-sections-nav"
          className={`nav-list${isMobileMenuOpen ? " open" : ""}`}
          aria-label="Home sections"
        >
          {navSections
            .map((section) => ({
              ...section,
              items: section.items.filter(
                (item) =>
                  ((!["user-access", "contacts-import"].includes(item.key) ||
                    canManageUsers) &&
                    (!["parking-management"].includes(item.key) ||
                      canManageParking)),
              ),
            }))
            .filter((section) => section.items.length > 0)
            .map((section) => (
              <div className="nav-section" key={section.label}>
                <p className="nav-section-label">{section.label}</p>

                <div className="nav-section-items">
                  {section.items.map((item) => {
                    const isActive = item.key === activePage;

                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={`nav-item${isActive ? " active" : ""}`}
                        onClick={() => {
                          if (item.key !== "visitation") {
                            setVisitationFocus(null);
                          }
                          navigateToState({
                            activePage: item.key,
                            visitationFocus:
                              item.key === "visitation" ? visitationFocus : null,
                          });
                          setIsMobileMenuOpen(false);
                        }}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

          <div className="nav-section">
            <p className="nav-section-label">Session</p>
            <div className="nav-section-items">
              <div className="theme-toggle-group" role="group" aria-label="Theme mode">
                <button
                  type="button"
                  className={`theme-toggle-option${theme === "light" ? " active" : ""}`}
                  aria-pressed={theme === "light"}
                  onClick={() => setTheme("light")}
                >
                  Light
                </button>
                <button
                  type="button"
                  className={`theme-toggle-option${theme === "dark" ? " active" : ""}`}
                  aria-pressed={theme === "dark"}
                  onClick={() => setTheme("dark")}
                >
                  Dark
                </button>
              </div>
              <button
                type="button"
                className="nav-item sign-out-button"
                onClick={handleSignOut}
              >
                Sign Out
              </button>
              <p className="side-panel-version">Version v0.1</p>
            </div>
          </div>
        </nav>
      </aside>

      <main className="content-panel">
        {isBackendRequestInFlight ? (
          <div className="page-progress" aria-live="polite" aria-label="Loading">
            <div className="page-progress-bar" />
          </div>
        ) : null}

        <section className="hero-card">
          <div className="hero-header">
            <div>
              <div className="hero-title-row">
                <p className="eyebrow">{currentPage.eyebrow}</p>
                {activePage === "member-details" && !isCompactMobileViewport ? (
                  <button
                    type="button"
                    className="hero-inline-link"
                    onClick={() => {
                      setMemberDetailsViewPreference("member-details-beta");
                      navigateToState({
                        activePage: "member-details-beta",
                        betaMemberTab: "details",
                      });
                    }}
                  >
                    Open Beta Mobile View
                  </button>
                ) : null}
              </div>
              {currentPage.description ? (
                <p className="description">{currentPage.description}</p>
              ) : null}
            </div>

            {activePage === "congregation" ? (
              <button
                type="button"
                className="hero-action-button"
                onClick={openNewMemberPage}
              >
                Add Member
              </button>
            ) : null}
          </div>

          {activePage === "congregation" ? (
            <div className="api-message-card">
              <p className="api-message-label">Congregation</p>

              {!isBackendLoading && !backendError && backendMessage ? (
                <>
                  <div className="congregation-search-row">
                    <label className="congregation-search-shell">
                      <span className="congregation-search-icon" aria-hidden="true">
                        Search
                      </span>
                      <input
                        type="search"
                        className="congregation-search-input"
                        placeholder="Search members"
                        value={memberSearch}
                        onChange={(event) => setMemberSearch(event.target.value)}
                      />
                    </label>
                    <div className="congregation-search-tools">
                      <label className="congregation-sort-control">
                        <span className="congregation-sort-label">Sort</span>
                        <select
                          aria-label="Sort members by name"
                          value={memberSortOrder}
                          onChange={(event) =>
                            setMemberSortOrder(event.target.value as MemberSortOrder)
                          }
                        >
                          <option value="name-asc">A-Z</option>
                          <option value="name-desc">Z-A</option>
                        </select>
                      </label>
                      <p className="congregation-search-count">
                        {filteredCongregationItems.length} member
                        {filteredCongregationItems.length === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>

                  <div className="api-data-list">
                    {sortedCongregationItems.map((item) => {
                      const memberData = parseMemberData(item.data);
                      const fullName = [memberData?.firstName, memberData?.lastName]
                        .filter(Boolean)
                        .join(" ");
                      const memberLabel = fullName || formatMemberKeyLabel(item.pk, item.sk);
                      const memberInitials = getMemberInitials(
                        memberData?.firstName,
                        memberData?.lastName,
                        memberLabel,
                      );
                      const memberPhotoDataUrl =
                        item.photo ?? memberData?.photo ?? memberData?.photoDataUrl;

                      return (
                        <article
                          className="api-data-item api-data-item-clickable"
                          key={`${item.pk}-${item.sk}`}
                          onContextMenu={(event) =>
                            handleMemberCardContextMenu(event, {
                              pk: item.pk,
                              sk: item.sk,
                              memberName: fullName || "Unnamed member",
                              memberData,
                              memberPhoto: memberPhotoDataUrl,
                            })
                          }
                          onTouchStart={(event) =>
                            handleMemberCardTouchStart(event, {
                              pk: item.pk,
                              sk: item.sk,
                              memberName: fullName || "Unnamed member",
                              memberData,
                              memberPhoto: memberPhotoDataUrl,
                            })
                          }
                          onTouchEnd={handleMemberCardTouchEnd}
                          onTouchCancel={handleMemberCardTouchEnd}
                          onTouchMove={handleMemberCardTouchEnd}
                        >
                          {memberData ? (
                            <div className="api-data-details">
                              <div
                                className="api-data-layout"
                                onClick={() => handleMemberCardClick(item.pk, item.sk)}
                              >
                                <div className="api-data-avatar">
                                  {memberPhotoDataUrl ? (
                                    <img
                                      src={memberPhotoDataUrl}
                                      alt={`${memberLabel} photo`}
                                      className="member-avatar-image"
                                    />
                                  ) : (
                                    <span aria-hidden="true">{memberInitials}</span>
                                  )}
                                </div>

                                <div className="api-data-content">
                                  <div className="api-data-row">
                                    <div className="api-data-title-block">
                                      <p className="api-data-name">
                                        {fullName || "Unnamed member"}
                                      </p>
                                      <p
                                        className="api-data-key"
                                        title={formatMemberKeyLabel(item.pk, item.sk)}
                                      >
                                        <span className="api-data-key-full">
                                          {formatMemberKeyLabel(item.pk, item.sk)}
                                        </span>
                                        <span className="api-data-key-compact">
                                          {formatCompactMemberKey(item.sk)}
                                        </span>
                                      </p>
                                    </div>

                                  </div>

                                  <div className="api-data-meta">
                                    <span>{memberData.role || "No role"}</span>
                                    <span>{memberData.status || "No status"}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <p className="api-data-value">{item.data}</p>
                          )}
                        </article>
                      );
                    })}

                    {filteredCongregationItems.length === 0 ? (
                      <p className="congregation-empty-state">
                        No members match your search.
                      </p>
                    ) : null}
                  </div>

                </>
              ) : null}
            </div>
          ) : null}

          {activePage === "visitation" ? (
            <div className="visitation-board">
              {visitationFocus ? (
                <div className="visitation-focus-banner">
                  <div>
                    <p className="visitation-focus-label">Focused Member</p>
                    <p className="visitation-focus-name">{visitationFocus.memberName}</p>
                  </div>
                  <div className="visitation-focus-actions">
                    <button
                      type="button"
                      className="member-cancel-button member-back-button"
                      onClick={() => {
                        navigateToState({
                          activePage: "member-details",
                          selectedMember: {
                            pk: visitationFocus.pk,
                            sk: visitationFocus.sk,
                          },
                          visitationFocus,
                        });
                      }}
                      aria-label="Back to details"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      className="member-cancel-button"
                      onClick={() => setVisitationFocus(null)}
                    >
                      Show All
                    </button>
                  </div>
                </div>
              ) : null}

              {visitationItems.map((item) => {
                const memberData = parseMemberData(item.data);
                const fullName = getMemberName(memberData?.firstName, memberData?.lastName);
                const visits = memberData?.visitations ?? [];

                return (
                  <article className="visitation-card" key={`${item.pk}-${item.sk}`}>
                    <div className="visitation-card-top">
                      <div>
                        <p className="visitation-member-key">
                          {item.pk} / {item.sk}
                        </p>
                        <p className="visitation-member-name">
                          {fullName || "Unnamed member"}
                        </p>
                      </div>
                    </div>

                    <div className="visitation-actions">
                      <button
                        type="button"
                        className="visitation-action-button visitation-action-schedule"
                        onClick={() =>
                          openVisitationModal(
                            "schedule",
                            item.pk,
                            item.sk,
                            fullName || "Unnamed member",
                          )
                        }
                      >
                        <span>Schedule</span>
                      </button>
                    </div>

                    {visits.length > 0 ? (
                      <div className="visitation-summary">
                        {visits.map((visit, index) => (
                          <div className="visit-entry" key={visit.id}>
                            <div className="visit-entry-top">
                              <p className="visit-entry-label">Visit {visits.length - index}</p>
                              <p className="visit-entry-time">
                                {visit.scheduledAt
                                  ? new Date(visit.scheduledAt).toLocaleString()
                                  : "No schedule"}
                              </p>
                            </div>

                            <div className="visit-entry-meta">
                              <p className="visitation-summary-item">
                                Status: {visit.completedAt ? "Completed" : "Pending"}
                              </p>
                              <p className="visitation-summary-item">
                                Assigned priest: {visit.assignedPriestName || "Unassigned"}
                              </p>
                              <p className="visitation-summary-item">
                                Note: {visit.note || "No note yet"}
                              </p>
                            </div>

                            <div className="visit-entry-actions">
                              <button
                                type="button"
                                className="visitation-action-button visitation-action-schedule"
                                onClick={() =>
                                  openVisitationModal(
                                    "schedule",
                                    item.pk,
                                    item.sk,
                                    fullName || "Unnamed member",
                                    {
                                      visitationId: visit.id,
                                      schedule: visit.scheduledAt,
                                      assignedPriestSk: visit.assignedPriestSk,
                                      assignedPriestName: visit.assignedPriestName,
                                    },
                                  )
                                }
                              >
                                <span>Edit</span>
                              </button>

                              <button
                                type="button"
                                className={`visitation-action-button visitation-action-note${
                                  visit.note ? " active" : ""
                                }`}
                                onClick={() =>
                                  openVisitationModal(
                                    "note",
                                    item.pk,
                                    item.sk,
                                    fullName || "Unnamed member",
                                    {
                                      visitationId: visit.id,
                                      note: visit.note,
                                    },
                                  )
                                }
                              >
                                <span>{visit.note ? "Edit Note" : "Add Note"}</span>
                              </button>

                              <button
                                type="button"
                                className={`visitation-action-button visitation-action-complete${
                                  visit.completedAt ? " active" : ""
                                }`}
                                onClick={() =>
                                  openVisitationModal(
                                    "complete",
                                    item.pk,
                                    item.sk,
                                    fullName || "Unnamed member",
                                    {
                                      visitationId: visit.id,
                                    },
                                  )
                                }
                              >
                                <span>{visit.completedAt ? "Completed" : "Mark Done"}</span>
                              </button>

                              <button
                                type="button"
                                className="visitation-action-button visitation-action-delete"
                                onClick={() =>
                                  openVisitationModal(
                                    "delete",
                                    item.pk,
                                    item.sk,
                                    fullName || "Unnamed member",
                                    {
                                      visitationId: visit.id,
                                    },
                                  )
                                }
                              >
                                <span>Delete</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="visitation-empty">No visitations scheduled yet.</p>
                    )}
                  </article>
                );
              })}
            </div>
          ) : null}

          {activePage === "visitation-report" ? (
            <div className="visitation-report-board">
              <div className="visitation-report-toolbar">
                <label className="visitation-report-filter">
                  <span>Priest</span>
                  <select
                    value={visitationReportPriestFilter}
                    onChange={(event) => setVisitationReportPriestFilter(event.target.value)}
                  >
                    <option value="all">All priests</option>
                    {priestMembers.map((priest) => (
                      <option key={priest.sk} value={priest.sk}>
                        {priest.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="visitation-report-toggle">
                  <input
                    type="checkbox"
                    checked={showCompletedVisitationsInReport}
                    onChange={(event) =>
                      setShowCompletedVisitationsInReport(event.target.checked)
                    }
                  />
                  <span>Show completed</span>
                </label>
              </div>

              {filteredVisitationReportGroups.length > 0 ? (
                filteredVisitationReportGroups.map((group) => (
                  <section
                    className="visitation-report-group"
                    key={group.priestSk || group.priestName}
                  >
                    <div className="visitation-report-group-header">
                      <div>
                        <p className="visitation-report-group-label">Priest</p>
                        <h2 className="visitation-report-group-name">{group.priestName}</h2>
                      </div>
                      <p className="visitation-report-group-count">
                        {group.visits.length} scheduled
                      </p>
                    </div>

                    <div className="visitation-report-list">
                      {group.visits.map((visit) => (
                        <article
                          className={`visitation-report-item${
                            visit.completedAt ? " completed" : ""
                          }`}
                          key={`${group.priestSk || group.priestName}-${visit.memberSk}-${visit.scheduledAt}`}
                        >
                          <div className="visitation-report-item-top">
                            <div>
                              <p className="visitation-report-member-name">
                                {visit.memberName}
                              </p>
                              <p className="visitation-report-member-key">
                                {formatCompactMemberKey(visit.memberSk)}
                              </p>
                            </div>
                            <p className="visitation-report-time">
                              {new Date(visit.scheduledAt).toLocaleString()}
                            </p>
                          </div>

                          <div className="visitation-report-meta">
                            <p className="visitation-summary-item">
                              Status: {visit.completedAt ? "Completed" : "Pending"}
                            </p>
                            <p className="visitation-summary-item">
                              Note: {visit.note || "No note yet"}
                            </p>
                          </div>

                          <div className="visitation-report-actions">
                            <button
                              type="button"
                              className="visitation-action-button visitation-action-schedule"
                              onClick={() =>
                                openMemberVisitationPage(
                                  visit.memberPk,
                                  visit.memberSk,
                                  visit.memberName,
                                )
                              }
                            >
                              <span>Details</span>
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))
              ) : (
                <div className="visitation-report-empty">
                  <p className="member-detail-value">
                    {visitationReportPriestFilter === "all"
                      ? showCompletedVisitationsInReport
                        ? "No scheduled visitations are currently assigned to priests."
                        : "No pending scheduled visitations are currently assigned to priests."
                      : showCompletedVisitationsInReport
                        ? "No scheduled visitations were found for the selected priest."
                        : "No pending scheduled visitations were found for the selected priest."}
                  </p>
                </div>
              )}
            </div>
          ) : null}

          {activePage === "visitation-calendar" ? (
            <div className="visitation-calendar-board">
              <div className="visitation-calendar-toolbar">
                <div className="visitation-calendar-month-nav">
                  <button
                    type="button"
                    className="member-cancel-button visitation-calendar-nav-button"
                    onClick={() =>
                      setVisitationCalendarMonth(
                        (current) => new Date(current.getFullYear(), current.getMonth() - 1, 1),
                      )
                    }
                    aria-label="Previous month"
                  >
                    ←
                  </button>
                  <p className="visitation-calendar-month-label">
                    {visitationCalendarMonthLabel}
                  </p>
                  <button
                    type="button"
                    className="member-cancel-button visitation-calendar-nav-button"
                    onClick={() =>
                      setVisitationCalendarMonth(
                        (current) => new Date(current.getFullYear(), current.getMonth() + 1, 1),
                      )
                    }
                    aria-label="Next month"
                  >
                    →
                  </button>
                </div>

                <label className="visitation-report-filter">
                  <span>Priest</span>
                  <select
                    value={visitationCalendarPriestFilter}
                    onChange={(event) =>
                      setVisitationCalendarPriestFilter(event.target.value)
                    }
                  >
                    <option value="all">All priests</option>
                    {priestMembers.map((priest) => (
                      <option key={priest.sk} value={priest.sk}>
                        {priest.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="visitation-calendar-weekdays" aria-hidden="true">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayLabel) => (
                  <p key={dayLabel}>{dayLabel}</p>
                ))}
              </div>

              <div className="visitation-calendar-grid">
                {visitationCalendarDays.map((day) => {
                  const dayEvents = filteredVisitationCalendarEvents.filter((event) =>
                    isSameDay(event.scheduledDate, day),
                  );
                  const isOutsideMonth = day.getMonth() !== visitationCalendarMonth.getMonth();
                  const isToday = isSameDay(day, new Date());

                  return (
                    <article
                      key={day.toISOString()}
                      className={`visitation-calendar-day${
                        isOutsideMonth ? " outside-month" : ""
                      }${isToday ? " today" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => openCalendarDaySchedulePage(day)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openCalendarDaySchedulePage(day);
                        }
                      }}
                    >
                      <div className="visitation-calendar-day-header">
                        <p className="visitation-calendar-day-number">{day.getDate()}</p>
                        {dayEvents.length > 0 ? (
                          <p className="visitation-calendar-day-count">
                            {dayEvents.length}
                          </p>
                        ) : null}
                      </div>

                      <div className="visitation-calendar-events">
                        {dayEvents.length > 0 ? (
                          dayEvents.map((event) => (
                            <button
                              type="button"
                              className={`visitation-calendar-event${
                                event.completedAt ? " completed" : ""
                              }`}
                              key={event.id}
                              onClick={(clickEvent) => {
                                clickEvent.stopPropagation();
                                openMemberVisitationPage(
                                  event.memberPk,
                                  event.memberSk,
                                  event.memberName,
                                );
                              }}
                            >
                              <span className="visitation-calendar-event-time">
                                {event.scheduledDate.toLocaleTimeString(undefined, {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </span>
                              <span className="visitation-calendar-event-name">
                                {event.memberName}
                              </span>
                              <span className="visitation-calendar-event-priest">
                                {event.assignedPriestName}
                              </span>
                            </button>
                          ))
                        ) : (
                          <div className="visitation-calendar-empty-slot" />
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}

          {activePage === "visitation-calendar-schedule" ? (
            <div className="visitation-calendar-schedule-page">
              <form
                className="member-form-card visitation-calendar-schedule-card"
                onSubmit={handleCalendarScheduleSubmit}
              >
                <div className="member-form-header visitation-calendar-schedule-header">
                  <div>
                    <p className="member-form-mode">Schedule Visitation</p>
                    <p className="visitation-calendar-schedule-copy">
                      {calendarScheduleDateLabel
                        ? `Create a visitation for ${calendarScheduleDateLabel}.`
                        : "Choose a member and time for this visitation."}
                    </p>
                  </div>

                  <button
                    type="button"
                    className="member-cancel-button"
                    onClick={closeCalendarDaySchedulePage}
                  >
                    Back to Calendar
                  </button>
                </div>

                <div className="visitation-calendar-schedule-date-pill">
                  {calendarScheduleDateLabel || "Select a date from the calendar"}
                </div>

                <div className="member-form-grid visitation-calendar-schedule-grid">
                  <label className="member-field">
                    <span>Member</span>
                    <select
                      value={calendarScheduleMemberSk}
                      onChange={(event) => setCalendarScheduleMemberSk(event.target.value)}
                      required
                    >
                      <option value="">
                        {congregationMemberOptions.length > 0
                          ? "Select a member"
                          : "No members available"}
                      </option>
                      {congregationMemberOptions.map((member) => (
                        <option key={`${member.pk}-${member.sk}`} value={member.sk}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="member-field">
                    <span>Time</span>
                    <input
                      type="time"
                      value={calendarScheduleTime}
                      onChange={(event) => setCalendarScheduleTime(event.target.value)}
                      required
                    />
                  </label>

                  <label className="member-field member-field-full">
                    <span>Assign priest</span>
                    <select
                      value={calendarScheduleAssignedPriestSk}
                      onChange={(event) =>
                        setCalendarScheduleAssignedPriestSk(event.target.value)
                      }
                    >
                      <option value="">Leave unassigned</option>
                      {priestMembers.map((priest) => (
                        <option key={priest.sk} value={priest.sk}>
                          {priest.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="member-form-actions">
                  <p className="member-submit-message">{calendarScheduleSubmitState}</p>
                  <button
                    type="button"
                    className="member-cancel-button"
                    onClick={() => {
                      setCalendarScheduleMemberSk("");
                      setCalendarScheduleTime("09:00");
                      setCalendarScheduleAssignedPriestSk("");
                      setCalendarScheduleSubmitState(null);
                    }}
                  >
                    Clear
                  </button>
                  <button
                    type="submit"
                    className="member-submit-button"
                    disabled={
                      isCalendarScheduleSubmitting ||
                      !calendarScheduleDate ||
                      !selectedCalendarScheduleMember
                    }
                  >
                    {isCalendarScheduleSubmitting
                      ? "Scheduling..."
                      : "Schedule Visitation"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {activePage === "new-member" ? (
            <form className="member-form-card" onSubmit={handleMemberSubmit}>
              <div className="member-form-header">
                <p className="member-form-mode">
                  {isEditingMember ? "Edit" : "Add Member"}
                </p>
              </div>

              <div className="member-form-grid">
                <label className="member-field">
                  <span>First name</span>
                  <input
                    type="text"
                    placeholder="John"
                    value={memberForm.firstName}
                    onChange={(event) =>
                      updateMemberForm("firstName", event.target.value)
                    }
                  />
                </label>

                <label className="member-field">
                  <span>Last name</span>
                  <input
                    type="text"
                    placeholder="Smith"
                    value={memberForm.lastName}
                    onChange={(event) =>
                      updateMemberForm("lastName", event.target.value)
                    }
                  />
                </label>

                <label className="member-field">
                  <span>Email</span>
                  <input
                    type="email"
                    placeholder="john@example.com"
                    value={memberForm.email}
                    onChange={(event) =>
                      updateMemberForm("email", event.target.value)
                    }
                  />
                </label>

                <label className="member-field">
                  <span>Phone</span>
                  <input
                    type="tel"
                    placeholder="+1 (555) 555-5555"
                    value={memberForm.phone}
                    onChange={(event) =>
                      updateMemberForm("phone", event.target.value)
                    }
                  />
                </label>

                <div className="member-field member-field-full">
                  <span>Photo</span>
                  <input
                    ref={memberPhotoInputRef}
                    className="member-photo-input"
                    type="file"
                    accept="image/*"
                    onChange={handleMemberPhotoChange}
                  />
                  <div className="member-photo-picker">
                    <button
                      type="button"
                      className="member-photo-picker-button"
                      onClick={() => memberPhotoInputRef.current?.click()}
                    >
                      Choose Photo
                    </button>
                    <p
                      className={`member-photo-picker-name${
                        memberForm.photo ? "" : " empty"
                      }`}
                    >
                      {memberForm.photo ? "Photo selected" : "No photo selected"}
                    </p>
                  </div>
                  {memberForm.photo ? (
                    <div className="member-photo-preview">
                      <img
                        src={memberForm.photo}
                        alt="Member preview"
                        className="member-photo-preview-image"
                      />
                      <button
                        type="button"
                        className="member-photo-remove-button"
                        onClick={clearMemberPhoto}
                      >
                        Remove Photo
                      </button>
                    </div>
                  ) : null}
                  <p className="member-photo-hint">
                    Upload a headshot or profile photo. Large images are resized automatically.
                  </p>
                  {memberPhotoStatus ? (
                    <p className="member-photo-status">{memberPhotoStatus}</p>
                  ) : null}
                </div>

                <label className="member-field">
                  <span>Role</span>
                  <select
                    value={memberForm.role}
                    onChange={(event) => updateMemberForm("role", event.target.value)}
                  >
                    <option value="" disabled>
                      Select a role
                    </option>
                    {isAdminUser || memberForm.role === "Priest" ? (
                      <option>Priest</option>
                    ) : null}
                    <option>Member</option>
                    <option>parking-admin</option>
                    <option>Servant</option>
                    <option>Visitor</option>
                    <option>Sector coordinator</option>
                    <option>Contractor</option>
                    <option>Student</option>
                  </select>
                </label>

                <label className="member-field">
                  <span>Status</span>
                  <select
                    value={memberForm.status}
                    onChange={(event) =>
                      updateMemberForm("status", event.target.value)
                    }
                  >
                    <option value="" disabled>
                      Select a status
                    </option>
                    <option>Active</option>
                    <option>Needs Follow-up</option>
                    <option>Inactive</option>
                  </select>
                </label>

                <label className="member-field member-field-full">
                  <span>Address</span>
                  <input
                    type="text"
                    placeholder="123 Main Street"
                    value={memberForm.address}
                    onChange={(event) =>
                      updateMemberForm("address", event.target.value)
                    }
                  />
                </label>

                <label className="member-field member-field-full">
                  <span>Notes</span>
                  <textarea
                    rows={4}
                    placeholder="Assignment notes, visitation reminders, or special circumstances"
                    value={memberForm.notes}
                    onChange={(event) =>
                      updateMemberForm("notes", event.target.value)
                    }
                  />
                </label>
              </div>

              <div className="member-form-actions">
                {memberSubmitState ? (
                  <p className="member-submit-message">{memberSubmitState}</p>
                ) : null}
                <button
                  type="button"
                  className="member-cancel-button"
                  onClick={handleCancelMemberForm}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="member-submit-button"
                  disabled={isMemberSubmitting}
                >
                  {isMemberSubmitting
                    ? isEditingMember
                      ? "Updating..."
                      : "Saving..."
                    : isEditingMember
                      ? "Update Member"
                      : "Save Member"}
                </button>
              </div>
            </form>
          ) : null}

          {activePage === "announcement-week" ? (
            <div className="announcements-editor-page">
              <form className="announcements-editor-card" onSubmit={handleAnnouncementWeekSubmit}>
                <div className="member-form-header">
                  <p className="member-form-mode">
                    {announcementWeekForm.sk ? "Edit Week" : "Add Week"}
                  </p>
                </div>

                <div className="member-form-grid">
                  <label className="member-field member-field-full">
                    <span>Week</span>
                    <input
                      type="week"
                      value={announcementWeekForm.weekLabel}
                      onChange={(event) =>
                        updateAnnouncementWeekField("weekLabel", event.target.value)
                      }
                    />
                  </label>

                  <div className="member-field member-field-full">
                    <span>Announcements</span>
                    <div className="announcement-items-list">
                      {announcementWeekForm.items.map((item, index) => (
                        <div className="announcement-item-row" key={index}>
                          <input
                            type="text"
                            placeholder={`Announcement ${index + 1}`}
                            value={item}
                            onChange={(event) =>
                              updateAnnouncementItem(index, event.target.value)
                            }
                          />
                          <button
                            type="button"
                            className="announcement-remove-button"
                            onClick={() =>
                              openAnnouncementItemDeleteModal(
                                index,
                                item || `Announcement ${index + 1}`,
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="announcement-add-button"
                      onClick={addAnnouncementItem}
                    >
                      Add Item
                    </button>
                  </div>
                </div>

                <div className="member-form-actions">
                  {announcementSubmitState ? (
                    <p className="member-submit-message">{announcementSubmitState}</p>
                  ) : null}
                  <button
                    type="button"
                    className="member-cancel-button"
                    onClick={() => {
                      setAnnouncementSubmitState(null);
                      setActivePage("announcements");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="member-submit-button"
                    disabled={isAnnouncementSubmitting}
                  >
                    {isAnnouncementSubmitting
                      ? "Saving..."
                      : announcementWeekForm.sk
                        ? "Update Week"
                        : "Create Week"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {activePage === "announcements" ? (
            <div className="announcements-page">
              <div className="announcements-list-card">
                <div className="announcement-list-toolbar">
                  <p className="api-message-label">Weekly Announcements</p>
                  <div className="announcement-list-toolbar-actions">
                    <label className="announcement-sort-control">
                      <span>Sort by date</span>
                      <select
                        value={announcementSortOrder}
                        onChange={(event) =>
                          setAnnouncementSortOrder(
                            event.target.value as AnnouncementSortOrder,
                          )
                        }
                      >
                        <option value="latest">Latest first</option>
                        <option value="oldest">Oldest first</option>
                      </select>
                    </label>
                    {canManageAnnouncements ? (
                      <button
                        type="button"
                        className="announcement-toolbar-button"
                        onClick={startCreateAnnouncementWeek}
                      >
                        Add Week
                      </button>
                    ) : null}
                  </div>
                </div>
                {isAnnouncementsLoading ? (
                  <p className="api-message-text">Loading announcement weeks...</p>
                ) : announcementsError ? (
                  <p className="api-message-text">{announcementsError}</p>
                ) : announcementWeeks.length === 0 ? (
                  <p className="api-message-text">No announcement weeks yet.</p>
                ) : (
                  <div className="announcement-weeks-list">
                    {announcementWeeks.map((week) => (
                      <article
                        className={`announcement-week-card${
                          week.parsed?.weekLabel === currentAnnouncementWeekLabel
                            ? " current"
                            : ""
                        }`}
                        key={week.sk}
                      >
                        <div className="announcement-week-header">
                          <div>
                            <p className="announcement-week-title">
                              {formatAnnouncementWeekLabel(week.parsed?.weekLabel)}
                            </p>
                            <p className="announcement-week-meta">{week.sk}</p>
                          </div>
                          {canManageAnnouncements ? (
                            <div className="announcement-week-actions">
                              <button
                                type="button"
                                className="announcement-edit-button"
                                onClick={() =>
                                  startEditAnnouncementWeek(week.sk, week.parsed)
                                }
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="api-delete-button"
                                onClick={() =>
                                  openAnnouncementDeleteModal(
                                    week.sk,
                                    formatAnnouncementWeekLabel(week.parsed?.weekLabel),
                                  )
                                }
                                disabled={deletingAnnouncementSk === week.sk}
                              >
                                {deletingAnnouncementSk === week.sk ? "..." : "Delete"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <ul className="announcement-week-items">
                          {(week.parsed?.items ?? []).map((item, index) => (
                            <li key={`${week.sk}-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {activePage === "user-access" ? (
            <div className="user-access-page">
              <div className="user-access-card">
                <div className="user-access-header">
                  <p className="api-message-label">Assign User Groups</p>
                  <p className="congregation-search-count">
                    {userDirectory.length} user{userDirectory.length === 1 ? "" : "s"}
                  </p>
                </div>

                {userDirectoryStatus ? (
                  <p className="member-submit-message">{userDirectoryStatus}</p>
                ) : null}

                {isUserDirectoryLoading ? (
                  <p className="api-message-text">Loading users...</p>
                ) : userDirectoryError ? (
                  <p className="api-message-text">{userDirectoryError}</p>
                ) : userDirectory.length === 0 ? (
                  <p className="api-message-text">No Cognito users found.</p>
                ) : (
                  <div className="user-access-list">
                    {userDirectory.map((user) => {
                      const assignedGroups = groupAssignments[user.username] ?? user.groups;

                      return (
                        <article className="user-access-item" key={user.username}>
                          <div className="user-access-top">
                            <div>
                              <p className="user-access-username">{user.username}</p>
                              <p className="user-access-meta">
                                {user.email || "No email"} · {user.status} ·{" "}
                                {user.enabled ? "Enabled" : "Disabled"}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="member-submit-button"
                              onClick={() => handleSaveUserGroups(user.username)}
                              disabled={savingUserGroups === user.username}
                            >
                              {savingUserGroups === user.username ? "Saving..." : "Save"}
                            </button>
                          </div>

                          <div className="user-access-groups">
                            {manageableGroups.map((groupName) => (
                              <label className="user-access-group" key={groupName}>
                                <input
                                  type="checkbox"
                                  checked={assignedGroups.includes(groupName)}
                                  onChange={() =>
                                    toggleUserGroupAssignment(user.username, groupName)
                                  }
                                />
                                <span>{groupLabelMap[groupName]}</span>
                              </label>
                            ))}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {activePage === "contacts-import" ? (
            <div className="contacts-import-page">
              <form
                className="member-form-card contacts-import-card"
                onSubmit={handleContactsImportSubmit}
              >
                <div className="member-form-header">
                  <p className="member-form-mode">Import Members from Contacts</p>
                </div>

                <div className="member-form-grid">
                  <label className="member-field member-field-full">
                    <span>VCF file</span>
                    <input
                      ref={contactsImportInputRef}
                      className="contacts-import-file-input"
                      type="file"
                      accept=".vcf,text/vcard"
                      onChange={(event) => {
                        const nextFile = event.target.files?.[0] ?? null;
                        setContactsImportFile(nextFile);
                        setContactsImportStatus(null);
                        setContactsImportSummary(null);
                      }}
                    />
                    <div className="contacts-import-picker">
                      <button
                        type="button"
                        className="contacts-import-picker-button"
                        onClick={() => contactsImportInputRef.current?.click()}
                      >
                        Choose File
                      </button>
                      <span
                        className={`contacts-import-picker-name${
                          contactsImportFile ? "" : " empty"
                        }`}
                      >
                        {contactsImportFile ? contactsImportFile.name : "No file selected"}
                      </span>
                    </div>
                    <p className="contacts-import-hint">
                      Upload a <code>.vcf</code> file. Members with the same email,
                      phone, or exact name are skipped.
                    </p>
                  </label>
                </div>

                {contactsImportStatus ? (
                  <p className="member-submit-message">{contactsImportStatus}</p>
                ) : null}

                {contactsImportSummary ? (
                  <div className="contacts-import-summary">
                    <div className="contacts-import-stats">
                      <div className="contacts-import-stat">
                        <p className="contacts-import-stat-label">Processed</p>
                        <p className="contacts-import-stat-value">
                          {contactsImportSummary.processedCount}
                        </p>
                      </div>
                      <div className="contacts-import-stat">
                        <p className="contacts-import-stat-label">Imported</p>
                        <p className="contacts-import-stat-value">
                          {contactsImportSummary.importedCount}
                        </p>
                      </div>
                      <div className="contacts-import-stat">
                        <p className="contacts-import-stat-label">Skipped</p>
                        <p className="contacts-import-stat-value">
                          {contactsImportSummary.skippedCount}
                        </p>
                      </div>
                    </div>

                    <div className="contacts-import-lists">
                      <div className="contacts-import-list-block">
                        <p className="contacts-import-list-title">Imported members</p>
                        {contactsImportSummary.importedMembers.length > 0 ? (
                          <ul>
                            {contactsImportSummary.importedMembers.map((memberName) => (
                              <li key={`imported-${memberName}`}>{memberName}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="contacts-import-empty">
                            No new members were imported.
                          </p>
                        )}
                      </div>

                      <div className="contacts-import-list-block">
                        <p className="contacts-import-list-title">Skipped members</p>
                        {contactsImportSummary.skippedMembers.length > 0 ? (
                          <ul>
                            {contactsImportSummary.skippedMembers.map((memberName) => (
                              <li key={`skipped-${memberName}`}>{memberName}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="contacts-import-empty">
                            No duplicates were found.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="member-form-actions">
                  <button
                    type="button"
                    className="member-cancel-button"
                    onClick={() => {
                      setContactsImportFile(null);
                      setContactsImportStatus(null);
                      setContactsImportSummary(null);
                      if (contactsImportInputRef.current) {
                        contactsImportInputRef.current.value = "";
                      }
                    }}
                  >
                    Clear
                  </button>
                  <button
                    type="submit"
                    className="member-submit-button"
                    disabled={isContactsImporting}
                  >
                    {isContactsImporting ? "Importing..." : "Import Contacts"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {activePage === "parking-registration" ? renderParkingRegistrationPage({}) : null}

          {activePage === "parking-management" ? (
            <div className="parking-management-page">
              <form
                className="member-form-card parking-management-card"
                onSubmit={handleParkingManagementSubmit}
              >
                <div className="member-form-header">
                  <p className="member-form-mode">Parking Capacity</p>
                  <p className="parking-management-summary">
                    {(parkingManagement?.activeRegistrationCount ?? 0).toLocaleString()} active
                    placement
                    {(parkingManagement?.activeRegistrationCount ?? 0) === 1 ? "" : "s"} /{" "}
                    {(parkingManagement?.maxSpots ?? 0).toLocaleString()} available spots
                  </p>
                  {parkingManagement ? (
                    <p className="parking-management-meta">
                      Waiting list: {parkingManagement.waitingListCount}
                    </p>
                  ) : null}
                </div>

                <div className="member-form-grid parking-management-grid">
                  <label className="member-field">
                    <span>Max parking spots</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={parkingMaxSpotsInput}
                      onChange={(event) => setParkingMaxSpotsInput(event.target.value)}
                      placeholder="Enter total available spots"
                    />
                  </label>
                </div>

                {parkingManagementError ? (
                  <p className="member-submit-message">{parkingManagementError}</p>
                ) : null}
                {parkingManagementStatus ? (
                  <p className="member-submit-message">{parkingManagementStatus}</p>
                ) : null}

                <div className="member-form-actions">
                  <button
                    type="button"
                    className="member-cancel-button"
                    onClick={() =>
                      setParkingMaxSpotsInput(String(parkingManagement?.maxSpots ?? 0))
                    }
                  >
                    Reset
                  </button>
                  <button
                    type="submit"
                    className="member-submit-button"
                    disabled={isParkingManagementSaving || isParkingManagementLoading}
                  >
                    {isParkingManagementSaving ? "Saving..." : "Update Spots"}
                  </button>
                </div>
              </form>

              <div className="member-form-card parking-list-card">
                <div className="member-form-header parking-list-header">
                  <div>
                    <p className="member-form-mode">Parking Registrations</p>
                    <p className="parking-list-summary">
                      {parkingTab === "assigned"
                        ? `${assignedParkingRegistrations.length} active registration${assignedParkingRegistrations.length === 1 ? "" : "s"}`
                        : `${waitingListRegistrations.length} waiting list registration${waitingListRegistrations.length === 1 ? "" : "s"}, sorted by earliest registration`}
                    </p>
                  </div>
                  <div className="parking-tabs" role="tablist" aria-label="Parking registration tabs">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={parkingTab === "assigned"}
                      className={`parking-tab${parkingTab === "assigned" ? " active" : ""}`}
                      onClick={() => setParkingTab("assigned")}
                    >
                      Active
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={parkingTab === "waiting-list"}
                      className={`parking-tab${parkingTab === "waiting-list" ? " active" : ""}`}
                      onClick={() => setParkingTab("waiting-list")}
                    >
                      Waiting List
                    </button>
                  </div>
                </div>

                {parkingRegistrationsError ? (
                  <p className="member-submit-message">{parkingRegistrationsError}</p>
                ) : null}

                {parkingTab === "assigned"
                  ? renderParkingRegistrationsTable(assignedParkingRegistrations)
                  : renderParkingRegistrationsTable(waitingListRegistrations)}

                {(parkingTab === "assigned"
                  ? assignedParkingRegistrations.length === 0
                  : waitingListRegistrations.length === 0) ? (
                  <p className="api-message-text">
                    {parkingTab === "assigned"
                      ? "No active parking registrations."
                      : "No waiting list registrations."}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {activePage === "calendar-dashboard" ? (
            <div className="calendar-schedule-layout">
              <section className="placeholder-page-card calendar-dashboard-card">
                <div className="calendar-schedule-header">
                  <div>
                    <p className="placeholder-page-kicker">Google Calendar</p>
                    <h3 className="calendar-connect-title">Dashboard</h3>
                  </div>

                  <div className="calendar-dashboard-actions">
                    <p className="calendar-month-load-badge neutral calendar-dashboard-sync-badge">
                      {formatLastSyncLabel(calendarDashboardLastSyncAt)}
                    </p>
                    <button
                      type="button"
                      className="member-submit-button"
                      onClick={() => {
                        void loadCalendarDashboardSummary();
                      }}
                      disabled={isCalendarDashboardLoading}
                    >
                      {isCalendarDashboardLoading ? "Refreshing..." : "Refresh Dashboard"}
                    </button>
                  </div>
                </div>

                {!googleCalendarConnection?.connected ? (
                  <div className="calendar-schedule-empty">
                    <p className="placeholder-page-copy">
                      Connect Google Calendar first from{" "}
                      <code>Calendar -&gt; Connect Calendar</code> before using the
                      dashboard.
                    </p>
                  </div>
                ) : (
                  <>
                    {calendarDashboardStatus ? (
                      <p className="member-submit-message calendar-schedule-status">
                        {calendarDashboardStatus}
                      </p>
                    ) : null}

                    <div className="calendar-dashboard-grid">
                      <article className="calendar-dashboard-metric">
                        <p className="calendar-dashboard-metric-label">Meetings today</p>
                        <div className="calendar-dashboard-metric-values">
                          <div>
                            <p className="calendar-dashboard-metric-caption">Total</p>
                            <p className="calendar-dashboard-metric-value">
                              {calendarDashboardSummary?.day.total ?? 0}
                            </p>
                          </div>
                          <div>
                            <p className="calendar-dashboard-metric-caption">Upcoming</p>
                            <p className="calendar-dashboard-metric-value">
                              {calendarDashboardSummary?.day.upcoming ?? 0}
                            </p>
                          </div>
                        </div>
                      </article>

                      <article className="calendar-dashboard-metric">
                        <p className="calendar-dashboard-metric-label">Meetings this week</p>
                        <div className="calendar-dashboard-metric-values">
                          <div>
                            <p className="calendar-dashboard-metric-caption">Total</p>
                            <p className="calendar-dashboard-metric-value">
                              {calendarDashboardSummary?.week.total ?? 0}
                            </p>
                          </div>
                          <div>
                            <p className="calendar-dashboard-metric-caption">Upcoming</p>
                            <p className="calendar-dashboard-metric-value">
                              {calendarDashboardSummary?.week.upcoming ?? 0}
                            </p>
                          </div>
                        </div>
                      </article>

                      <article className="calendar-dashboard-metric">
                        <p className="calendar-dashboard-metric-label">Meetings this month</p>
                        <div className="calendar-dashboard-metric-values">
                          <div>
                            <p className="calendar-dashboard-metric-caption">Total</p>
                            <p className="calendar-dashboard-metric-value">
                              {calendarDashboardSummary?.month.total ?? 0}
                            </p>
                          </div>
                          <div>
                            <p className="calendar-dashboard-metric-caption">Upcoming</p>
                            <p className="calendar-dashboard-metric-value">
                              {calendarDashboardSummary?.month.upcoming ?? 0}
                            </p>
                          </div>
                        </div>
                      </article>
                    </div>

                    <div className="calendar-dashboard-upcoming">
                      <div className="calendar-schedule-section-header">
                        <p className="placeholder-page-kicker">Upcoming</p>
                        <h4 className="calendar-schedule-section-title">Next Events</h4>
                      </div>

                      {(calendarDashboardSummary?.upcomingEvents.length ?? 0) > 0 ? (
                        <div className="calendar-dashboard-list">
                          {calendarDashboardSummary!.upcomingEvents.map((eventItem) => (
                            <article
                              key={`${eventItem.calendarId || "calendar"}-${eventItem.id}-${eventItem.start}`}
                              className="calendar-dashboard-event"
                            >
                              <div className="calendar-dashboard-event-date">
                                <p className="calendar-dashboard-event-month">
                                  {parseCalendarEventDateValue(
                                    eventItem.start,
                                    eventItem.isAllDay,
                                  ).toLocaleDateString(undefined, {
                                    month: "short",
                                  })}
                                </p>
                                <p className="calendar-dashboard-event-day-number">
                                  {parseCalendarEventDateValue(
                                    eventItem.start,
                                    eventItem.isAllDay,
                                  ).toLocaleDateString(undefined, {
                                    day: "numeric",
                                  })}
                                </p>
                              </div>
                              <div className="calendar-dashboard-event-details">
                                <div className="calendar-dashboard-event-meta">
                                  <p className="calendar-dashboard-event-time">
                                    {eventItem.isAllDay
                                      ? "All day"
                                      : formatEventDateTimeLabel(
                                          eventItem.start,
                                          eventItem.end,
                                          false,
                                        )}
                                  </p>
                                  <p className="calendar-dashboard-event-calendar">
                                    {eventItem.calendarName || "Primary Calendar"}
                                  </p>
                                </div>
                                <p className="calendar-dashboard-event-title">
                                  {eventItem.title || "Untitled event"}
                                </p>
                                {eventItem.congregationItems?.length ? (
                                  <p className="calendar-dashboard-event-congregation">
                                    {eventItem.congregationItems
                                      .map((item) => formatCongregationDirectoryItemLabel(item))
                                      .join(", ")}
                                  </p>
                                ) : null}
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="calendar-schedule-empty">
                          <p className="placeholder-page-copy">
                            No upcoming events were found.
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>
            </div>
          ) : null}

          {activePage === "calendar-connect" ? (
            <div className="calendar-connect-layout">
              <section className="placeholder-page-card calendar-connect-card">
                <div className="calendar-connect-header">
                  <div>
                    <p className="placeholder-page-kicker">Google Calendar</p>
                    <h3 className="calendar-connect-title">Connection</h3>
                    <p className="placeholder-page-copy calendar-connect-copy">
                      Connect a Google account so Shepherd Hub can keep Calendar access on
                      the server and refresh tokens automatically when needed.
                    </p>
                  </div>

                  <button
                    type="button"
                    className="member-submit-button"
                    onClick={handleGoogleCalendarConnect}
                    disabled={isGoogleCalendarConnecting}
                  >
                    {isGoogleCalendarConnecting
                      ? "Redirecting..."
                      : googleCalendarConnection?.connected
                        ? "Reconnect Google Calendar"
                        : "Connect Google Calendar"}
                  </button>
                </div>

                {googleCalendarStatus ? (
                  <p
                    className={`member-submit-message calendar-connect-status ${googleCalendarStatusTone}`}
                  >
                    {googleCalendarStatus}
                  </p>
                ) : null}

                <div className="calendar-connect-grid">
                  <div className="calendar-connect-metric">
                    <span>Status</span>
                    <strong>
                      {isGoogleCalendarLoading
                        ? "Loading..."
                        : googleCalendarConnection?.connected
                          ? "Connected"
                          : "Not connected"}
                    </strong>
                  </div>

                  <div className="calendar-connect-metric">
                    <span>Refresh token</span>
                    <strong>
                      {googleCalendarConnection?.hasRefreshToken ? "Stored" : "Not stored"}
                    </strong>
                  </div>

                  <div className="calendar-connect-metric">
                    <span>Access token expiry</span>
                    <strong>
                      {googleCalendarConnection?.accessTokenExpiresAt
                        ? new Date(
                            googleCalendarConnection.accessTokenExpiresAt,
                          ).toLocaleString()
                        : "Not available"}
                    </strong>
                  </div>

                  <div className="calendar-connect-metric">
                    <span>Last refresh</span>
                    <strong>
                      {googleCalendarConnection?.lastRefreshAt
                        ? new Date(googleCalendarConnection.lastRefreshAt).toLocaleString()
                        : "Not yet"}
                    </strong>
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {activePage === "calendar-schedule" ? (
            <div className="calendar-schedule-layout">
              <section className="placeholder-page-card calendar-schedule-card">
                <form
                  className="calendar-schedule-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void loadGoogleCalendarAvailability();
                  }}
                >
                  <div className="calendar-schedule-header">
                    <div>
                      <p className="placeholder-page-kicker">Google Calendar</p>
                      <h3 className="calendar-connect-title">Busy and Free Times</h3>
                      <p className="placeholder-page-copy calendar-connect-copy">
                        Pull live availability from the connected Google Calendar and use
                        it to see open schedule windows before you book anything else.
                      </p>
                    </div>

                    <button
                      type="submit"
                      className="member-submit-button"
                      disabled={isCalendarAvailabilityLoading}
                    >
                      {isCalendarAvailabilityLoading ? "Loading..." : "Refresh Availability"}
                    </button>
                  </div>

                  <div className="calendar-schedule-controls">
                    <label className="member-field">
                      <span>Calendar</span>
                      <select
                        value={selectedGoogleCalendarId}
                        onChange={(event) => setSelectedGoogleCalendarId(event.target.value)}
                        disabled={googleCalendars.length === 0}
                      >
                        {googleCalendars.length > 0 ? (
                          googleCalendars.map((calendar) => (
                            <option key={calendar.id} value={calendar.id}>
                              {calendar.name}
                              {calendar.primary ? " (Primary)" : ""}
                            </option>
                          ))
                        ) : (
                          <option value="primary">Primary Calendar</option>
                        )}
                      </select>
                    </label>

                    <label className="member-field">
                      <span>Date</span>
                      <input
                        type="date"
                        value={calendarScheduleLookupDate}
                        onChange={(event) =>
                          setCalendarScheduleLookupDate(event.target.value)
                        }
                      />
                    </label>

                    <label className="member-field">
                      <span>From</span>
                      <input
                        type="time"
                        value={calendarScheduleLookupStartTime}
                        onChange={(event) =>
                          setCalendarScheduleLookupStartTime(event.target.value)
                        }
                      />
                    </label>

                    <label className="member-field">
                      <span>To</span>
                      <input
                        type="time"
                        value={calendarScheduleLookupEndTime}
                        onChange={(event) =>
                          setCalendarScheduleLookupEndTime(event.target.value)
                        }
                      />
                    </label>
                  </div>
                </form>

                {calendarAvailabilityStatus ? (
                  <p className="member-submit-message calendar-schedule-status">
                    {calendarAvailabilityStatus}
                  </p>
                ) : null}

                {!googleCalendarConnection?.connected ? (
                  <div className="calendar-schedule-empty">
                    <p className="placeholder-page-copy">
                      Connect Google Calendar first from{" "}
                      <code>Calendar -&gt; Connect Calendar</code> before pulling live
                      availability.
                    </p>
                  </div>
                ) : null}

                {googleCalendarConnection?.connected ? (
                  <div className="calendar-schedule-results">
                    <div className="calendar-schedule-summary-card">
                      <p className="placeholder-page-kicker">Schedule Window</p>
                      <h4 className="calendar-schedule-section-title">
                        {new Date(`${calendarScheduleLookupDate}T00:00`).toLocaleDateString(
                          undefined,
                          {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          },
                        )}
                      </h4>
                      <p className="calendar-schedule-summary-copy">
                        Calendar:{" "}
                        {googleCalendars.find((calendar) => calendar.id === selectedGoogleCalendarId)
                          ?.name ?? "Primary Calendar"}
                      </p>
                      <p className="calendar-schedule-summary-copy">
                        Looking from {calendarScheduleLookupStartTime} to{" "}
                        {calendarScheduleLookupEndTime}
                      </p>
                    </div>

                    <div className="calendar-schedule-column">
                      <div className="calendar-schedule-section-header">
                        <p className="placeholder-page-kicker">Available</p>
                        <h4 className="calendar-schedule-section-title">
                          {calendarAvailabilityFreeSlots.length} free time
                          {calendarAvailabilityFreeSlots.length === 1 ? "" : "s"}
                        </h4>
                      </div>

                      {calendarAvailabilityFreeSlots.length > 0 ? (
                        <div className="calendar-schedule-slot-list">
                          {calendarAvailabilityFreeSlots.map((slot) => (
                            <article
                              className="calendar-schedule-slot free"
                              key={`free-${slot.start}-${slot.end}`}
                            >
                              <p className="calendar-schedule-slot-time">
                                {formatTimeLabel(slot.start)} to {formatTimeLabel(slot.end)}
                              </p>
                              <p className="calendar-schedule-slot-copy">
                                Free for {formatDurationLabel(slot.start, slot.end)}
                              </p>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="placeholder-page-copy">
                          No open time was found in this window.
                        </p>
                      )}
                    </div>

                    <div className="calendar-schedule-column">
                      <div className="calendar-schedule-section-header">
                        <p className="placeholder-page-kicker">Busy</p>
                        <h4 className="calendar-schedule-section-title">
                          {calendarAvailability?.busy.length ?? 0} busy time
                          {(calendarAvailability?.busy.length ?? 0) === 1 ? "" : "s"}
                        </h4>
                      </div>

                      {(calendarAvailability?.busy.length ?? 0) > 0 ? (
                        <div className="calendar-schedule-slot-list">
                          {calendarAvailability?.busy.map((slot) => (
                            <article
                              className="calendar-schedule-slot busy"
                              key={`busy-${slot.start}-${slot.end}`}
                            >
                              <p className="calendar-schedule-slot-time">
                                {formatTimeLabel(slot.start)} to {formatTimeLabel(slot.end)}
                              </p>
                              <p className="calendar-schedule-slot-copy">
                                Busy for {formatDurationLabel(slot.start, slot.end)}
                              </p>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="placeholder-page-copy">
                          No busy events were returned for this window.
                        </p>
                      )}
                    </div>

                    <div className="calendar-schedule-column">
                      <div className="calendar-schedule-section-header">
                        <p className="placeholder-page-kicker">Events</p>
                        <h4 className="calendar-schedule-section-title">
                          {calendarEvents?.items.length ?? 0} actual event
                          {(calendarEvents?.items.length ?? 0) === 1 ? "" : "s"}
                        </h4>
                      </div>

                      {(calendarEvents?.items.length ?? 0) > 0 ? (
                        <div className="calendar-schedule-slot-list">
                          {calendarEvents?.items.map((eventItem) => (
                            <article
                              className="calendar-schedule-slot event"
                              key={`event-${eventItem.id}`}
                            >
                              <p className="calendar-schedule-slot-time">{eventItem.title}</p>
                              <p className="calendar-schedule-slot-copy">
                                {formatEventDateTimeLabel(
                                  eventItem.start,
                                  eventItem.end,
                                  eventItem.isAllDay,
                                )}
                              </p>
                              {eventItem.organizer ? (
                                <p className="calendar-schedule-slot-meta">
                                  Organizer: {eventItem.organizer}
                                </p>
                              ) : null}
                              {eventItem.location ? (
                                <p className="calendar-schedule-slot-meta">
                                  Location: {eventItem.location}
                                </p>
                              ) : null}
                              <p className="calendar-schedule-slot-meta">
                                Type: {eventItem.eventType}
                              </p>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="placeholder-page-copy">
                          No actual events were returned for this window.
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}

          {activePage === "calendar-month" ? (
            <div className="calendar-month-layout">
              <section className="placeholder-page-card calendar-month-card">
                <div className="calendar-schedule-header">
                  <div>
                    <p className="placeholder-page-kicker">Google Calendar</p>
                    <h3 className="calendar-connect-title">Schedule</h3>
                  </div>
                </div>

                {!googleCalendarConnection?.connected ? (
                  <div className="calendar-schedule-empty">
                    <p className="placeholder-page-copy">
                      Connect Google Calendar first from{" "}
                      <code>Calendar -&gt; Connect Calendar</code> before using month
                      schedule booking.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="calendar-month-toolbar">
                      <label className="member-field">
                        <span className="calendar-month-picker-label">
                          <span>New event calendar</span>
                          {calendarMonthLoadBadge ? (
                            <span
                              className={`calendar-month-load-badge ${calendarMonthLoadBadge.tone}`}
                              role="status"
                            >
                              {calendarMonthLoadBadge.label}
                            </span>
                          ) : null}
                        </span>
                        <select
                          value={selectedGoogleCalendarId}
                          onChange={(event) => setSelectedGoogleCalendarId(event.target.value)}
                          disabled={googleCalendars.length === 0}
                        >
                          {googleCalendars.length > 0 ? (
                            googleCalendars.map((calendar) => (
                              <option key={calendar.id} value={calendar.id}>
                                {calendar.calendarColorEmoji ? `${calendar.calendarColorEmoji} ` : ""}
                                {calendar.name}
                                {calendar.primary ? " (Primary)" : ""}
                              </option>
                            ))
                          ) : (
                            <option value="primary">🔵 Primary Calendar</option>
                          )}
                        </select>
                      </label>

                      <div
                        className="calendar-schedule-view-switcher"
                        role="tablist"
                        aria-label="Schedule view"
                      >
                        {([
                          ["day", "Day"],
                          ["week", "Week"],
                          ["month", "Month"],
                        ] as const).map(([viewMode, label]) => (
                          <button
                            key={viewMode}
                            type="button"
                            className={`calendar-schedule-view-button${
                              calendarScheduleViewMode === viewMode ? " active" : ""
                            }`}
                            onClick={() => {
                              setCalendarScheduleViewMode(viewMode);
                              if (viewMode === "day" || viewMode === "week") {
                                setCalendarMonthViewDate(
                                  getCalendarScheduleAnchorDateForViewMode(viewMode),
                                );
                              }
                            }}
                            role="tab"
                            aria-selected={calendarScheduleViewMode === viewMode}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      <div className="calendar-schedule-period-bar">
                        <p className="visitation-calendar-month-label">{calendarMonthLabel}</p>
                        <div className="visitation-calendar-month-nav">
                          <button
                            type="button"
                            className="member-cancel-button visitation-calendar-nav-button"
                            onClick={() =>
                              setCalendarMonthViewDate(
                                (current) =>
                                  shiftCalendarScheduleViewDate(
                                    current,
                                    calendarScheduleViewMode,
                                    -1,
                                  ),
                              )
                            }
                            aria-label={`Previous ${calendarScheduleViewMode}`}
                          >
                            ←
                          </button>
                          <button
                            type="button"
                            className="member-cancel-button visitation-calendar-nav-button"
                            onClick={() =>
                              setCalendarMonthViewDate(
                                (current) =>
                                  shiftCalendarScheduleViewDate(
                                    current,
                                    calendarScheduleViewMode,
                                    1,
                                  ),
                              )
                            }
                            aria-label={`Next ${calendarScheduleViewMode}`}
                          >
                            →
                          </button>
                          <button
                            type="button"
                            className="member-cancel-button visitation-calendar-nav-button"
                            onClick={() => {
                              void loadGoogleCalendarMonthEvents();
                            }}
                            aria-label="Refresh schedule"
                            title="Refresh schedule"
                            disabled={isCalendarMonthLoading}
                          >
                            ↻
                          </button>
                        </div>
                      </div>
                    </div>

                    {calendarEventFormStatus ? (
                      <p className="member-submit-message calendar-schedule-status">
                        {calendarEventFormStatus}
                      </p>
                    ) : null}

                    {calendarScheduleViewMode === "month" ? (
                      <div className="visitation-calendar-weekdays" aria-hidden="true">
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayLabel) => (
                          <p key={dayLabel}>{dayLabel}</p>
                        ))}
                      </div>
                    ) : null}

                    <div
                      className={`visitation-calendar-grid calendar-month-grid calendar-month-grid-${calendarScheduleViewMode}`}
                    >
                      {calendarScheduleVisibleDays.map((day) => {
                        const dayEvents = (calendarMonthEvents?.items ?? []).filter((eventItem) =>
                          isSameDay(
                            parseCalendarEventDateValue(eventItem.start, eventItem.isAllDay),
                            day,
                          ),
                        );
                        const visibleEventLimit =
                          calendarScheduleViewMode === "month" ? 3 : Number.MAX_SAFE_INTEGER;
                        const isOutsideMonth =
                          calendarScheduleViewMode === "month" &&
                          day.getMonth() !== calendarMonthViewDate.getMonth();
                        const isToday = isSameDay(day, new Date());
                        const dayValue = formatDateInputValue(day);
                        const isSelected = dayValue === calendarMonthSelectedDate;

                        return (
                          <article
                            key={day.toISOString()}
                            className={`visitation-calendar-day calendar-month-day${
                              isOutsideMonth ? " outside-month" : ""
                            }${isToday ? " today" : ""}${isSelected ? " selected" : ""} calendar-month-day-${calendarScheduleViewMode}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              openCalendarEventCreateModal(dayValue);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openCalendarEventCreateModal(dayValue);
                              }
                            }}
                          >
                            <div className="visitation-calendar-day-header">
                              <p className="visitation-calendar-day-number">
                                {formatCalendarScheduleDayLabel(
                                  day,
                                  calendarScheduleViewMode,
                                  isCompactMobileViewport,
                                )}
                              </p>
                              {dayEvents.length > 0 ? (
                                <p className="visitation-calendar-day-count">
                                  {dayEvents.length}
                                </p>
                              ) : null}
                            </div>

                            <div className="visitation-calendar-events">
                              {dayEvents.length > 0 ? (
                                <>
                                  {dayEvents.slice(0, visibleEventLimit).map((eventItem) => (
                                    <button
                                      type="button"
                                      className="visitation-calendar-event calendar-month-event-chip"
                                      key={eventItem.id}
                                      style={{
                                        backgroundColor: hexToRgba(
                                          eventItem.calendarColor || "#6c88b5",
                                          0.14,
                                        ),
                                        borderColor: hexToRgba(
                                          eventItem.calendarColor || "#6c88b5",
                                          0.34,
                                        ),
                                      }}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        openCalendarEventEditModal(eventItem);
                                      }}
                                    >
                                      <span className="calendar-month-event-row">
                                        <span
                                          className="calendar-month-event-dot"
                                          aria-hidden="true"
                                          style={{
                                            backgroundColor:
                                              eventItem.calendarColor || "var(--accent-strong)",
                                          }}
                                        />
                                        <span className="visitation-calendar-event-time">
                                          {eventItem.isAllDay
                                            ? "All day"
                                            : formatTimeLabel(eventItem.start)}
                                        </span>
                                        <span className="visitation-calendar-event-name">
                                          {eventItem.title}
                                        </span>
                                      </span>
                                      <span className="calendar-month-event-hover-details">
                                        <span className="calendar-month-event-hover-title">
                                          {eventItem.title}
                                        </span>
                                        <span>
                                          {formatEventDateTimeLabel(
                                            eventItem.start,
                                            eventItem.end,
                                            eventItem.isAllDay,
                                          )}
                                        </span>
                                        {eventItem.calendarName ? (
                                          <span>Calendar: {eventItem.calendarName}</span>
                                        ) : null}
                                        {eventItem.location ? (
                                          <span>Location: {eventItem.location}</span>
                                        ) : null}
                                      </span>
                                    </button>
                                  ))}
                                  {dayEvents.length > visibleEventLimit ? (
                                    <button
                                      type="button"
                                      className="calendar-month-more-events"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        openCalendarDayEventsModal(dayValue);
                                      }}
                                    >
                                      +{dayEvents.length - visibleEventLimit} more
                                    </button>
                                  ) : null}
                                </>
                              ) : (
                                <div className="visitation-calendar-empty-slot" />
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>

                    {!calendarMonthSelectedDate ? (
                      <div className="calendar-schedule-empty calendar-booking-empty">
                      </div>
                    ) : null}
                  </>
                )}
              </section>
            </div>
          ) : null}

          {activePage === "calendar-reporting" ? (
            <div className="calendar-schedule-layout">
              <section className="placeholder-page-card calendar-schedule-card">
                <div className="calendar-schedule-header">
                  <div>
                    <p className="placeholder-page-kicker">Calendar Reporting</p>
                    <h3 className="calendar-connect-title">Congregation Event Summary</h3>
                    <p className="placeholder-page-copy calendar-connect-copy">
                      Congregation members sorted by the fewest attached calendar events first for{" "}
                      {currentCalendarReportYear}.
                    </p>
                  </div>
                </div>

                {!googleCalendarConnection?.connected ? (
                  <div className="calendar-schedule-empty">
                    <p className="placeholder-page-copy">
                      Connect Google Calendar first from{" "}
                      <code>Calendar -&gt; Connect Calendar</code> before using this report.
                    </p>
                  </div>
                ) : (
                  <>
                    {calendarReportingStatus ? (
                      <p className="member-submit-message calendar-schedule-status">
                        {calendarReportingStatus}
                      </p>
                    ) : null}

                    <div className="parking-table-wrap">
                      <table className="parking-table calendar-reporting-table">
                        <thead>
                          <tr>
                            <th scope="col">Person Name</th>
                            <th scope="col">Events This Year</th>
                            <th scope="col">Last Event Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {calendarReportingRows.map((row) => (
                            <tr key={`${row.pk}-${row.sk}`}>
                              <td data-label="Person Name">
                                <div className="parking-table-primary">
                                  <span className="parking-table-name">{row.memberName}</span>
                                </div>
                              </td>
                              <td data-label="Events This Year">
                                {row.eventCountThisYear}
                              </td>
                              <td data-label="Last Event Date">
                                {row.lastEventDate
                                  ? new Date(row.lastEventDate).toLocaleDateString(
                                      undefined,
                                      {
                                        year: "numeric",
                                        month: "short",
                                        day: "numeric",
                                      },
                                    )
                                  : "No attached event yet"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            </div>
          ) : null}

          {placeholderPages.includes(activePage) ? (
            <div className="placeholder-page-card">
              <p className="placeholder-page-kicker">Placeholder</p>
              <p className="placeholder-page-copy">
                This page is ready for future content and workflow details.
              </p>
            </div>
          ) : null}

          {activePage === "member-details" ? (
            <div className="member-detail-card">
              {selectedMemberItem && selectedMemberData ? (
                <>
                  <div className="member-detail-header">
                    <div>
                      <p className="member-detail-key">
                        {selectedMemberItem.pk} / {selectedMemberItem.sk}
                      </p>
                      <h2 className="member-detail-name">{selectedMemberName}</h2>
                    </div>

                    <div className="member-detail-actions">
                      <div className="member-detail-action-groups">
                        <div className="member-detail-action-row member-detail-action-row-primary">
                          <button
                            type="button"
                            className="member-cancel-button member-back-button"
                            onClick={() => setActivePage("congregation")}
                            aria-label="Back to congregation"
                          >
                            ←
                          </button>
                          <button
                            type="button"
                            className="api-visitations-button"
                            onClick={() =>
                              openMemberVisitationPage(
                                selectedMemberItem.pk,
                                selectedMemberItem.sk,
                                selectedMemberName,
                              )
                            }
                          >
                            Visitations
                          </button>
                          <div className="member-detail-contact-actions">
                            <a
                              className={`member-contact-button phone${
                                selectedMemberPhone ? "" : " disabled"
                              }`}
                              href={selectedMemberPhone ? `tel:${selectedMemberPhone}` : undefined}
                              aria-label="Call member"
                              onClick={(event) => {
                                if (!selectedMemberPhone) {
                                  event.preventDefault();
                                }
                              }}
                            >
                              <img
                                src="/phone-ios.png"
                                alt=""
                                aria-hidden="true"
                                className="member-contact-image"
                              />
                            </a>
                            <a
                              className={`member-contact-button imessage${
                                selectedMemberPhone ? "" : " disabled"
                              }`}
                              href={selectedMemberPhone ? `sms:${selectedMemberPhone}` : undefined}
                              aria-label="Message member"
                              onClick={(event) => {
                                if (!selectedMemberPhone) {
                                  event.preventDefault();
                                }
                              }}
                            >
                              <img
                                src="/imessage.png"
                                alt=""
                                aria-hidden="true"
                                className="member-contact-image"
                              />
                            </a>
                            <a
                              className={`member-contact-button whatsapp${
                                selectedMemberWhatsappPhone ? "" : " disabled"
                              }`}
                              href={
                                selectedMemberWhatsappPhone
                                  ? `https://wa.me/${selectedMemberWhatsappPhone}`
                                  : undefined
                              }
                              target="_blank"
                              rel="noreferrer"
                              aria-label="Open WhatsApp"
                              onClick={(event) => {
                                if (!selectedMemberWhatsappPhone) {
                                  event.preventDefault();
                                }
                              }}
                            >
                              <img
                                src="/whatsapp.png"
                                alt=""
                                aria-hidden="true"
                                className="member-contact-image"
                              />
                            </a>
                            <a
                              className={`member-contact-button email${
                                selectedMemberEmail ? "" : " disabled"
                              }`}
                              href={selectedMemberEmail ? `mailto:${selectedMemberEmail}` : undefined}
                              aria-label="Email member"
                              onClick={(event) => {
                                if (!selectedMemberEmail) {
                                  event.preventDefault();
                                }
                              }}
                            >
                              <img
                                src="/email.png"
                                alt=""
                                aria-hidden="true"
                                className="member-contact-image"
                              />
                            </a>
                          </div>
                        </div>
                        <div className="member-detail-action-row member-detail-action-row-secondary">
                          <button
                            type="button"
                            className="member-submit-button"
                            onClick={() =>
                              openEditMemberPage(
                                selectedMemberItem.pk,
                                selectedMemberItem.sk,
                                selectedMemberData,
                                selectedMemberItem.photo,
                              )
                            }
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="api-delete-button"
                            onClick={() =>
                              openDeleteModal(
                                selectedMemberItem.pk,
                                selectedMemberItem.sk,
                                selectedMemberName,
                              )
                            }
                            disabled={
                              deletingMemberKey ===
                              `${selectedMemberItem.pk}-${selectedMemberItem.sk}`
                            }
                          >
                            {deletingMemberKey ===
                            `${selectedMemberItem.pk}-${selectedMemberItem.sk}`
                              ? "Deleting..."
                              : "Delete"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="member-detail-grid">
                    <div className="member-detail-section">
                      <p className="member-detail-label">Role</p>
                      <p className="member-detail-value">
                        {selectedMemberData.role || "Not set"}
                      </p>
                    </div>
                    <div className="member-detail-section">
                      <p className="member-detail-label">Status</p>
                      <p className="member-detail-value">
                        {selectedMemberData.status || "Not set"}
                      </p>
                    </div>
                    <div className="member-detail-section">
                      <p className="member-detail-label">Email</p>
                      <p className="member-detail-value">
                        {selectedMemberData.email || "Not set"}
                      </p>
                    </div>
                    <div className="member-detail-section">
                      <p className="member-detail-label">Phone</p>
                      <p className="member-detail-value">
                        {selectedMemberData.phone || "Not set"}
                      </p>
                    </div>
                    <div className="member-detail-section member-detail-section-full">
                      <p className="member-detail-label">Address</p>
                      <p className="member-detail-value">
                        {selectedMemberData.address || "Not set"}
                      </p>
                    </div>
                    <div className="member-detail-section member-detail-section-full">
                      <p className="member-detail-label">Notes</p>
                      <p className="member-detail-value">
                        {selectedMemberData.notes || "No notes yet"}
                      </p>
                    </div>
                  </div>

                  <div className="member-detail-history-card">
                    <button
                      type="button"
                      className="member-history-toggle"
                      onClick={() => setIsHistoryExpanded((current) => !current)}
                    >
                      <span className="member-detail-subtitle">Log History</span>
                      <span className="member-history-toggle-icon">
                        {isHistoryExpanded ? "Hide" : "Show"}
                      </span>
                    </button>

                    {isHistoryExpanded ? (
                      selectedMemberHistory.length > 0 ? (
                        <div className="member-history-list">
                          {selectedMemberHistory.map((entry, index) => (
                            <div
                              className="member-history-item"
                              key={`${entry.action}-${entry.timestamp}-${index}`}
                            >
                              <div className="member-history-top">
                                <p className="member-history-action">
                                  {entry.action
                                    .split("_")
                                    .join(" ")
                                    .replace(/\b\w/g, (match: string) =>
                                      match.toUpperCase(),
                                    )}
                                </p>
                                <p className="member-history-time">
                                  {new Date(entry.timestamp).toLocaleString()}
                                </p>
                              </div>
                              <p className="member-history-message">{entry.message}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="member-detail-value">
                          No activity has been recorded yet.
                        </p>
                      )
                    ) : null}
                  </div>

                  <div className="member-detail-visit-card">
                    <p className="member-detail-subtitle">Visitation</p>
                    {selectedMemberData.visitations && selectedMemberData.visitations.length > 0 ? (
                      <div className="member-visit-list">
                        {selectedMemberData.visitations.map((visit, index) => (
                          <div className="member-visit-item" key={visit.id}>
                            <div className="member-visit-top">
                              <p className="member-detail-label">Visit {selectedMemberData.visitations!.length - index}</p>
                              <p className="member-history-time">
                                {visit.scheduledAt
                                  ? new Date(visit.scheduledAt).toLocaleString()
                                  : "No schedule"}
                              </p>
                            </div>
                            <div className="member-detail-grid">
                              <div className="member-detail-section">
                                <p className="member-detail-label">Status</p>
                                <p className="member-detail-value">
                                  {visit.completedAt ? "Completed" : "Pending"}
                                </p>
                              </div>
                              <div className="member-detail-section">
                                <p className="member-detail-label">Completed At</p>
                                <p className="member-detail-value">
                                  {visit.completedAt
                                    ? new Date(visit.completedAt).toLocaleString()
                                    : "Not completed"}
                                </p>
                              </div>
                              <div className="member-detail-section member-detail-section-full">
                                <p className="member-detail-label">Assigned Priest</p>
                                <p className="member-detail-value">
                                  {visit.assignedPriestName || "Unassigned"}
                                </p>
                              </div>
                              <div className="member-detail-section member-detail-section-full">
                                <p className="member-detail-label">Note</p>
                                <p className="member-detail-value">
                                  {visit.note || "No note yet"}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="member-detail-value">No visitations scheduled yet.</p>
                    )}
                  </div>
                </>
              ) : (
                <div className="member-detail-empty">
                  <p className="member-detail-value">
                    The selected member could not be found.
                  </p>
                  <button
                    type="button"
                    className="member-cancel-button"
                    onClick={() => setActivePage("congregation")}
                  >
                    Back to Congregation
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {activePage === "member-details-beta" ? (
            <div className="member-detail-beta-page">
              {selectedMemberItem && selectedMemberData ? (
                <div className="member-detail-beta-card">
                  <div className="member-detail-beta-header">
                    <div className="member-detail-beta-header-actions">
                      <button
                        type="button"
                        className="member-detail-beta-back"
                        onClick={() => {
                          if (isCompactMobileViewport) {
                            setActivePage("congregation");
                            return;
                          }

                          setMemberDetailsViewPreference("member-details");
                          setActivePage("member-details");
                        }}
                      >
                        <span aria-hidden="true">←</span>
                        <span>Back</span>
                      </button>
                    </div>
                    <div className="member-detail-beta-menu" ref={betaMemberMenuRef}>
                      <button
                        type="button"
                        className="member-detail-beta-menu-button"
                        aria-label="Open member actions"
                        onClick={() =>
                          setIsBetaMemberMenuOpen((current) => !current)
                        }
                      >
                        ...
                      </button>
                      {isBetaMemberMenuOpen ? (
                        <div className="member-detail-beta-menu-panel">
                          <button
                            type="button"
                            className="member-detail-beta-menu-item"
                            onClick={() => {
                              setIsBetaMemberMenuOpen(false);
                              openEditMemberPage(
                                selectedMemberItem.pk,
                                selectedMemberItem.sk,
                                selectedMemberData,
                                selectedMemberItem.photo,
                              );
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="member-detail-beta-menu-item danger"
                            onClick={() => {
                              setIsBetaMemberMenuOpen(false);
                              openDeleteModal(
                                selectedMemberItem.pk,
                                selectedMemberItem.sk,
                                selectedMemberName,
                              );
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="member-detail-beta-hero">
                    <div className="member-detail-beta-avatar-wrap">
                      <div className="member-detail-beta-avatar">
                        {selectedMemberPhotoDataUrl ? (
                          <img
                            src={selectedMemberPhotoDataUrl}
                            alt={`${selectedMemberName} photo`}
                            className="member-avatar-image"
                          />
                        ) : (
                          <span aria-hidden="true">{selectedMemberInitials}</span>
                        )}
                      </div>
                    </div>
                    <h2 className="member-detail-beta-name">{selectedMemberName}</h2>
                    <p className="member-detail-beta-key">
                      #{selectedMemberItem.sk}
                    </p>
                  </div>

                  <div className="member-detail-beta-contact-row">
                    <a
                      className={`member-contact-button phone${
                        selectedMemberPhone ? "" : " disabled"
                      }`}
                      href={selectedMemberPhone ? `tel:${selectedMemberPhone}` : undefined}
                      aria-label="Call member"
                      onClick={(event) => {
                        if (!selectedMemberPhone) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <img
                        src="/phone-ios.png"
                        alt=""
                        aria-hidden="true"
                        className="member-contact-image"
                      />
                    </a>
                    <a
                      className={`member-contact-button imessage${
                        selectedMemberPhone ? "" : " disabled"
                      }`}
                      href={selectedMemberPhone ? `sms:${selectedMemberPhone}` : undefined}
                      aria-label="Message member"
                      onClick={(event) => {
                        if (!selectedMemberPhone) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <img
                        src="/imessage.png"
                        alt=""
                        aria-hidden="true"
                        className="member-contact-image"
                      />
                    </a>
                    <a
                      className={`member-contact-button whatsapp${
                        selectedMemberWhatsappPhone ? "" : " disabled"
                      }`}
                      href={
                        selectedMemberWhatsappPhone
                          ? `https://wa.me/${selectedMemberWhatsappPhone}`
                          : undefined
                      }
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open WhatsApp"
                      onClick={(event) => {
                        if (!selectedMemberWhatsappPhone) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <img
                        src="/whatsapp.png"
                        alt=""
                        aria-hidden="true"
                        className="member-contact-image"
                      />
                    </a>
                    <a
                      className={`member-contact-button email${
                        selectedMemberEmail ? "" : " disabled"
                      }`}
                      href={selectedMemberEmail ? `mailto:${selectedMemberEmail}` : undefined}
                      aria-label="Email member"
                      onClick={(event) => {
                        if (!selectedMemberEmail) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <img
                        src="/email.png"
                        alt=""
                        aria-hidden="true"
                        className="member-contact-image"
                      />
                    </a>
                  </div>

                  <div className="member-detail-beta-tabs" role="tablist" aria-label="Beta tabs">
                    <button
                      type="button"
                      className={`member-detail-beta-tab${
                        betaMemberTab === "details" ? " active" : ""
                      }`}
                      role="tab"
                      aria-selected={betaMemberTab === "details"}
                      onClick={() => setBetaMemberTab("details")}
                    >
                      Details
                    </button>
                    <button
                      type="button"
                      className={`member-detail-beta-tab${
                        betaMemberTab === "visitations" ? " active" : ""
                      }`}
                      role="tab"
                      aria-selected={betaMemberTab === "visitations"}
                      onClick={() => setBetaMemberTab("visitations")}
                    >
                      Visitations
                    </button>
                    <button
                      type="button"
                      className={`member-detail-beta-tab${
                        betaMemberTab === "activity" ? " active" : ""
                      }`}
                      role="tab"
                      aria-selected={betaMemberTab === "activity"}
                      onClick={() => setBetaMemberTab("activity")}
                    >
                      Activity
                    </button>
                  </div>

                  <div className="member-detail-beta-tab-panel" role="tabpanel">
                    {betaMemberTab === "details" ? (
                      <div className="member-detail-beta-details-grid">
                        <div className="member-detail-beta-detail-card">
                          <p className="member-detail-beta-detail-label">Role</p>
                          <p className="member-detail-beta-detail-value">
                            {selectedMemberData.role || "Not set"}
                          </p>
                        </div>
                        <div className="member-detail-beta-detail-card">
                          <p className="member-detail-beta-detail-label">Status</p>
                          <p className="member-detail-beta-detail-value">
                            {selectedMemberData.status || "Not set"}
                          </p>
                        </div>
                        <div className="member-detail-beta-detail-card full">
                          <p className="member-detail-beta-detail-label">Phone</p>
                          <p className="member-detail-beta-detail-value">
                            {selectedMemberData.phone || "Not set"}
                          </p>
                        </div>
                        <div className="member-detail-beta-detail-card full">
                          <p className="member-detail-beta-detail-label">Email</p>
                          <p className="member-detail-beta-detail-value">
                            {selectedMemberData.email || "Not set"}
                          </p>
                        </div>
                        <div className="member-detail-beta-detail-card full">
                          <p className="member-detail-beta-detail-label">Address</p>
                          <p className="member-detail-beta-detail-value">
                            {selectedMemberData.address || "Not set"}
                          </p>
                        </div>
                        <div className="member-detail-beta-detail-card full">
                          <p className="member-detail-beta-detail-label">Notes</p>
                          <p className="member-detail-beta-detail-value">
                            {selectedMemberData.notes || "No notes yet"}
                          </p>
                        </div>
                      </div>
                    ) : betaMemberTab === "visitations" ? (
                      <div className="member-detail-beta-visitation-board">
                        <div className="member-detail-beta-visitation-actions">
                          <button
                            type="button"
                            className="visitation-action-button visitation-action-schedule"
                            onClick={() =>
                              openVisitationModal(
                                "schedule",
                                selectedMemberItem.pk,
                                selectedMemberItem.sk,
                                selectedMemberName,
                              )
                            }
                          >
                            <span>Schedule</span>
                          </button>
                        </div>

                        {selectedMemberData.visitations &&
                        selectedMemberData.visitations.length > 0 ? (
                          <div className="member-detail-beta-visits">
                            {selectedMemberData.visitations.map((visit, index) => (
                              <div className="member-detail-beta-visit-card" key={visit.id}>
                                <div className="member-detail-beta-visit-top">
                                  <p className="member-detail-beta-visit-label">
                                    Visit {selectedMemberData.visitations!.length - index}
                                  </p>
                                  <p className="member-detail-beta-visit-time">
                                    {visit.scheduledAt
                                      ? new Date(visit.scheduledAt).toLocaleString()
                                      : "No schedule"}
                                  </p>
                                </div>

                                <div className="member-detail-beta-visit-meta">
                                  <p className="member-detail-beta-visit-meta-item">
                                    Status: {visit.completedAt ? "Completed" : "Pending"}
                                  </p>
                                  <p className="member-detail-beta-visit-meta-item">
                                    Assigned priest: {visit.assignedPriestName || "Unassigned"}
                                  </p>
                                  <p className="member-detail-beta-visit-meta-item">
                                    Note: {visit.note || "No note yet"}
                                  </p>
                                </div>

                                <div className="member-detail-beta-visit-actions-row">
                                  <button
                                    type="button"
                                    className="visitation-action-button visitation-action-schedule"
                                    onClick={() =>
                                      openVisitationModal(
                                        "schedule",
                                        selectedMemberItem.pk,
                                        selectedMemberItem.sk,
                                        selectedMemberName,
                                        {
                                          visitationId: visit.id,
                                          schedule: visit.scheduledAt,
                                          assignedPriestSk: visit.assignedPriestSk,
                                          assignedPriestName: visit.assignedPriestName,
                                        },
                                      )
                                    }
                                  >
                                    <span>Edit</span>
                                  </button>

                                  <button
                                    type="button"
                                    className={`visitation-action-button visitation-action-note${
                                      visit.note ? " active" : ""
                                    }`}
                                    onClick={() =>
                                      openVisitationModal(
                                        "note",
                                        selectedMemberItem.pk,
                                        selectedMemberItem.sk,
                                        selectedMemberName,
                                        {
                                          visitationId: visit.id,
                                          note: visit.note,
                                        },
                                      )
                                    }
                                  >
                                    <span>{visit.note ? "Edit Note" : "Add Note"}</span>
                                  </button>

                                  <button
                                    type="button"
                                    className={`visitation-action-button visitation-action-complete${
                                      visit.completedAt ? " active" : ""
                                    }`}
                                    onClick={() =>
                                      openVisitationModal(
                                        "complete",
                                        selectedMemberItem.pk,
                                        selectedMemberItem.sk,
                                        selectedMemberName,
                                        {
                                          visitationId: visit.id,
                                        },
                                      )
                                    }
                                  >
                                    <span>{visit.completedAt ? "Completed" : "Mark Done"}</span>
                                  </button>

                                  <button
                                    type="button"
                                    className="visitation-action-button visitation-action-delete"
                                    onClick={() =>
                                      openVisitationModal(
                                        "delete",
                                        selectedMemberItem.pk,
                                        selectedMemberItem.sk,
                                        selectedMemberName,
                                        {
                                          visitationId: visit.id,
                                        },
                                      )
                                    }
                                  >
                                    <span>Delete</span>
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="member-detail-beta-empty-state compact">
                            <p className="member-detail-beta-empty-title">
                              No visitations scheduled yet.
                            </p>
                          </div>
                        )}
                      </div>
                    ) : betaMemberTab === "activity" ? (
                      selectedMemberHistory.length > 0 ? (
                        <div className="member-detail-beta-activity-list">
                          {selectedMemberHistory.map((entry, index) => (
                            <div
                              className={`member-detail-beta-activity-item activity-${entry.action.replace(
                                /_/g,
                                "-",
                              )}`}
                              key={`${entry.action}-${entry.timestamp}-${index}`}
                            >
                              <span
                                className="member-detail-beta-activity-marker"
                                aria-hidden="true"
                              />
                              <div className="member-detail-beta-activity-card">
                                <div className="member-detail-beta-history-top">
                                  <span className="member-detail-beta-history-action">
                                    {entry.action
                                      .split("_")
                                      .join(" ")
                                      .replace(/\b\w/g, (match: string) =>
                                        match.toUpperCase(),
                                      )}
                                  </span>
                                  <span className="member-detail-beta-history-time">
                                    {new Date(entry.timestamp).toLocaleString()}
                                  </span>
                                </div>
                                <p className="member-detail-beta-history-message">
                                  {entry.message}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="member-detail-beta-empty-state compact">
                          <p className="member-detail-beta-empty-title">
                            No activity has been recorded yet.
                          </p>
                        </div>
                      )
                    ) : (
                      <div className="member-detail-beta-empty-state">
                        <p className="member-detail-beta-empty-title">Tab</p>
                        <p className="member-detail-beta-empty-copy">
                          Beta placeholder content.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="member-detail-card">
                  <div className="member-detail-empty">
                    <p className="member-detail-value">
                      The selected member could not be found.
                    </p>
                    <button
                      type="button"
                      className="member-cancel-button"
                      onClick={() => {
                        if (isCompactMobileViewport) {
                          setActivePage("congregation");
                          return;
                        }

                        setMemberDetailsViewPreference("member-details");
                        setActivePage("member-details");
                      }}
                    >
                      {isCompactMobileViewport ? "Back to Congregation" : "Back to Details"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </section>

        {activePage === "congregation" ? (
          <button
            type="button"
            className="mobile-fab-button"
            onClick={openNewMemberPage}
            aria-label="Add member"
          >
            +
          </button>
        ) : null}
      </main>

      {memberContextMenu ? (
        <div
          ref={memberContextMenuRef}
          className="member-context-menu"
          role="menu"
          aria-label={`Actions for ${memberContextMenu.memberName}`}
          style={{
            left: `${memberContextMenu.x}px`,
            top: `${memberContextMenu.y}px`,
          }}
        >
          <button
            type="button"
            className="member-context-menu-item"
            role="menuitem"
            onClick={() => handleMemberContextMenuAction("delete")}
          >
            <span className="member-context-menu-label">Delete</span>
          </button>
          <button
            type="button"
            className="member-context-menu-item"
            role="menuitem"
            onClick={() => handleMemberContextMenuAction("edit")}
          >
            <span className="member-context-menu-label">Edit</span>
          </button>
          <button
            type="button"
            className="member-context-menu-item"
            role="menuitem"
            onClick={() => handleMemberContextMenuAction("details")}
          >
            <span className="member-context-menu-label">Details</span>
          </button>
          <button
            type="button"
            className="member-context-menu-item"
            role="menuitem"
            onClick={() => handleMemberContextMenuAction("schedule")}
          >
            <span className="member-context-menu-label">Schedule visitation</span>
          </button>
        </div>
      ) : null}

      {visitationModal ? (
        <div className="modal-overlay" role="presentation" onClick={closeVisitationModal}>
          <div
            className={`modal-card${
              visitationModal.action === "delete" ? " modal-card-danger" : ""
            }`}
            role="dialog"
            aria-modal="true"
            aria-label="Visitation action"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">{visitationModal.memberName}</p>
            <h2 className="modal-title">
              {visitationModal.action === "schedule"
                ? visitationModal.visitationId
                  ? "Edit visitation"
                  : "Schedule visitation"
                : visitationModal.action === "note"
                  ? "Add visitation note"
                  : visitationModal.action === "complete"
                    ? "Mark visitation done"
                    : "Delete visitation"}
            </h2>

            <form className="modal-form" onSubmit={handleVisitationModalSubmit}>
              {visitationModal.action === "schedule" ? (
                <>
                  <label className="member-field">
                    <span>Visitation date</span>
                    <input
                      type="datetime-local"
                      value={visitationSchedule}
                      onChange={(event) => setVisitationSchedule(event.target.value)}
                      required
                    />
                  </label>

                  <label className="member-field">
                    <span>Assign priest</span>
                    <select
                      value={visitationAssignedPriestSk}
                      onChange={(event) => {
                        const nextSk = event.target.value;
                        const selectedPriest = priestMembers.find(
                          (priest) => priest.sk === nextSk,
                        );
                        setVisitationAssignedPriestSk(nextSk);
                        setVisitationAssignedPriestName(selectedPriest?.name ?? "");
                      }}
                      required={priestMembers.length > 0}
                    >
                      <option value="">
                        {priestMembers.length > 0
                          ? "Select a priest"
                          : "No priests available"}
                      </option>
                      {!selectedVisitationPriestAvailable && visitationAssignedPriestSk ? (
                        <option value={visitationAssignedPriestSk}>
                          {visitationAssignedPriestName || "Previously assigned priest"}
                        </option>
                      ) : null}
                      {priestMembers.map((priest) => (
                        <option key={priest.sk} value={priest.sk}>
                          {priest.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}

              {visitationModal.action === "note" ? (
                <label className="member-field">
                  <span>Visitation note</span>
                  <textarea
                    rows={5}
                    value={visitationNote}
                    onChange={(event) => setVisitationNote(event.target.value)}
                    placeholder="Add a summary of the visit or planned follow-up"
                    required
                  />
                </label>
              ) : null}

              {visitationModal.action === "complete" ? (
                <p className="modal-copy">
                  Confirm that this specific visit for {visitationModal.memberName} has
                  been completed.
                </p>
              ) : null}

              {visitationModal.action === "delete" ? (
                <p className="modal-copy">
                  Remove this specific visitation for {visitationModal.memberName}? This
                  action cannot be undone.
                </p>
              ) : null}

              <div className="modal-actions">
                {visitationSubmitState ? (
                  <p className="modal-submit-message">{visitationSubmitState}</p>
                ) : null}
                <button
                  type="button"
                  className="modal-secondary-button"
                  onClick={closeVisitationModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={
                    visitationModal.action === "delete"
                      ? "modal-danger-button"
                      : "member-submit-button"
                  }
                  disabled={isVisitationSubmitting}
                >
                  {isVisitationSubmitting
                    ? "Saving..."
                    : visitationModal.action === "complete"
                      ? "Confirm"
                      : visitationModal.action === "delete"
                        ? "Delete"
                        : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteModal ? (
        <div className="modal-overlay" role="presentation" onClick={closeDeleteModal}>
          <div
            className="modal-card modal-card-danger"
            role="dialog"
            aria-modal="true"
            aria-label="Delete member confirmation"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">Delete Member</p>
            <h2 className="modal-title">{deleteModal.memberName}</h2>
            <p className="modal-copy">
              Remove this member from the congregation list? This action cannot be
              undone.
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="modal-secondary-button"
                onClick={closeDeleteModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-danger-button"
                onClick={confirmDeleteMember}
                disabled={deletingMemberKey === `${deleteModal.pk}-${deleteModal.sk}`}
              >
                {deletingMemberKey === `${deleteModal.pk}-${deleteModal.sk}`
                  ? "Deleting..."
                  : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {announcementDeleteModal ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={closeAnnouncementDeleteModal}
        >
          <div
            className="modal-card modal-card-danger"
            role="dialog"
            aria-modal="true"
            aria-label="Delete announcement week confirmation"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">Delete Week</p>
            <h2 className="modal-title">{announcementDeleteModal.weekLabel}</h2>
            <p className="modal-copy">
              Remove this announcement week and its full list of items? This action
              cannot be undone.
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="modal-secondary-button"
                onClick={closeAnnouncementDeleteModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-danger-button"
                onClick={confirmRemoveAnnouncementWeek}
                disabled={deletingAnnouncementSk === announcementDeleteModal.sk}
              >
                {deletingAnnouncementSk === announcementDeleteModal.sk
                  ? "Deleting..."
                  : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {announcementItemDeleteModal ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={closeAnnouncementItemDeleteModal}
        >
          <div
            className="modal-card modal-card-danger"
            role="dialog"
            aria-modal="true"
            aria-label="Delete announcement item confirmation"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">Remove Announcement</p>
            <h2 className="modal-title">{announcementItemDeleteModal.label}</h2>
            <p className="modal-copy">
              Remove this announcement from the current week list?
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="modal-secondary-button"
                onClick={closeAnnouncementItemDeleteModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-danger-button"
                onClick={confirmRemoveAnnouncementItem}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {parkingHistoryModal ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => setParkingHistoryModal(null)}
        >
          <div
            className="modal-card parking-history-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Parking activity history"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">Parking Activity</p>
            <h2 className="modal-title">{parkingHistoryModal.memberName}</h2>
            <p className="modal-copy">{parkingHistoryModal.sk}</p>

            {parkingHistoryModal.history.length > 0 ? (
              <div className="parking-history-list">
                {parkingHistoryModal.history.map((entry, index) => (
                  <article className="parking-history-item" key={`${entry.timestamp}-${index}`}>
                    <div className="parking-history-top">
                      <p className="parking-history-action">{entry.action.replace(/_/g, " ")}</p>
                      <p className="parking-history-time">
                        {new Date(entry.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <p className="parking-history-message">{entry.message}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="modal-copy">No parking activity recorded yet.</p>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="modal-secondary-button"
                onClick={() => setParkingHistoryModal(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {calendarMonthExpandedDate ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={closeCalendarDayEventsModal}
        >
          <div
            className="modal-card calendar-day-events-modal"
            ref={calendarDayEventsModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-day-events-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="member-form-header visitation-calendar-schedule-header">
              <div>
                <p className="member-form-mode">Day Events</p>
                <h2 className="modal-title" id="calendar-day-events-title">
                  {calendarMonthExpandedDateLabel}
                </h2>
                <p className="visitation-calendar-schedule-copy">
                  View every event scheduled for this day.
                </p>
              </div>

              <button
                type="button"
                className="calendar-booking-close-button"
                onClick={closeCalendarDayEventsModal}
                aria-label="Close day events modal"
              >
                ×
              </button>
            </div>

            {calendarMonthExpandedDayEvents.length > 0 ? (
              <div className="calendar-day-events-list">
                {calendarMonthExpandedDayEvents.map((eventItem) => (
                  <button
                    type="button"
                    key={`${eventItem.calendarId || "calendar"}-${eventItem.id}-${eventItem.start}`}
                    className="calendar-day-events-item"
                    onClick={() => {
                      openCalendarEventEditModal(eventItem);
                    }}
                  >
                    <div className="calendar-day-events-item-top">
                      <p className="calendar-day-events-item-time">
                        {eventItem.isAllDay
                          ? "All day"
                          : formatEventDateTimeLabel(
                              eventItem.start,
                              eventItem.end,
                              false,
                            )}
                      </p>
                      <p className="calendar-day-events-item-calendar">
                        {eventItem.calendarName || "Primary Calendar"}
                      </p>
                    </div>
                    <p className="calendar-day-events-item-title">
                      {eventItem.title || "Untitled event"}
                    </p>
                    {eventItem.location ? (
                      <p className="calendar-day-events-item-meta">
                        Location: {eventItem.location}
                      </p>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : (
              <p className="modal-copy">No events were found for this day.</p>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="modal-secondary-button"
                onClick={closeCalendarDayEventsModal}
              >
                Close
              </button>
              <button
                type="button"
                className="member-submit-button"
                onClick={() => {
                  openCalendarEventCreateModal(calendarMonthExpandedDate);
                }}
              >
                Add Event
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {calendarMonthSelectedDate ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={closeCalendarEventModal}
        >
          <div
            className="modal-card calendar-booking-modal"
            ref={calendarBookingModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-booking-modal-title"
            aria-busy={isCalendarEventSubmitting || isCalendarEventDeleting}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="calendar-booking-close-button"
              onClick={closeCalendarEventModal}
              disabled={isCalendarEventSubmitting || isCalendarEventDeleting}
              aria-label="Close event modal"
            >
              ×
            </button>
            <div className="member-form-header visitation-calendar-schedule-header">
              <div>
                <p className="member-form-mode">
                  {selectedCalendarMonthEvent ? "Edit Event" : "Book Event"}
                </p>
                <h2 className="modal-title" id="calendar-booking-modal-title">
                  {selectedCalendarMonthEvent?.title || calendarMonthSelectedDateLabel}
                </h2>
                <p className="visitation-calendar-schedule-copy">
                  {selectedCalendarMonthEvent
                    ? "Adjust the selected event or remove it from the calendar."
                    : "Create an event for the selected day."}
                </p>
                {selectedCalendarMonthEvent?.calendarName ? (
                  <p className="placeholder-page-copy">
                    {selectedCalendarMonthEvent.calendarColorEmoji
                      ? `${selectedCalendarMonthEvent.calendarColorEmoji} `
                      : ""}
                    Calendar: {selectedCalendarMonthEvent.calendarName}
                  </p>
                ) : null}
              </div>
            </div>

            <form className="modal-form calendar-booking-form" onSubmit={handleCalendarEventSubmit}>
              <div className="member-form-grid visitation-calendar-schedule-grid">
                <label className="member-field">
                  <span>Date</span>
                  <input
                    type="date"
                    value={calendarMonthSelectedDate}
                    onChange={(event) => setCalendarMonthSelectedDate(event.target.value)}
                  />
                </label>

                <label className="member-field member-field-full">
                  <span>Congregation</span>
                  <input
                    type="text"
                    value={calendarCongregationQuery}
                    onChange={(event) => {
                      setCalendarCongregationQuery(event.target.value);
                    }}
                    placeholder="Search congregation directory"
                    autoComplete="off"
                  />
                  {selectedCongregationDirectoryItems.length > 0 ? (
                    <div className="calendar-congregation-selection-list">
                      {selectedCongregationDirectoryItems.map((item) => (
                        <button
                          key={`${item.pk}-${item.sk}`}
                          type="button"
                          className="calendar-congregation-selection-chip"
                          onClick={() => {
                            setSelectedCongregationDirectoryItems((current) =>
                              current.filter(
                                (selectedItem) =>
                                  !(
                                    selectedItem.pk === item.pk &&
                                    selectedItem.sk === item.sk
                                  ),
                              ),
                            );
                          }}
                        >
                          <span className="calendar-congregation-selection-chip-primary">
                            {formatCongregationDirectoryItemLabel(item)}
                          </span>
                          <span className="calendar-congregation-selection-chip-secondary">
                            {formatCongregationDirectoryItemSubLabel(item)}
                          </span>
                          <span
                            className="calendar-congregation-selection-chip-remove"
                            aria-hidden="true"
                          >
                            ×
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {filteredCalendarCongregationSuggestions.length > 0 ? (
                    <div className="calendar-congregation-suggestions">
                      {filteredCalendarCongregationSuggestions.map((item) => (
                        <button
                          key={`${item.pk}-${item.sk}`}
                          type="button"
                          className="calendar-congregation-suggestion"
                          onClick={() => {
                            setSelectedCongregationDirectoryItems((current) => [
                              ...current,
                              item,
                            ]);
                            setCalendarCongregationQuery("");
                          }}
                        >
                          <span className="calendar-congregation-suggestion-primary">
                            {formatCongregationDirectoryItemLabel(item)}
                          </span>
                          <span className="calendar-congregation-suggestion-secondary">
                            {formatCongregationDirectoryItemSubLabel(item)}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {normalizedCalendarCongregationQuery &&
                  filteredCalendarCongregationSuggestions.length === 0 ? (
                    <p className="calendar-congregation-selection">
                      No matching congregation entries found.
                    </p>
                  ) : null}
                </label>

                <label className="member-field member-field-full">
                  <span>Title</span>
                  <input
                    type="text"
                    value={calendarEventForm.title}
                    onChange={(event) =>
                      setCalendarEventForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Event title"
                  />
                </label>

                {selectedCalendarMonthEvent?.isAllDay ? (
                  <label className="member-field member-field-full">
                    <span>Schedule</span>
                    <input type="text" value="All day event" disabled />
                  </label>
                ) : (
                  <>
                    <label className="member-field">
                      <span>Start time</span>
                      <input
                        type="time"
                        value={calendarEventForm.startTime}
                        onChange={(event) =>
                          setCalendarEventForm((current) => ({
                            ...current,
                            startTime: event.target.value,
                          }))
                        }
                      />
                    </label>

                    <label className="member-field">
                      <span>End time</span>
                      <input
                        type="time"
                        value={calendarEventForm.endTime}
                        onChange={(event) =>
                          setCalendarEventForm((current) => ({
                            ...current,
                            endTime: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </>
                )}

                <label className="member-field member-field-full">
                  <span>Location</span>
                  <input
                    type="text"
                    value={calendarEventForm.location}
                    onChange={(event) =>
                      setCalendarEventForm((current) => ({
                        ...current,
                        location: event.target.value,
                      }))
                    }
                    placeholder="Optional location"
                  />
                </label>

                <label className="member-field member-field-full">
                  <span>Description</span>
                  <textarea
                    rows={4}
                    value={calendarEventForm.description}
                    onChange={(event) =>
                      setCalendarEventForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Optional description"
                  />
                </label>
              </div>

              <div className="modal-actions">
                {isCalendarEventSubmitting ? (
                  <p className="modal-submit-message">
                    {selectedCalendarMonthEvent
                      ? "Saving changes..."
                      : "Booking event..."}
                  </p>
                ) : null}
                {isCalendarEventDeleting ? (
                  <p className="modal-submit-message">Deleting event...</p>
                ) : null}
                {selectedCalendarMonthEvent ? (
                  <button
                    type="button"
                    className="modal-danger-button"
                    onClick={() => {
                      void handleCalendarEventDelete();
                    }}
                    disabled={isCalendarEventDeleting || isCalendarEventSubmitting}
                  >
                    {isCalendarEventDeleting ? "Deleting..." : "Delete Event"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="modal-secondary-button"
                  disabled={isCalendarEventSubmitting || isCalendarEventDeleting}
                  onClick={() => {
                    if (selectedCalendarMonthEvent) {
                      openCalendarEventEditModal(selectedCalendarMonthEvent);
                    } else {
                      setCalendarEventForm(initialCalendarEventForm);
                      setCalendarCongregationQuery("");
                      setSelectedCongregationDirectoryItems([]);
                      setPendingCalendarCongregationEntries([]);
                      setCalendarEventFormStatus(null);
                    }
                  }}
                >
                  {selectedCalendarMonthEvent ? "Reset" : "Clear"}
                </button>
                <button
                  type="submit"
                  className="member-submit-button"
                  disabled={isCalendarEventSubmitting || isCalendarEventDeleting}
                >
                  {isCalendarEventSubmitting
                    ? selectedCalendarMonthEvent
                      ? "Saving Changes..."
                      : "Booking Event..."
                    : selectedCalendarMonthEvent
                      ? "Save Changes"
                      : "Book Event"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
