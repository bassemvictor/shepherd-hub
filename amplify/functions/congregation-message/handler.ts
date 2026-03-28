import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  DynamoDBDocumentClient,
  PutCommand,
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
  schedule?: string;
  note?: string;
};

type StoredMemberData = {
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
  visitation?: {
    scheduledAt?: string;
    note?: string;
    completedAt?: string;
    updatedAt?: string;
  };
};

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const responseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json",
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const time = new Date().toISOString();
  const tableName = process.env.TEST_TABLE_NAME;

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

      const nextVisitation = {
        ...(existingData.visitation ?? {}),
        updatedAt: time,
      };

      if (payload.action === "schedule") {
        nextVisitation.scheduledAt = payload.schedule;
      }

      if (payload.action === "note") {
        nextVisitation.note = payload.note;
      }

      if (payload.action === "complete") {
        nextVisitation.completedAt = time;
      }

      await dynamoClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: payload.pk,
            sk: payload.sk,
            data: JSON.stringify({
              ...existingData,
              visitation: nextVisitation,
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

      const data = JSON.stringify({
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

  const response = await dynamoClient.send(
    new ScanCommand({
      TableName: tableName,
      Limit: 10,
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
