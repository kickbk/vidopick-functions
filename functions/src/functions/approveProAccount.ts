import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { sendExpoPushNotifications } from "../utils/expoPush.js";

if (!admin.apps.length) admin.initializeApp();

/**
 * Approve a user's Pro sponsorship request.
 * Callable from the web dashboard by org admins or platform admins.
 */
export const approveProAccount = onCall(
  { region: "us-central1", memory: "256MiB" },
  async (request) => {
    if (!request.auth)
      throw new HttpsError("unauthenticated", "Not authenticated");

    const callerRole = request.auth.token.role as string | undefined;
    const callerOrgId = request.auth.token.organizationId as string | undefined;

    if (callerRole !== "admin" && callerRole !== "organization") {
      throw new HttpsError(
        "permission-denied",
        "Only admins and organization accounts can approve Pro",
      );
    }

    const { uid, organizationId } = request.data as {
      uid?: string;
      organizationId?: string;
    };

    if (!uid) throw new HttpsError("invalid-argument", "uid is required");

    // Determine effective org ID
    const orgId = organizationId ?? callerOrgId;
    if (!orgId)
      throw new HttpsError("invalid-argument", "organizationId required");

    // Org accounts can only approve for their own org
    if (callerRole === "organization" && orgId !== callerOrgId) {
      throw new HttpsError(
        "permission-denied",
        "You can only approve users for your own organization",
      );
    }

    const db = admin.firestore();

    const [userSnap, orgSnap] = await Promise.all([
      db.doc(`users/${uid}`).get(),
      db.doc(`organizations/${orgId}`).get(),
    ]);

    if (!userSnap.exists)
      throw new HttpsError("not-found", "User document not found");

    const orgName: string = orgSnap.data()?.name ?? "your organization";
    const userData = userSnap.data()!;

    const now = admin.firestore.Timestamp.now();

    // Only set approvedAt the first time (preserve the earliest Pro date for display)
    const alreadyPro = userData.proStatus === "active";
    await db.doc(`users/${uid}`).update({
      proStatus: "active",
      proType: "sponsored",
      sponsoredBy: admin.firestore.FieldValue.arrayUnion(orgId),
      pendingApprovalFrom: admin.firestore.FieldValue.arrayRemove(orgId),
      ...(alreadyPro ? {} : { approvedAt: now }),
    });

    // Write/update orgSponsors subcollection for billing tracking
    const orgUserRef = db.doc(`orgSponsors/${orgId}/users/${uid}`);
    const orgUserSnap = await orgUserRef.get();
    if (orgUserSnap.exists) {
      // Close any accidentally open period, then add a fresh one
      const existingPeriods: any[] = orgUserSnap.data()!.periods ?? [];
      const closedPeriods = existingPeriods.map((p: any) =>
        p.endedAt === null ? { ...p, endedAt: now } : p,
      );
      await orgUserRef.set({
        uid,
        displayName:
          (userData.identities as Record<string, string> | undefined)?.[
            orgId
          ] ?? "",
        email: userData.email ?? "",
        periods: [...closedPeriods, { startedAt: now, endedAt: null }],
        approvedAt: now,
        updatedAt: now,
      });
    } else {
      await orgUserRef.set({
        uid,
        displayName:
          (userData.identities as Record<string, string> | undefined)?.[
            orgId
          ] ?? "",
        email: userData.email ?? "",
        periods: [{ startedAt: now, endedAt: null }],
        approvedAt: now,
        updatedAt: now,
      });
    }

    console.log(`[approveProAccount] uid=${uid} approved by org=${orgId}`);

    const userEmail: string = userData.email ?? "";
    const displayName: string =
      (userData.identities as Record<string, string> | undefined)?.[orgId] ??
      userEmail ??
      "there";

    // Send push notification to the user (non-fatal)
    const deviceTokens: string[] = userData.deviceTokens ?? [];
    await sendExpoPushNotifications(
      deviceTokens,
      {
        title: "You have Vidopick Pro!",
        body: `${orgName} approved your Pro account. Welcome!`,
      },
      { type: "pro_approved", organizationId: orgId },
    );

    // Send approval email (non-fatal)
    if (userEmail) {
      try {
        const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
        const SENDER_EMAIL = "vidopickhelp@gmail.com";
        if (GMAIL_APP_PASSWORD) {
          const nodemailer = await import("nodemailer");
          const { buildProApprovalEmail } =
            await import("../utils/emailTemplates.js");
          const transporter = nodemailer.default.createTransport({
            service: "gmail",
            auth: { user: SENDER_EMAIL, pass: GMAIL_APP_PASSWORD },
          });
          await transporter.sendMail({
            from: `"Vidopick" <${SENDER_EMAIL}>`,
            to: userEmail,
            subject: `You have Vidopick Pro. Your request was approved by ${orgName}`,
            html: buildProApprovalEmail(displayName, orgName),
          });
          console.log(
            `[approveProAccount] approval email sent to ${userEmail}`,
          );
        }
      } catch (e) {
        console.warn("[approveProAccount] approval email failed:", e);
      }
    }

    return { success: true };
  },
);

