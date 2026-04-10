import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { handler, resetHandlerClientsForTesting, setHandlerClientsForTesting, } from "../amplify/functions/congregation-message/handler.js";
const parseBody = (body) => JSON.parse(body ?? "{}");
const invokeHandler = async (event) => (await handler(event, {}, (() => undefined)));
const createEvent = ({ path, method = "GET", body, groups, }) => ({
    body: body ? JSON.stringify(body) : undefined,
    headers: {},
    isBase64Encoded: false,
    rawPath: path,
    rawQueryString: "",
    requestContext: {
        accountId: "123456789012",
        apiId: "api-id",
        domainName: "example.com",
        domainPrefix: "example",
        http: {
            method,
            path,
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: "node:test",
        },
        requestId: "request-id",
        routeKey: `${method} ${path}`,
        stage: "$default",
        time: "now",
        timeEpoch: Date.now(),
        authorizer: groups
            ? {
                jwt: {
                    claims: {
                        "cognito:groups": `[${groups.join(" ")}]`,
                    },
                },
            }
            : undefined,
    },
    routeKey: `${method} ${path}`,
    version: "2.0",
});
const createMockClient = (resolver) => {
    const commands = [];
    return {
        commands,
        client: {
            send: async (command) => {
                const typedCommand = command;
                commands.push(typedCommand);
                return resolver(typedCommand, commands.length - 1);
            },
        },
    };
};
beforeEach(() => {
    process.env.TEST_TABLE_NAME = "test_table";
    process.env.USER_POOL_ID = "user-pool-id";
    process.env.PARKING_NOTIFICATIONS_FROM_EMAIL = "parking@example.com";
    resetHandlerClientsForTesting();
});
afterEach(() => {
    resetHandlerClientsForTesting();
    delete process.env.TEST_TABLE_NAME;
    delete process.env.USER_POOL_ID;
    delete process.env.PARKING_NOTIFICATIONS_FROM_EMAIL;
});
test("returns 500 when TEST_TABLE_NAME is missing", async () => {
    delete process.env.TEST_TABLE_NAME;
    const response = await invokeHandler(createEvent({ path: "/congregation/message" }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 500);
    assert.equal(body.message, "TEST_TABLE_NAME is not configured.");
});
test("forbids admin user listing for non-manager groups", async () => {
    const response = await invokeHandler(createEvent({ path: "/admin/users", groups: ["regular_user"] }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 403);
    assert.equal(body.message, "You do not have access to manage user groups.");
});
test("lists Cognito users and their groups for managers", async () => {
    const cognito = createMockClient((command) => {
        if (command.constructor.name === "ListUsersCommand") {
            return {
                Users: [
                    {
                        Username: "alice",
                        Enabled: true,
                        UserStatus: "CONFIRMED",
                        Attributes: [{ Name: "email", Value: "alice@example.com" }],
                    },
                ],
            };
        }
        if (command.constructor.name === "AdminListGroupsForUserCommand") {
            return {
                Groups: [{ GroupName: "admin" }, { GroupName: "regular_user" }],
            };
        }
        throw new Error(`Unexpected command ${command.constructor.name}`);
    });
    setHandlerClientsForTesting({ cognitoClient: cognito.client });
    const response = await invokeHandler(createEvent({ path: "/admin/users", groups: ["admin"] }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.message, "User directory loaded.");
    assert.deepEqual(body.groupOptions, ["admin", "super_user", "regular_user"]);
    assert.deepEqual(body.items, [
        {
            username: "alice",
            email: "alice@example.com",
            enabled: true,
            status: "CONFIRMED",
            groups: ["admin", "regular_user"],
        },
    ]);
});
test("updates Cognito user groups", async () => {
    const cognito = createMockClient((command) => {
        if (command.constructor.name === "AdminListGroupsForUserCommand") {
            return {
                Groups: [{ GroupName: "regular_user" }],
            };
        }
        if (command.constructor.name === "AdminAddUserToGroupCommand" ||
            command.constructor.name === "AdminRemoveUserFromGroupCommand") {
            return {};
        }
        throw new Error(`Unexpected command ${command.constructor.name}`);
    });
    setHandlerClientsForTesting({ cognitoClient: cognito.client });
    const response = await invokeHandler(createEvent({
        path: "/admin/users/groups",
        method: "POST",
        groups: ["super_user"],
        body: {
            username: "alice",
            groups: ["admin"],
        },
    }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.message, "User groups updated.");
    assert.deepEqual(cognito.commands.map((command) => command.constructor.name), [
        "AdminListGroupsForUserCommand",
        "AdminAddUserToGroupCommand",
        "AdminRemoveUserFromGroupCommand",
    ]);
});
test("forbids announcement writes for regular users", async () => {
    const response = await invokeHandler(createEvent({
        path: "/announcements/week",
        method: "POST",
        groups: ["regular_user"],
        body: { weekLabel: "2026-W13", items: ["One"] },
    }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 403);
    assert.equal(body.message, "You do not have access to add or edit announcements.");
});
test("forbids contacts import for regular users", async () => {
    const response = await invokeHandler(createEvent({
        path: "/contacts/import",
        method: "POST",
        groups: ["regular_user"],
        body: {
            content: "BEGIN:VCARD\nFN:John Smith\nEND:VCARD",
        },
    }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 403);
    assert.equal(body.message, "You do not have access to import contacts.");
});
test("creates a parking registration", async () => {
    const dynamo = createMockClient((command) => {
        if (command.constructor.name === "QueryCommand") {
            return { Items: [] };
        }
        if (command.constructor.name === "GetCommand") {
            return {
                Item: {
                    pk: "PARKING_SETTINGS",
                    sk: "CONFIG",
                    data: JSON.stringify({
                        maxSpots: 10,
                        updatedAt: "2026-04-09T10:00:00.000Z",
                    }),
                },
            };
        }
        if (command.constructor.name === "PutCommand") {
            return {};
        }
        throw new Error(`Unexpected command ${command.constructor.name}`);
    });
    const ses = createMockClient((command) => {
        assert.equal(command.constructor.name, "SendEmailCommand");
        return {};
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client, sesClient: ses.client });
    const response = await invokeHandler(createEvent({
        path: "/parking/registration",
        method: "POST",
        body: {
            firstName: "Jane",
            lastName: "Driver",
            licensePlate: "abc 123",
            personalEmail: "jane@example.com",
            workEmail: "jane@work.example.com",
            placeOfWork: "General Hospital",
            cellPhone: "6135550101",
            workPhone: "6135550102",
            durationFrom: "2026-04",
            durationTo: "2026-05",
        },
    }));
    const body = parseBody(response.body);
    const putCommand = dynamo.commands.find((command) => command.constructor.name === "PutCommand");
    const putInput = putCommand?.input;
    const storedData = JSON.parse(String(putInput.Item?.data ?? "{}"));
    assert.equal(response.statusCode, 201);
    assert.equal(putInput.Item?.pk, "PARKING_REGISTRATION");
    assert.equal(typeof putInput.Item?.sk, "string");
    assert.equal(storedData.firstName, "Jane");
    assert.equal(storedData.lastName, "Driver");
    assert.equal(storedData.licensePlate, "ABC 123");
    assert.equal(storedData.personalEmail, "jane@example.com");
    assert.equal(storedData.workEmail, "jane@work.example.com");
    assert.equal(storedData.placeOfWork, "General Hospital");
    assert.equal(storedData.cellPhone, "6135550101");
    assert.equal(storedData.workPhone, "6135550102");
    assert.equal(storedData.durationFrom, "2026-04");
    assert.equal(storedData.durationTo, "2026-05");
    assert.equal(storedData.placementStatus, "assigned");
    assert.equal(typeof storedData.registeredAt, "string");
    assert.deepEqual(storedData.history, [
        {
            timestamp: body.time,
            action: "parking_registration_created",
            message: "Parking registration created and assigned.",
        },
    ]);
    assert.equal(ses.commands.length, 1);
    assert.equal((ses.commands[0].input?.Destination?.ToAddresses ?? [])[0], "jane@example.com");
    assert.equal(ses.commands[0].input?.Content?.Simple
        ?.Subject?.Data, "Parking registration confirmed");
});
test("emails waiting list position for parking registration", async () => {
    const dynamo = createMockClient((command) => {
        if (command.constructor.name === "QueryCommand") {
            return {
                Items: [
                    {
                        pk: "PARKING_REGISTRATION",
                        sk: "REGISTRATION#existing",
                        data: JSON.stringify({
                            firstName: "Existing",
                            lastName: "Driver",
                            licensePlate: "XYZ999",
                            personalEmail: "existing@example.com",
                            workEmail: "",
                            placeOfWork: "",
                            cellPhone: "6135550000",
                            workPhone: "",
                            durationFrom: "2026-04",
                            durationTo: "2026-06",
                            registeredAt: "2026-04-01T08:00:00.000Z",
                            placementStatus: "waiting-list",
                        }),
                    },
                    {
                        pk: "PARKING_REGISTRATION",
                        sk: "REGISTRATION#assigned",
                        data: JSON.stringify({
                            firstName: "Assigned",
                            lastName: "Driver",
                            licensePlate: "AAA111",
                            personalEmail: "assigned@example.com",
                            workEmail: "",
                            placeOfWork: "",
                            cellPhone: "6135550100",
                            workPhone: "",
                            durationFrom: "2026-04",
                            durationTo: "2026-06",
                            registeredAt: "2026-04-01T07:00:00.000Z",
                            placementStatus: "assigned",
                        }),
                    },
                ],
            };
        }
        if (command.constructor.name === "GetCommand") {
            return {
                Item: {
                    pk: "PARKING_SETTINGS",
                    sk: "CONFIG",
                    data: JSON.stringify({
                        maxSpots: 1,
                        updatedAt: "2026-04-09T10:00:00.000Z",
                    }),
                },
            };
        }
        if (command.constructor.name === "PutCommand") {
            return {};
        }
        throw new Error(`Unexpected command ${command.constructor.name}`);
    });
    const ses = createMockClient((command) => {
        assert.equal(command.constructor.name, "SendEmailCommand");
        return {};
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client, sesClient: ses.client });
    const response = await invokeHandler(createEvent({
        path: "/parking/registration",
        method: "POST",
        body: {
            firstName: "Wait",
            lastName: "List",
            licensePlate: "wait 123",
            personalEmail: "wait@example.com",
            workEmail: "",
            placeOfWork: "",
            cellPhone: "6135550109",
            workPhone: "",
            durationFrom: "2026-04",
            durationTo: "2026-05",
        },
    }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 201);
    assert.equal(body.message, "Parking registration submitted and added to the waiting list.");
    assert.equal(ses.commands[0].input?.Content?.Simple?.Subject?.Data, "Parking registration received - waiting list #2");
    assert.match(ses.commands[0].input?.Content?.Simple?.Body?.Text?.Data ?? "", /Waiting list position: 2/);
});
test("blocks parking registration when license plate already exists", async () => {
    const dynamo = createMockClient((command) => {
        if (command.constructor.name === "QueryCommand") {
            return {
                Items: [
                    {
                        pk: "PARKING_REGISTRATION",
                        sk: "REGISTRATION#existing",
                        data: JSON.stringify({
                            firstName: "Existing",
                            lastName: "Driver",
                            licensePlate: "ABC123",
                            personalEmail: "existing@example.com",
                            workEmail: "",
                            placeOfWork: "",
                            cellPhone: "6135550000",
                            workPhone: "",
                            durationFrom: "2026-04",
                            durationTo: "2026-05",
                            registeredAt: "2026-04-01T08:00:00.000Z",
                            placementStatus: "waiting-list",
                        }),
                    },
                ],
            };
        }
        throw new Error(`Unexpected command ${command.constructor.name}`);
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const response = await invokeHandler(createEvent({
        path: "/parking/registration",
        method: "POST",
        body: {
            firstName: "Jane",
            lastName: "Driver",
            licensePlate: "ABC 123",
            personalEmail: "jane@example.com",
            workEmail: "",
            placeOfWork: "",
            cellPhone: "6135550101",
            workPhone: "",
            durationFrom: "2026-04",
            durationTo: "2026-05",
        },
    }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 409);
    assert.equal(body.message, "A parking registration already exists for that license plate.");
});
test("blocks parking registration when duration from is not earlier than duration to", async () => {
    const dynamo = createMockClient(() => {
        throw new Error("DynamoDB should not be called for invalid duration.");
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const response = await invokeHandler(createEvent({
        path: "/parking/registration",
        method: "POST",
        body: {
            firstName: "Jane",
            lastName: "Driver",
            licensePlate: "ABC 123",
            personalEmail: "jane@example.com",
            workEmail: "",
            placeOfWork: "",
            cellPhone: "6135550101",
            workPhone: "",
            durationFrom: "2026-05",
            durationTo: "2026-05",
        },
    }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 400);
    assert.equal(body.message, "Duration from must be earlier than duration to.");
});
test("loads and updates parking management", async () => {
    const dynamo = createMockClient((command) => {
        if (command.constructor.name === "QueryCommand") {
            const values = command.input?.ExpressionAttributeValues;
            if (values?.[":pk"] === "CONGREGATION") {
                return {
                    Items: [
                        {
                            pk: "CONGREGATION",
                            sk: "MEMBER#parking-admin",
                            data: JSON.stringify({
                                firstName: "Lot",
                                lastName: "Admin",
                                email: "lot@example.com",
                                role: "parking-admin",
                            }),
                        },
                    ],
                };
            }
            return {
                Items: [
                    {
                        pk: "PARKING_REGISTRATION",
                        sk: "REGISTRATION#1",
                        data: JSON.stringify({
                            placementStatus: "waiting-list",
                        }),
                    },
                    {
                        pk: "PARKING_REGISTRATION",
                        sk: "REGISTRATION#2",
                        data: JSON.stringify({
                            placementStatus: "assigned",
                        }),
                    },
                ],
            };
        }
        if (command.constructor.name === "GetCommand") {
            return {
                Item: {
                    pk: "PARKING_SETTINGS",
                    sk: "CONFIG",
                    data: JSON.stringify({
                        maxSpots: 50,
                        updatedAt: "2026-04-09T10:00:00.000Z",
                    }),
                },
            };
        }
        if (command.constructor.name === "PutCommand") {
            return {};
        }
        throw new Error(`Unexpected command ${command.constructor.name}`);
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const getResponse = await invokeHandler({
        ...createEvent({
            path: "/parking/management",
            method: "GET",
        }),
        requestContext: {
            ...createEvent({
                path: "/parking/management",
                method: "GET",
            }).requestContext,
            authorizer: {
                jwt: {
                    claims: {
                        email: "lot@example.com",
                    },
                },
            },
        },
    });
    const getBody = parseBody(getResponse.body);
    assert.equal(getResponse.statusCode, 200);
    assert.equal(getBody.maxSpots, 50);
    assert.equal(getBody.activeRegistrationCount, 1);
    assert.equal(getBody.waitingListCount, 1);
    const postResponse = await invokeHandler({
        ...createEvent({
            path: "/parking/management",
            method: "POST",
            body: { maxSpots: 75 },
        }),
        requestContext: {
            ...createEvent({
                path: "/parking/management",
                method: "POST",
                body: { maxSpots: 75 },
            }).requestContext,
            authorizer: {
                jwt: {
                    claims: {
                        email: "lot@example.com",
                    },
                },
            },
        },
    });
    const postBody = parseBody(postResponse.body);
    assert.equal(postResponse.statusCode, 200);
    assert.equal(postBody.message, "Parking capacity updated.");
});
test("lists parking registrations for parking admin", async () => {
    const dynamo = createMockClient((command) => {
        if (command.constructor.name === "QueryCommand") {
            const values = command.input?.ExpressionAttributeValues;
            if (values?.[":pk"] === "CONGREGATION") {
                return {
                    Items: [
                        {
                            pk: "CONGREGATION",
                            sk: "MEMBER#parking-admin",
                            data: JSON.stringify({
                                email: "lot@example.com",
                                role: "parking-admin",
                            }),
                        },
                    ],
                };
            }
            return {
                Items: [
                    {
                        pk: "PARKING_REGISTRATION",
                        sk: "REGISTRATION#1",
                        data: JSON.stringify({
                            firstName: "A",
                            lastName: "One",
                            registeredAt: "2026-04-01T08:00:00.000Z",
                            placementStatus: "waiting-list",
                        }),
                    },
                    {
                        pk: "PARKING_REGISTRATION",
                        sk: "REGISTRATION#2",
                        data: JSON.stringify({
                            firstName: "B",
                            lastName: "Two",
                            registeredAt: "2026-03-01T08:00:00.000Z",
                            placementStatus: "assigned",
                        }),
                    },
                ],
            };
        }
        throw new Error(`Unexpected command ${command.constructor.name}`);
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const response = await invokeHandler({
        ...createEvent({
            path: "/parking/registrations",
            method: "GET",
        }),
        requestContext: {
            ...createEvent({
                path: "/parking/registrations",
                method: "GET",
            }).requestContext,
            authorizer: {
                jwt: {
                    claims: {
                        email: "lot@example.com",
                    },
                },
            },
        },
    });
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.message, "Parking registrations loaded.");
    assert.equal(body.items[0].sk, "REGISTRATION#2");
    assert.equal(body.items[1].sk, "REGISTRATION#1");
});
test("updates parking registration placement status", async () => {
    const dynamo = createMockClient((command) => {
        if (command.constructor.name === "QueryCommand") {
            return {
                Items: [
                    {
                        pk: "CONGREGATION",
                        sk: "MEMBER#parking-admin",
                        data: JSON.stringify({
                            email: "lot@example.com",
                            role: "parking-admin",
                        }),
                    },
                ],
            };
        }
        if (command.constructor.name === "GetCommand") {
            return {
                Item: {
                    pk: "PARKING_REGISTRATION",
                    sk: "REGISTRATION#1",
                    data: JSON.stringify({
                        history: [
                            {
                                timestamp: "2026-04-01T08:00:00.000Z",
                                action: "parking_registration_created",
                                message: "Parking registration created and added to the waiting list.",
                            },
                        ],
                        firstName: "Jane",
                        lastName: "Driver",
                        licensePlate: "ABC123",
                        personalEmail: "jane@example.com",
                        workEmail: "",
                        placeOfWork: "",
                        cellPhone: "6135550101",
                        workPhone: "",
                        durationFrom: "2026-04",
                        durationTo: "2026-05",
                        registeredAt: "2026-04-01T08:00:00.000Z",
                        placementStatus: "waiting-list",
                    }),
                },
            };
        }
        if (command.constructor.name === "PutCommand") {
            return {};
        }
        throw new Error(`Unexpected command ${command.constructor.name}`);
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const response = await invokeHandler({
        ...createEvent({
            path: "/parking/registrations/status",
            method: "POST",
            body: {
                sk: "REGISTRATION#1",
                placementStatus: "assigned",
            },
        }),
        requestContext: {
            ...createEvent({
                path: "/parking/registrations/status",
                method: "POST",
                body: {
                    sk: "REGISTRATION#1",
                    placementStatus: "assigned",
                },
            }).requestContext,
            authorizer: {
                jwt: {
                    claims: {
                        email: "lot@example.com",
                    },
                },
            },
        },
    });
    const body = parseBody(response.body);
    const putCommand = dynamo.commands.find((command) => command.constructor.name === "PutCommand");
    const putInput = putCommand?.input;
    const storedData = JSON.parse(String(putInput.Item?.data ?? "{}"));
    assert.equal(response.statusCode, 200);
    assert.equal(body.message, "Parking registration assigned.");
    assert.deepEqual(storedData.history, [
        {
            timestamp: body.time,
            action: "parking_registration_assigned",
            message: "Parking registration moved to assigned.",
        },
        {
            timestamp: "2026-04-01T08:00:00.000Z",
            action: "parking_registration_created",
            message: "Parking registration created and added to the waiting list.",
        },
    ]);
});
test("creates an announcement week", async () => {
    const dynamo = createMockClient((command) => {
        if (command.constructor.name === "GetCommand") {
            return {};
        }
        if (command.constructor.name === "PutCommand") {
            return {};
        }
        throw new Error(`Unexpected command ${command.constructor.name}`);
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const response = await invokeHandler(createEvent({
        path: "/announcements/week",
        method: "POST",
        groups: ["admin"],
        body: { weekLabel: "2026-W13", items: [" One ", "", "Two"] },
    }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 201);
    assert.equal(body.message, "Announcement week created.");
    assert.equal(body.sk, "WEEK#2026-W13");
    assert.deepEqual(dynamo.commands.map((command) => command.constructor.name), ["GetCommand", "PutCommand"]);
});
test("removes an announcement week", async () => {
    const dynamo = createMockClient((command) => {
        assert.equal(command.constructor.name, "DeleteCommand");
        return {};
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const response = await invokeHandler(createEvent({
        path: "/announcements/week/remove",
        method: "POST",
        groups: ["admin"],
        body: { sk: "WEEK#2026-W13" },
    }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.message, "Announcement week removed.");
});
test("creates a congregation member", async () => {
    const dynamo = createMockClient((command) => {
        assert.equal(command.constructor.name, "PutCommand");
        return {};
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const response = await invokeHandler(createEvent({
        path: "/congregation/member",
        method: "POST",
        groups: ["regular_user"],
        body: {
            firstName: "John",
            lastName: "Smith",
            email: "john@example.com",
            photo: "data:image/jpeg;base64,abc123",
        },
    }));
    const body = parseBody(response.body);
    const putInput = dynamo.commands[0]?.input;
    assert.equal(response.statusCode, 201);
    assert.equal(body.message, "Congregation member created.");
    assert.equal(putInput.Item?.photo, "data:image/jpeg;base64,abc123");
});
test("forbids regular users from creating a priest member", async () => {
    const response = await invokeHandler(createEvent({
        path: "/congregation/member",
        method: "POST",
        groups: ["regular_user"],
        body: {
            firstName: "Mark",
            lastName: "Priest",
            role: "Priest",
        },
    }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 403);
    assert.equal(body.message, "Only admins can assign the Priest role to a member.");
});
test("imports VCF contacts and skips existing members", async () => {
    const dynamo = createMockClient((command) => {
        if (command.constructor.name === "QueryCommand") {
            return {
                Items: [
                    {
                        pk: "CONGREGATION",
                        sk: "MEMBER#existing",
                        data: JSON.stringify({
                            firstName: "John",
                            lastName: "Smith",
                            email: "john@example.com",
                            phone: "6137004486",
                        }),
                    },
                ],
            };
        }
        if (command.constructor.name === "PutCommand") {
            return {};
        }
        throw new Error(`Unexpected command ${command.constructor.name}`);
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const response = await invokeHandler(createEvent({
        path: "/contacts/import",
        method: "POST",
        groups: ["admin"],
        body: {
            fileName: "contacts.vcf",
            content: `BEGIN:VCARD
VERSION:3.0
FN:John Smith
N:Smith;John;;;
EMAIL:john@example.com
TEL:6137004486
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
N:Doe;Jane;;;
EMAIL:jane@example.com
TEL:+1 (613) 555-0123
ADR:;;123 Example Street;Sample City;ON;A1A 1A1;Canada
NOTE:Imported from phone
END:VCARD`,
        },
    }));
    const body = parseBody(response.body);
    const putInput = dynamo.commands[1]?.input;
    const importedData = JSON.parse(String(putInput.Item?.data ?? "{}"));
    assert.equal(response.statusCode, 200);
    assert.equal(body.processedCount, 2);
    assert.equal(body.importedCount, 1);
    assert.equal(body.skippedCount, 1);
    assert.deepEqual(body.importedMembers, ["Jane Doe"]);
    assert.deepEqual(body.skippedMembers, ["John Smith"]);
    assert.deepEqual(dynamo.commands.map((command) => command.constructor.name), ["QueryCommand", "PutCommand"]);
    assert.equal(putInput.Item?.pk, "CONGREGATION");
    assert.equal(typeof putInput.Item?.sk, "string");
    assert.equal(importedData.firstName, "Jane");
    assert.equal(importedData.lastName, "Doe");
    assert.equal(importedData.email, "jane@example.com");
    assert.equal(importedData.phone, "+1 (613) 555-0123");
    assert.equal(importedData.address, "123 Example Street, Sample City, ON, A1A 1A1, Canada");
    assert.equal(importedData.notes, "Imported from phone");
});
test("updates a congregation member", async () => {
    const existingData = {
        firstName: "John",
        lastName: "Smith",
        history: [],
        createdAt: "2026-01-01T00:00:00.000Z",
    };
    const dynamo = createMockClient((command) => {
        if (command.constructor.name === "GetCommand") {
            return {
                Item: {
                    pk: "CONGREGATION",
                    sk: "MEMBER#1",
                    data: JSON.stringify(existingData),
                },
            };
        }
        if (command.constructor.name === "PutCommand") {
            return {};
        }
        throw new Error(`Unexpected command ${command.constructor.name}`);
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const response = await invokeHandler(createEvent({
        path: "/congregation/member/update",
        method: "POST",
        groups: ["regular_user"],
        body: {
            pk: "CONGREGATION",
            sk: "MEMBER#1",
            firstName: "John",
            lastName: "Updated",
            photo: "data:image/jpeg;base64,updated-photo",
        },
    }));
    const body = parseBody(response.body);
    const putCommand = dynamo.commands.find((command) => command.constructor.name === "PutCommand");
    const savedItem = putCommand?.input?.Item;
    assert.equal(response.statusCode, 200);
    assert.equal(body.message, "Congregation member updated.");
    assert.equal(savedItem?.photo, "data:image/jpeg;base64,updated-photo");
});
test("forbids regular users from promoting a member to priest", async () => {
    const dynamo = createMockClient((command) => {
        if (command.constructor.name === "GetCommand") {
            return {
                Item: {
                    pk: "CONGREGATION",
                    sk: "MEMBER#1",
                    data: JSON.stringify({
                        firstName: "John",
                        lastName: "Smith",
                        role: "Member",
                        history: [],
                        createdAt: "2026-01-01T00:00:00.000Z",
                    }),
                },
            };
        }
        throw new Error(`Unexpected command ${command.constructor.name}`);
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const response = await invokeHandler(createEvent({
        path: "/congregation/member/update",
        method: "POST",
        groups: ["regular_user"],
        body: {
            pk: "CONGREGATION",
            sk: "MEMBER#1",
            firstName: "John",
            lastName: "Smith",
            role: "Priest",
        },
    }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 403);
    assert.equal(body.message, "Only admins can assign the Priest role to a member.");
});
test("removes a congregation member", async () => {
    const dynamo = createMockClient((command) => {
        assert.equal(command.constructor.name, "DeleteCommand");
        return {};
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const response = await invokeHandler(createEvent({
        path: "/congregation/member/remove",
        method: "POST",
        groups: ["regular_user"],
        body: { pk: "CONGREGATION", sk: "MEMBER#1" },
    }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.message, "Congregation member deleted.");
});
test("schedules a visitation", async () => {
    const dynamo = createMockClient((command, index) => {
        if (command.constructor.name === "GetCommand") {
            if (index === 0) {
                return {
                    Item: {
                        pk: "CONGREGATION",
                        sk: "MEMBER#1",
                        data: JSON.stringify({ firstName: "John", lastName: "Smith", visitations: [] }),
                    },
                };
            }
            return {
                Item: {
                    pk: "CONGREGATION",
                    sk: "MEMBER#PRIEST",
                    data: JSON.stringify({ firstName: "Paul", lastName: "Priest", role: "Priest" }),
                },
            };
        }
        if (command.constructor.name === "PutCommand") {
            return {};
        }
        throw new Error(`Unexpected command ${command.constructor.name}`);
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const response = await invokeHandler(createEvent({
        path: "/congregation/member/visitation",
        method: "POST",
        groups: ["regular_user"],
        body: {
            pk: "CONGREGATION",
            sk: "MEMBER#1",
            action: "schedule",
            schedule: "2026-04-01T10:00:00.000Z",
            assignedPriestSk: "MEMBER#PRIEST",
        },
    }));
    const body = parseBody(response.body);
    const putCommand = dynamo.commands.find((command) => command.constructor.name === "PutCommand");
    const savedItem = putCommand?.input?.Item;
    const savedData = savedItem ? JSON.parse(savedItem.data) : null;
    const savedVisit = savedData?.visitations?.[0];
    assert.equal(response.statusCode, 200);
    assert.equal(body.message, "Visitation updated.");
    assert.equal(savedVisit?.assignedPriestSk, "MEMBER#PRIEST");
    assert.equal(savedVisit?.assignedPriestName, "Paul Priest");
});
test("rejects assigning a visitation to a non-priest member", async () => {
    const dynamo = createMockClient((command, index) => {
        if (command.constructor.name === "GetCommand") {
            if (index === 0) {
                return {
                    Item: {
                        pk: "CONGREGATION",
                        sk: "MEMBER#1",
                        data: JSON.stringify({ firstName: "John", lastName: "Smith", visitations: [] }),
                    },
                };
            }
            return {
                Item: {
                    pk: "CONGREGATION",
                    sk: "MEMBER#2",
                    data: JSON.stringify({ firstName: "Sam", lastName: "Servant", role: "Servant" }),
                },
            };
        }
        throw new Error(`Unexpected command ${command.constructor.name}`);
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const response = await invokeHandler(createEvent({
        path: "/congregation/member/visitation",
        method: "POST",
        groups: ["regular_user"],
        body: {
            pk: "CONGREGATION",
            sk: "MEMBER#1",
            action: "schedule",
            schedule: "2026-04-01T10:00:00.000Z",
            assignedPriestSk: "MEMBER#2",
        },
    }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 400);
    assert.equal(body.message, "Assigned member must be a priest.");
});
test("adds a visitation note to an existing visit", async () => {
    const dynamo = createMockClient((command) => {
        if (command.constructor.name === "GetCommand") {
            return {
                Item: {
                    pk: "CONGREGATION",
                    sk: "MEMBER#1",
                    data: JSON.stringify({
                        visitations: [{ id: "visit-1", scheduledAt: "2026-04-01T10:00:00.000Z" }],
                    }),
                },
            };
        }
        if (command.constructor.name === "PutCommand") {
            return {};
        }
        throw new Error(`Unexpected command ${command.constructor.name}`);
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const response = await invokeHandler(createEvent({
        path: "/congregation/member/visitation",
        method: "POST",
        groups: ["regular_user"],
        body: {
            pk: "CONGREGATION",
            sk: "MEMBER#1",
            action: "note",
            visitationId: "visit-1",
            note: "Bring study material",
        },
    }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.message, "Visitation updated.");
});
test("marks a visitation as complete", async () => {
    const dynamo = createMockClient((command) => {
        if (command.constructor.name === "GetCommand") {
            return {
                Item: {
                    pk: "CONGREGATION",
                    sk: "MEMBER#1",
                    data: JSON.stringify({
                        visitations: [{ id: "visit-1", scheduledAt: "2026-04-01T10:00:00.000Z" }],
                    }),
                },
            };
        }
        if (command.constructor.name === "PutCommand") {
            return {};
        }
        throw new Error(`Unexpected command ${command.constructor.name}`);
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const response = await invokeHandler(createEvent({
        path: "/congregation/member/visitation",
        method: "POST",
        groups: ["regular_user"],
        body: {
            pk: "CONGREGATION",
            sk: "MEMBER#1",
            action: "complete",
            visitationId: "visit-1",
        },
    }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.message, "Visitation updated.");
});
test("deletes a visitation", async () => {
    const dynamo = createMockClient((command) => {
        if (command.constructor.name === "GetCommand") {
            return {
                Item: {
                    pk: "CONGREGATION",
                    sk: "MEMBER#1",
                    data: JSON.stringify({
                        visitations: [
                            { id: "visit-1", scheduledAt: "2026-04-01T10:00:00.000Z" },
                            { id: "visit-2", scheduledAt: "2026-04-02T10:00:00.000Z" },
                        ],
                    }),
                },
            };
        }
        if (command.constructor.name === "PutCommand") {
            return {};
        }
        throw new Error(`Unexpected command ${command.constructor.name}`);
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const response = await invokeHandler(createEvent({
        path: "/congregation/member/visitation",
        method: "POST",
        groups: ["regular_user"],
        body: {
            pk: "CONGREGATION",
            sk: "MEMBER#1",
            action: "delete",
            visitationId: "visit-1",
        },
    }));
    const body = parseBody(response.body);
    const putCommand = dynamo.commands.find((command) => command.constructor.name === "PutCommand");
    const savedItem = putCommand?.input?.Item;
    const savedData = savedItem ? JSON.parse(savedItem.data) : null;
    assert.equal(response.statusCode, 200);
    assert.equal(body.message, "Visitation updated.");
    assert.equal(savedData?.visitations?.length, 1);
    assert.equal(savedData?.visitations?.[0]?.id, "visit-2");
});
test("lists announcement weeks", async () => {
    const dynamo = createMockClient((command) => {
        assert.equal(command.constructor.name, "QueryCommand");
        return {
            Items: [
                { pk: "ANNOUNCEMENT", sk: "WEEK#2026-W14", data: "{}" },
                { pk: "ANNOUNCEMENT", sk: "WEEK#2026-W13", data: "{}" },
            ],
        };
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const response = await invokeHandler(createEvent({ path: "/announcements", groups: ["regular_user"] }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.message, "Announcement weeks loaded.");
    assert.deepEqual(body.items, [
        { pk: "ANNOUNCEMENT", sk: "WEEK#2026-W13", data: "{}" },
        { pk: "ANNOUNCEMENT", sk: "WEEK#2026-W14", data: "{}" },
    ]);
});
test("lists congregation members", async () => {
    const dynamo = createMockClient((command) => {
        assert.equal(command.constructor.name, "QueryCommand");
        return {
            Items: [
                { pk: "CONGREGATION", sk: "MEMBER#2", data: "{}" },
                { pk: "CONGREGATION", sk: "MEMBER#1", data: "{}" },
            ],
        };
    });
    setHandlerClientsForTesting({ dynamoClient: dynamo.client });
    const response = await invokeHandler(createEvent({ path: "/congregation/message", groups: ["regular_user"] }));
    const body = parseBody(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(typeof body.message === "string" && body.message.startsWith("Congregation API says hello."), true);
    assert.deepEqual(body.items, [
        { pk: "CONGREGATION", sk: "MEMBER#1", data: "{}" },
        { pk: "CONGREGATION", sk: "MEMBER#2", data: "{}" },
    ]);
});
