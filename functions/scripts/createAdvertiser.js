#!/usr/bin/env node

/**
 * Script to add advertisers to Firestore
 *
 * Usage:
 *   node createAdvertiser.js
 *
 * Then follow the prompts to create an advertiser
 */

const admin = require("firebase-admin");
const readline = require("readline");

// Initialize Firebase Admin
const serviceAccount = require("../integrations/firebase/service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function createAdvertiser() {
  console.log("\n🎯 Create New Advertiser\n");

  // Get advertiser details
  const name = await question('Advertiser name (e.g., "Candeeland Burbank"): ');
  const id = await question(
    'Document ID (e.g., "candeelandburbank" - lowercase, no spaces): ',
  );
  const type = await question("Type (affiliate/paid/both): ");

  const roles = [];
  if (type.includes("affiliate") || type.includes("both")) {
    roles.push("affiliate");
  }
  if (type.includes("paid") || type.includes("both")) {
    roles.push("paid");
  }

  const advertiserData = {
    id,
    name,
    isActive: true,
    roles,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Paid config
  if (roles.includes("paid")) {
    const tier = await question("Tier (1-5): ");
    const tierWeights = { 1: 1.0, 2: 2.5, 3: 5.5, 4: 12, 5: 25 };
    const monthlyPrices = { 1: 100, 2: 250, 3: 500, 4: 1000, 5: 2500 };

    advertiserData.paidConfig = {
      tier: parseInt(tier),
      weight: tierWeights[tier],
      monthlyPrice: monthlyPrices[tier],
      billingStatus: "active",
    };
  }

  // Optional fields
  const address = await question("Address (optional, press enter to skip): ");
  if (address) advertiserData.address = address;

  const phone = await question("Phone (optional): ");
  if (phone) advertiserData.phone = phone;

  const website = await question("Website (optional): ");
  if (website) advertiserData.website = website;

  const logo = await question("Logo URL (optional): ");
  if (logo) advertiserData.logo = logo;

  console.log("\n📄 Creating advertiser with data:");
  console.log(JSON.stringify(advertiserData, null, 2));

  const confirm = await question("\nCreate this advertiser? (yes/no): ");

  if (confirm.toLowerCase() !== "yes") {
    console.log("❌ Cancelled");
    rl.close();
    return;
  }

  try {
    await db.collection("organizations").doc(id).set(advertiserData);
    console.log("✅ Advertiser created successfully!");
    console.log(`\n📍 Document ID: ${id}`);
    console.log(
      `🔗 Firestore URL: https://console.firebase.google.com/project/vidopick-c725d/firestore/data/advertisers/${id}`,
    );
  } catch (error) {
    console.error("❌ Error creating advertiser:", error);
  }

  rl.close();
}

createAdvertiser();