/**
 * Decline a pending Pro sponsorship request.
 */
export const declineProAccount = onCall(
  { region: "us-central1", memory: "256MiB" },
  async (request) => {
    if (!request.auth)
      throw new HttpsError("unauthenticated", "Not authenticated");

    const callerRole = request.auth.token.role as string | undefined;
    const callerOrgId = request.auth.token.organizationId as string | undefined;

    if (callerRole !== "admin" && callerRole !== "organization") {
      throw new HttpsError(
        "permission-denied",
        "Only admins and organization accounts can decline Pro",
      );
    }

    const { uid, organizationId } = request.data as {
      uid?: string;
      organizationId?: string;
    };
    if (!uid) throw new HttpsError("invalid-argument", "uid is required");

    const orgId = organizationId ?? callerOrgId;
    if (!orgId)
      throw new HttpsError("invalid-argument", "organizationId required");

    if (callerRole === "organization" && orgId !== callerOrgId) {
      throw new HttpsError(
        "permission-denied",
        "You can only manage users for your own organization",
      );
    }

    const db = admin.firestore();

    const [userSnap, orgSnap] = await Promise.all([
      db.doc(`users/${uid}`).get(),
      db.doc(`organizations/${orgId}`).get(),
    ]);

    if (!userSnap.exists)
      throw new HttpsError("not-found", "User document not found");

    const userData = userSnap.data()!;
    const orgName: string = orgSnap.data()?.name ?? "your organization";

    // Reset to 'none' so the user can scan the invite and re-apply
    await db.doc(`users/${uid}`).update({
      proStatus: "none",
      pendingApprovalFrom: admin.firestore.FieldValue.arrayRemove(orgId),
      declinedAt: admin.firestore.FieldValue.serverTimestamp(),
      declinedBy: orgId,
    });

    console.log(`[declineProAccount] uid=${uid} declined by org=${orgId}`);

    const userEmail: string = userData.email ?? "";
    const displayName: string =
      (userData.identities as Record<string, string> | undefined)?.[orgId] ??
      userEmail ??
      "there";

    // Send push notification (non-fatal)
    const deviceTokens: string[] = userData.deviceTokens ?? [];
    console.log(
      `[declineProAccount] sending push to ${deviceTokens.length} token(s) for uid=${uid}`,
    );
    await sendExpoPushNotifications(
      deviceTokens,
      {
        title: "Pro request not approved",
        body: `${orgName} declined your request.`,
      },
      { type: "pro_declined", organizationId: orgId },
    );

    // Send decline email (non-fatal)
    if (userEmail) {
      try {
        const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
        const SENDER_EMAIL = "vidopickhelp@gmail.com";
        if (GMAIL_APP_PASSWORD) {
          const nodemailer = await import("nodemailer");
          const { buildProDeclinedEmail } =
            await import("../utils/emailTemplates.js");
          const transporter = nodemailer.default.createTransport({
            service: "gmail",
            auth: { user: SENDER_EMAIL, pass: GMAIL_APP_PASSWORD },
          });
          await transporter.sendMail({
            from: `"Vidopick" <${SENDER_EMAIL}>`,
            to: userEmail,
            subject: `Your Vidopick Pro request from ${orgName}`,
            html: buildProDeclinedEmail(displayName, orgName),
          });
          console.log(`[declineProAccount] decline email sent to ${userEmail}`);
        }
      } catch (e) {
        console.warn("[declineProAccount] decline email failed:", e);
      }
    }

    return { success: true };
  },
);
