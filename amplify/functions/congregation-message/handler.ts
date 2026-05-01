import {
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import {
  DeleteCommand,
  GetCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

type TableRow = {
  pk: string;
  sk: string;
  data: string;
  photo?: string;
};

type CreateMemberPayload = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  photo?: string;
  role: string;
  status: string;
  address: string;
  notes: string;
};

type UpdateMemberPayload = CreateMemberPayload & {
  pk: string;
  sk: string;
  createdAt?: string;
};

type DeleteMemberPayload = {
  pk: string;
  sk: string;
};

type VisitationPayload = {
  pk: string;
  sk: string;
  action: "schedule" | "note" | "complete" | "delete";
  visitationId?: string;
  schedule?: string;
  note?: string;
  assignedPriestSk?: string;
};

type AnnouncementWeekPayload = {
  sk?: string;
  weekLabel: string;
  items: string[];
  createdAt?: string;
};

type DeleteAnnouncementPayload = {
  pk: "ANNOUNCEMENT";
  sk: string;
};

type UpdateUserGroupsPayload = {
  username: string;
  groups: string[];
};

type ImportContactsPayload = {
  fileName?: string;
  content: string;
};

type ParkingRegistrationPayload = {
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

type ParkingManagementPayload = {
  maxSpots: number;
};

type GoogleCalendarConnectStartPayload = {
  returnTo?: string;
};

type GoogleCalendarFreeBusyPayload = {
  timeMin: string;
  timeMax: string;
  timeZone?: string;
  calendarId?: string;
};

type GoogleCalendarEventsPayload = {
  timeMin: string;
  timeMax: string;
  timeZone?: string;
  calendarId?: string;
  useSyncCache?: boolean;
  cacheOnly?: boolean;
  forceSync?: boolean;
  selectedYearMonth?: string;
};

type GoogleCalendarReportingPayload = {
  year?: number;
  calendarIds?: string[];
  cacheOnly?: boolean;
  forceSync?: boolean;
};

type GoogleCalendarCongregationMetadataItem = {
  pk: string;
  sk: string;
  firstName: string;
  lastName: string;
  phone: string;
};

type GoogleCalendarCreateEventPayload = {
  calendarId?: string;
  title: string;
  start: string;
  end: string;
  timeZone?: string;
  location?: string;
  description?: string;
  congregationItems?: GoogleCalendarCongregationMetadataItem[];
};

type GoogleCalendarUpdateEventPayload = {
  calendarId?: string;
  eventId: string;
  title: string;
  start: string;
  end: string;
  timeZone?: string;
  location?: string;
  description?: string;
  congregationItems?: GoogleCalendarCongregationMetadataItem[];
  isAllDay?: boolean;
};

type GoogleCalendarDeleteEventPayload = {
  calendarId?: string;
  eventId: string;
};

type CongregationDirectoryItem = {
  pk: string;
  sk: string;
  firstName: string;
  lastName: string;
  phone: string;
};

type CongregationDirectoryResponse = {
  message: string;
  time: string;
  items: CongregationDirectoryItem[];
};

type GoogleCalendarLoadedEventsResult = {
  items: StoredGoogleCalendarSyncedEventData[];
  changedResources: GoogleCalendarSyncChangedResource[];
  syncMode: "full" | "incremental" | "direct" | "cached";
  debug?: {
    preFilterItemCount: number;
    returnedItemCount: number;
    filteredOutItems: Array<{
      id: string;
      title: string;
      start: string;
      end: string;
    }>;
  };
};

type GoogleCalendarSyncedCacheResult = {
  changedResources: GoogleCalendarSyncChangedResource[];
  hadPriorSyncToken: boolean;
  events: StoredGoogleCalendarSyncedEventData[];
};

type UpdateParkingRegistrationStatusPayload = {
  sk: string;
  placementStatus: "assigned" | "waiting-list" | "available";
};

type StoredMemberData = {
  history?: Array<{
    timestamp: string;
    action: string;
    message: string;
  }>;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  photo?: string;
  photoDataUrl?: string;
  role?: string;
  status?: string;
  address?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
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

type StoredAnnouncementWeekData = {
  weekLabel?: string;
  items?: string[];
  createdAt?: string;
  updatedAt?: string;
};

type StoredParkingRegistrationData = {
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

type StoredParkingSettingsData = {
  maxSpots: number;
  updatedAt: string;
};

type StoredGoogleCalendarConnectionData = {
  email: string;
  refreshTokenEncrypted: string;
  accessTokenEncrypted: string;
  accessTokenExpiresAt: string;
  tokenScope?: string;
  tokenType?: string;
  connectedAt: string;
  updatedAt: string;
  refreshTokenUpdatedAt: string;
  lastRefreshAt?: string;
  lastError?: string | null;
};

type StoredGoogleOAuthStateData = {
  email: string;
  userKey?: string;
  returnTo: string;
  createdAt: string;
  expiresAt: string;
};

type StoredGoogleCalendarSyncStateData = {
  syncToken: string;
};

type StoredGoogleCalendarSyncedEventData = {
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
  congregationItems?: GoogleCalendarCongregationMetadataItem[];
};

type StoredGoogleCalendarMonthCacheData = {
  month: string;
  items: StoredGoogleCalendarSyncedEventData[];
};

type GoogleCalendarSyncChangedResource =
  | (StoredGoogleCalendarSyncedEventData & {
      changeType: "upsert";
    })
  | {
      id: string;
      status: string;
      changeType: "deleted";
    };

type ParkingRegistrationsResponse = {
  message: string;
  time: string;
  items: Array<
    StoredParkingRegistrationData & {
      pk: string;
      sk: string;
    }
  >;
};

type CognitoUserDirectoryItem = {
  username: string;
  email: string;
  enabled: boolean;
  status: string;
  groups: string[];
};

type ParsedVcfContact = {
  displayName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GoogleFreeBusyResponse = {
  calendars?: Record<
    string,
    {
      busy?: Array<{
        start?: string;
        end?: string;
      }>;
      errors?: Array<{
        domain?: string;
        reason?: string;
      }>;
    }
  >;
  timeMin?: string;
  timeMax?: string;
};

type GoogleCalendarListResponse = {
  items?: Array<{
    id?: string;
    summary?: string;
    summaryOverride?: string;
    primary?: boolean;
    accessRole?: string;
    timeZone?: string;
    hidden?: boolean;
    selected?: boolean;
  }>;
};

type GoogleCalendarEventsListResponse = {
  items?: Array<{
    id?: string;
    summary?: string;
    status?: string;
    htmlLink?: string;
    location?: string;
    eventType?: string;
    visibility?: string;
    start?: {
      dateTime?: string;
      date?: string;
    };
    end?: {
      dateTime?: string;
      date?: string;
    };
    organizer?: {
      email?: string;
      displayName?: string;
    };
  }>;
};

type AwsCommandClient = {
  send: any;
};

const prependHistoryEntry = (
  history: StoredMemberData["history"],
  entry: NonNullable<StoredMemberData["history"]>[number],
) => [entry, ...(history ?? [])];

const normalizeWhitespace = (value?: string) => value?.replace(/\s+/g, " ").trim() ?? "";
const normalizeEmail = (value?: string) => normalizeWhitespace(value).toLowerCase();
const normalizePhone = (value?: string) =>
  (value ?? "").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
const normalizeLicensePlate = (value?: string) =>
  normalizeWhitespace(value).replace(/[\s-]+/g, "").toUpperCase();
const isParkingMonthValue = (value?: string) => /^\d{4}-\d{2}$/.test(value ?? "");
const normalizeName = (
  firstName?: string,
  lastName?: string,
  displayName?: string,
) =>
  normalizeWhitespace(
    [firstName, lastName].filter(Boolean).join(" ") || displayName || "",
  ).toLowerCase();

const getStoredMemberName = (firstName?: string, lastName?: string) =>
  [firstName, lastName].filter(Boolean).join(" ").trim();
const normalizeGoogleCalendarCongregationMetadataItems = (
  items: GoogleCalendarCongregationMetadataItem[] | undefined,
) =>
  (items ?? [])
    .map((item) => ({
      pk: normalizeWhitespace(item.pk),
      sk: normalizeWhitespace(item.sk),
      firstName: normalizeWhitespace(item.firstName),
      lastName: normalizeWhitespace(item.lastName),
      phone: normalizeWhitespace(item.phone),
    }))
    .filter((item) => item.pk && item.sk);

const parseGoogleCalendarCongregationMetadata = (
  value: string | undefined,
): GoogleCalendarCongregationMetadataItem[] => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as GoogleCalendarCongregationMetadataItem[];
    return normalizeGoogleCalendarCongregationMetadataItems(parsed);
  } catch {
    return [];
  }
};

const isActiveParkingPlacementStatus = (value?: string) =>
  value === "assigned" || value === "available" || value === "active";

const decodeVcfValue = (value: string) =>
  value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();

const parseVcfAddress = (value: string) =>
  value
    .split(";")
    .map((part) => decodeVcfValue(part))
    .filter(Boolean)
    .join(", ");

const splitDisplayName = (value: string) => {
  const cleaned = normalizeWhitespace(value);

  if (!cleaned) {
    return {
      firstName: "",
      lastName: "",
    };
  }

  const parts = cleaned.split(" ");

  return {
    firstName: parts.shift() ?? "",
    lastName: parts.join(" "),
  };
};

const parseVcfCard = (cardContent: string): ParsedVcfContact | null => {
  let fullName = "";
  let firstName = "";
  let lastName = "";
  let email = "";
  let phone = "";
  let address = "";
  let notes = "";

  for (const rawLine of cardContent.split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const separatorIndex = line.indexOf(":");

    if (separatorIndex === -1) {
      continue;
    }

    const descriptor = line.slice(0, separatorIndex);
    const rawValue = line.slice(separatorIndex + 1);
    const propertyName = descriptor.split(";")[0]?.split(".").pop()?.toUpperCase();

    if (!propertyName) {
      continue;
    }

    if (propertyName === "FN" && !fullName) {
      fullName = decodeVcfValue(rawValue);
    }

    if (propertyName === "N" && (!firstName || !lastName)) {
      const parts = rawValue.split(";").map((part) => decodeVcfValue(part));
      lastName ||= parts[0] ?? "";
      firstName ||= parts[1] ?? "";
    }

    if (propertyName === "EMAIL" && !email) {
      email = decodeVcfValue(rawValue);
    }

    if (propertyName === "TEL" && !phone) {
      phone = decodeVcfValue(rawValue);
    }

    if (propertyName === "ADR" && !address) {
      address = parseVcfAddress(rawValue);
    }

    if (propertyName === "NOTE") {
      notes = notes
        ? `${notes}\n${decodeVcfValue(rawValue)}`
        : decodeVcfValue(rawValue);
    }
  }

  let resolvedFirstName = normalizeWhitespace(firstName);
  let resolvedLastName = normalizeWhitespace(lastName);
  let resolvedDisplayName = normalizeWhitespace(fullName);

  if ((!resolvedFirstName && !resolvedLastName) && resolvedDisplayName) {
    const splitName = splitDisplayName(resolvedDisplayName);
    resolvedFirstName = splitName.firstName;
    resolvedLastName = splitName.lastName;
  }

  if (!resolvedDisplayName) {
    resolvedDisplayName = normalizeWhitespace(
      [resolvedFirstName, resolvedLastName].filter(Boolean).join(" "),
    );
  }

  if (!resolvedFirstName && !resolvedLastName) {
    const fallbackName = normalizeWhitespace(email || phone);

    if (fallbackName) {
      const splitName = splitDisplayName(fallbackName);
      resolvedFirstName = splitName.firstName;
      resolvedLastName = splitName.lastName;
      resolvedDisplayName ||= fallbackName;
    }
  }

  if (!resolvedFirstName && !resolvedLastName && !resolvedDisplayName) {
    return null;
  }

  return {
    displayName:
      resolvedDisplayName ||
      normalizeWhitespace([resolvedFirstName, resolvedLastName].join(" ")) ||
      "Imported contact",
    firstName: resolvedFirstName || resolvedDisplayName || "Imported",
    lastName: resolvedLastName,
    email: normalizeWhitespace(email),
    phone: normalizeWhitespace(phone),
    address: normalizeWhitespace(address),
    notes: normalizeWhitespace(notes),
  };
};

const parseVcfContacts = (content: string) => {
  const unfoldedContent = content.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const contacts: ParsedVcfContact[] = [];

  for (const match of unfoldedContent.matchAll(/BEGIN:VCARD\s*([\s\S]*?)END:VCARD/gi)) {
    const cardContent = match[1] ?? "";
    const parsedContact = parseVcfCard(cardContent);

    if (parsedContact) {
      contacts.push(parsedContact);
    }
  }

  return contacts;
};

const defaultDynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({})) as AwsCommandClient;
const defaultCognitoClient = new CognitoIdentityProviderClient({}) as AwsCommandClient;
const defaultSesClient = new SESv2Client({}) as AwsCommandClient;
const allowedUserGroups = ["admin", "super_user", "regular_user", "parking_admin"] as const;
let dynamoClient: AwsCommandClient = defaultDynamoClient;
let cognitoClient: AwsCommandClient = defaultCognitoClient;
let sesClient: AwsCommandClient = defaultSesClient;

const responseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json",
};
const googleCalendarScope = "https://www.googleapis.com/auth/calendar";
const googleConnectionPk = "CALENDAR_INTEGRATION";
const googleOauthStatePk = "CALENDAR_OAUTH_STATE";
const googleEventSyncPkPrefix = "CALENDAR_EVENT_SYNC";
const googleEventSyncStateSk = "SYNC_STATE";
const googleEventSyncMonthSkPrefix = "MONTH";
const googleCalendarCongregationMetadataKey = "shepherdHubCongregation";
const googleOauthStateTtlMs = 10 * 60 * 1000;
const googleAccessTokenExpiryBufferMs = 60 * 1000;
const googleCalendarMonthCacheTargetBytes = 350 * 1024;
const getRequestGroups = (event: Parameters<APIGatewayProxyHandlerV2>[0]) => {
  const claims =
    ((event.requestContext as { authorizer?: { jwt?: { claims?: Record<string, unknown> } } })
      .authorizer?.jwt?.claims as Record<string, unknown> | undefined) ?? {};
  const normalizeGroups = (rawGroups: unknown) => {
    if (Array.isArray(rawGroups)) {
      return rawGroups.map(String);
    }

    if (typeof rawGroups === "string") {
      try {
        const parsed = JSON.parse(rawGroups);
        return Array.isArray(parsed) ? parsed.map(String) : [rawGroups];
      } catch {
        const cleaned = rawGroups.replace(/^\[|\]$/g, "").trim();

        return cleaned
          .split(/[,\s]+/)
          .map((group) => group.trim())
          .filter(Boolean);
      }
    }

    return [];
  };

  return Array.from(
    new Set([
      ...normalizeGroups(claims["cognito:groups"]),
      ...normalizeGroups(claims.groups),
    ]),
  );
};

const isUserManager = (groups: string[]) =>
  groups.includes("admin") || groups.includes("super_user");
const isAdminUser = (groups: string[]) => groups.includes("admin");

const getRequestEmail = (event: Parameters<APIGatewayProxyHandlerV2>[0]) => {
  const claims =
    ((event.requestContext as { authorizer?: { jwt?: { claims?: Record<string, unknown> } } })
      .authorizer?.jwt?.claims as Record<string, unknown> | undefined) ?? {};

  const email = claims.email;

  return typeof email === "string" ? normalizeEmail(email) : "";
};

const getRequestUserKey = (event: Parameters<APIGatewayProxyHandlerV2>[0]) => {
  const claims =
    ((event.requestContext as { authorizer?: { jwt?: { claims?: Record<string, unknown> } } })
      .authorizer?.jwt?.claims as Record<string, unknown> | undefined) ?? {};

  const sub =
    typeof claims.sub === "string"
      ? normalizeWhitespace(String(claims.sub)).toLowerCase()
      : "";
  const email = typeof claims.email === "string" ? normalizeEmail(claims.email) : "";
  const cognitoUsername =
    typeof claims["cognito:username"] === "string"
      ? normalizeWhitespace(String(claims["cognito:username"])).toLowerCase()
      : "";

  return sub || email || cognitoUsername;
};

const getHeaderValue = (
  headers: Parameters<APIGatewayProxyHandlerV2>[0]["headers"],
  name: string,
) => {
  const lookupName = name.toLowerCase();
  const match = Object.entries(headers ?? {}).find(
    ([headerName]) => headerName.toLowerCase() === lookupName,
  );

  return typeof match?.[1] === "string" ? match[1] : "";
};

const getGoogleClientId = () => normalizeWhitespace(process.env.GOOGLE_CLIENT_ID);
const getGoogleClientSecret = () => normalizeWhitespace(process.env.GOOGLE_CLIENT_SECRET);
const getGoogleCalendarCallbackUrl = () =>
  normalizeWhitespace(process.env.GOOGLE_CALENDAR_CALLBACK_URL);
const getGoogleTokenEncryptionKey = () =>
  normalizeWhitespace(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY);

const getGoogleConnectionSortKey = (email: string) => `GOOGLE#${email}`;
const getGoogleOauthStateSortKey = (state: string) => `GOOGLE#${state}`;
const getGoogleEventSyncPartitionKey = (userKey: string, calendarId: string) =>
  `${googleEventSyncPkPrefix}#${userKey}#${calendarId}`;
const getGoogleEventSyncMonthSortKey = (month: string, chunkIndex: number) =>
  `${googleEventSyncMonthSkPrefix}#${month}#${String(chunkIndex).padStart(3, "0")}`;

const getRequiredGoogleConfig = () => {
  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();
  const callbackUrl = getGoogleCalendarCallbackUrl();
  const encryptionKey = getGoogleTokenEncryptionKey();

  if (!clientId || !clientSecret || !callbackUrl || !encryptionKey) {
    throw new Error(
      "Google Calendar OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALENDAR_CALLBACK_URL, and GOOGLE_TOKEN_ENCRYPTION_KEY.",
    );
  }

  return {
    clientId,
    clientSecret,
    callbackUrl,
    encryptionKey,
  };
};

const getEncryptionKeyBytes = () => {
  const { encryptionKey } = getRequiredGoogleConfig();
  const decodedKey = Buffer.from(encryptionKey, "base64");

  if (decodedKey.length !== 32) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }

  return decodedKey;
};

