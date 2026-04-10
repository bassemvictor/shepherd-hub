import { AdminAddUserToGroupCommand, AdminListGroupsForUserCommand, AdminRemoveUserFromGroupCommand, CognitoIdentityProviderClient, ListUsersCommand, } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { DeleteCommand, GetCommand, DynamoDBDocumentClient, PutCommand, QueryCommand, } from "@aws-sdk/lib-dynamodb";
const prependHistoryEntry = (history, entry) => [entry, ...(history ?? [])];
const normalizeWhitespace = (value) => value?.replace(/\s+/g, " ").trim() ?? "";
const normalizeEmail = (value) => normalizeWhitespace(value).toLowerCase();
const normalizePhone = (value) => (value ?? "").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
const normalizeLicensePlate = (value) => normalizeWhitespace(value).replace(/[\s-]+/g, "").toUpperCase();
const isParkingMonthValue = (value) => /^\d{4}-\d{2}$/.test(value ?? "");
const normalizeName = (firstName, lastName, displayName) => normalizeWhitespace([firstName, lastName].filter(Boolean).join(" ") || displayName || "").toLowerCase();
const getStoredMemberName = (firstName, lastName) => [firstName, lastName].filter(Boolean).join(" ").trim();
const isActiveParkingPlacementStatus = (value) => value === "assigned" || value === "available" || value === "active";
const decodeVcfValue = (value) => value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
const parseVcfAddress = (value) => value
    .split(";")
    .map((part) => decodeVcfValue(part))
    .filter(Boolean)
    .join(", ");
