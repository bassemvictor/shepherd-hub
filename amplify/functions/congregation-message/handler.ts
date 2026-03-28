import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
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

const prependHistoryEntry = (
  history: StoredMemberData["history"],
  entry: NonNullable<StoredMemberData["history"]>[number],
) => [entry, ...(history ?? [])];

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const responseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json",
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const time = new Date().toISOString();
  const tableName = process.env.TEST_TABLE_NAME;
  const requestPath = event.requestContext.http.path;

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

  if (event.requestContext.http.method === "POST") {
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