const encryptSecret = (value: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKeyBytes(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv, tag, encrypted].map((part) => part.toString("base64")).join(".");
};

const decryptSecret = (value: string) => {
  const [ivPart, tagPart, encryptedPart] = value.split(".");

  if (!ivPart || !tagPart || !encryptedPart) {
    throw new Error("Encrypted secret is malformed.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKeyBytes(),
    Buffer.from(ivPart, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
};

const parseAbsoluteHttpUrl = (value?: string) => {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

const buildCalendarReturnUrl = ({
  returnTo,
  status,
  message,
}: {
  returnTo: string;
  status: "success" | "error";
  message: string;
}) => {
  const url = new URL(returnTo);
  url.searchParams.set("calendar-google-status", status);
  url.searchParams.set("calendar-google-message", message);
  return url.toString();
};

const redirectResponse = (location: string) => ({
  statusCode: 302,
  headers: {
    Location: location,
    "Cache-Control": "no-store",
  },
  body: "",
});

const exchangeGoogleToken = async (
  formBody: URLSearchParams,
): Promise<Required<Pick<GoogleTokenResponse, "access_token" | "expires_in">> &
  Pick<GoogleTokenResponse, "refresh_token" | "scope" | "token_type">> => {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody.toString(),
  });

  const responseBody = (await response.json()) as GoogleTokenResponse;

  if (!response.ok || !responseBody.access_token || !responseBody.expires_in) {
    const errorMessage =
      responseBody.error_description || responseBody.error || "Google token exchange failed.";
    throw new Error(errorMessage);
  }

  return {
    access_token: responseBody.access_token,
    expires_in: responseBody.expires_in,
    refresh_token: responseBody.refresh_token,
    scope: responseBody.scope,
    token_type: responseBody.token_type,
  };
};

const queryGoogleCalendarFreeBusy = async ({
  accessToken,
  timeMin,
  timeMax,
  timeZone,
  calendarId,
}: {
  accessToken: string;
  timeMin: string;
  timeMax: string;
  timeZone?: string;
  calendarId?: string;
}) => {
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      timeZone,
      items: [{ id: calendarId || "primary" }],
    }),
  });

  const responseBody = (await response.json()) as GoogleFreeBusyResponse & {
    error?: {
      message?: string;
    };
  };

  if (!response.ok) {
    throw new Error(
      responseBody.error?.message || "Unable to load Google Calendar free/busy data.",
    );
  }

  return responseBody;
};

const listGoogleCalendars = async (accessToken: string) => {
  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  const responseBody = (await response.json()) as GoogleCalendarListResponse & {
    error?: {
      message?: string;
    };
  };

  if (!response.ok) {
    throw new Error(responseBody.error?.message || "Unable to load Google calendars.");
  }

  return (responseBody.items ?? [])
    .filter((item) => item.id)
    .map((item) => ({
      id: String(item.id),
      name: item.summaryOverride || item.summary || String(item.id),
      primary: Boolean(item.primary),
      accessRole: item.accessRole ?? "",
      timeZone: item.timeZone ?? "",
      hidden: Boolean(item.hidden),
      selected: Boolean(item.selected),
    }));
};

const normalizeGoogleCalendarEvent = (item: {
  id?: string;
  summary?: string;
  status?: string;
  htmlLink?: string;
  location?: string;
  description?: string;
  extendedProperties?: {
    private?: Record<string, string | undefined>;
  };
  eventType?: string;
  visibility?: string;
  start?: {
    dateTime?: string;
    date?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
  };
  organizer?: {
    email?: string;
    displayName?: string;
  };
}): StoredGoogleCalendarSyncedEventData | null => {
  if (!item.id || item.status === "cancelled") {
    return null;
  }

  const start = item.start?.dateTime || item.start?.date || "";
  const end = item.end?.dateTime || item.end?.date || "";

  if (!start || !end) {
    return null;
  }

  return {
    id: String(item.id),
    title: item.summary || "(No title)",
    status: item.status ?? "",
    htmlLink: item.htmlLink ?? "",
    location: item.location ?? "",
    description: item.description ?? "",
    eventType: item.eventType ?? "default",
    visibility: item.visibility ?? "default",
    start,
    end,
    isAllDay: Boolean(item.start?.date && !item.start?.dateTime),
    organizer: item.organizer?.displayName || item.organizer?.email || "",
    congregationItems: parseGoogleCalendarCongregationMetadata(
      item.extendedProperties?.private?.[googleCalendarCongregationMetadataKey],
    ),
  };
};

const getGoogleCalendarEventMonthKey = (event: Pick<StoredGoogleCalendarSyncedEventData, "start">) =>
  event.start.slice(0, 7);

const isGoogleCalendarMonthCacheSortKey = (sortKey: string) =>
  sortKey.startsWith(`${googleEventSyncMonthSkPrefix}#`);

const getSerializedGoogleCalendarMonthCacheSize = (
  month: string,
  items: StoredGoogleCalendarSyncedEventData[],
) => Buffer.byteLength(JSON.stringify({ month, items } satisfies StoredGoogleCalendarMonthCacheData), "utf8");

const parseGoogleCalendarMonthCacheRow = (item: TableRow) => {
  if (!isGoogleCalendarMonthCacheSortKey(item.sk)) {
    return null;
  }

  try {
    const parsed = JSON.parse(String(item.data)) as StoredGoogleCalendarMonthCacheData;

    if (!parsed || typeof parsed.month !== "string" || !Array.isArray(parsed.items)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

const buildGoogleCalendarMonthCacheChunks = (
  events: StoredGoogleCalendarSyncedEventData[],
): StoredGoogleCalendarMonthCacheData[] => {
  const eventsByMonth = new Map<string, StoredGoogleCalendarSyncedEventData[]>();

  for (const event of events) {
    const monthKey = getGoogleCalendarEventMonthKey(event);
    const existingMonthEvents = eventsByMonth.get(monthKey) ?? [];
    existingMonthEvents.push(event);
    eventsByMonth.set(monthKey, existingMonthEvents);
  }

  const monthChunks: StoredGoogleCalendarMonthCacheData[] = [];

  for (const monthKey of Array.from(eventsByMonth.keys()).sort()) {
    const monthEvents = (eventsByMonth.get(monthKey) ?? []).slice().sort((left, right) =>
      left.start.localeCompare(right.start),
    );

    let currentChunk: StoredGoogleCalendarSyncedEventData[] = [];

    for (const event of monthEvents) {
      const nextChunk = [...currentChunk, event];

      if (
        currentChunk.length > 0 &&
        getSerializedGoogleCalendarMonthCacheSize(monthKey, nextChunk) >
          googleCalendarMonthCacheTargetBytes
      ) {
        monthChunks.push({
          month: monthKey,
          items: currentChunk,
        });
        currentChunk = [event];
        continue;
      }

      currentChunk = nextChunk;
    }

    if (currentChunk.length > 0) {
      monthChunks.push({
        month: monthKey,
        items: currentChunk,
      });
    }
  }

  return monthChunks;
};

const listGoogleCalendarEvents = async ({
  accessToken,
  calendarId,
  timeMin,
  timeMax,
  timeZone,
}: {
  accessToken: string;
  calendarId: string;
  timeMin: string;
  timeMax: string;
  timeZone?: string;
}) => {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
  );
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "100");
  if (timeZone) {
    url.searchParams.set("timeZone", timeZone);
  }

  console.log("Listing Google Calendar events directly.", {
    calendarId,
    timeMin,
    timeMax,
    timeZone: timeZone ?? null,
    query: url.toString(),
  });

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const responseBody = (await response.json()) as GoogleCalendarEventsListResponse & {
    error?: { message?: string };
  };

  console.log("Google Calendar direct events response received.", {
    calendarId,
    ok: response.ok,
    status: response.status,
    itemCount: Array.isArray(responseBody.items) ? responseBody.items.length : 0,
    errorMessage: responseBody.error?.message ?? null,
  });

  if (!response.ok) {
    throw new Error(responseBody.error?.message || "Unable to load Google Calendar events.");
  }

  return (responseBody.items ?? [])
    .map(normalizeGoogleCalendarEvent)
    .filter((item): item is StoredGoogleCalendarSyncedEventData => item !== null);
};

const loadGoogleCalendarEventsForCalendar = async ({
  tableName,
  time,
  userKey,
  calendarId,
  timeMin,
  timeMax,
  timeZone,
  useSyncCache,
  cacheOnly,
  forceSync,
  selectedYearMonth,
}: {
  tableName: string;
  time: string;
  userKey: string;
  calendarId: string;
  timeMin: string;
  timeMax: string;
  timeZone?: string;
  useSyncCache: boolean;
  cacheOnly: boolean;
  forceSync: boolean;
  selectedYearMonth?: string;
}): Promise<GoogleCalendarLoadedEventsResult> => {
  console.log("loadGoogleCalendarEventsForCalendar started.", {
    tableName,
    userKey,
    calendarId,
    timeMin,
    timeMax,
    timeZone: timeZone ?? null,
    useSyncCache,
    cacheOnly,
    forceSync,
    selectedYearMonth: selectedYearMonth ?? null,
  });
  let existingConnection: StoredGoogleCalendarConnectionData | null | undefined;

  const loadExistingConnection = async () => {
    if (existingConnection !== undefined) {
      console.log("Reusing previously loaded Google Calendar connection state.", {
        userKey,
        calendarId,
        hasConnection: Boolean(existingConnection),
      });
      return existingConnection;
    }

    existingConnection = await getStoredGoogleConnection(tableName, userKey);

    console.log("Google Calendar events connection lookup completed.", {
      userKey,
      calendarId,
      hasConnection: Boolean(existingConnection),
    });

    return existingConnection;
  };

  const requireExistingConnection = async () => {
    const connection = await loadExistingConnection();

    if (!connection) {
      console.warn("Google Calendar connection is required but missing.", {
        userKey,
        calendarId,
      });
      throw Object.assign(new Error("Google Calendar is not connected."), {
        statusCode: 404,
      });
    }

    console.log("Google Calendar connection requirement satisfied.", {
      userKey,
      calendarId,
    });
    return connection;
  };

  if (useSyncCache) {
    try {
      if (cacheOnly) {
        console.log("Serving Google Calendar events from DynamoDB cache only.", {
          calendarId,
          userKey,
          selectedYearMonth: selectedYearMonth || null,
        });
        const cachedItems = await getCachedGoogleCalendarEventsForRange({
          tableName,
          userKey,
          calendarId,
          timeMin,
          timeMax,
          selectedYearMonth: selectedYearMonth || undefined,
        });
        console.log("Google Calendar cache-only load completed.", {
          userKey,
          calendarId,
          cachedItemCount: cachedItems.length,
        });

        return {
          items: cachedItems,
          changedResources: [],
          syncMode: "cached",
          debug: buildGoogleCalendarEventsRangeDebug({
            allItems: cachedItems,
            returnedItems: cachedItems,
          }),
        };
      }

      const connection = await requireExistingConnection();
      const currentConnection = await refreshGoogleAccessTokenIfNeeded({
        tableName,
        time,
        email: userKey,
        connection,
      });
      console.log("Google Calendar events connection ready.", {
        userKey,
        calendarId,
        accessTokenExpiresAt: currentConnection.accessTokenExpiresAt ?? null,
      });
      const accessToken = decryptSecret(currentConnection.accessTokenEncrypted);
      console.log("Google Calendar access token decrypted for events request.", {
        userKey,
        calendarId,
      });
      const syncResult = await syncGoogleCalendarEventCache({
        tableName,
        time,
        userKey,
        calendarId,
        accessToken,
      });
      console.log("Google Calendar sync result ready for range filtering.", {
        userKey,
        calendarId,
        totalSyncedEventCount: syncResult.events.length,
        changedResourceCount: syncResult.changedResources.length,
        hadPriorSyncToken: syncResult.hadPriorSyncToken,
      });
      const monthCandidateItems = syncResult.events.filter((item) => {
        if (!selectedYearMonth) {
          return true;
        }

        const start = Date.parse(item.start);
        const end = Date.parse(item.end);

        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          return false;
        }

        const relevantMonthKeys = new Set<string>([item.start.slice(0, 7)]);
        relevantMonthKeys.add(new Date(Math.max(start, end - 1)).toISOString().slice(0, 7));
        return relevantMonthKeys.has(selectedYearMonth);
      });
      console.log("Google Calendar month candidate filtering completed.", {
        userKey,
        calendarId,
        selectedYearMonth: selectedYearMonth ?? null,
        monthCandidateCount: monthCandidateItems.length,
        monthCandidatePreview: monthCandidateItems.slice(0, 10).map((item) => ({
          id: item.id,
          title: item.title,
          start: item.start,
          end: item.end,
        })),
      });
      const returnedItems = filterGoogleCalendarEventsForRange({
        items: syncResult.events,
        timeMin,
        timeMax,
        selectedYearMonth,
      });
      console.log("Google Calendar stage 2 range filtering completed.", {
        userKey,
        calendarId,
        returnedItemCount: returnedItems.length,
        returnedItemPreview: returnedItems.slice(0, 10).map((item) => ({
          id: item.id,
          title: item.title,
          start: item.start,
          end: item.end,
        })),
      });

      return {
        items: returnedItems,
        changedResources: syncResult.changedResources,
        syncMode: syncResult.hadPriorSyncToken ? "incremental" : "full",
        debug: buildGoogleCalendarEventsRangeDebug({
          allItems: syncResult.events,
          candidateItems: monthCandidateItems,
          returnedItems,
        }),
      };
    } catch (error) {
      const typedError = error as Error & { statusCode?: number };
      if (typedError.statusCode === 404) {
        throw error;
      }
      console.error("Google Calendar sync cache path failed; falling back to direct events fetch.", {
        calendarId,
        userKey,
        timeMin,
        timeMax,
        statusCode: typedError.statusCode ?? null,
        errorMessage: typedError.message,
      });
      const connection = await requireExistingConnection();
      const currentConnection = await refreshGoogleAccessTokenIfNeeded({
        tableName,
        time,
        email: userKey,
        connection,
      });
      console.log("Google Calendar events connection ready for direct fallback.", {
        userKey,
        calendarId,
        accessTokenExpiresAt: currentConnection.accessTokenExpiresAt ?? null,
      });
      const accessToken = decryptSecret(currentConnection.accessTokenEncrypted);
      console.log("Google Calendar access token decrypted for direct fallback.", {
        userKey,
        calendarId,
      });
      const directFallbackItems = await listGoogleCalendarEvents({
        accessToken,
        calendarId,
        timeMin,
        timeMax,
        timeZone,
      });
      console.log("Google Calendar direct fallback load completed.", {
        userKey,
        calendarId,
        itemCount: directFallbackItems.length,
        itemPreview: directFallbackItems.slice(0, 10).map((item) => ({
          id: item.id,
          title: item.title,
          start: item.start,
          end: item.end,
        })),
      });
      return {
        items: directFallbackItems,
        changedResources: [],
        syncMode: "direct",
        debug: undefined,
      };
    }
  }

  const connection = await requireExistingConnection();
  const currentConnection = await refreshGoogleAccessTokenIfNeeded({
    tableName,
    time,
    email: userKey,
    connection,
  });
  console.log("Google Calendar events connection ready.", {
    userKey,
    calendarId,
    accessTokenExpiresAt: currentConnection.accessTokenExpiresAt ?? null,
  });
  const accessToken = decryptSecret(currentConnection.accessTokenEncrypted);
  console.log("Google Calendar access token decrypted for events request.", {
    userKey,
    calendarId,
  });
  const directItems = await listGoogleCalendarEvents({
    accessToken,
    calendarId,
    timeMin,
    timeMax,
    timeZone,
  });
  console.log("Google Calendar direct non-cache load completed.", {
    userKey,
    calendarId,
    itemCount: directItems.length,
    itemPreview: directItems.slice(0, 10).map((item) => ({
      id: item.id,
      title: item.title,
      start: item.start,
      end: item.end,
    })),
  });
  return {
    items: directItems,
    changedResources: [],
    syncMode: "direct",
    debug: buildGoogleCalendarEventsRangeDebug({
      allItems: directItems,
      returnedItems: directItems,
    }),
  };
};

