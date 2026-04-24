"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePortOnePayMethod = normalizePortOnePayMethod;
exports.isPortOneConfigured = isPortOneConfigured;
exports.getPortOneCredentials = getPortOneCredentials;
exports.getPortOneWebhookHeaders = getPortOneWebhookHeaders;
exports.getPortOnePayment = getPortOnePayment;
exports.verifyPortOneWebhook = verifyPortOneWebhook;
const server_sdk_1 = require("@portone/server-sdk");
function normalizePortOnePayMethod(value) {
    return value === "TRANSFER" ? "TRANSFER" : "CARD";
}
function isPortOneConfigured() {
    return Boolean(process.env.PORTONE_STORE_ID?.trim() &&
        process.env.PORTONE_CHANNEL_KEY?.trim() &&
        process.env.PORTONE_API_SECRET?.trim());
}
function getPortOneCredentials() {
    const storeId = process.env.PORTONE_STORE_ID?.trim();
    const channelKey = process.env.PORTONE_CHANNEL_KEY?.trim();
    const apiSecret = process.env.PORTONE_API_SECRET?.trim();
    if (!storeId || !channelKey || !apiSecret) {
        throw new Error("PortOne credentials are not configured.");
    }
    return {
        storeId,
        channelKey,
        apiSecret,
        webhookSecret: process.env.PORTONE_WEBHOOK_SECRET?.trim() || undefined
    };
}
function getPortOneWebhookHeaders(headers) {
    const webhookId = headers.get("webhook-id") ?? "";
    const webhookSignature = headers.get("webhook-signature") ?? "";
    const webhookTimestamp = headers.get("webhook-timestamp") ?? "";
    if (!webhookId || !webhookSignature || !webhookTimestamp) {
        return null;
    }
    return {
        "webhook-id": webhookId,
        "webhook-signature": webhookSignature,
        "webhook-timestamp": webhookTimestamp
    };
}
async function getPortOnePayment(credentials, paymentId) {
    const client = (0, server_sdk_1.PaymentClient)({ secret: credentials.apiSecret });
    return client.getPayment({ paymentId });
}
async function verifyPortOneWebhook(input) {
    return server_sdk_1.Webhook.verify(input.webhookSecret, input.payload, input.headers);
}
//# sourceMappingURL=portone.js.map