const splitDisplayName = (value) => {
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
const parseVcfCard = (cardContent) => {
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
        resolvedDisplayName = normalizeWhitespace([resolvedFirstName, resolvedLastName].filter(Boolean).join(" "));
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
        displayName: resolvedDisplayName ||
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
const parseVcfContacts = (content) => {
    const unfoldedContent = content.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
    const contacts = [];
    for (const match of unfoldedContent.matchAll(/BEGIN:VCARD\s*([\s\S]*?)END:VCARD/gi)) {
        const cardContent = match[1] ?? "";
        const parsedContact = parseVcfCard(cardContent);
        if (parsedContact) {
            contacts.push(parsedContact);
        }
    }
    return contacts;
};
const defaultDynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const defaultCognitoClient = new CognitoIdentityProviderClient({});
const defaultSesClient = new SESv2Client({});
const allowedUserGroups = ["admin", "super_user", "regular_user"];
let dynamoClient = defaultDynamoClient;
let cognitoClient = defaultCognitoClient;
let sesClient = defaultSesClient;
const responseHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Content-Type": "application/json",
};
const getRequestGroups = (event) => {
    const claims = event.requestContext
        .authorizer?.jwt?.claims ?? {};
    const normalizeGroups = (rawGroups) => {
        if (Array.isArray(rawGroups)) {
            return rawGroups.map(String);
        }
        if (typeof rawGroups === "string") {
            try {
                const parsed = JSON.parse(rawGroups);
                return Array.isArray(parsed) ? parsed.map(String) : [rawGroups];
            }
            catch {
                const cleaned = rawGroups.replace(/^\[|\]$/g, "").trim();
                return cleaned
                    .split(/[,\s]+/)
                    .map((group) => group.trim())
                    .filter(Boolean);
            }
        }
        return [];
    };
    return Array.from(new Set([
        ...normalizeGroups(claims["cognito:groups"]),
        ...normalizeGroups(claims.groups),
    ]));
};
const isUserManager = (groups) => groups.includes("admin") || groups.includes("super_user");
const isAdminUser = (groups) => groups.includes("admin");
const getRequestEmail = (event) => {
    const claims = event.requestContext
        .authorizer?.jwt?.claims ?? {};
    const email = claims.email;
    return typeof email === "string" ? normalizeEmail(email) : "";
};
const forbiddenResponse = (time, message) => ({
    statusCode: 403,
    headers: responseHeaders,
    body: JSON.stringify({
        message,
        time,
    }),
});
const getParkingNotificationFromEmail = () => normalizeEmail(process.env.PARKING_NOTIFICATIONS_FROM_EMAIL);
const sendParkingRegistrationNotification = async ({ fromEmail, toEmail, firstName, lastName, licensePlate, durationFrom, durationTo, placementStatus, waitingListPosition, }) => {
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
    const subject = placementStatus === "waiting-list"
        ? `Parking registration received - waiting list #${waitingListPosition ?? "-"}`
        : "Parking registration confirmed";
    const textBody = placementStatus !== "waiting-list"
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
    await sesClient.send(new SendEmailCommand({
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
    }));
    console.log("Parking registration email sent", {
        toEmail,
        placementStatus,
        waitingListPosition: waitingListPosition ?? null,
    });
};
export const setHandlerClientsForTesting = (clients) => {
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
export const handler = async (event) => {
    const time = new Date().toISOString();
    const tableName = process.env.TEST_TABLE_NAME;
    const userPoolId = process.env.USER_POOL_ID;
    const requestPath = event.requestContext.http.path;
    const requestGroups = getRequestGroups(event);
    const requestEmail = getRequestEmail(event);
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
    if ((requestPath.endsWith("/parking/management") ||
        requestPath.endsWith("/parking/registrations")) &&
        !isAdminUser(requestGroups)) {
        const congregationResponse = await dynamoClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "pk = :pk",
            ExpressionAttributeValues: {
                ":pk": "CONGREGATION",
            },
        }));
        const congregationItems = (congregationResponse.Items ?? []);
        const hasParkingAdminRole = congregationItems.some((item) => {
            let memberData = {};
            try {
                memberData = JSON.parse(item.data);
            }
            catch {
                memberData = {};
            }
            return (normalizeEmail(memberData.email) === requestEmail &&
                memberData.role === "parking-admin");
        });
        if (!hasParkingAdminRole) {
            return forbiddenResponse(time, "You do not have access to manage parking settings.");
        }
    }
    if ((requestPath.endsWith("/admin/users") ||
        requestPath.endsWith("/admin/users/groups")) &&
        !isUserManager(requestGroups)) {
        return forbiddenResponse(time, "You do not have access to manage user groups.");
    }
    if ((requestPath.endsWith("/announcements/week") ||
        requestPath.endsWith("/announcements/week/remove")) &&
        !isUserManager(requestGroups)) {
        return forbiddenResponse(time, "You do not have access to add or edit announcements.");
    }
    if (requestPath.endsWith("/contacts/import") && !isUserManager(requestGroups)) {
        return forbiddenResponse(time, "You do not have access to import contacts.");
    }
    if ((requestPath.endsWith("/admin/users") ||
        requestPath.endsWith("/admin/users/groups")) &&
        !userPoolId) {
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
        if (requestPath.endsWith("/parking/registration")) {
            const payload = JSON.parse(event.body ?? "{}");
            if (!payload.firstName ||
                !payload.lastName ||
                !payload.licensePlate ||
                !payload.personalEmail ||
                !payload.cellPhone ||
                !payload.durationFrom ||
                !payload.durationTo) {
                return {
                    statusCode: 400,
                    headers: responseHeaders,
                    body: JSON.stringify({
                        message: "First name, last name, license plate, personal email, telephone cell, and duration fields are required.",
                        time,
                    }),
                };
            }
            if (!isParkingMonthValue(payload.durationFrom) ||
                !isParkingMonthValue(payload.durationTo)) {
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
            const existingRegistrationsResponse = await dynamoClient.send(new QueryCommand({
                TableName: tableName,
                KeyConditionExpression: "pk = :pk",
                ExpressionAttributeValues: {
                    ":pk": "PARKING_REGISTRATION",
                },
            }));
            const existingRegistrations = (existingRegistrationsResponse.Items ?? []);
            const duplicateRegistration = existingRegistrations.some((item) => {
                try {
                    const existingData = JSON.parse(item.data);
                    return normalizeLicensePlate(existingData.licensePlate) === normalizedLicensePlate;
                }
                catch {
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
                dynamoClient.send(new GetCommand({
                    TableName: tableName,
                    Key: {
                        pk: "PARKING_SETTINGS",
                        sk: "CONFIG",
                    },
                })),
                dynamoClient.send(new QueryCommand({
                    TableName: tableName,
                    KeyConditionExpression: "pk = :pk",
                    ExpressionAttributeValues: {
                        ":pk": "PARKING_REGISTRATION",
                    },
                })),
            ]);
            let settingsData = {
                maxSpots: 0,
                updatedAt: "",
            };
            try {
                if (settingsResponse.Item?.data) {
                    settingsData = JSON.parse(String(settingsResponse.Item.data));
                }
            }
            catch {
                settingsData = {
                    maxSpots: 0,
                    updatedAt: "",
                };
            }
            const existingParkingRegistrations = (registrationsResponse.Items ?? [])
                .map((item) => {
                try {
                    return JSON.parse(item.data);
                }
                catch {
                    return null;
                }
            })
                .filter(Boolean);
            const currentActiveCount = existingParkingRegistrations.filter((registration) => isActiveParkingPlacementStatus(registration.placementStatus)).length;
            const currentWaitingListCount = existingParkingRegistrations.filter((registration) => registration.placementStatus === "waiting-list").length;
            const placementStatus = settingsData.maxSpots > currentActiveCount ? "available" : "waiting-list";
            const waitingListPosition = placementStatus === "waiting-list" ? currentWaitingListCount + 1 : undefined;
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
            const data = {
                history: [
                    {
                        timestamp: time,
                        action: "parking_registration_created",
                        message: placementStatus === "available"
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
            await dynamoClient.send(new PutCommand({
                TableName: tableName,
                Item: {
                    pk: "PARKING_REGISTRATION",
                    sk: `REGISTRATION#${registrationId}`,
                    data: JSON.stringify(data),
                },
            }));
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
            }
            catch (error) {
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
                    message: placementStatus === "available"
                        ? "Parking registration submitted and marked as Available."
                        : "Parking registration submitted and added to the waiting list.",
                    time,
                    pk: "PARKING_REGISTRATION",
                    sk: `REGISTRATION#${registrationId}`,
                }),
            };
        }
        if (requestPath.endsWith("/parking/management")) {
            const payload = JSON.parse(event.body ?? "{}");
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
            await dynamoClient.send(new PutCommand({
                TableName: tableName,
                Item: {
                    pk: "PARKING_SETTINGS",
                    sk: "CONFIG",
                    data: JSON.stringify({
                        maxSpots,
                        updatedAt: time,
                    }),
                },
            }));
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
            const payload = JSON.parse(event.body ?? "{}");
            if (!payload.sk ||
                (payload.placementStatus !== "assigned" &&
                    payload.placementStatus !== "waiting-list" &&
                    payload.placementStatus !== "available")) {
                return {
                    statusCode: 400,
                    headers: responseHeaders,
                    body: JSON.stringify({
                        message: "sk and placementStatus are required.",
                        time,
                    }),
                };
            }
            const existingResponse = await dynamoClient.send(new GetCommand({
                TableName: tableName,
                Key: {
                    pk: "PARKING_REGISTRATION",
                    sk: payload.sk,
                },
            }));
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
            let existingData;
            try {
                existingData = JSON.parse(String(existingResponse.Item.data));
            }
            catch {
                return {
                    statusCode: 500,
                    headers: responseHeaders,
                    body: JSON.stringify({
                        message: "Parking registration data is invalid.",
                        time,
                    }),
                };
            }
            const { isActive: _legacyIsActive, ...existingDataWithoutLegacyFlag } = existingData;
            await dynamoClient.send(new PutCommand({
                TableName: tableName,
                Item: {
                    pk: "PARKING_REGISTRATION",
                    sk: payload.sk,
                    data: JSON.stringify({
                        ...existingDataWithoutLegacyFlag,
                        history: [
                            {
                                timestamp: time,
                                action: payload.placementStatus === "assigned"
                                    ? "parking_registration_assigned"
                                    : payload.placementStatus === "available"
                                        ? "parking_registration_available"
                                        : "parking_registration_waiting_list",
                                message: payload.placementStatus === "assigned"
                                    ? "Parking registration moved to assigned."
                                    : payload.placementStatus === "available"
                                        ? "Parking registration moved to available."
                                        : "Parking registration moved to the waiting list.",
                            },
                            ...(existingDataWithoutLegacyFlag.history ?? []),
                        ],
                        placementStatus: payload.placementStatus,
                    }),
                },
            }));
            return {
                statusCode: 200,
                headers: responseHeaders,
                body: JSON.stringify({
                    message: payload.placementStatus === "assigned"
                        ? "Parking registration assigned."
                        : payload.placementStatus === "available"
                            ? "Parking registration marked as available."
                            : "Parking registration moved to the waiting list.",
                    time,
                }),
            };
        }
        if (requestPath.endsWith("/contacts/import")) {
            const payload = JSON.parse(event.body ?? "{}");
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
            const existingMembersResponse = await dynamoClient.send(new QueryCommand({
                TableName: tableName,
                KeyConditionExpression: "pk = :pk",
                ExpressionAttributeValues: {
                    ":pk": "CONGREGATION",
                },
            }));
            const existingMembers = (existingMembersResponse.Items ?? []);
            const emailKeys = new Set();
            const phoneKeys = new Set();
            const nameKeys = new Set();
            for (const item of existingMembers) {
                let memberData = {};
                try {
                    memberData = JSON.parse(item.data);
                }
                catch {
                    memberData = {};
                }
                const emailKey = normalizeEmail(memberData.email);
                const phoneKey = normalizePhone(memberData.phone);
                const nameKey = normalizeName(memberData.firstName, memberData.lastName);
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
            const importedMembers = [];
            const skippedMembers = [];
            for (const contact of parsedContacts) {
                const emailKey = normalizeEmail(contact.email);
                const phoneKey = normalizePhone(contact.phone);
                const nameKey = normalizeName(contact.firstName, contact.lastName, contact.displayName);
                const contactLabel = contact.displayName ||
                    normalizeWhitespace([contact.firstName, contact.lastName].join(" ")) ||
                    contact.email ||
                    contact.phone ||
                    "Imported contact";
                const alreadyExists = (emailKey && emailKeys.has(emailKey)) ||
                    (phoneKey && phoneKeys.has(phoneKey)) ||
                    (nameKey && nameKeys.has(nameKey));
                if (alreadyExists) {
                    skippedMembers.push(contactLabel);
                    continue;
                }
                await dynamoClient.send(new PutCommand({
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
                }));
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
                    message: importedMembers.length > 0
                        ? `Imported ${importedMembers.length} contact${importedMembers.length === 1 ? "" : "s"}.`
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
            const payload = JSON.parse(event.body ?? "{}");
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
            const nextGroups = payload.groups.filter((group) => allowedUserGroups.includes(group));
            const existingGroupsResponse = await cognitoClient.send(new AdminListGroupsForUserCommand({
                UserPoolId: userPoolId,
                Username: payload.username,
            }));
            const existingGroups = (existingGroupsResponse.Groups ?? [])
                .map((group) => group.GroupName)
                .filter((groupName) => Boolean(groupName))
                .filter((groupName) => allowedUserGroups.includes(groupName));
            const groupsToAdd = nextGroups.filter((group) => !existingGroups.includes(group));
            const groupsToRemove = existingGroups.filter((groupName) => !nextGroups.includes(groupName));
            await Promise.all([
                ...groupsToAdd.map((groupName) => cognitoClient.send(new AdminAddUserToGroupCommand({
                    GroupName: groupName,
                    UserPoolId: userPoolId,
                    Username: payload.username,
                }))),
                ...groupsToRemove.map((groupName) => cognitoClient.send(new AdminRemoveUserFromGroupCommand({
                    GroupName: groupName,
                    UserPoolId: userPoolId,
                    Username: payload.username,
                }))),
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
            const payload = JSON.parse(event.body ?? "{}");
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
            await dynamoClient.send(new DeleteCommand({
                TableName: tableName,
                Key: {
                    pk: "ANNOUNCEMENT",
                    sk: payload.sk,
                },
            }));
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
            const payload = JSON.parse(event.body ?? "{}");
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
            const existingAnnouncementResponse = await dynamoClient.send(new GetCommand({
                TableName: tableName,
                Key: {
                    pk: "ANNOUNCEMENT",
                    sk: announcementSk,
                },
            }));
            if (existingAnnouncementResponse.Item &&
                (!payload.sk || payload.sk !== announcementSk)) {
                return {
                    statusCode: 409,
                    headers: responseHeaders,
                    body: JSON.stringify({
                        message: "An announcement week already exists for that week.",
                        time,
                    }),
                };
            }
            await dynamoClient.send(new PutCommand({
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
            }));
            if (payload.sk && payload.sk !== announcementSk) {
                await dynamoClient.send(new DeleteCommand({
                    TableName: tableName,
                    Key: {
                        pk: "ANNOUNCEMENT",
                        sk: payload.sk,
                    },
                }));
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
            const payload = JSON.parse(event.body ?? "{}");
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
            if ((payload.action === "note" ||
                payload.action === "complete" ||
                payload.action === "delete") &&
                !payload.visitationId) {
                return {
                    statusCode: 400,
                    headers: responseHeaders,
                    body: JSON.stringify({
                        message: "visitationId is required for note, complete, and delete actions.",
                        time,
                    }),
                };
            }
            const existingResponse = await dynamoClient.send(new GetCommand({
                TableName: tableName,
                Key: {
                    pk: payload.pk,
                    sk: payload.sk,
                },
            }));
            const existingItem = existingResponse.Item;
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
            let existingData = {};
            try {
                existingData = JSON.parse(existingItem.data);
            }
            catch {
                existingData = {};
            }
            const existingVisitations = existingData.visitations ?? [];
            let nextVisitations = existingVisitations;
            let historyMessage = "";
            if (payload.action === "schedule") {
                const assignedPriestSk = payload.assignedPriestSk?.trim() ?? "";
                let assignedPriestName = "";
                if (assignedPriestSk) {
                    const assignedPriestResponse = await dynamoClient.send(new GetCommand({
                        TableName: tableName,
                        Key: {
                            pk: "CONGREGATION",
                            sk: assignedPriestSk,
                        },
                    }));
                    const assignedPriestItem = assignedPriestResponse.Item;
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
                    let assignedPriestData = {};
                    try {
                        assignedPriestData = JSON.parse(assignedPriestItem.data);
                    }
                    catch {
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
                    nextVisitations = existingVisitations.map((visitation) => visitation.id === payload.visitationId
                        ? {
                            ...visitation,
                            scheduledAt: payload.schedule,
                            assignedPriestSk: assignedPriestSk || undefined,
                            assignedPriestName: assignedPriestName || undefined,
                            updatedAt: time,
                        }
                        : visitation);
                    historyMessage = assignedPriestName
                        ? `Visitation schedule updated to ${payload.schedule}. Assigned to ${assignedPriestName}.`
                        : `Visitation schedule updated to ${payload.schedule}.`;
                }
                else {
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
                nextVisitations = existingVisitations.map((visitation) => visitation.id === payload.visitationId
                    ? {
                        ...visitation,
                        note: payload.note,
                        updatedAt: time,
                    }
                    : visitation);
                const targetVisit = existingVisitations.find((visitation) => visitation.id === payload.visitationId);
                historyMessage = targetVisit?.note
                    ? "Visitation note edited."
                    : "Visitation note added.";
            }
            if (payload.action === "complete") {
                nextVisitations = existingVisitations.map((visitation) => visitation.id === payload.visitationId
                    ? {
                        ...visitation,
                        completedAt: time,
                        updatedAt: time,
                    }
                    : visitation);
                historyMessage = "Visitation marked as done.";
            }
            if (payload.action === "delete") {
                const targetVisit = existingVisitations.find((visitation) => visitation.id === payload.visitationId);
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
                nextVisitations = existingVisitations.filter((visitation) => visitation.id !== payload.visitationId);
                historyMessage = "Visitation deleted.";
            }
            await dynamoClient.send(new PutCommand({
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
            }));
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
            const payload = JSON.parse(event.body ?? "{}");
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
            const existingResponse = await dynamoClient.send(new GetCommand({
                TableName: tableName,
                Key: {
                    pk: payload.pk,
                    sk: payload.sk,
                },
            }));
            const existingItem = existingResponse.Item;
            let existingData = {};
            if (existingItem) {
                try {
                    existingData = JSON.parse(existingItem.data);
                }
                catch {
                    existingData = {};
                }
            }
            if (payload.role === "Priest" &&
                existingData.role !== "Priest" &&
                !isAdminUser(requestGroups)) {
                return forbiddenResponse(time, "Only admins can assign the Priest role to a member.");
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
            await dynamoClient.send(new PutCommand({
                TableName: tableName,
                Item: {
                    pk: payload.pk,
                    sk: payload.sk,
                    data,
                    photo: payload.photo ?? existingItem?.photo ?? "",
                },
            }));
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
            const payload = JSON.parse(event.body ?? "{}");
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
            await dynamoClient.send(new DeleteCommand({
                TableName: tableName,
                Key: {
                    pk: payload.pk,
                    sk: payload.sk,
                },
            }));
            return {
                statusCode: 200,
                headers: responseHeaders,
                body: JSON.stringify({
                    message: "Congregation member deleted.",
                    time,
                }),
            };
        }
        const payload = JSON.parse(event.body ?? "{}");
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
            return forbiddenResponse(time, "Only admins can assign the Priest role to a member.");
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
        await dynamoClient.send(new PutCommand({
            TableName: tableName,
            Item: {
                pk: "CONGREGATION",
                sk: `MEMBER#${memberId}`,
                data,
                photo: payload.photo ?? "",
            },
        }));
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
        const usersResponse = await cognitoClient.send(new ListUsersCommand({
            UserPoolId: userPoolId,
        }));
        const users = await Promise.all((usersResponse.Users ?? []).map(async (user) => {
            const username = user.Username ?? "";
            const email = user.Attributes?.find((attribute) => attribute.Name === "email")?.Value ?? "";
            const groupsResponse = await cognitoClient.send(new AdminListGroupsForUserCommand({
                UserPoolId: userPoolId,
                Username: username,
            }));
            return {
                username,
                email,
                enabled: user.Enabled ?? false,
                status: user.UserStatus ?? "UNKNOWN",
                groups: (groupsResponse.Groups ?? [])
                    .map((group) => group.GroupName)
                    .filter((groupName) => Boolean(groupName))
                    .filter((groupName) => allowedUserGroups.includes(groupName)),
            };
        }));
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
        const response = await dynamoClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "pk = :pk",
            ExpressionAttributeValues: {
                ":pk": "ANNOUNCEMENT",
            },
        }));
        const items = (response.Items ?? []).sort((left, right) => left.sk.localeCompare(right.sk));
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
            dynamoClient.send(new GetCommand({
                TableName: tableName,
                Key: {
                    pk: "PARKING_SETTINGS",
                    sk: "CONFIG",
                },
            })),
            dynamoClient.send(new QueryCommand({
                TableName: tableName,
                KeyConditionExpression: "pk = :pk",
                ExpressionAttributeValues: {
                    ":pk": "PARKING_REGISTRATION",
                },
            })),
        ]);
        let settingsData = {
            maxSpots: 0,
            updatedAt: "",
        };
        try {
            if (settingsResponse.Item?.data) {
                settingsData = JSON.parse(String(settingsResponse.Item.data));
            }
        }
        catch {
            settingsData = {
                maxSpots: 0,
                updatedAt: "",
            };
        }
        const registrations = (registrationsResponse.Items ?? []).map((item) => {
            try {
                return JSON.parse(item.data);
            }
            catch {
                return null;
            }
        }).filter(Boolean);
        const activeRegistrationCount = registrations.filter((registration) => isActiveParkingPlacementStatus(registration.placementStatus)).length;
        const waitingListCount = registrations.filter((registration) => registration.placementStatus === "waiting-list").length;
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
        const registrationsResponse = await dynamoClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "pk = :pk",
            ExpressionAttributeValues: {
                ":pk": "PARKING_REGISTRATION",
            },
        }));
        const items = (registrationsResponse.Items ?? [])
            .map((item) => {
            try {
                return {
                    pk: item.pk,
                    sk: item.sk,
                    ...JSON.parse(item.data),
                };
            }
            catch {
                return null;
            }
        })
            .filter(Boolean)
            .sort((left, right) => String(left?.registeredAt ?? "").localeCompare(String(right?.registeredAt ?? "")));
        return {
            statusCode: 200,
            headers: responseHeaders,
            body: JSON.stringify({
                message: "Parking registrations loaded.",
                time,
                items,
            }),
        };
    }
    const response = await dynamoClient.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
            ":pk": "CONGREGATION",
        },
    }));
    const items = (response.Items ?? []).sort((left, right) => left.sk.localeCompare(right.sk));
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