const listGoogleCalendarEventsSyncPage = async ({
  accessToken,
  calendarId,
  syncToken,
  pageToken,
}: {
  accessToken: string;
  calendarId: string;
  syncToken?: string;
  pageToken?: string;
}) => {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
  );
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("showDeleted", "true");
  url.searchParams.set("maxResults", "2500");
  if (syncToken) {
    url.searchParams.set("syncToken", syncToken);
  }
  if (pageToken) {
    url.searchParams.set("pageToken", pageToken);
  }

  console.log("Requesting Google Calendar sync page.", {
    calendarId,
    hasSyncToken: Boolean(syncToken),
    hasPageToken: Boolean(pageToken),
    query: url.toString(),
  });

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const responseBody = (await response.json()) as GoogleCalendarEventsListResponse & {
    error?: { message?: string };
    nextPageToken?: string;
    nextSyncToken?: string;
  };

  console.log("Google Calendar sync page response received.", {
    calendarId,
    ok: response.ok,
    status: response.status,
    itemCount: Array.isArray(responseBody.items) ? responseBody.items.length : 0,
    hasNextPageToken: Boolean(responseBody.nextPageToken),
    hasNextSyncToken: Boolean(responseBody.nextSyncToken),
    errorMessage: responseBody.error?.message ?? null,
  });

  if (!response.ok) {
    const error = new Error(
      responseBody.error?.message || "Unable to synchronize Google Calendar events.",
    ) as Error & { statusCode?: number };
    error.statusCode = response.status;
    throw error;
  }

  return {
    items: responseBody.items ?? [],
    nextPageToken: responseBody.nextPageToken ?? "",
    nextSyncToken: responseBody.nextSyncToken ?? "",
  };
};

const getGoogleCalendarSyncState = async (
  tableName: string,
  userKey: string,
  calendarId: string,
) => {
  console.log("Loading Google Calendar sync state.", {
    tableName,
    userKey,
    calendarId,
  });
  const response = await dynamoClient.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        pk: getGoogleEventSyncPartitionKey(userKey, calendarId),
        sk: googleEventSyncStateSk,
      },
    }),
  );

  if (!response.Item?.data) {
    console.log("Google Calendar sync state not found.", {
      userKey,
      calendarId,
    });
    return null;
  }

  try {
    const parsed = JSON.parse(String(response.Item.data)) as StoredGoogleCalendarSyncStateData;
    console.log("Google Calendar sync state loaded.", {
      userKey,
      calendarId,
      hasSyncToken: Boolean(parsed.syncToken),
    });
    return parsed;
  } catch {
    console.error("Google Calendar sync state JSON parsing failed.", {
      userKey,
      calendarId,
    });
    return null;
  }
};

const saveGoogleCalendarSyncState = async (
  tableName: string,
  userKey: string,
  calendarId: string,
  syncState: StoredGoogleCalendarSyncStateData,
) => {
  console.log("Saving Google Calendar sync state.", {
    tableName,
    userKey,
    calendarId,
    hasSyncToken: Boolean(syncState.syncToken),
  });
  await dynamoClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        pk: getGoogleEventSyncPartitionKey(userKey, calendarId),
        sk: googleEventSyncStateSk,
        data: JSON.stringify(syncState),
      },
    }),
  );
};

const loadAllGoogleCalendarCachedEvents = async (
  tableName: string,
  userKey: string,
  calendarId: string,
) => {
  console.log("Loading all cached Google Calendar month entries.", {
    tableName,
    userKey,
    calendarId,
  });
  const response = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": getGoogleEventSyncPartitionKey(userKey, calendarId),
      },
    }),
  );

  const items = ((response.Items ?? []) as TableRow[])
    .map((item) => {
      const parsed = parseGoogleCalendarMonthCacheRow(item);

      if (!parsed && isGoogleCalendarMonthCacheSortKey(item.sk)) {
        console.error("Failed to parse Google Calendar month cache row.", {
          userKey,
          calendarId,
          sortKey: item.sk,
        });
      }

      return parsed;
    })
    .filter((item): item is StoredGoogleCalendarMonthCacheData => item !== null)
    .flatMap((item) => item.items)
    .sort((left, right) => left.start.localeCompare(right.start));

  console.log("Loaded all cached Google Calendar month entries.", {
    userKey,
    calendarId,
    rawItemCount: (response.Items ?? []).length,
    eventCount: items.length,
  });

  return {
    rows: (response.Items ?? []) as TableRow[],
    items,
  };
};

const clearGoogleCalendarCachedEvents = async (
  tableName: string,
  userKey: string,
  calendarId: string,
) => {
  console.warn("Clearing Google Calendar cached events.", {
    tableName,
    userKey,
    calendarId,
  });
  const response = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": getGoogleEventSyncPartitionKey(userKey, calendarId),
      },
    }),
  );

  console.warn("Google Calendar cached events query completed before clear.", {
    userKey,
    calendarId,
    itemCount: (response.Items ?? []).length,
  });

  await Promise.all(
    ((response.Items ?? []) as TableRow[]).map((item) =>
      dynamoClient.send(
        new DeleteCommand({
          TableName: tableName,
          Key: {
            pk: item.pk,
            sk: item.sk,
          },
        }),
      ),
    ),
  );
};

const rewriteGoogleCalendarMonthCache = async ({
  tableName,
  userKey,
  calendarId,
  rows,
  events,
}: {
  tableName: string;
  userKey: string;
  calendarId: string;
  rows: TableRow[];
  events: StoredGoogleCalendarSyncedEventData[];
}) => {
  const monthRows = rows.filter((item) => isGoogleCalendarMonthCacheSortKey(item.sk));
  const monthChunks = buildGoogleCalendarMonthCacheChunks(events);

  console.log("Rewriting Google Calendar month cache.", {
    tableName,
    userKey,
    calendarId,
    previousMonthRowCount: monthRows.length,
    nextMonthRowCount: monthChunks.length,
    eventCount: events.length,
  });

  await Promise.all(
    monthRows.map((item) =>
      dynamoClient.send(
        new DeleteCommand({
          TableName: tableName,
          Key: {
            pk: item.pk,
            sk: item.sk,
          },
        }),
      ),
    ),
  );

  await Promise.all(
    monthChunks.map((chunk, index) =>
      dynamoClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: getGoogleEventSyncPartitionKey(userKey, calendarId),
            sk: getGoogleEventSyncMonthSortKey(chunk.month, index + 1),
            data: JSON.stringify(chunk),
          },
        }),
      ),
    ),
  );
};

const syncGoogleCalendarEventCache = async ({
  tableName,
  time,
  userKey,
  calendarId,
  accessToken,
}: {
  tableName: string;
  time: string;
  userKey: string;
  calendarId: string;
  accessToken: string;
}): Promise<GoogleCalendarSyncedCacheResult> => {
  console.log("Starting Google Calendar event cache sync.", {
    tableName,
    userKey,
    calendarId,
  });
  const syncState = await getGoogleCalendarSyncState(tableName, userKey, calendarId);
  const priorSyncToken = syncState?.syncToken;
  let cachedState:
    | {
        rows: TableRow[];
        items: StoredGoogleCalendarSyncedEventData[];
      }
    | null = priorSyncToken
    ? null
    : {
        rows: [] as TableRow[],
        items: [] as StoredGoogleCalendarSyncedEventData[],
      };
  let cachedEventsById = new Map<string, StoredGoogleCalendarSyncedEventData>(
    (cachedState?.items ?? []).map((item) => [item.id, item] as const),
  );
  let pageToken = "";
  let nextSyncToken = "";
  const changedResources: GoogleCalendarSyncChangedResource[] = [];
  let pageCount = 0;

  const ensureCachedEventsLoaded = async () => {
    if (cachedState) {
      return;
    }

    cachedState = await loadAllGoogleCalendarCachedEvents(tableName, userKey, calendarId);
    cachedEventsById = new Map(cachedState.items.map((item) => [item.id, item] as const));
  };

  try {
    do {
      pageCount += 1;
      const page = await listGoogleCalendarEventsSyncPage({
        accessToken,
        calendarId,
        syncToken: priorSyncToken,
        pageToken: pageToken || undefined,
      });

      console.log("Processing Google Calendar sync page.", {
        calendarId,
        userKey,
        pageCount,
        receivedItemCount: page.items.length,
        hasNextPageToken: Boolean(page.nextPageToken),
        hasNextSyncToken: Boolean(page.nextSyncToken),
      });

      for (const rawItem of page.items) {
        if (!rawItem.id) {
          console.warn("Skipping Google Calendar sync item without id.", {
            calendarId,
            userKey,
          });
          continue;
        }

        if (rawItem.status === "cancelled") {
          await ensureCachedEventsLoaded();
          changedResources.push({
            id: String(rawItem.id),
            status: rawItem.status ?? "cancelled",
            changeType: "deleted",
          });
          cachedEventsById.delete(String(rawItem.id));
          continue;
        }

        const normalizedEvent = normalizeGoogleCalendarEvent(rawItem);

        if (!normalizedEvent) {
          console.warn("Skipping Google Calendar sync item that could not be normalized.", {
            calendarId,
            userKey,
            eventId: String(rawItem.id),
            status: rawItem.status ?? null,
          });
          continue;
        }

        changedResources.push({
          ...normalizedEvent,
          changeType: "upsert",
        });
        await ensureCachedEventsLoaded();
        cachedEventsById.set(normalizedEvent.id, normalizedEvent);
      }

      pageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken || nextSyncToken;
    } while (pageToken);
  } catch (error) {
    const typedError = error as Error & { statusCode?: number };

    if (typedError.statusCode === 410) {
      console.warn("Google Calendar sync token expired; clearing cached events and retrying full sync.", {
        calendarId,
        userKey,
        statusCode: typedError.statusCode,
      });
      await clearGoogleCalendarCachedEvents(tableName, userKey, calendarId);
      return syncGoogleCalendarEventCache({
        tableName,
        time,
        userKey,
        calendarId,
        accessToken,
      });
    }

    console.error("Google Calendar sync cache update failed.", {
      calendarId,
      userKey,
      hadPriorSyncToken: Boolean(priorSyncToken),
      statusCode: typedError.statusCode ?? null,
      errorMessage: typedError.message,
    });
    throw error;
  }

  if (nextSyncToken) {
    await saveGoogleCalendarSyncState(tableName, userKey, calendarId, {
      syncToken: nextSyncToken,
    });
  }

  if (changedResources.length > 0) {
    await rewriteGoogleCalendarMonthCache({
      tableName,
      userKey,
      calendarId,
      rows: cachedState?.rows ?? [],
      events: Array.from(cachedEventsById.values()),
    });
  } else {
    console.log("Skipping Google Calendar month cache rewrite because sync returned no changes.", {
      calendarId,
      userKey,
      hadPriorSyncToken: Boolean(priorSyncToken),
    });
  }

  console.log("Google Calendar event cache sync completed.", {
    calendarId,
    userKey,
    pageCount,
    changedResourceCount: changedResources.length,
    hadPriorSyncToken: Boolean(priorSyncToken),
    savedNextSyncToken: Boolean(nextSyncToken),
  });

  await ensureCachedEventsLoaded();

  return {
    changedResources,
    hadPriorSyncToken: Boolean(priorSyncToken),
    events: Array.from(cachedEventsById.values()).sort((left, right) =>
      left.start.localeCompare(right.start),
    ),
  };
};

