import { defineFunction } from "@aws-amplify/backend";

export const congregationMessage = defineFunction({
  name: "congregation-message",
  memoryMB: 128,
  runtime: 24,
});
