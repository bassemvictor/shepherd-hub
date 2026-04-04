import {
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

type TableRow = {
  pk: string;
  sk: string;
  data: string;
};

type CreateMemberPayload = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
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
  action: "schedule" | "note" | "complete";
  visitationId?: string;
  schedule?: string;
  note?: string;
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
    updatedAt?: string;
  }>;
};

type StoredAnnouncementWeekData = {
  weekLabel?: string;
  items?: string[];
  createdAt?: string;
  updatedAt?: string;
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
const normalizeName = (
  firstName?: string,
  lastName?: string,
  displayName?: string,
) =>
  normalizeWhitespace(
    [firstName, lastName].filter(Boolean).join(" ") || displayName || "",
  ).toLowerCase();

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
const allowedUserGroups = ["admin", "super_user", "regular_user"] as const;
let dynamoClient: AwsCommandClient = defaultDynamoClient;
let cognitoClient: AwsCommandClient = defaultCognitoClient;

const responseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json",
};

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

const forbiddenResponse = (time: string, message: string) => ({
  statusCode: 403,
  headers: responseHeaders,
  body: JSON.stringify({
    message,
    time,
  }),
});

export const setHandlerClientsForTesting = (clients: {
  dynamoClient?: AwsCommandClient;
  cognitoClient?: AwsCommandClient;
}) => {
  if (clients.dynamoClient) {
    dynamoClient = clients.dynamoClient;
  }

  if (clients.cognitoClient) {
    cognitoClient = clients.cognitoClient;
  }
};

export const resetHandlerClientsForTesting = () => {
  dynamoClient = defaultDynamoClient;
  cognitoClient = defaultCognitoClient;
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const time = new Date().toISOString();
  const tableName = process.env.TEST_TABLE_NAME;
  const userPoolId = process.env.USER_POOL_ID;
  const requestPath = event.requestContext.http.path;
  const requestGroups = getRequestGroups(event);

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

      if ((payload.action === "note" || payload.action === "complete") && !payload.visitationId) {
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            message: "visitationId is required for note and complete actions.",
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
        if (payload.visitationId) {
          nextVisitations = existingVisitations.map((visitation) =>
            visitation.id === payload.visitationId
              ? {
                  ...visitation,
                  scheduledAt: payload.schedule,
                  updatedAt: time,
                }
              : visitation,
          );
          historyMessage = `Visitation schedule updated to ${payload.schedule}.`;
        } else {
          nextVisitations = [
            {
              id: crypto.randomUUID(),
              scheduledAt: payload.schedule,
              updatedAt: time,
            },
            ...existingVisitations,
          ];
          historyMessage = `Visitation scheduled for ${payload.schedule}.`;
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