const filterGoogleCalendarEventsForRange = ({
  items,
  timeMin,
  timeMax,
  selectedYearMonth,
}: {
  items: StoredGoogleCalendarSyncedEventData[];
  timeMin: string;
  timeMax: string;
  selectedYearMonth?: string;
}) => {
  const windowStart = Date.parse(timeMin);
  const windowEnd = Date.parse(timeMax);
  const monthStart = new Date(timeMin);
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthKeys = new Set<string>();
  const cursor = new Date(monthStart);

  while (cursor.getTime() < windowEnd) {
    monthKeys.add(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const candidateItems = items.filter((item) => {
    const start = Date.parse(item.start);
    const end = Date.parse(item.end);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return false;
    }

    const relevantMonthKeys = new Set<string>([item.start.slice(0, 7)]);
    relevantMonthKeys.add(new Date(Math.max(start, end - 1)).toISOString().slice(0, 7));

    if (selectedYearMonth && monthKeys.size === 1) {
      return relevantMonthKeys.has(selectedYearMonth);
    }

    return Array.from(relevantMonthKeys).some((monthKey) => monthKeys.has(monthKey));
  });

  if (selectedYearMonth && monthKeys.size === 1) {
    return candidateItems.slice().sort((left, right) => left.start.localeCompare(right.start));
  }

  return candidateItems
    .filter((item) => {
      const start = Date.parse(item.start);
      const end = Date.parse(item.end);
      return (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end > windowStart &&
        start < windowEnd
      );
    })
    .sort((left, right) => left.start.localeCompare(right.start));
};

const buildGoogleCalendarEventsRangeDebug = ({
  allItems,
  candidateItems,
  returnedItems,
}: {
  allItems: StoredGoogleCalendarSyncedEventData[];
  candidateItems?: StoredGoogleCalendarSyncedEventData[];
  returnedItems: StoredGoogleCalendarSyncedEventData[];
}) => {
  const debugSourceItems = candidateItems ?? allItems;
  const returnedIds = new Set(returnedItems.map((item) => item.id));

  return {
    preFilterItemCount: debugSourceItems.length,
    returnedItemCount: returnedItems.length,
    filteredOutItems: debugSourceItems
      .filter((item) => !returnedIds.has(item.id))
      .map((item) => ({
        id: item.id,
        title: item.title,
        start: item.start,
        end: item.end,
      }))
      .slice(0, 25),
  };
};

const getCachedGoogleCalendarEventsForRange = async ({
  tableName,
  userKey,
  calendarId,
  timeMin,
  timeMax,
  selectedYearMonth,
}: {
  tableName: string;
  userKey: string;
  calendarId: string;
  timeMin: string;
  timeMax: string;
  selectedYearMonth?: string;
}) => {
  const windowStart = Date.parse(timeMin);
  const windowEnd = Date.parse(timeMax);
  const monthStart = new Date(timeMin);
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthKeys = new Set<string>();
  const cursor = new Date(monthStart);

  while (cursor.getTime() < windowEnd) {
    monthKeys.add(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  console.log("Loading cached Google Calendar events for range.", {
    tableName,
    userKey,
    calendarId,
    timeMin,
    timeMax,
    windowStart,
    windowEnd,
    monthKeys: Array.from(monthKeys.values()),
    selectedYearMonth: selectedYearMonth ?? null,
  });
  const response = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression:
        selectedYearMonth && monthKeys.size === 1
          ? "pk = :pk AND begins_with(sk, :skPrefix)"
          : "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": getGoogleEventSyncPartitionKey(userKey, calendarId),
        ...(selectedYearMonth && monthKeys.size === 1
          ? {
              ":skPrefix": `${googleEventSyncMonthSkPrefix}#${selectedYearMonth}#`,
            }
          : {}),
      },
    }),
  );

  const items = filterGoogleCalendarEventsForRange({
    items: ((response.Items ?? []) as TableRow[])
    .map((item) => {
      const parsed = parseGoogleCalendarMonthCacheRow(item);

      if (!parsed && isGoogleCalendarMonthCacheSortKey(item.sk)) {
        console.error("Failed to parse cached Google Calendar month row while loading range.", {
          userKey,
          calendarId,
          sortKey: item.sk,
        });
      }

      return parsed;
    })
    .filter(
      (item): item is StoredGoogleCalendarMonthCacheData =>
        item !== null && monthKeys.has(item.month),
    )
    .flatMap((item) => item.items),
    timeMin,
    timeMax,
    selectedYearMonth,
  });

  console.log("Loaded cached Google Calendar events for range.", {
    userKey,
    calendarId,
    rawItemCount: (response.Items ?? []).length,
    matchedItemCount: items.length,
  });

  return items;
};

const loadCongregationDirectoryItems = async (tableName: string) => {
  const response = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": "CONGREGATION",
      },
    }),
  );

  return ((response.Items ?? []) as TableRow[])
    .map((item) => {
      try {
        const parsed = JSON.parse(item.data) as StoredMemberData;
        const firstName = normalizeWhitespace(parsed.firstName);
        const lastName = normalizeWhitespace(parsed.lastName);

        if (!firstName && !lastName) {
          return null;
        }

        return {
          pk: item.pk,
          sk: item.sk,
          firstName,
          lastName,
          phone: normalizeWhitespace(parsed.phone),
        } satisfies CongregationDirectoryItem;
      } catch {
        return null;
      }
    })
    .filter((item): item is CongregationDirectoryItem => item !== null)
    .sort((left, right) =>
      `${left.firstName} ${left.lastName}`.localeCompare(`${right.firstName} ${right.lastName}`),
    );
};

const buildGoogleCalendarReportingRows = ({
  congregationItems,
  events,
}: {
  congregationItems: CongregationDirectoryItem[];
  events: StoredGoogleCalendarSyncedEventData[];
}) =>
  congregationItems
    .map((item) => {
      const memberName = normalizeWhitespace(`${item.firstName} ${item.lastName}`) || item.sk;
      const attachedEvents = events.filter((event) =>
        (event.congregationItems ?? []).some(
          (congregationItem) =>
            congregationItem.pk === item.pk && congregationItem.sk === item.sk,
        ),
      );
      const lastEventTimestamp = attachedEvents
        .map((event) => Date.parse(event.start))
        .filter((value) => Number.isFinite(value));

      return {
        pk: item.pk,
        sk: item.sk,
        memberName,
        eventCountThisYear: attachedEvents.length,
        lastEventDate:
          lastEventTimestamp.length > 0
            ? new Date(Math.max(...lastEventTimestamp)).toISOString()
            : null,
      };
    })
    .sort((left, right) => {
      if (left.eventCountThisYear !== right.eventCountThisYear) {
        return left.eventCountThisYear - right.eventCountThisYear;
      }

      if (left.lastEventDate !== right.lastEventDate) {
        return (left.lastEventDate ? Date.parse(left.lastEventDate) : 0) -
          (right.lastEventDate ? Date.parse(right.lastEventDate) : 0);
      }

      return left.memberName.localeCompare(right.memberName, undefined, {
        sensitivity: "base",
      });
    });

const createGoogleCalendarEvent = async ({
  accessToken,
  calendarId,
  title,
  start,
  end,
  timeZone,
  location,
  description,
  congregationItems,
}: {
  accessToken: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  timeZone?: string;
  location?: string;
  description?: string;
  congregationItems?: GoogleCalendarCongregationMetadataItem[];
}) => {
  const normalizedCongregationItems = normalizeGoogleCalendarCongregationMetadataItems(
    congregationItems,
  );
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: title,
        location,
        description,
        extendedProperties:
          normalizedCongregationItems.length > 0
            ? {
                private: {
                  [googleCalendarCongregationMetadataKey]: JSON.stringify(
                    normalizedCongregationItems,
                  ),
                },
              }
            : undefined,
        start: {
          dateTime: start,
          timeZone,
        },
        end: {
          dateTime: end,
          timeZone,
        },
      }),
    },
  );

  const responseBody = (await response.json()) as {
    error?: { message?: string };
    id?: string;
    summary?: string;
    status?: string;
    htmlLink?: string;
    location?: string;
    description?: string;
    extendedProperties?: {
      private?: Record<string, string | undefined>;
    };
    eventType?: string;
    visibility?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    organizer?: { email?: string; displayName?: string };
  };

  if (!response.ok || !responseBody.id) {
    throw new Error(responseBody.error?.message || "Unable to create Google Calendar event.");
  }

  return {
    id: responseBody.id,
    title: responseBody.summary || title,
    status: responseBody.status ?? "",
    htmlLink: responseBody.htmlLink ?? "",
    location: responseBody.location ?? location ?? "",
    description: responseBody.description ?? description ?? "",
    eventType: responseBody.eventType ?? "default",
    visibility: responseBody.visibility ?? "default",
    start: responseBody.start?.dateTime || responseBody.start?.date || start,
    end: responseBody.end?.dateTime || responseBody.end?.date || end,
    isAllDay: Boolean(responseBody.start?.date && !responseBody.start?.dateTime),
    organizer: responseBody.organizer?.displayName || responseBody.organizer?.email || "",
    congregationItems:
      parseGoogleCalendarCongregationMetadata(
        responseBody.extendedProperties?.private?.[googleCalendarCongregationMetadataKey],
      ).length > 0
        ? parseGoogleCalendarCongregationMetadata(
            responseBody.extendedProperties?.private?.[googleCalendarCongregationMetadataKey],
          )
        : normalizedCongregationItems,
  };
};

const updateGoogleCalendarEvent = async ({
  accessToken,
  calendarId,
  eventId,
  title,
  start,
  end,
  timeZone,
  location,
  description,
  congregationItems,
  isAllDay,
}: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  title: string;
  start: string;
  end: string;
  timeZone?: string;
  location?: string;
  description?: string;
  congregationItems?: GoogleCalendarCongregationMetadataItem[];
  isAllDay?: boolean;
}) => {
  const normalizedCongregationItems = normalizeGoogleCalendarCongregationMetadataItems(
    congregationItems,
  );
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: title,
        location,
        description,
        extendedProperties: {
          private: {
            [googleCalendarCongregationMetadataKey]:
              normalizedCongregationItems.length > 0
                ? JSON.stringify(normalizedCongregationItems)
                : "",
          },
        },
        ...(isAllDay
          ? {
              start: {
                date: start,
              },
              end: {
                date: end,
              },
            }
          : {
              start: {
                dateTime: start,
                timeZone,
              },
              end: {
                dateTime: end,
                timeZone,
              },
            }),
      }),
    },
  );

  const responseBody = (await response.json()) as {
    error?: { message?: string };
    id?: string;
    summary?: string;
    status?: string;
    htmlLink?: string;
    location?: string;
    description?: string;
    extendedProperties?: {
      private?: Record<string, string | undefined>;
    };
    eventType?: string;
    visibility?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    organizer?: { email?: string; displayName?: string };
  };

  if (!response.ok || !responseBody.id) {
    throw new Error(responseBody.error?.message || "Unable to update Google Calendar event.");
  }

  return {
    id: responseBody.id,
    title: responseBody.summary || title,
    status: responseBody.status ?? "",
    htmlLink: responseBody.htmlLink ?? "",
    location: responseBody.location ?? location ?? "",
    description: responseBody.description ?? description ?? "",
    eventType: responseBody.eventType ?? "default",
    visibility: responseBody.visibility ?? "default",
    start: responseBody.start?.dateTime || responseBody.start?.date || start,
    end: responseBody.end?.dateTime || responseBody.end?.date || end,
    isAllDay: Boolean(responseBody.start?.date && !responseBody.start?.dateTime),
    organizer: responseBody.organizer?.displayName || responseBody.organizer?.email || "",
    congregationItems:
      parseGoogleCalendarCongregationMetadata(
        responseBody.extendedProperties?.private?.[googleCalendarCongregationMetadataKey],
      ).length > 0
        ? parseGoogleCalendarCongregationMetadata(
            responseBody.extendedProperties?.private?.[googleCalendarCongregationMetadataKey],
          )
        : normalizedCongregationItems,
  };
};

const deleteGoogleCalendarEvent = async ({
  accessToken,
  calendarId,
  eventId,
}: {
  accessToken: string;
  calendarId: string;
  eventId: string;
}) => {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    let errorMessage = "Unable to delete Google Calendar event.";

    try {
      const responseBody = (await response.json()) as { error?: { message?: string } };
      errorMessage = responseBody.error?.message || errorMessage;
    } catch {
      // Ignore empty or non-JSON delete responses.
    }

    throw new Error(errorMessage);
  }
};

const getStoredGoogleConnection = async (tableName: string, email: string) => {
  console.log("Loading stored Google Calendar connection.", {
    tableName,
    userKey: email,
  });
  const response = await dynamoClient.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        pk: googleConnectionPk,
        sk: getGoogleConnectionSortKey(email),
      },
    }),
  );

  if (!response.Item?.data) {
    console.warn("Stored Google Calendar connection not found.", {
      userKey: email,
    });
    return null;
  }

  try {
    const parsed = JSON.parse(String(response.Item.data)) as StoredGoogleCalendarConnectionData;
    console.log("Stored Google Calendar connection loaded.", {
      userKey: email,
      hasAccessToken: Boolean(parsed.accessTokenEncrypted),
      hasRefreshToken: Boolean(parsed.refreshTokenEncrypted),
      accessTokenExpiresAt: parsed.accessTokenExpiresAt ?? null,
      lastError: parsed.lastError ?? null,
    });
    return parsed;
  } catch {
    console.error("Stored Google Calendar connection JSON parsing failed.", {
      userKey: email,
    });
    return null;
  }
};

const saveStoredGoogleConnection = async (
  tableName: string,
  email: string,
  connection: StoredGoogleCalendarConnectionData,
) => {
  await dynamoClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        pk: googleConnectionPk,
        sk: getGoogleConnectionSortKey(email),
        data: JSON.stringify(connection),
      },
    }),
  );
};

const refreshGoogleAccessTokenIfNeeded = async ({
  tableName,
  time,
  email,
  connection,
}: {
  tableName: string;
  time: string;
  email: string;
  connection: StoredGoogleCalendarConnectionData;
}) => {
  const expiresAtMs = Date.parse(connection.accessTokenExpiresAt ?? "");
  const isExpiredOrMissing =
    !connection.accessTokenEncrypted ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= Date.now() + googleAccessTokenExpiryBufferMs;

  console.log("Checking whether Google access token refresh is needed.", {
    userKey: email,
    hasAccessToken: Boolean(connection.accessTokenEncrypted),
    hasRefreshToken: Boolean(connection.refreshTokenEncrypted),
    accessTokenExpiresAt: connection.accessTokenExpiresAt ?? null,
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
    isExpiredOrMissing,
  });

  if (!isExpiredOrMissing) {
    console.log("Google access token refresh not needed.", {
      userKey: email,
    });
    return connection;
  }

  console.log("Refreshing Google access token.", {
    userKey: email,
  });
  const refreshToken = decryptSecret(connection.refreshTokenEncrypted);
  const { clientId, clientSecret, callbackUrl } = getRequiredGoogleConfig();

  const refreshedToken = await exchangeGoogleToken(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      redirect_uri: callbackUrl,
    }),
  );

  const refreshedAt = new Date();
  const nextConnection: StoredGoogleCalendarConnectionData = {
    ...connection,
    email,
    accessTokenEncrypted: encryptSecret(refreshedToken.access_token),
    accessTokenExpiresAt: new Date(
      refreshedAt.getTime() + refreshedToken.expires_in * 1000,
    ).toISOString(),
    tokenScope: refreshedToken.scope ?? connection.tokenScope,
    tokenType: refreshedToken.token_type ?? connection.tokenType,
    updatedAt: time,
    lastRefreshAt: time,
    lastError: null,
  };

  await saveStoredGoogleConnection(tableName, email, nextConnection);

  console.log("Google access token refresh completed and saved.", {
    userKey: email,
    nextAccessTokenExpiresAt: nextConnection.accessTokenExpiresAt,
  });

  return nextConnection;
};

const forbiddenResponse = (time: string, message: string) => ({
  statusCode: 403,
  headers: responseHeaders,
  body: JSON.stringify({
    message,
    time,
  }),
});

