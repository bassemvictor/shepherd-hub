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

const prependHistoryEntry = (
  history: StoredMemberData["history"],
  entry: NonNullable<StoredMemberData["history"]>[number],
) => [entry, ...(history ?? [])];

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognitoClient = new CognitoIdentityProviderClient({});
const allowedUserGroups = ["admin", "super_user", "regular_user"] as const;

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
        return rawGroups
          .split(",")
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

const forbiddenResponse = (time: string) => ({
  statusCode: 403,
  headers: responseHeaders,
  body: JSON.stringify({
    message: "You do not have access to manage user groups.",
    time,
  }),
});

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const time = new Date().toISOString();
  const tableName = process.env.TEST_TABLE_NAME;
  const userPoolId = process.env.USER_POOL_ID;
  const requestPath = event.requestContext.http.path;
  const requestClaims =
    ((event.requestContext as { authorizer?: { jwt?: { claims?: Record<string, unknown> } } })
      .authorizer?.jwt?.claims as Record<string, unknown> | undefined) ?? {};
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
    console.log(
      JSON.stringify({
        message: "Admin route forbidden",
        path: requestPath,
        groups: requestGroups,
        cognitoGroupsClaim: requestClaims["cognito:groups"],
        groupsClaim: requestClaims.groups,
        sub: requestClaims.sub,
        username:
          requestClaims["cognito:username"] ??
          requestClaims.username ??
          requestClaims.email,
      }),
    );
    return forbiddenResponse(time);
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

      const existingGroups = (existingGroupsResponse.Groups ?? [])
        .map((group: { GroupName?: string }) => group.GroupName)
        .filter((groupName): groupName is string => Boolean(groupName))
        .filter(
          (groupName): groupName is (typeof allowedUserGroups)[number] =>
            allowedUserGroups.includes(groupName as (typeof allowedUserGroups)[number]),
        );

      const groupsToAdd = nextGroups.filter((group) => !existingGroups.includes(group));
      const groupsToRemove = existingGroups.filter((group) => !nextGroups.includes(group));

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
            .filter((groupName): groupName is string => Boolean(groupName))
            .filter(
              (groupName): groupName is (typeof allowedUserGroups)[number] =>
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
