import { defineAuth } from "@aws-amplify/backend";
export const auth = defineAuth({
    groups: ["admin", "super_user", "regular_user", "parking_admin"],
    loginWith: {
        email: true,
    },
});