const getParkingNotificationFromEmail = () =>
  normalizeEmail(process.env.PARKING_NOTIFICATIONS_FROM_EMAIL);

const sendParkingRegistrationNotification = async ({
  fromEmail,
  toEmail,
  firstName,
  lastName,
  licensePlate,
  durationFrom,
  durationTo,
  placementStatus,
  waitingListPosition,
}: {
  fromEmail: string;
  toEmail: string;
  firstName: string;
  lastName: string;
  licensePlate: string;
  durationFrom: string;
  durationTo: string;
  placementStatus: "assigned" | "waiting-list" | "available";
  waitingListPosition?: number;
}) => {
  if (!fromEmail || !toEmail) {
    console.log("Parking registration email skipped", {
      reason: !fromEmail ? "missing_from_email" : "missing_to_email",
      fromEmailConfigured: Boolean(fromEmail),
      toEmailPresent: Boolean(toEmail),
      placementStatus,
      waitingListPosition: waitingListPosition ?? null,
    });
    return;
  }

  const memberName = normalizeWhitespace(`${firstName} ${lastName}`);
  const subject =
    placementStatus === "waiting-list"
      ? `Parking registration received - waiting list #${waitingListPosition ?? "-"}`
      : "Parking registration confirmed";
  const textBody =
    placementStatus !== "waiting-list"
      ? [
          `Hello ${firstName},`,
          "",
          `Your parking registration for ${memberName} has been received successfully.`,
          placementStatus === "available"
            ? "A parking spot is currently available and your registration is ready for parking-admin review."
            : "Your parking registration has been assigned successfully.",
          `License plate: ${licensePlate}`,
          `Duration: ${durationFrom} to ${durationTo}`,
          "",
          "Thank you.",
        ].join("\n")
      : [
          `Hello ${firstName},`,
          "",
          `Your parking registration for ${memberName} has been received.`,
          "There is currently no available parking spot, so your registration has been placed on the waiting list.",
          `Waiting list position: ${waitingListPosition ?? "-"}`,
          `License plate: ${licensePlate}`,
          `Duration: ${durationFrom} to ${durationTo}`,
          "",
          "Thank you.",
        ].join("\n");

  console.log("Parking registration email send requested", {
    fromEmail,
    toEmail,
    memberName,
    licensePlate,
    placementStatus,
    waitingListPosition: waitingListPosition ?? null,
    subject,
  });

  await sesClient.send(
    new SendEmailCommand({
      FromEmailAddress: fromEmail,
      Destination: {
        ToAddresses: [toEmail],
      },
      Content: {
        Simple: {
          Subject: {
            Data: subject,
          },
          Body: {
            Text: {
              Data: textBody,
            },
          },
        },
      },
    }),
  );

  console.log("Parking registration email sent", {
    toEmail,
    placementStatus,
    waitingListPosition: waitingListPosition ?? null,
  });
};

export const setHandlerClientsForTesting = (clients: {
  dynamoClient?: AwsCommandClient;
  cognitoClient?: AwsCommandClient;
  sesClient?: AwsCommandClient;
}) => {
  if (clients.dynamoClient) {
    dynamoClient = clients.dynamoClient;
  }

  if (clients.cognitoClient) {
    cognitoClient = clients.cognitoClient;
  }

  if (clients.sesClient) {
    sesClient = clients.sesClient;
  }
};

export const resetHandlerClientsForTesting = () => {
  dynamoClient = defaultDynamoClient;
  cognitoClient = defaultCognitoClient;
  sesClient = defaultSesClient;
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const time = new Date().toISOString();
  const tableName = process.env.TEST_TABLE_NAME;
  const userPoolId = process.env.USER_POOL_ID;
  const requestPath = event.requestContext.http.path;
  const requestGroups = getRequestGroups(event);
  const requestEmail = getRequestEmail(event);
  const requestUserKey = getRequestUserKey(event);

  if (!tableName) {
    return {
      statusCode: 500,
      headers: responseHeaders,
      body: JSON.stringify({
        message: "TEST_TABLE_NAME is not configured.",
        time,
        items: [],
      }),
    };
  }

  if (
    (requestPath.endsWith("/parking/management") ||
      requestPath.endsWith("/parking/registrations")) &&
    !isAdminUser(requestGroups)
  ) {
    const congregationResponse = await dynamoClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": "CONGREGATION",
        },
      }),
    );
    const congregationItems = (congregationResponse.Items ?? []) as TableRow[];
    const hasParkingAdminRole = congregationItems.some((item) => {
      let memberData: StoredMemberData = {};

      try {
        memberData = JSON.parse(item.data) as StoredMemberData;
      } catch {
        memberData = {};
      }

      return (
        normalizeEmail(memberData.email) === requestEmail &&
        memberData.role === "parking-admin"
      );
    });

    if (!hasParkingAdminRole) {
      return forbiddenResponse(
        time,
        "You do not have access to manage parking settings.",
      );
    }
  }

  if (
    (requestPath.endsWith("/admin/users") ||
      requestPath.endsWith("/admin/users/groups")) &&
    !isUserManager(requestGroups)
  ) {
    return forbiddenResponse(time, "You do not have access to manage user groups.");
  }

  if (
    (requestPath.endsWith("/announcements/week") ||
      requestPath.endsWith("/announcements/week/remove")) &&
    !isUserManager(requestGroups)
  ) {
    return forbiddenResponse(
      time,
      "You do not have access to add or edit announcements.",
    );
  }

  if (requestPath.endsWith("/contacts/import") && !isUserManager(requestGroups)) {
    return forbiddenResponse(time, "You do not have access to import contacts.");
  }

  if (
    (requestPath.endsWith("/admin/users") ||
      requestPath.endsWith("/admin/users/groups")) &&
    !userPoolId
  ) {
    return {
      statusCode: 500,
      headers: responseHeaders,
      body: JSON.stringify({
        message: "USER_POOL_ID is not configured.",
        time,
      }),
    };
  }

  if (event.requestContext.http.method === "POST") {
    if (requestPath.endsWith("/calendar/google/connect/start")) {
      if (!requestUserKey) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "A signed-in user identifier is required to connect Google Calendar.",
            time,
          }),
        };
      }

      try {
        const { clientId, callbackUrl } = getRequiredGoogleConfig();
        const payload = JSON.parse(event.body ?? "{}") as Partial<GoogleCalendarConnectStartPayload>;
        const fallbackReturnTo =
          parseAbsoluteHttpUrl(getHeaderValue(event.headers, "origin"))?.toString() ?? "";
        const returnTo =
          parseAbsoluteHttpUrl(payload.returnTo)?.toString() || fallbackReturnTo;

        if (!returnTo) {
          return {
            statusCode: 400,
            headers: responseHeaders,
            body: JSON.stringify({
              message: "A valid returnTo URL is required to start Google Calendar OAuth.",
              time,
            }),
          };
        }

        const state = randomBytes(24).toString("hex");
        const createdAt = new Date(time);
        const expiresAt = new Date(createdAt.getTime() + googleOauthStateTtlMs).toISOString();

        await dynamoClient.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              pk: googleOauthStatePk,
              sk: getGoogleOauthStateSortKey(state),
              data: JSON.stringify({
                email: requestEmail,
                userKey: requestUserKey,
                returnTo,
                createdAt: time,
                expiresAt,
              } satisfies StoredGoogleOAuthStateData),
            },
          }),
        );

        const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authorizationUrl.searchParams.set("client_id", clientId);
        authorizationUrl.searchParams.set("redirect_uri", callbackUrl);
        authorizationUrl.searchParams.set("response_type", "code");
        authorizationUrl.searchParams.set("scope", googleCalendarScope);
        authorizationUrl.searchParams.set("access_type", "offline");
        authorizationUrl.searchParams.set("include_granted_scopes", "true");
        authorizationUrl.searchParams.set("prompt", "consent");
        authorizationUrl.searchParams.set("state", state);

        return {
          statusCode: 200,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "Google Calendar authorization started.",
            time,
            authorizationUrl: authorizationUrl.toString(),
          }),
        };
      } catch (error) {
        return {
          statusCode: 500,
          headers: responseHeaders,
          body: JSON.stringify({
            message: error instanceof Error ? error.message : "Unable to start Google OAuth.",
            time,
          }),
        };
      }
    }

    if (requestPath.endsWith("/calendar/google/freebusy")) {
      if (!requestUserKey) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "A signed-in user identifier is required to load calendar availability.",
            time,
          }),
        };
      }

      const payload = JSON.parse(event.body ?? "{}") as Partial<GoogleCalendarFreeBusyPayload>;
      const timeMin = normalizeWhitespace(payload.timeMin);
      const timeMax = normalizeWhitespace(payload.timeMax);
      const timeZone = normalizeWhitespace(payload.timeZone);
      const calendarId = normalizeWhitespace(payload.calendarId) || "primary";

      if (!timeMin || !timeMax) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "timeMin and timeMax are required.",
            time,
          }),
        };
      }

      if (
        Number.isNaN(Date.parse(timeMin)) ||
        Number.isNaN(Date.parse(timeMax)) ||
        Date.parse(timeMin) >= Date.parse(timeMax)
      ) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "timeMin must be earlier than timeMax and both must be valid dates.",
            time,
          }),
        };
      }

      const existingConnection = await getStoredGoogleConnection(tableName, requestUserKey);

      if (!existingConnection) {
        return {
          statusCode: 404,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "Google Calendar is not connected.",
            time,
          }),
        };
      }

      try {
        const currentConnection = await refreshGoogleAccessTokenIfNeeded({
          tableName,
          time,
          email: requestUserKey,
          connection: existingConnection,
        });
        const accessToken = decryptSecret(currentConnection.accessTokenEncrypted);
        const freeBusyResponse = await queryGoogleCalendarFreeBusy({
          accessToken,
          timeMin,
          timeMax,
          timeZone,
          calendarId,
        });
        const calendarData = freeBusyResponse.calendars?.[calendarId] ?? {
          busy: [],
          errors: [],
        };

        return {
          statusCode: 200,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "Google Calendar availability loaded.",
            time,
            calendarId,
            timeMin: freeBusyResponse.timeMin ?? timeMin,
            timeMax: freeBusyResponse.timeMax ?? timeMax,
            busy: (calendarData.busy ?? []).filter(
              (slot) => typeof slot.start === "string" && typeof slot.end === "string",
            ),
            errors: calendarData.errors ?? [],
          }),
        };
      } catch (error) {
        const typedError = error as Error & { statusCode?: number };
        console.error("Google Calendar availability request failed.", {
          calendarId,
          userKey: requestUserKey,
          timeMin,
          timeMax,
          statusCode: typedError.statusCode ?? null,
          errorMessage: typedError.message,
        });
        return {
          statusCode: 500,
          headers: responseHeaders,
          body: JSON.stringify({
            message:
              error instanceof Error
                ? error.message
                : "Unable to load Google Calendar availability.",
            time,
          }),
        };
      }
    }

    if (requestPath.endsWith("/calendar/google/events")) {
      if (!requestUserKey) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "A signed-in user identifier is required to load calendar events.",
            time,
          }),
        };
      }

      const payload = JSON.parse(event.body ?? "{}") as Partial<GoogleCalendarEventsPayload>;
      const timeMin = normalizeWhitespace(payload.timeMin);
      const timeMax = normalizeWhitespace(payload.timeMax);
      const timeZone = normalizeWhitespace(payload.timeZone);
      const calendarId = normalizeWhitespace(payload.calendarId) || "primary";
      const useSyncCache = payload.useSyncCache === true;
      const cacheOnly = payload.cacheOnly === true;
      const forceSync = payload.forceSync === true;
      const selectedYearMonth = normalizeWhitespace(payload.selectedYearMonth);

      console.log("Google Calendar events request received.", {
        requestPath,
        userKey: requestUserKey,
        calendarId,
        timeMin,
        timeMax,
        timeZone: timeZone || null,
        useSyncCache,
        cacheOnly,
        forceSync,
        selectedYearMonth: selectedYearMonth || null,
      });

      if (!timeMin || !timeMax) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "timeMin and timeMax are required.",
            time,
          }),
        };
      }

      if (
        Number.isNaN(Date.parse(timeMin)) ||
        Number.isNaN(Date.parse(timeMax)) ||
        Date.parse(timeMin) >= Date.parse(timeMax)
      ) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "timeMin must be earlier than timeMax and both must be valid dates.",
            time,
          }),
        };
      }

      try {
        const items = await loadGoogleCalendarEventsForCalendar({
          tableName,
          time,
          userKey: requestUserKey,
          calendarId,
          timeMin,
          timeMax,
          timeZone,
          useSyncCache,
          cacheOnly,
          forceSync,
          selectedYearMonth: selectedYearMonth || undefined,
        });

        console.log("Google Calendar events request succeeded.", {
          userKey: requestUserKey,
          calendarId,
          syncMode: items.syncMode,
          itemCount: items.items.length,
          changedResourceCount: items.changedResources.length,
        });

        return {
          statusCode: 200,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "Google Calendar events loaded.",
            time,
            calendarId,
            timeMin,
            timeMax,
            items: items.items,
            changedResources: items.changedResources,
            syncMode: items.syncMode,
            debug: items.debug,
          }),
        };
      } catch (error) {
        const typedError = error as Error & { statusCode?: number };
        console.error("Google Calendar events request failed.", {
          calendarId,
          userKey: requestUserKey,
          timeMin,
          timeMax,
          useSyncCache,
          statusCode: typedError.statusCode ?? null,
          errorMessage: typedError.message,
        });
        return {
          statusCode: typedError.statusCode ?? 500,
          headers: responseHeaders,
          body: JSON.stringify({
            message:
              error instanceof Error ? error.message : "Unable to load Google Calendar events.",
            time,
          }),
        };
      }
    }

    if (requestPath.endsWith("/calendar/google/reporting")) {
      if (!requestUserKey) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "A signed-in user identifier is required to load calendar reporting.",
            time,
          }),
        };
      }

      const payload = JSON.parse(event.body ?? "{}") as Partial<GoogleCalendarReportingPayload>;
      const year =
        typeof payload.year === "number" &&
        Number.isInteger(payload.year) &&
        payload.year >= 2000 &&
        payload.year <= 9999
          ? payload.year
          : new Date(time).getUTCFullYear();
      const cacheOnly = payload.cacheOnly === true;
      const forceSync = payload.forceSync === true;
      const calendarIds =
        Array.isArray(payload.calendarIds) && payload.calendarIds.length > 0
          ? Array.from(
              new Set(
                payload.calendarIds
                  .map((item) => normalizeWhitespace(item))
                  .filter(Boolean),
              ),
            )
          : ["primary"];
      const timeMin = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)).toISOString();
      const timeMax = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0)).toISOString();

      console.log("Google Calendar reporting request received.", {
        requestPath,
        userKey: requestUserKey,
        year,
        calendarIds,
        cacheOnly,
        forceSync,
      });

      try {
        const [congregationItems, calendarResults] = await Promise.all([
          loadCongregationDirectoryItems(tableName),
          Promise.all(
            calendarIds.map((calendarId) =>
              loadGoogleCalendarEventsForCalendar({
                tableName,
                time,
                userKey: requestUserKey,
                calendarId,
                timeMin,
                timeMax,
                timeZone: "UTC",
                useSyncCache: true,
                cacheOnly,
                forceSync,
                selectedYearMonth: undefined,
              }).then((result) => ({
                calendarId,
                ...result,
              })),
            ),
          ),
        ]);

        const uniqueEvents = new Map<string, StoredGoogleCalendarSyncedEventData>();
        const syncModes = calendarResults.map((result) => ({
          calendarId: result.calendarId,
          syncMode: result.syncMode,
        }));

        for (const result of calendarResults) {
          for (const item of result.items) {
            uniqueEvents.set(`${result.calendarId}#${item.id}#${item.start}`, item);
          }
        }

        const rows = buildGoogleCalendarReportingRows({
          congregationItems,
          events: Array.from(uniqueEvents.values()),
        });
        const overallSyncMode = calendarResults.some((result) => result.syncMode === "full")
          ? "full"
          : calendarResults.some((result) => result.syncMode === "incremental")
            ? "incremental"
            : calendarResults.some((result) => result.syncMode === "direct")
              ? "direct"
              : "cached";

        console.log("Google Calendar reporting request succeeded.", {
          userKey: requestUserKey,
          year,
          calendarCount: calendarIds.length,
          rowCount: rows.length,
          eventCount: uniqueEvents.size,
          syncMode: overallSyncMode,
        });

        return {
          statusCode: 200,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "Google Calendar reporting loaded.",
            time,
            year,
            rows,
            eventCount: uniqueEvents.size,
            syncMode: overallSyncMode,
            syncModes,
          }),
        };
      } catch (error) {
        const typedError = error as Error & { statusCode?: number };
        console.error("Google Calendar reporting request failed.", {
          userKey: requestUserKey,
          year,
          calendarIds,
          statusCode: typedError.statusCode ?? null,
          errorMessage: typedError.message,
        });
        return {
          statusCode: typedError.statusCode ?? 500,
          headers: responseHeaders,
          body: JSON.stringify({
            message:
              error instanceof Error
                ? error.message
                : "Unable to load Google Calendar reporting.",
            time,
          }),
        };
      }
    }

    if (requestPath.endsWith("/calendar/google/events/create")) {
      if (!requestUserKey) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "A signed-in user identifier is required to create calendar events.",
            time,
          }),
        };
      }

      const payload = JSON.parse(event.body ?? "{}") as Partial<GoogleCalendarCreateEventPayload>;
      const calendarId = normalizeWhitespace(payload.calendarId) || "primary";
      const title = normalizeWhitespace(payload.title);
      const start = normalizeWhitespace(payload.start);
      const end = normalizeWhitespace(payload.end);
      const timeZone = normalizeWhitespace(payload.timeZone);
      const location = normalizeWhitespace(payload.location);
      const description = normalizeWhitespace(payload.description);
      const congregationItems = normalizeGoogleCalendarCongregationMetadataItems(
        payload.congregationItems,
      );

      if (!title || !start || !end) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "title, start, and end are required.",
            time,
          }),
        };
      }

      if (
        Number.isNaN(Date.parse(start)) ||
        Number.isNaN(Date.parse(end)) ||
        Date.parse(start) >= Date.parse(end)
      ) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "start must be earlier than end and both must be valid dates.",
            time,
          }),
        };
      }

      const existingConnection = await getStoredGoogleConnection(tableName, requestUserKey);

      if (!existingConnection) {
        return {
          statusCode: 404,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "Google Calendar is not connected.",
            time,
          }),
        };
      }

      try {
        const currentConnection = await refreshGoogleAccessTokenIfNeeded({
          tableName,
          time,
          email: requestUserKey,
          connection: existingConnection,
        });
        const accessToken = decryptSecret(currentConnection.accessTokenEncrypted);
        const item = await createGoogleCalendarEvent({
          accessToken,
          calendarId,
          title,
          start,
          end,
          timeZone,
          location,
          description,
          congregationItems,
        });

        return {
          statusCode: 201,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "Google Calendar event created.",
            time,
            calendarId,
            item,
          }),
        };
      } catch (error) {
        return {
          statusCode: 500,
          headers: responseHeaders,
          body: JSON.stringify({
            message:
              error instanceof Error ? error.message : "Unable to create Google Calendar event.",
            time,
          }),
        };
      }
    }

    if (requestPath.endsWith("/calendar/google/events/update")) {
      if (!requestUserKey) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "A signed-in user identifier is required to update calendar events.",
            time,
          }),
        };
      }

      const payload = JSON.parse(event.body ?? "{}") as Partial<GoogleCalendarUpdateEventPayload>;
      const calendarId = normalizeWhitespace(payload.calendarId) || "primary";
      const eventId = normalizeWhitespace(payload.eventId);
      const title = normalizeWhitespace(payload.title);
      const start = normalizeWhitespace(payload.start);
      const end = normalizeWhitespace(payload.end);
      const timeZone = normalizeWhitespace(payload.timeZone);
      const location = normalizeWhitespace(payload.location);
      const description = normalizeWhitespace(payload.description);
      const congregationItems = normalizeGoogleCalendarCongregationMetadataItems(
        payload.congregationItems,
      );
      const isAllDay = payload.isAllDay === true;

      if (!eventId || !title || !start || !end) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "eventId, title, start, and end are required.",
            time,
          }),
        };
      }

      if (
        (!isAllDay &&
          (Number.isNaN(Date.parse(start)) ||
            Number.isNaN(Date.parse(end)) ||
            Date.parse(start) >= Date.parse(end))) ||
        (isAllDay && start >= end)
      ) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: isAllDay
              ? "For all-day events, end must be later than start."
              : "start must be earlier than end and both must be valid dates.",
            time,
          }),
        };
      }

      const existingConnection = await getStoredGoogleConnection(tableName, requestUserKey);

      if (!existingConnection) {
        return {
          statusCode: 404,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "Google Calendar is not connected.",
            time,
          }),
        };
      }

      try {
        const currentConnection = await refreshGoogleAccessTokenIfNeeded({
          tableName,
          time,
          email: requestUserKey,
          connection: existingConnection,
        });
        const accessToken = decryptSecret(currentConnection.accessTokenEncrypted);
        const item = await updateGoogleCalendarEvent({
          accessToken,
          calendarId,
          eventId,
          title,
          start,
          end,
          timeZone,
          location,
          description,
          congregationItems,
          isAllDay,
        });

        return {
          statusCode: 200,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "Google Calendar event updated.",
            time,
            calendarId,
            item,
          }),
        };
      } catch (error) {
        return {
          statusCode: 500,
          headers: responseHeaders,
          body: JSON.stringify({
            message:
              error instanceof Error ? error.message : "Unable to update Google Calendar event.",
            time,
          }),
        };
      }
    }

    if (requestPath.endsWith("/calendar/google/events/delete")) {
      if (!requestUserKey) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "A signed-in user identifier is required to delete calendar events.",
            time,
          }),
        };
      }

      const payload = JSON.parse(event.body ?? "{}") as Partial<GoogleCalendarDeleteEventPayload>;
      const calendarId = normalizeWhitespace(payload.calendarId) || "primary";
      const eventId = normalizeWhitespace(payload.eventId);

      if (!eventId) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "eventId is required.",
            time,
          }),
        };
      }

      const existingConnection = await getStoredGoogleConnection(tableName, requestUserKey);

      if (!existingConnection) {
        return {
          statusCode: 404,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "Google Calendar is not connected.",
            time,
          }),
        };
      }

      try {
        const currentConnection = await refreshGoogleAccessTokenIfNeeded({
          tableName,
          time,
          email: requestUserKey,
          connection: existingConnection,
        });
        const accessToken = decryptSecret(currentConnection.accessTokenEncrypted);
        await deleteGoogleCalendarEvent({
          accessToken,
          calendarId,
          eventId,
        });

        return {
          statusCode: 200,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "Google Calendar event deleted.",
            time,
            calendarId,
            eventId,
          }),
        };
      } catch (error) {
        return {
          statusCode: 500,
          headers: responseHeaders,
          body: JSON.stringify({
            message:
              error instanceof Error ? error.message : "Unable to delete Google Calendar event.",
            time,
          }),
        };
      }
    }

    if (requestPath.endsWith("/parking/registration")) {
      const payload = JSON.parse(event.body ?? "{}") as Partial<ParkingRegistrationPayload>;

      if (
        !payload.firstName ||
        !payload.lastName ||
        !payload.licensePlate ||
        !payload.personalEmail ||
        !payload.cellPhone ||
        !payload.durationFrom ||
        !payload.durationTo
      ) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message:
              "First name, last name, license plate, personal email, telephone cell, and duration fields are required.",
            time,
          }),
        };
      }

      if (
        !isParkingMonthValue(payload.durationFrom) ||
        !isParkingMonthValue(payload.durationTo)
      ) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "Duration fields must use the YYYY-MM month format.",
            time,
          }),
        };
      }

      if (payload.durationFrom >= payload.durationTo) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "Duration from must be earlier than duration to.",
            time,
          }),
        };
      }

      const normalizedLicensePlate = normalizeLicensePlate(payload.licensePlate);
      const existingRegistrationsResponse = await dynamoClient.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: {
            ":pk": "PARKING_REGISTRATION",
          },
        }),
      );
      const existingRegistrations = (existingRegistrationsResponse.Items ?? []) as TableRow[];
      const duplicateRegistration = existingRegistrations.some((item) => {
        try {
          const existingData = JSON.parse(item.data) as StoredParkingRegistrationData;
          return normalizeLicensePlate(existingData.licensePlate) === normalizedLicensePlate;
        } catch {
          return false;
        }
      });

      if (duplicateRegistration) {
        return {
          statusCode: 409,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "A parking registration already exists for that license plate.",
            time,
          }),
        };
      }

      const [settingsResponse, registrationsResponse] = await Promise.all([
        dynamoClient.send(
          new GetCommand({
            TableName: tableName,
            Key: {
              pk: "PARKING_SETTINGS",
              sk: "CONFIG",
            },
          }),
        ),
        dynamoClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "pk = :pk",
            ExpressionAttributeValues: {
              ":pk": "PARKING_REGISTRATION",
            },
          }),
        ),
      ]);

      let settingsData: StoredParkingSettingsData = {
        maxSpots: 0,
        updatedAt: "",
      };

      try {
        if (settingsResponse.Item?.data) {
          settingsData = JSON.parse(String(settingsResponse.Item.data)) as StoredParkingSettingsData;
        }
      } catch {
        settingsData = {
          maxSpots: 0,
          updatedAt: "",
        };
      }

      const existingParkingRegistrations = ((registrationsResponse.Items ?? []) as TableRow[])
        .map((item) => {
          try {
            return JSON.parse(item.data) as StoredParkingRegistrationData;
          } catch {
            return null;
          }
        })
        .filter(Boolean) as StoredParkingRegistrationData[];
      const currentActiveCount = existingParkingRegistrations.filter(
        (registration) => isActiveParkingPlacementStatus(registration.placementStatus),
      ).length;
      const currentWaitingListCount = existingParkingRegistrations.filter(
        (registration) => registration.placementStatus === "waiting-list",
      ).length;
      const placementStatus =
        settingsData.maxSpots > currentActiveCount ? "available" : "waiting-list";
      const waitingListPosition =
        placementStatus === "waiting-list" ? currentWaitingListCount + 1 : undefined;

      console.log("Parking registration placement resolved", {
        registrationEmail: normalizeEmail(payload.personalEmail),
        licensePlate: payload.licensePlate.trim().toUpperCase(),
        maxSpots: settingsData.maxSpots ?? 0,
        currentActiveCount,
        currentWaitingListCount,
        placementStatus,
        waitingListPosition: waitingListPosition ?? null,
      });

      const registrationId = crypto.randomUUID();
      const data: StoredParkingRegistrationData = {
        history: [
          {
            timestamp: time,
            action: "parking_registration_created",
            message:
              placementStatus === "available"
                ? "Parking registration created and marked as available."
                : "Parking registration created and added to the waiting list.",
          },
        ],
        firstName: payload.firstName.trim(),
        lastName: payload.lastName.trim(),
        licensePlate: payload.licensePlate.trim().toUpperCase(),
        personalEmail: payload.personalEmail.trim(),
        workEmail: payload.workEmail?.trim() ?? "",
        placeOfWork: payload.placeOfWork?.trim() ?? "",
        cellPhone: payload.cellPhone.trim(),
        workPhone: payload.workPhone?.trim() ?? "",
        durationFrom: payload.durationFrom,
        durationTo: payload.durationTo,
        registeredAt: time,
        placementStatus,
      };

      await dynamoClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: "PARKING_REGISTRATION",
            sk: `REGISTRATION#${registrationId}`,
            data: JSON.stringify(data),
          },
        }),
      );

      try {
        await sendParkingRegistrationNotification({
          fromEmail: getParkingNotificationFromEmail(),
          toEmail: normalizeEmail(payload.personalEmail),
          firstName: payload.firstName.trim(),
          lastName: payload.lastName.trim(),
          licensePlate: payload.licensePlate.trim().toUpperCase(),
          durationFrom: payload.durationFrom,
          durationTo: payload.durationTo,
          placementStatus,
          waitingListPosition,
        });
      } catch (error) {
        console.error("Failed to send parking registration notification", {
          error,
          registrationId,
          fromEmailConfigured: Boolean(getParkingNotificationFromEmail()),
          personalEmail: normalizeEmail(payload.personalEmail),
          placementStatus,
          waitingListPosition: waitingListPosition ?? null,
        });
      }

      return {
        statusCode: 201,
        headers: responseHeaders,
        body: JSON.stringify({
          message:
            placementStatus === "available"
              ? "Parking registration submitted and marked as Available."
              : "Parking registration submitted and added to the waiting list.",
          time,
          pk: "PARKING_REGISTRATION",
          sk: `REGISTRATION#${registrationId}`,
        }),
      };
    }

    if (requestPath.endsWith("/parking/management")) {
      const payload = JSON.parse(event.body ?? "{}") as Partial<ParkingManagementPayload>;
      const maxSpots = Number(payload.maxSpots);

      if (!Number.isFinite(maxSpots) || maxSpots < 0) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "maxSpots must be a non-negative number.",
            time,
          }),
        };
      }

      await dynamoClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: "PARKING_SETTINGS",
            sk: "CONFIG",
            data: JSON.stringify({
              maxSpots,
              updatedAt: time,
            } satisfies StoredParkingSettingsData),
          },
        }),
      );

      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify({
          message: "Parking capacity updated.",
          time,
          maxSpots,
        }),
      };
    }

    if (requestPath.endsWith("/parking/registrations/status")) {
      const payload = JSON.parse(event.body ?? "{}") as Partial<UpdateParkingRegistrationStatusPayload>;

      if (
        !payload.sk ||
        (payload.placementStatus !== "assigned" &&
          payload.placementStatus !== "waiting-list" &&
          payload.placementStatus !== "available")
      ) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "sk and placementStatus are required.",
            time,
          }),
        };
      }

      const existingResponse = await dynamoClient.send(
        new GetCommand({
          TableName: tableName,
          Key: {
            pk: "PARKING_REGISTRATION",
            sk: payload.sk,
          },
        }),
      );

      if (!existingResponse.Item?.data) {
        return {
          statusCode: 404,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "Parking registration not found.",
            time,
          }),
        };
      }

      let existingData: StoredParkingRegistrationData;

      try {
        existingData = JSON.parse(String(existingResponse.Item.data)) as StoredParkingRegistrationData;
      } catch {
        return {
          statusCode: 500,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "Parking registration data is invalid.",
            time,
          }),
        };
      }

      const { isActive: _legacyIsActive, ...existingDataWithoutLegacyFlag } = existingData as
        StoredParkingRegistrationData & { isActive?: boolean };

      await dynamoClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: "PARKING_REGISTRATION",
            sk: payload.sk,
            data: JSON.stringify({
              ...existingDataWithoutLegacyFlag,
              history: [
                {
                  timestamp: time,
                  action:
                    payload.placementStatus === "assigned"
                      ? "parking_registration_assigned"
                      : payload.placementStatus === "available"
                        ? "parking_registration_available"
                        : "parking_registration_waiting_list",
                  message:
                    payload.placementStatus === "assigned"
                      ? "Parking registration moved to assigned."
                      : payload.placementStatus === "available"
                        ? "Parking registration moved to available."
                      : "Parking registration moved to the waiting list.",
                },
                ...((existingDataWithoutLegacyFlag.history ?? []) as NonNullable<
                  StoredParkingRegistrationData["history"]
                >),
              ],
              placementStatus: payload.placementStatus,
            } satisfies StoredParkingRegistrationData),
          },
        }),
      );

      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify({
          message:
            payload.placementStatus === "assigned"
              ? "Parking registration assigned."
              : payload.placementStatus === "available"
                ? "Parking registration marked as available."
              : "Parking registration moved to the waiting list.",
          time,
        }),
      };
    }

    if (requestPath.endsWith("/contacts/import")) {
      const payload = JSON.parse(event.body ?? "{}") as Partial<ImportContactsPayload>;

      if (!payload.content || typeof payload.content !== "string") {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "A VCF file content payload is required.",
            time,
          }),
        };
      }

      const parsedContacts = parseVcfContacts(payload.content);
      const existingMembersResponse = await dynamoClient.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: {
            ":pk": "CONGREGATION",
          },
        }),
      );
      const existingMembers = (existingMembersResponse.Items ?? []) as TableRow[];
      const emailKeys = new Set<string>();
      const phoneKeys = new Set<string>();
      const nameKeys = new Set<string>();

      for (const item of existingMembers) {
        let memberData: StoredMemberData = {};

        try {
          memberData = JSON.parse(item.data) as StoredMemberData;
        } catch {
          memberData = {};
        }

        const emailKey = normalizeEmail(memberData.email);
        const phoneKey = normalizePhone(memberData.phone);
        const nameKey = normalizeName(
          memberData.firstName,
          memberData.lastName,
        );

        if (emailKey) {
          emailKeys.add(emailKey);
        }

        if (phoneKey) {
          phoneKeys.add(phoneKey);
        }

        if (nameKey) {
          nameKeys.add(nameKey);
        }
      }

      const importedMembers: string[] = [];
      const skippedMembers: string[] = [];

      for (const contact of parsedContacts) {
        const emailKey = normalizeEmail(contact.email);
        const phoneKey = normalizePhone(contact.phone);
        const nameKey = normalizeName(
          contact.firstName,
          contact.lastName,
          contact.displayName,
        );
        const contactLabel =
          contact.displayName ||
          normalizeWhitespace([contact.firstName, contact.lastName].join(" ")) ||
          contact.email ||
          contact.phone ||
          "Imported contact";
        const alreadyExists =
          (emailKey && emailKeys.has(emailKey)) ||
          (phoneKey && phoneKeys.has(phoneKey)) ||
          (nameKey && nameKeys.has(nameKey));

        if (alreadyExists) {
          skippedMembers.push(contactLabel);
          continue;
        }

        await dynamoClient.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              pk: "CONGREGATION",
              sk: `MEMBER#${crypto.randomUUID()}`,
              data: JSON.stringify({
                history: prependHistoryEntry(undefined, {
                  timestamp: time,
                  action: "member_created",
                  message: "Member imported from contacts file.",
                }),
                firstName: contact.firstName,
                lastName: contact.lastName,
                email: contact.email,
                phone: contact.phone,
                role: "",
                status: "",
                address: contact.address,
                notes: contact.notes,
                createdAt: time,
              }),
            },
          }),
        );

        importedMembers.push(contactLabel);

        if (emailKey) {
          emailKeys.add(emailKey);
        }

        if (phoneKey) {
          phoneKeys.add(phoneKey);
        }

        if (nameKey) {
          nameKeys.add(nameKey);
        }
      }

      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify({
          message:
            importedMembers.length > 0
              ? `Imported ${importedMembers.length} contact${
                  importedMembers.length === 1 ? "" : "s"
                }.`
              : "No new contacts were imported.",
          time,
          processedCount: parsedContacts.length,
          importedCount: importedMembers.length,
          skippedCount: skippedMembers.length,
          importedMembers,
          skippedMembers,
        }),
      };
    }

    if (requestPath.endsWith("/admin/users/groups")) {
      const payload = JSON.parse(event.body ?? "{}") as Partial<UpdateUserGroupsPayload>;

      if (!payload.username || !Array.isArray(payload.groups)) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "username and groups are required.",
            time,
          }),
        };
      }

      const nextGroups = payload.groups.filter((group): group is (typeof allowedUserGroups)[number] =>
        allowedUserGroups.includes(group as (typeof allowedUserGroups)[number]),
      );

      const existingGroupsResponse = await cognitoClient.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: userPoolId,
          Username: payload.username,
        }),
      );

      const existingGroups = ((existingGroupsResponse.Groups ?? []) as Array<{ GroupName?: string }>)
        .map((group: { GroupName?: string }) => group.GroupName)
        .filter((groupName: string | undefined): groupName is string => Boolean(groupName))
        .filter(
          (groupName: string): groupName is (typeof allowedUserGroups)[number] =>
            allowedUserGroups.includes(groupName as (typeof allowedUserGroups)[number]),
        );

      const groupsToAdd = nextGroups.filter(
        (group: (typeof allowedUserGroups)[number]) => !existingGroups.includes(group),
      );
      const groupsToRemove = existingGroups.filter(
        (groupName: (typeof allowedUserGroups)[number]) => !nextGroups.includes(groupName),
      );

      await Promise.all([
        ...groupsToAdd.map((groupName) =>
          cognitoClient.send(
            new AdminAddUserToGroupCommand({
              GroupName: groupName,
              UserPoolId: userPoolId,
              Username: payload.username,
            }),
          ),
        ),
        ...groupsToRemove.map((groupName) =>
          cognitoClient.send(
            new AdminRemoveUserFromGroupCommand({
              GroupName: groupName,
              UserPoolId: userPoolId,
              Username: payload.username,
            }),
          ),
        ),
      ]);

      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify({
          message: "User groups updated.",
          time,
        }),
      };
    }

    if (requestPath.endsWith("/announcements/week/remove")) {
      const payload = JSON.parse(event.body ?? "{}") as Partial<DeleteAnnouncementPayload>;

      if (!payload.sk) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "sk is required.",
            time,
          }),
        };
      }

      await dynamoClient.send(
        new DeleteCommand({
          TableName: tableName,
          Key: {
            pk: "ANNOUNCEMENT",
            sk: payload.sk,
          },
        }),
      );

      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify({
          message: "Announcement week removed.",
          time,
        }),
      };
    }

    if (requestPath.endsWith("/announcements/week")) {
      const payload = JSON.parse(event.body ?? "{}") as Partial<AnnouncementWeekPayload>;

      if (!payload.weekLabel || !Array.isArray(payload.items)) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "weekLabel and items are required.",
            time,
          }),
        };
      }

      const sanitizedItems = payload.items.map((item) => item.trim()).filter(Boolean);
      const announcementSk = `WEEK#${payload.weekLabel}`;
      const existingAnnouncementResponse = await dynamoClient.send(
        new GetCommand({
          TableName: tableName,
          Key: {
            pk: "ANNOUNCEMENT",
            sk: announcementSk,
          },
        }),
      );

      if (
        existingAnnouncementResponse.Item &&
        (!payload.sk || payload.sk !== announcementSk)
      ) {
        return {
          statusCode: 409,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "An announcement week already exists for that week.",
            time,
          }),
        };
      }

      await dynamoClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: "ANNOUNCEMENT",
            sk: announcementSk,
            data: JSON.stringify({
              weekLabel: payload.weekLabel,
              items: sanitizedItems,
              createdAt: payload.createdAt ?? time,
              updatedAt: time,
            }),
          },
        }),
      );

      if (payload.sk && payload.sk !== announcementSk) {
        await dynamoClient.send(
          new DeleteCommand({
            TableName: tableName,
            Key: {
              pk: "ANNOUNCEMENT",
              sk: payload.sk,
            },
          }),
        );
      }

      return {
        statusCode: payload.sk ? 200 : 201,
        headers: responseHeaders,
        body: JSON.stringify({
          message: payload.sk
            ? "Announcement week updated."
            : "Announcement week created.",
          time,
          sk: announcementSk,
        }),
      };
    }

    if (event.requestContext.http.path.endsWith("/congregation/member/visitation")) {
      const payload = JSON.parse(event.body ?? "{}") as Partial<VisitationPayload>;

      if (!payload.pk || !payload.sk || !payload.action) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "pk, sk, and action are required.",
            time,
          }),
        };
      }

      if (payload.action === "schedule" && !payload.schedule) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "Schedule is required.",
            time,
          }),
        };
      }

      if (payload.action === "note" && !payload.note) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "Note is required.",
            time,
          }),
        };
      }

      if (
        (payload.action === "note" ||
          payload.action === "complete" ||
          payload.action === "delete") &&
        !payload.visitationId
      ) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "visitationId is required for note, complete, and delete actions.",
            time,
          }),
        };
      }

      const existingResponse = await dynamoClient.send(
        new GetCommand({
          TableName: tableName,
          Key: {
            pk: payload.pk,
            sk: payload.sk,
          },
        }),
      );

      const existingItem = existingResponse.Item as TableRow | undefined;

      if (!existingItem) {
        return {
          statusCode: 404,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "Congregation member not found.",
            time,
          }),
        };
      }

      let existingData: StoredMemberData = {};

      try {
        existingData = JSON.parse(existingItem.data) as StoredMemberData;
      } catch {
        existingData = {};
      }

      const existingVisitations = existingData.visitations ?? [];
      let nextVisitations = existingVisitations;
      let historyMessage = "";

      if (payload.action === "schedule") {
        const assignedPriestSk = payload.assignedPriestSk?.trim() ?? "";
        let assignedPriestName = "";

        if (assignedPriestSk) {
          const assignedPriestResponse = await dynamoClient.send(
            new GetCommand({
              TableName: tableName,
              Key: {
                pk: "CONGREGATION",
                sk: assignedPriestSk,
              },
            }),
          );

          const assignedPriestItem = assignedPriestResponse.Item as TableRow | undefined;

          if (!assignedPriestItem) {
            return {
              statusCode: 400,
              headers: responseHeaders,
              body: JSON.stringify({
                message: "Assigned priest not found.",
                time,
              }),
            };
          }

          let assignedPriestData: StoredMemberData = {};

          try {
            assignedPriestData = JSON.parse(assignedPriestItem.data) as StoredMemberData;
          } catch {
            assignedPriestData = {};
          }

          if (assignedPriestData.role !== "Priest") {
            return {
              statusCode: 400,
              headers: responseHeaders,
              body: JSON.stringify({
                message: "Assigned member must be a priest.",
                time,
              }),
            };
          }

          assignedPriestName =
            getStoredMemberName(assignedPriestData.firstName, assignedPriestData.lastName) ||
            assignedPriestSk;
        }

        if (payload.visitationId) {
          nextVisitations = existingVisitations.map((visitation) =>
            visitation.id === payload.visitationId
              ? {
                  ...visitation,
                  scheduledAt: payload.schedule,
                  assignedPriestSk: assignedPriestSk || undefined,
                  assignedPriestName: assignedPriestName || undefined,
                  updatedAt: time,
                }
              : visitation,
          );
          historyMessage = assignedPriestName
            ? `Visitation schedule updated to ${payload.schedule}. Assigned to ${assignedPriestName}.`
            : `Visitation schedule updated to ${payload.schedule}.`;
        } else {
          nextVisitations = [
            {
              id: crypto.randomUUID(),
              scheduledAt: payload.schedule,
              assignedPriestSk: assignedPriestSk || undefined,
              assignedPriestName: assignedPriestName || undefined,
              updatedAt: time,
            },
            ...existingVisitations,
          ];
          historyMessage = assignedPriestName
            ? `Visitation scheduled for ${payload.schedule}. Assigned to ${assignedPriestName}.`
            : `Visitation scheduled for ${payload.schedule}.`;
        }
      }

      if (payload.action === "note") {
        nextVisitations = existingVisitations.map((visitation) =>
          visitation.id === payload.visitationId
            ? {
                ...visitation,
                note: payload.note,
                updatedAt: time,
              }
            : visitation,
        );

        const targetVisit = existingVisitations.find(
          (visitation) => visitation.id === payload.visitationId,
        );
        historyMessage = targetVisit?.note
          ? "Visitation note edited."
          : "Visitation note added.";
      }

      if (payload.action === "complete") {
        nextVisitations = existingVisitations.map((visitation) =>
          visitation.id === payload.visitationId
            ? {
                ...visitation,
                completedAt: time,
                updatedAt: time,
              }
            : visitation,
        );
        historyMessage = "Visitation marked as done.";
      }

      if (payload.action === "delete") {
        const targetVisit = existingVisitations.find(
          (visitation) => visitation.id === payload.visitationId,
        );

        if (!targetVisit) {
          return {
            statusCode: 404,
            headers: responseHeaders,
            body: JSON.stringify({
              message: "Visitation not found.",
              time,
            }),
          };
        }

        nextVisitations = existingVisitations.filter(
          (visitation) => visitation.id !== payload.visitationId,
        );
        historyMessage = "Visitation deleted.";
      }

      await dynamoClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: payload.pk,
            sk: payload.sk,
            data: JSON.stringify({
              ...existingData,
              history: prependHistoryEntry(existingData.history, {
                timestamp: time,
                action: `visitation_${payload.action}`,
                message: historyMessage,
              }),
              visitations: nextVisitations,
              updatedAt: time,
            }),
          },
        }),
      );

      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify({
          message: "Visitation updated.",
          time,
        }),
      };
    }

    if (event.requestContext.http.path.endsWith("/congregation/member/update")) {
      const payload = JSON.parse(event.body ?? "{}") as Partial<UpdateMemberPayload>;

      if (!payload.pk || !payload.sk || !payload.firstName || !payload.lastName) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "pk, sk, first name, and last name are required.",
            time,
          }),
        };
      }

      const existingResponse = await dynamoClient.send(
        new GetCommand({
          TableName: tableName,
          Key: {
            pk: payload.pk,
            sk: payload.sk,
          },
        }),
      );

      const existingItem = existingResponse.Item as TableRow | undefined;
      let existingData: StoredMemberData = {};

      if (existingItem) {
        try {
          existingData = JSON.parse(existingItem.data) as StoredMemberData;
        } catch {
          existingData = {};
        }
      }

      if (
        payload.role === "Priest" &&
        existingData.role !== "Priest" &&
        !isAdminUser(requestGroups)
      ) {
        return forbiddenResponse(
          time,
          "Only admins can assign the Priest role to a member.",
        );
      }

      const data = JSON.stringify({
        ...existingData,
        history: prependHistoryEntry(existingData.history, {
          timestamp: time,
          action: "member_updated",
          message: "Member details edited.",
        }),
        firstName: payload.firstName ?? "",
        lastName: payload.lastName ?? "",
        email: payload.email ?? "",
        phone: payload.phone ?? "",
        role: payload.role ?? "",
        status: payload.status ?? "",
        address: payload.address ?? "",
        notes: payload.notes ?? "",
        createdAt: payload.createdAt ?? time,
        updatedAt: time,
      });

      await dynamoClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: payload.pk,
            sk: payload.sk,
            data,
            photo: payload.photo ?? existingItem?.photo ?? "",
          },
        }),
      );

      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify({
          message: "Congregation member updated.",
          time,
        }),
      };
    }

    if (event.requestContext.http.path.endsWith("/congregation/member/remove")) {
      const payload = JSON.parse(event.body ?? "{}") as Partial<DeleteMemberPayload>;

      if (!payload.pk || !payload.sk) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "pk and sk are required.",
            time,
          }),
        };
      }

      await dynamoClient.send(
        new DeleteCommand({
          TableName: tableName,
          Key: {
            pk: payload.pk,
            sk: payload.sk,
          },
        }),
      );

      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify({
          message: "Congregation member deleted.",
          time,
        }),
      };
    }

    const payload = JSON.parse(event.body ?? "{}") as Partial<CreateMemberPayload>;

    if (!payload.firstName || !payload.lastName) {
      return {
        statusCode: 400,
        headers: responseHeaders,
        body: JSON.stringify({
          message: "First name and last name are required.",
          time,
        }),
      };
    }

    if (payload.role === "Priest" && !isAdminUser(requestGroups)) {
      return forbiddenResponse(
        time,
        "Only admins can assign the Priest role to a member.",
      );
    }

    const memberId = crypto.randomUUID();
    const data = JSON.stringify({
      history: prependHistoryEntry(undefined, {
        timestamp: time,
        action: "member_created",
        message: "Member entry added.",
      }),
      firstName: payload.firstName ?? "",
      lastName: payload.lastName ?? "",
      email: payload.email ?? "",
      phone: payload.phone ?? "",
      role: payload.role ?? "",
      status: payload.status ?? "",
      address: payload.address ?? "",
      notes: payload.notes ?? "",
      createdAt: time,
    });

    await dynamoClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: "CONGREGATION",
          sk: `MEMBER#${memberId}`,
          data,
          photo: payload.photo ?? "",
        },
      }),
    );

    return {
      statusCode: 201,
      headers: responseHeaders,
      body: JSON.stringify({
        message: "Congregation member created.",
        time,
      }),
    };
  }

  if (requestPath.endsWith("/calendar/google/oauth/callback")) {
    const errorDescription =
      normalizeWhitespace(event.queryStringParameters?.error_description) ||
      normalizeWhitespace(event.queryStringParameters?.error);
    const state = normalizeWhitespace(event.queryStringParameters?.state);
    const authorizationCode = normalizeWhitespace(event.queryStringParameters?.code);

    if (!state) {
      return {
        statusCode: 400,
        headers: responseHeaders,
        body: JSON.stringify({
          message: "Missing OAuth state.",
          time,
        }),
      };
    }

    const stateResponse = await dynamoClient.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          pk: googleOauthStatePk,
          sk: getGoogleOauthStateSortKey(state),
        },
      }),
    );

    let stateData: StoredGoogleOAuthStateData | null = null;

    try {
      if (stateResponse.Item?.data) {
        stateData = JSON.parse(String(stateResponse.Item.data)) as StoredGoogleOAuthStateData;
      }
    } catch {
      stateData = null;
    }

    if (!stateData) {
      return {
        statusCode: 400,
        headers: responseHeaders,
        body: JSON.stringify({
          message: "OAuth state is invalid or has expired.",
          time,
        }),
      };
    }

    const expired = Date.parse(stateData.expiresAt) < Date.now();

    if (expired) {
      await dynamoClient.send(
        new DeleteCommand({
          TableName: tableName,
          Key: {
            pk: googleOauthStatePk,
            sk: getGoogleOauthStateSortKey(state),
          },
        }),
      );

      return redirectResponse(
        buildCalendarReturnUrl({
          returnTo: stateData.returnTo,
          status: "error",
          message: "Google Calendar connection expired before it could be completed.",
        }),
      );
    }

    if (errorDescription) {
      await dynamoClient.send(
        new DeleteCommand({
          TableName: tableName,
          Key: {
            pk: googleOauthStatePk,
            sk: getGoogleOauthStateSortKey(state),
          },
        }),
      );

      return redirectResponse(
        buildCalendarReturnUrl({
          returnTo: stateData.returnTo,
          status: "error",
          message: errorDescription,
        }),
      );
    }

    if (!authorizationCode) {
      return redirectResponse(
        buildCalendarReturnUrl({
          returnTo: stateData.returnTo,
          status: "error",
          message: "Google did not return an authorization code.",
        }),
      );
    }

    try {
      const storedUserKey = stateData.userKey || stateData.email;
      const existingConnection = await getStoredGoogleConnection(tableName, storedUserKey);
      const { clientId, clientSecret, callbackUrl } = getRequiredGoogleConfig();
      const tokenResponse = await exchangeGoogleToken(
        new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code: authorizationCode,
          grant_type: "authorization_code",
          redirect_uri: callbackUrl,
        }),
      );

      const refreshToken =
        tokenResponse.refresh_token ||
        (existingConnection
          ? decryptSecret(existingConnection.refreshTokenEncrypted)
          : "");

      if (!refreshToken) {
        throw new Error(
          "Google did not return a refresh token. Remove the app from your Google account permissions and try connecting again.",
        );
      }

      const connectedAt = existingConnection?.connectedAt ?? time;

      await saveStoredGoogleConnection(tableName, storedUserKey, {
        email: storedUserKey,
        refreshTokenEncrypted: encryptSecret(refreshToken),
        accessTokenEncrypted: encryptSecret(tokenResponse.access_token),
        accessTokenExpiresAt: new Date(
          Date.now() + tokenResponse.expires_in * 1000,
        ).toISOString(),
        tokenScope: tokenResponse.scope ?? existingConnection?.tokenScope,
        tokenType: tokenResponse.token_type ?? existingConnection?.tokenType,
        connectedAt,
        updatedAt: time,
        refreshTokenUpdatedAt: tokenResponse.refresh_token
          ? time
          : existingConnection?.refreshTokenUpdatedAt ?? connectedAt,
        lastRefreshAt: existingConnection?.lastRefreshAt,
        lastError: null,
      });

      await dynamoClient.send(
        new DeleteCommand({
          TableName: tableName,
          Key: {
            pk: googleOauthStatePk,
            sk: getGoogleOauthStateSortKey(state),
          },
        }),
      );

      return redirectResponse(
        buildCalendarReturnUrl({
          returnTo: stateData.returnTo,
          status: "success",
          message: "Google Calendar connected.",
        }),
      );
    } catch (error) {
      return redirectResponse(
        buildCalendarReturnUrl({
          returnTo: stateData.returnTo,
          status: "error",
          message:
            error instanceof Error ? error.message : "Unable to connect Google Calendar.",
        }),
      );
    }
  }

  if (requestPath.endsWith("/calendar/google/connection")) {
    if (!requestUserKey) {
      return {
        statusCode: 400,
        headers: responseHeaders,
        body: JSON.stringify({
          message: "A signed-in user identifier is required to view Google Calendar status.",
          time,
        }),
      };
    }

    const existingConnection = await getStoredGoogleConnection(tableName, requestUserKey);

    if (!existingConnection) {
      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify({
          message: "Google Calendar is not connected.",
          time,
          connected: false,
          hasRefreshToken: false,
          accessTokenExpiresAt: null,
          connectedAt: null,
          updatedAt: null,
          lastRefreshAt: null,
          tokenScope: null,
          lastError: null,
        }),
      };
    }

    let currentConnection = existingConnection;

    try {
      currentConnection = await refreshGoogleAccessTokenIfNeeded({
        tableName,
        time,
        email: requestUserKey,
        connection: existingConnection,
      });
    } catch (error) {
      currentConnection = {
        ...existingConnection,
        lastError:
          error instanceof Error ? error.message : "Unable to refresh Google access token.",
        updatedAt: time,
      };
      await saveStoredGoogleConnection(tableName, requestUserKey, currentConnection);
    }

    return {
      statusCode: 200,
      headers: responseHeaders,
      body: JSON.stringify({
        message: "Google Calendar connection loaded.",
        time,
        connected: true,
        hasRefreshToken: Boolean(currentConnection.refreshTokenEncrypted),
        accessTokenExpiresAt: currentConnection.accessTokenExpiresAt ?? null,
        connectedAt: currentConnection.connectedAt ?? null,
        updatedAt: currentConnection.updatedAt ?? null,
        lastRefreshAt: currentConnection.lastRefreshAt ?? null,
        tokenScope: currentConnection.tokenScope ?? null,
        lastError: currentConnection.lastError ?? null,
      }),
    };
  }

  if (requestPath.endsWith("/calendar/google/calendars")) {
    if (!requestUserKey) {
      return {
        statusCode: 400,
        headers: responseHeaders,
        body: JSON.stringify({
          message: "A signed-in user identifier is required to load calendars.",
          time,
        }),
      };
    }

    const existingConnection = await getStoredGoogleConnection(tableName, requestUserKey);

    if (!existingConnection) {
      return {
        statusCode: 404,
        headers: responseHeaders,
        body: JSON.stringify({
          message: "Google Calendar is not connected.",
          time,
        }),
      };
    }

    try {
      const currentConnection = await refreshGoogleAccessTokenIfNeeded({
        tableName,
        time,
        email: requestUserKey,
        connection: existingConnection,
      });
      const accessToken = decryptSecret(currentConnection.accessTokenEncrypted);
      const calendars = await listGoogleCalendars(accessToken);

      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify({
          message: "Google calendars loaded.",
          time,
          items: calendars,
        }),
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers: responseHeaders,
        body: JSON.stringify({
          message:
            error instanceof Error ? error.message : "Unable to load Google calendars.",
          time,
        }),
      };
    }
  }

  if (requestPath.endsWith("/admin/users")) {
    const usersResponse = await cognitoClient.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
      }),
    );

    const users = await Promise.all(
      (usersResponse.Users ?? []).map(
        async (user: {
          Username?: string;
          Attributes?: Array<{ Name?: string; Value?: string }>;
          Enabled?: boolean;
          UserStatus?: string;
        }): Promise<CognitoUserDirectoryItem> => {
        const username = user.Username ?? "";
        const email =
          user.Attributes?.find((attribute: { Name?: string; Value?: string }) => attribute.Name === "email")?.Value ?? "";
        const groupsResponse = await cognitoClient.send(
          new AdminListGroupsForUserCommand({
            UserPoolId: userPoolId,
            Username: username,
          }),
        );

        return {
          username,
          email,
          enabled: user.Enabled ?? false,
          status: user.UserStatus ?? "UNKNOWN",
          groups: (groupsResponse.Groups ?? [])
            .map((group: { GroupName?: string }) => group.GroupName)
            .filter((groupName: string | undefined): groupName is string => Boolean(groupName))
            .filter(
              (groupName: string): groupName is (typeof allowedUserGroups)[number] =>
                allowedUserGroups.includes(groupName as (typeof allowedUserGroups)[number]),
            ),
        };
      }),
    );

    return {
      statusCode: 200,
      headers: responseHeaders,
      body: JSON.stringify({
        message: "User directory loaded.",
        time,
        groupOptions: allowedUserGroups,
        items: users,
      }),
    };
  }

  if (requestPath.endsWith("/announcements")) {
    const response = await dynamoClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": "ANNOUNCEMENT",
        },
      }),
    );
    const items = ((response.Items ?? []) as TableRow[]).sort((left, right) =>
      left.sk.localeCompare(right.sk),
    );

    return {
      statusCode: 200,
      headers: responseHeaders,
      body: JSON.stringify({
        message: "Announcement weeks loaded.",
        time,
        items,
      }),
    };
  }

  if (requestPath.endsWith("/parking/management")) {
    const [settingsResponse, registrationsResponse] = await Promise.all([
      dynamoClient.send(
        new GetCommand({
          TableName: tableName,
          Key: {
            pk: "PARKING_SETTINGS",
            sk: "CONFIG",
          },
        }),
      ),
      dynamoClient.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: {
            ":pk": "PARKING_REGISTRATION",
          },
        }),
      ),
    ]);

    let settingsData: StoredParkingSettingsData = {
      maxSpots: 0,
      updatedAt: "",
    };

    try {
      if (settingsResponse.Item?.data) {
        settingsData = JSON.parse(String(settingsResponse.Item.data)) as StoredParkingSettingsData;
      }
    } catch {
      settingsData = {
        maxSpots: 0,
        updatedAt: "",
      };
    }

    const registrations = ((registrationsResponse.Items ?? []) as TableRow[]).map((item) => {
      try {
        return JSON.parse(item.data) as StoredParkingRegistrationData;
      } catch {
        return null;
      }
    }).filter(Boolean) as StoredParkingRegistrationData[];

    const activeRegistrationCount = registrations.filter(
      (registration) => isActiveParkingPlacementStatus(registration.placementStatus),
    ).length;
    const waitingListCount = registrations.filter(
      (registration) => registration.placementStatus === "waiting-list",
    ).length;

    return {
      statusCode: 200,
      headers: responseHeaders,
      body: JSON.stringify({
        message: "Parking management loaded.",
        time,
        maxSpots: settingsData.maxSpots ?? 0,
        activeRegistrationCount,
        waitingListCount,
        updatedAt: settingsData.updatedAt ?? "",
      }),
    };
  }

  if (requestPath.endsWith("/parking/registrations")) {
    const registrationsResponse = await dynamoClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": "PARKING_REGISTRATION",
        },
      }),
    );

    const items = ((registrationsResponse.Items ?? []) as TableRow[])
      .map((item) => {
        try {
          return {
            pk: item.pk,
            sk: item.sk,
            ...(JSON.parse(item.data) as StoredParkingRegistrationData),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((left, right) =>
        String(left?.registeredAt ?? "").localeCompare(String(right?.registeredAt ?? "")),
      ) as ParkingRegistrationsResponse["items"];

    return {
      statusCode: 200,
      headers: responseHeaders,
      body: JSON.stringify({
        message: "Parking registrations loaded.",
        time,
        items,
      } satisfies ParkingRegistrationsResponse),
    };
  }

  if (requestPath.endsWith("/congregation/directory")) {
    const response = await dynamoClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": "CONGREGATION",
        },
      }),
    );

    const items = ((response.Items ?? []) as TableRow[])
      .map((item) => {
        try {
          const parsed = JSON.parse(item.data) as StoredMemberData;
          const firstName = normalizeWhitespace(parsed.firstName);
          const lastName = normalizeWhitespace(parsed.lastName);

          if (!firstName && !lastName) {
            return null;
          }

          return {
            pk: item.pk,
            sk: item.sk,
            firstName,
            lastName,
            phone: normalizeWhitespace(parsed.phone),
          } satisfies CongregationDirectoryItem;
        } catch {
          return null;
        }
      })
      .filter((item): item is CongregationDirectoryItem => item !== null)
      .sort((left, right) =>
        `${left.firstName} ${left.lastName}`.localeCompare(
          `${right.firstName} ${right.lastName}`,
        ),
      );

    return {
      statusCode: 200,
      headers: responseHeaders,
      body: JSON.stringify({
        message: "Congregation directory loaded.",
        time,
        items,
      } satisfies CongregationDirectoryResponse),
    };
  }

  const response = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": "CONGREGATION",
      },
    }),
  );
  const items = ((response.Items ?? []) as TableRow[]).sort((left, right) =>
    left.sk.localeCompare(right.sk),
  );

  return {
    statusCode: 200,
    headers: responseHeaders,
    body: JSON.stringify({
      message: `Congregation API says hello. Current server time: ${time}`,
      time,
      items,
    }),
  };
};
